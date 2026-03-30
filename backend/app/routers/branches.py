"""
Router: /api/chats/{chat_id}/branches
Handles branch CRUD, message sending (with SSE streaming), and merge.
"""

from __future__ import annotations

import asyncio
import random
import uuid
from typing import Any, AsyncIterator

import litellm
from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Request, status
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from sqlalchemy import select, text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.database import get_db
from app.dependencies import get_current_user
from app.models import Branch, Chat, ModelSource, ModelSourceModel, Node, UserSettings
from app.schemas import (
    BranchCreate,
    BranchRead,
    BranchUpdate,
    CopyNodeResponse,
    MergeRequest,
    MergeResponse,
    NodeRead,
    SendMessageRequest,
)
from app.services.compression import maybe_compress_context
from app.services.encryption import decrypt_api_key
from app.services.history import count_messages_tokens, fetch_linear_history, format_history_for_llm
from app.services.title import generate_chat_title

router = APIRouter(prefix="/api/chats/{chat_id}/branches", tags=["branches"])

# ---------------------------------------------------------------------------
# Adjectives + nouns for random branch naming (wispy-river-42 style)
# ---------------------------------------------------------------------------
_ADJECTIVES = [
    "wispy", "amber", "crimson", "gentle", "hollow", "silver", "velvet",
    "brisk", "cobalt", "dusty", "frosty", "golden", "hazel", "indigo",
    "jade", "khaki", "lemon", "misty", "neon", "opal",
]
_NOUNS = [
    "river", "canyon", "harbor", "meadow", "pebble", "summit", "valley",
    "bridge", "cinder", "dagger", "ember", "flint", "glade", "haven",
    "island", "jungle", "knoll", "lantern", "moor", "nexus",
]


def _random_branch_name() -> str:
    return f"{random.choice(_ADJECTIVES)}-{random.choice(_NOUNS)}-{random.randint(10, 99)}"


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


async def _get_chat_or_404(chat_id: str, user_id: str, db: AsyncSession) -> Chat:
    result = await db.execute(
        select(Chat).where(Chat.id == chat_id, Chat.user_id == user_id)
    )
    chat = result.scalar_one_or_none()
    if chat is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Chat not found")
    return chat


async def _get_branch_or_404(branch_id: str, chat_id: str, db: AsyncSession) -> Branch:
    result = await db.execute(
        select(Branch).where(Branch.id == branch_id, Branch.chat_id == chat_id)
    )
    branch = result.scalar_one_or_none()
    if branch is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Branch not found")
    return branch


def _resolve_synthesis_model(
    override: str | None,
    user_settings: UserSettings | None,
    fallback: str,
) -> str:
    """Resolve synthesis model in priority order from the spec."""
    if override:
        return override
    if user_settings and user_settings.synthesis_model_id:
        # synthesis_model_id is an FK to model_source_models — use its model_id string
        # The caller must load the related object; here we fall through to env var
        pass
    env = settings.SYNTHESIS_MODEL
    if env:
        return env
    return fallback


# ---------------------------------------------------------------------------
# Branch CRUD
# ---------------------------------------------------------------------------


@router.get("", response_model=list[BranchRead])
async def list_branches(
    chat_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: dict[str, Any] = Depends(get_current_user),
) -> list[Branch]:
    await _get_chat_or_404(chat_id, current_user["id"], db)
    result = await db.execute(select(Branch).where(Branch.chat_id == chat_id))
    return list(result.scalars().all())


@router.post("", response_model=BranchRead, status_code=status.HTTP_201_CREATED)
async def create_branch(
    chat_id: str,
    payload: BranchCreate,
    db: AsyncSession = Depends(get_db),
    current_user: dict[str, Any] = Depends(get_current_user),
) -> Branch:
    await _get_chat_or_404(chat_id, current_user["id"], db)

    head_node_id: str | None = None
    if payload.source_node_id is not None:
        # Verify the source node belongs to this chat
        node_result = await db.execute(
            select(Node).where(Node.id == str(payload.source_node_id), Node.chat_id == chat_id)
        )
        if node_result.scalar_one_or_none() is None:
            raise HTTPException(status_code=404, detail="Source node not found in this chat")
        head_node_id = str(payload.source_node_id)

    branch = Branch(
        chat_id=chat_id,
        name=payload.name,
        head_node_id=head_node_id,
    )
    db.add(branch)
    try:
        await db.flush()
    except IntegrityError:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Branch name already exists in this chat",
        )
    await db.refresh(branch)
    return branch


@router.get("/{branch_id}", response_model=BranchRead)
async def get_branch(
    chat_id: str,
    branch_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: dict[str, Any] = Depends(get_current_user),
) -> Branch:
    await _get_chat_or_404(chat_id, current_user["id"], db)
    return await _get_branch_or_404(branch_id, chat_id, db)


@router.patch("/{branch_id}", response_model=BranchRead)
async def update_branch(
    chat_id: str,
    branch_id: str,
    payload: BranchUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: dict[str, Any] = Depends(get_current_user),
) -> Branch:
    await _get_chat_or_404(chat_id, current_user["id"], db)
    branch = await _get_branch_or_404(branch_id, chat_id, db)
    if payload.name is not None:
        branch.name = payload.name
    await db.flush()
    await db.refresh(branch)
    return branch


@router.delete("/{branch_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_branch(
    chat_id: str,
    branch_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: dict[str, Any] = Depends(get_current_user),
) -> None:
    """
    Delete a branch and cascade-delete all nodes exclusively reachable through it
    (i.e., not referenced as parents by nodes on other branches).
    """
    await _get_chat_or_404(chat_id, current_user["id"], db)
    branch = await _get_branch_or_404(branch_id, chat_id, db)

    # Collect all node IDs exclusively owned by this branch
    # Strategy: walk the ancestry of this branch's HEAD; exclude any node that is
    # also an ancestor of another branch's HEAD.
    owned_nodes = (
        await _collect_exclusive_nodes(branch.head_node_id, branch_id, chat_id, db)
        if branch.head_node_id
        else []
    )

    await db.delete(branch)
    await db.flush()

    # Delete exclusively owned nodes (leaves first to satisfy FK constraints)
    for node_id in owned_nodes:
        node_result = await db.execute(select(Node).where(Node.id == node_id))
        node = node_result.scalar_one_or_none()
        if node:
            await db.delete(node)


async def _collect_exclusive_nodes(
    head_node_id: str, branch_id: str, chat_id: str, db: AsyncSession
) -> list[str]:
    """
    Return the list of node IDs exclusively reachable through the given branch
    starting from head_node_id — nodes whose only path to any branch HEAD goes
    through this branch.
    """
    # Fetch all other branch HEADs in this chat
    other_branches = await db.execute(
        select(Branch).where(Branch.chat_id == chat_id, Branch.id != branch_id)
    )
    other_heads = [b.head_node_id for b in other_branches.scalars().all()]

    # Collect all ancestors of OTHER branches
    shared_ancestors: set[str] = set()
    for head in other_heads:
        ancestors = await _walk_ancestors(head, db)
        shared_ancestors.update(ancestors)

    # Collect this branch's ancestry
    own_ancestors = await _walk_ancestors(head_node_id, db)

    # Exclusively owned = in own chain but not in any other branch's chain
    return [nid for nid in own_ancestors if nid not in shared_ancestors]


async def _walk_ancestors(node_id: str, db: AsyncSession) -> list[str]:
    """Walk up parent chain; return all node IDs from node_id to root (inclusive)."""
    cte = text(
        """
        WITH RECURSIVE ancestry AS (
            SELECT id, parent_id FROM nodes WHERE id = :node_id
            UNION ALL
            SELECT n.id, n.parent_id FROM nodes n INNER JOIN ancestry a ON n.id = a.parent_id
        )
        SELECT id FROM ancestry
        """
    )
    result = await db.execute(cte, {"node_id": node_id})
    return [row[0] for row in result.fetchall()]


# ---------------------------------------------------------------------------
# Linear history for a branch (or arbitrary node)
# ---------------------------------------------------------------------------


@router.get("/{branch_id}/history", response_model=list[NodeRead])
async def get_branch_history(
    chat_id: str,
    branch_id: str,
    node_id: str | None = None,
    db: AsyncSession = Depends(get_db),
    current_user: dict[str, Any] = Depends(get_current_user),
) -> list[dict]:
    """
    Return the linear history up to the branch HEAD (or a specific node_id if provided).
    """
    await _get_chat_or_404(chat_id, current_user["id"], db)
    branch = await _get_branch_or_404(branch_id, chat_id, db)

    target = node_id or branch.head_node_id
    if not target:
        return []
    return await fetch_linear_history(db, target)


# ---------------------------------------------------------------------------
# Manual context compression
# ---------------------------------------------------------------------------


class CompressRequest(BaseModel):
    model: str
    context_window_tokens: int = 8192


class CompressResponse(BaseModel):
    compressed: bool
    new_node_id: str | None = None
    message: str


@router.post("/{branch_id}/compress", response_model=CompressResponse)
async def compress_branch_context(
    chat_id: str,
    branch_id: str,
    payload: CompressRequest,
    db: AsyncSession = Depends(get_db),
    current_user: dict[str, Any] = Depends(get_current_user),
) -> CompressResponse:
    """
    Manually trigger context compression for a branch.
    Summarises the oldest nodes if the history is above the compression threshold.
    """
    await _get_chat_or_404(chat_id, current_user["id"], db)
    branch = await _get_branch_or_404(branch_id, chat_id, db)

    new_node_id = await maybe_compress_context(
        branch, payload.model, payload.context_window_tokens, db
    )

    if new_node_id is None:
        return CompressResponse(
            compressed=False,
            message="History is within the context budget — no compression needed.",
        )

    await db.commit()
    return CompressResponse(
        compressed=True,
        new_node_id=new_node_id,
        message="Oldest nodes successfully compressed into a summary node.",
    )


# ---------------------------------------------------------------------------
# Send message + SSE stream
# ---------------------------------------------------------------------------


@router.post("/{branch_id}/messages", status_code=status.HTTP_200_OK)
async def send_message(
    chat_id: str,
    branch_id: str,
    payload: SendMessageRequest,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
    current_user: dict[str, Any] = Depends(get_current_user),
) -> StreamingResponse:
    """
    Create a new node, stream the AI response via SSE, and persist the full
    response once streaming completes.  Partial responses are never persisted.
    """
    chat = await _get_chat_or_404(chat_id, current_user["id"], db)
    needs_title = chat.title is None
    branch = await _get_branch_or_404(branch_id, chat_id, db)

    # Determine parent node (None for root node when branch has no messages yet)
    parent_id: str | None = (
        str(payload.parent_node_id) if payload.parent_node_id else branch.head_node_id
    )

    # Create the node immediately (ai_response is NULL until streaming completes)
    node = Node(
        chat_id=chat_id,
        parent_id=parent_id,
        user_prompt=payload.user_prompt,
        model_used=payload.model_used,
    )
    db.add(node)
    await db.flush()
    node_id = node.id
    await db.commit()

    # Fetch linear history for LLM context
    history = await fetch_linear_history(db, parent_id)
    messages = await format_history_for_llm(history)

    # Inject custom instructions if set
    user_settings_result = await db.execute(
        select(UserSettings).where(UserSettings.user_id == current_user["id"])
    )
    user_settings = user_settings_result.scalar_one_or_none()
    if user_settings and user_settings.custom_instructions:
        messages.insert(0, {"role": "system", "content": user_settings.custom_instructions})

    messages.append({"role": "user", "content": payload.user_prompt})

    # Look up API key / base_url from the model source for this model
    _source_result = await db.execute(
        select(ModelSource)
        .join(ModelSourceModel, ModelSource.id == ModelSourceModel.source_id)
        .where(
            ModelSourceModel.model_id == payload.model_used,
            ModelSource.user_id == current_user["id"],
        )
        .limit(1)
    )
    _source = _source_result.scalar_one_or_none()
    llm_api_key: str | None = (
        decrypt_api_key(_source.encrypted_api_key)
        if _source and _source.encrypted_api_key
        else None
    )
    llm_base_url: str | None = _source.base_url if _source else None

    # Fire title generation in background on first message
    if needs_title:
        background_tasks.add_task(
            generate_chat_title, chat_id, payload.user_prompt, payload.model_used
        )

    token_count = count_messages_tokens(messages)

    return StreamingResponse(
        _sse_stream(node_id, branch_id, payload.model_used, messages, db, llm_api_key, llm_base_url),
        media_type="text/event-stream",
        headers={
            "X-Node-Id": node_id,
            "X-Context-Tokens": str(token_count),
        },
    )


async def _sse_stream(
    node_id: str,
    branch_id: str,
    model: str,
    messages: list[dict],
    db: AsyncSession,
    api_key: str | None = None,
    base_url: str | None = None,
) -> AsyncIterator[str]:
    """Yield SSE events; write full response to DB on completion."""
    full_response: list[str] = []
    try:
        litellm_kwargs: dict[str, Any] = dict(
            model=model,
            messages=messages,
            stream=True,
        )
        if api_key:
            litellm_kwargs["api_key"] = api_key
        if base_url:
            litellm_kwargs["api_base"] = base_url
        response = await litellm.acompletion(**litellm_kwargs)
        yield f"data: {{\"node_id\": \"{node_id}\"}}\n\n"
        async for chunk in response:
            delta = chunk.choices[0].delta.content or ""
            if delta:
                full_response.append(delta)
                # Escape newlines for SSE data field
                safe = delta.replace("\n", "\\n")
                yield f"data: {{\"token\": \"{safe}\"}}\n\n"

        # Persist only after full response received
        complete = "".join(full_response)
        node_result = await db.execute(select(Node).where(Node.id == node_id))
        node = node_result.scalar_one()
        node.ai_response = complete

        # Advance the sending branch's HEAD to this new node
        branch_result = await db.execute(
            select(Branch).where(Branch.id == branch_id)
        )
        branch = branch_result.scalar_one_or_none()
        if branch is not None:
            branch.head_node_id = node_id

        await db.commit()
        yield "data: [DONE]\n\n"

    except Exception as exc:
        await db.rollback()
        # Delete the orphaned node
        node_result = await db.execute(select(Node).where(Node.id == node_id))
        node = node_result.scalar_one_or_none()
        if node:
            await db.delete(node)
            await db.commit()
        yield f"data: {{\"error\": \"{str(exc)}\"}}\n\n"


# ---------------------------------------------------------------------------
# Merge (synthesize-and-merge)
# ---------------------------------------------------------------------------


@router.post("/merge", response_model=MergeResponse, status_code=status.HTTP_201_CREATED)
async def merge_branches(
    chat_id: str,
    payload: MergeRequest,
    db: AsyncSession = Depends(get_db),
    current_user: dict[str, Any] = Depends(get_current_user),
) -> MergeResponse:
    """
    Synthesize the source branch into a summary node on the target branch.
    The source branch remains active after the merge.
    """
    await _get_chat_or_404(chat_id, current_user["id"], db)

    source_branch = await _get_branch_or_404(str(payload.source_branch_id), chat_id, db)
    target_branch = await _get_branch_or_404(str(payload.target_branch_id), chat_id, db)

    if not source_branch.head_node_id or not target_branch.head_node_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Cannot merge a branch with no messages",
        )

    user_settings_result = await db.execute(
        select(UserSettings).where(UserSettings.user_id == current_user["id"])
    )
    user_settings = user_settings_result.scalar_one_or_none()

    synthesis_model = _resolve_synthesis_model(
        payload.synthesis_model_override, user_settings, payload.active_model
    )

    # Build raw context from source branch
    tangent_history = await fetch_linear_history(db, source_branch.head_node_id)
    raw_context = "\n\n".join(
        f"User: {n['user_prompt']}\nAssistant: {n.get('ai_response', '[no response]')}"
        for n in tangent_history
    )

    synthesis_prompt = (
        payload.synthesis_prompt_override
        or (
            f"We explored a side-tangent in our conversation.\n"
            f"Here is the raw tangent history:\n\n{raw_context}\n\n"
            f"Summarize the key findings, code, or decisions made in this tangent so we can "
            f"continue our main conversation seamlessly."
        )
    )

    ai_response = await litellm.acompletion(
        model=synthesis_model,
        messages=[{"role": "user", "content": synthesis_prompt}],
        stream=False,
    )
    summary = ai_response.choices[0].message.content

    # Create a new merge node on the target branch.
    # is_summary=True means it acts as a context root for future AI replies.
    # merge_parent_id stores the secondary parent for graph rendering.
    new_node = Node(
        chat_id=chat_id,
        parent_id=target_branch.head_node_id,
        merge_parent_id=source_branch.head_node_id,
        user_prompt=f"[Merged Tangent: {source_branch.name}]",
        ai_response=summary,
        model_used=synthesis_model,
        is_summary=True,
    )
    db.add(new_node)
    await db.flush()

    target_branch.head_node_id = new_node.id
    await db.commit()

    return MergeResponse(status="merged", new_node_id=uuid.UUID(new_node.id))


# ---------------------------------------------------------------------------
# Copy (cherry-pick) a single node onto a branch
# ---------------------------------------------------------------------------


@router.post(
    "/{branch_id}/copy/{node_id}",
    response_model=CopyNodeResponse,
    status_code=status.HTTP_201_CREATED,
)
async def copy_node(
    chat_id: str,
    branch_id: str,
    node_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: dict[str, Any] = Depends(get_current_user),
) -> CopyNodeResponse:
    """
    Cherry-pick a single node and append it as a new child of the branch HEAD.

    Copies user_prompt, ai_response, and model_used; does NOT carry over
    is_summary or parent relationships from the source node.
    """
    await _get_chat_or_404(chat_id, current_user["id"], db)
    branch = await _get_branch_or_404(branch_id, chat_id, db)

    # Load source node (may come from any branch in the same chat)
    source_result = await db.execute(
        select(Node).where(Node.id == node_id, Node.chat_id == chat_id)
    )
    source_node = source_result.scalar_one_or_none()
    if source_node is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Source node not found")

    new_node = Node(
        chat_id=chat_id,
        parent_id=branch.head_node_id,
        user_prompt=source_node.user_prompt,
        ai_response=source_node.ai_response,
        model_used=source_node.model_used,
        is_summary=False,
    )
    db.add(new_node)
    await db.flush()

    branch.head_node_id = new_node.id
    await db.commit()
    await db.refresh(new_node)

    return CopyNodeResponse(
        new_node_id=uuid.UUID(new_node.id),
        node=NodeRead.model_validate(new_node),
    )
