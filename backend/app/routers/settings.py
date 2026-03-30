"""
Router: /api/settings
Handles user settings, model sources, and available models.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

import httpx
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.dependencies import get_current_user
from app.models import ModelSource, ModelSourceModel, UserSettings
from app.schemas import (
    ModelSourceCreate,
    ModelSourceModelCreate,
    ModelSourceModelRead,
    ModelSourceModelUpdate,
    ModelSourceRead,
    ModelSourceUpdate,
    UserSettingsRead,
    UserSettingsUpdate,
)
from app.services.encryption import decrypt_api_key, encrypt_api_key

router = APIRouter(prefix="/api/settings", tags=["settings"])


# ---------------------------------------------------------------------------
# User Settings
# ---------------------------------------------------------------------------


@router.get("/me", response_model=UserSettingsRead)
async def get_settings(
    db: AsyncSession = Depends(get_db),
    current_user: dict[str, Any] = Depends(get_current_user),
) -> UserSettings:
    result = await db.execute(
        select(UserSettings).where(UserSettings.user_id == current_user["id"])
    )
    user_settings = result.scalar_one_or_none()
    if user_settings is None:
        # Create defaults on first access
        user_settings = UserSettings(user_id=current_user["id"])
        db.add(user_settings)
        await db.flush()
        await db.refresh(user_settings)
    return user_settings


@router.patch("/me", response_model=UserSettingsRead)
async def update_settings(
    payload: UserSettingsUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: dict[str, Any] = Depends(get_current_user),
) -> UserSettings:
    result = await db.execute(
        select(UserSettings).where(UserSettings.user_id == current_user["id"])
    )
    user_settings = result.scalar_one_or_none()
    if user_settings is None:
        user_settings = UserSettings(user_id=current_user["id"])
        db.add(user_settings)

    update_data = payload.model_dump(exclude_none=True)
    for field, value in update_data.items():
        setattr(user_settings, field, str(value) if "id" in field and value else value)

    await db.flush()
    await db.refresh(user_settings)
    return user_settings


# ---------------------------------------------------------------------------
# Model Sources
# ---------------------------------------------------------------------------


@router.get("/sources", response_model=list[ModelSourceRead])
async def list_sources(
    db: AsyncSession = Depends(get_db),
    current_user: dict[str, Any] = Depends(get_current_user),
) -> list[ModelSource]:
    result = await db.execute(
        select(ModelSource).where(ModelSource.user_id == current_user["id"])
    )
    return list(result.scalars().all())


@router.post("/sources", response_model=ModelSourceRead, status_code=status.HTTP_201_CREATED)
async def create_source(
    payload: ModelSourceCreate,
    db: AsyncSession = Depends(get_db),
    current_user: dict[str, Any] = Depends(get_current_user),
) -> ModelSource:
    encrypted_key = encrypt_api_key(payload.api_key) if payload.api_key else None
    source = ModelSource(
        user_id=current_user["id"],
        name=payload.name,
        provider_type=payload.provider_type,
        base_url=payload.base_url,
        encrypted_api_key=encrypted_key,
    )
    db.add(source)
    await db.flush()
    await db.refresh(source)

    # Immediately attempt to fetch model list in the background
    # (fire-and-forget; failures are non-fatal at creation time)
    try:
        await _sync_models_for_source(source, db)
    except Exception:
        pass  # Will be retried via manual refresh

    return source


@router.get("/sources/{source_id}", response_model=ModelSourceRead)
async def get_source(
    source_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: dict[str, Any] = Depends(get_current_user),
) -> ModelSource:
    return await _get_source_or_404(source_id, current_user["id"], db)


@router.patch("/sources/{source_id}", response_model=ModelSourceRead)
async def update_source(
    source_id: str,
    payload: ModelSourceUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: dict[str, Any] = Depends(get_current_user),
) -> ModelSource:
    source = await _get_source_or_404(source_id, current_user["id"], db)
    if payload.name is not None:
        source.name = payload.name
    if payload.base_url is not None:
        source.base_url = payload.base_url
    if payload.api_key is not None:
        source.encrypted_api_key = encrypt_api_key(payload.api_key)
    await db.flush()
    await db.refresh(source)
    return source


@router.delete("/sources/{source_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_source(
    source_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: dict[str, Any] = Depends(get_current_user),
) -> None:
    source = await _get_source_or_404(source_id, current_user["id"], db)
    await db.delete(source)


@router.post("/sources/{source_id}/refresh", response_model=list[ModelSourceModelRead])
async def refresh_models(
    source_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: dict[str, Any] = Depends(get_current_user),
) -> list[ModelSourceModel]:
    """Manually trigger a model-list sync from the provider."""
    source = await _get_source_or_404(source_id, current_user["id"], db)
    try:
        return await _sync_models_for_source(source, db)
    except Exception as exc:
        raise HTTPException(
            status_code=502,
            detail=f"Provider error: {exc}",
        ) from exc


# ---------------------------------------------------------------------------
# Models within a source (manual add/update/delete for custom sources)
# ---------------------------------------------------------------------------


@router.get("/sources/{source_id}/models", response_model=list[ModelSourceModelRead])
async def list_source_models(
    source_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: dict[str, Any] = Depends(get_current_user),
) -> list[ModelSourceModel]:
    await _get_source_or_404(source_id, current_user["id"], db)
    result = await db.execute(
        select(ModelSourceModel).where(ModelSourceModel.source_id == source_id)
    )
    return list(result.scalars().all())


@router.post(
    "/sources/{source_id}/models",
    response_model=ModelSourceModelRead,
    status_code=status.HTTP_201_CREATED,
)
async def add_source_model(
    source_id: str,
    payload: ModelSourceModelCreate,
    db: AsyncSession = Depends(get_db),
    current_user: dict[str, Any] = Depends(get_current_user),
) -> ModelSourceModel:
    await _get_source_or_404(source_id, current_user["id"], db)
    model = ModelSourceModel(
        source_id=source_id,
        model_id=payload.model_id,
        display_name=payload.display_name,
        context_window_tokens=payload.context_window_tokens,
    )
    db.add(model)
    await db.flush()
    await db.refresh(model)
    return model


@router.patch("/sources/{source_id}/models/{model_id}", response_model=ModelSourceModelRead)
async def update_source_model(
    source_id: str,
    model_id: str,
    payload: ModelSourceModelUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: dict[str, Any] = Depends(get_current_user),
) -> ModelSourceModel:
    await _get_source_or_404(source_id, current_user["id"], db)
    result = await db.execute(
        select(ModelSourceModel).where(
            ModelSourceModel.id == model_id, ModelSourceModel.source_id == source_id
        )
    )
    msm = result.scalar_one_or_none()
    if msm is None:
        raise HTTPException(status_code=404, detail="Model not found")
    if payload.display_name is not None:
        msm.display_name = payload.display_name
    if payload.context_window_tokens is not None:
        msm.context_window_tokens = payload.context_window_tokens
    await db.flush()
    await db.refresh(msm)
    return msm


@router.delete("/sources/{source_id}/models/{model_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_source_model(
    source_id: str,
    model_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: dict[str, Any] = Depends(get_current_user),
) -> None:
    await _get_source_or_404(source_id, current_user["id"], db)
    result = await db.execute(
        select(ModelSourceModel).where(
            ModelSourceModel.id == model_id, ModelSourceModel.source_id == source_id
        )
    )
    msm = result.scalar_one_or_none()
    if msm is None:
        raise HTTPException(status_code=404, detail="Model not found")
    await db.delete(msm)


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------


async def _get_source_or_404(source_id: str, user_id: str, db: AsyncSession) -> ModelSource:
    result = await db.execute(
        select(ModelSource).where(ModelSource.id == source_id, ModelSource.user_id == user_id)
    )
    source = result.scalar_one_or_none()
    if source is None:
        raise HTTPException(status_code=404, detail="Model source not found")
    return source


async def _sync_models_for_source(
    source: ModelSource, db: AsyncSession
) -> list[ModelSourceModel]:
    """
    Fetch the model list from the provider API, upsert into the DB,
    and return the updated list.
    """
    api_key = decrypt_api_key(source.encrypted_api_key) if source.encrypted_api_key else None

    # Fetch (model_id, display_name, context_window_tokens) from the provider
    if source.provider_type == "gemini":
        fetched = await _fetch_gemini_models(api_key)
    elif source.provider_type in ("ollama_chat", "ollama"):
        fetched = await _fetch_ollama_models(source.base_url or "http://localhost:11434")
    elif source.provider_type == "anthropic":
        fetched = await _fetch_anthropic_models(api_key)
    else:
        # OpenAI-compatible: openai, groq, mistral, openrouter, custom, etc.
        fetched = await _fetch_openai_compatible_models(
            base_url=source.base_url or _default_base_url(source.provider_type),
            api_key=api_key,
            provider_type=source.provider_type,
        )

    now = datetime.now(timezone.utc).replace(tzinfo=None)

    # Delete existing cached models for this source
    existing_result = await db.execute(
        select(ModelSourceModel).where(ModelSourceModel.source_id == source.id)
    )
    for existing in existing_result.scalars().all():
        await db.delete(existing)

    # Insert refreshed list
    new_models = []
    for model_id, display_name, context_window in fetched:
        msm = ModelSourceModel(
            source_id=source.id,
            model_id=model_id,
            display_name=display_name,
            context_window_tokens=context_window,
            last_fetched_at=now,
        )
        db.add(msm)
        new_models.append(msm)

    await db.flush()
    return new_models


# ---------------------------------------------------------------------------
# Provider-specific model list fetchers
# ---------------------------------------------------------------------------

async def _fetch_gemini_models(api_key: str | None) -> list[tuple[str, str, int]]:
    """
    Fetch models from the Google Generative AI REST endpoint.
    Tries the provided API key first, then falls back to the GOOGLE_API_KEY
    environment variable.  Raises on failure so the caller can surface the error.
    """
    import os

    keys_to_try: list[str] = []
    if api_key:
        keys_to_try.append(api_key)
    env_key = os.environ.get("GOOGLE_API_KEY")
    if env_key and env_key not in keys_to_try:
        keys_to_try.append(env_key)

    last_error = "No API key available for Gemini — provide one in the source settings or set the GOOGLE_API_KEY environment variable."
    for key in keys_to_try:
        async with httpx.AsyncClient(timeout=15) as client:
            resp = await client.get(
                "https://generativelanguage.googleapis.com/v1beta/models",
                params={"key": key},
            )
        if resp.status_code == 200:
            data = resp.json()
            result: list[tuple[str, str, int]] = []
            for m in data.get("models", []):
                name: str = m.get("name", "")
                if not name.startswith("models/"):
                    continue
                # Only include models that support generateContent
                methods = m.get("supportedGenerationMethods", [])
                if "generateContent" not in methods:
                    continue
                short = name.removeprefix("models/")
                model_id = f"gemini/{short}"
                display_name: str = m.get("displayName", short)
                context_window: int = int(m.get("inputTokenLimit", 8192))
                result.append((model_id, display_name, context_window))
            if result:
                return result
            last_error = "Gemini API returned no usable models."
        else:
            try:
                err = resp.json().get("error", {}).get("message", resp.text[:200])
            except Exception:
                err = resp.text[:200]
            last_error = f"Gemini API error {resp.status_code}: {err}"

    raise RuntimeError(last_error)


async def _fetch_ollama_models(base_url: str) -> list[tuple[str, str, int]]:
    """Fetch models from a local Ollama instance."""
    async with httpx.AsyncClient(timeout=10) as client:
        resp = await client.get(f"{base_url.rstrip('/')}/api/tags")
        resp.raise_for_status()
        data = resp.json()
    return [
        (f"ollama_chat/{m['name']}", m["name"], 8192)
        for m in data.get("models", [])
    ]


async def _fetch_anthropic_models(api_key: str | None) -> list[tuple[str, str, int]]:
    """Fetch models from the Anthropic models API."""
    if not api_key:
        # Return a hardcoded list of well-known Anthropic models
        return _anthropic_hardcoded()
    async with httpx.AsyncClient(timeout=15) as client:
        resp = await client.get(
            "https://api.anthropic.com/v1/models",
            headers={"x-api-key": api_key, "anthropic-version": "2023-06-01"},
        )
        if resp.status_code != 200:
            return _anthropic_hardcoded()
        data = resp.json()
    result: list[tuple[str, str, int]] = []
    for m in data.get("data", []):
        mid: str = m.get("id", "")
        if not mid:
            continue
        model_id = f"anthropic/{mid}"
        display_name: str = m.get("display_name", mid)
        result.append((model_id, display_name, 200000))
    return result or _anthropic_hardcoded()


def _anthropic_hardcoded() -> list[tuple[str, str, int]]:
    return [
        ("anthropic/claude-opus-4-5", "Claude Opus 4.5", 200000),
        ("anthropic/claude-sonnet-4-5", "Claude Sonnet 4.5", 200000),
        ("anthropic/claude-haiku-3-5", "Claude Haiku 3.5", 200000),
        ("anthropic/claude-3-opus-20240229", "Claude 3 Opus", 200000),
        ("anthropic/claude-3-5-sonnet-20241022", "Claude 3.5 Sonnet", 200000),
        ("anthropic/claude-3-5-haiku-20241022", "Claude 3.5 Haiku", 200000),
    ]


async def _fetch_openai_compatible_models(
    base_url: str, api_key: str | None, provider_type: str
) -> list[tuple[str, str, int]]:
    """Fetch models from an OpenAI-compatible /models endpoint."""
    if not base_url:
        return []
    headers: dict[str, str] = {}
    if api_key:
        headers["Authorization"] = f"Bearer {api_key}"
    async with httpx.AsyncClient(timeout=15) as client:
        resp = await client.get(f"{base_url.rstrip('/')}/models", headers=headers)
        resp.raise_for_status()
        data = resp.json()
    raw: list[dict] = data if isinstance(data, list) else data.get("data", [])
    prefix = f"{provider_type}/"
    return [
        (f"{prefix}{m['id']}", m["id"], 8192)
        for m in raw
        if isinstance(m, dict) and m.get("id")
    ]


def _default_base_url(provider_type: str) -> str:
    return {
        "openai": "https://api.openai.com/v1",
        "groq": "https://api.groq.com/openai/v1",
        "mistral": "https://api.mistral.ai/v1",
        "openrouter": "https://openrouter.ai/api/v1",
    }.get(provider_type, "")
