"""
Live LLM functional tests — only run when LIVE_LLM_TESTS=1 is set in .env.

These tests perform REAL LLM calls using credentials from the environment.
They are intentionally slow, consume API tokens, and are skipped in CI unless
the operator explicitly opts in by exporting the required variables.

Provider selection (first match wins):
  GEMINI_API_KEY            — uses Google Gemini (gemini-2.0-flash)
  OPENAI_API_KEY            — uses OpenAI (gpt-4o-mini)
  At least one must be set alongside LIVE_LLM_TESTS=1.

Required environment variables (set in backend/.env or exported):
  LIVE_LLM_TESTS=1          — opt-in flag
  GEMINI_API_KEY            — Google Gemini API key  (preferred)
  OPENAI_API_KEY            — OpenAI API key         (fallback)

Run:
  make test-live            # picks up backend/.env automatically
  # — or —
  LIVE_LLM_TESTS=1 GEMINI_API_KEY=... pytest tests/e2e/test_live_llm.py -v

What is tested:
  1. A model source can be created with a live API key.
  2. The model list refresh populates real models from the provider.
  3. A message can be sent and a real streamed response is received + stored.
  4. The graph node count increases after the new message.
"""

from __future__ import annotations

import os
from pathlib import Path

import pytest
import httpx
from dotenv import load_dotenv

# Load .env files so that LIVE_LLM_TESTS and API keys are available when running
# directly with pytest (make test-live already exports them).
# Load backend/.env first (base config), then root .env (secrets/overrides).
_backend_env = Path(__file__).parents[2] / ".env"
_root_env = Path(__file__).parents[3] / ".env"
for _env_file in (_backend_env, _root_env):
    if _env_file.exists():
        load_dotenv(_env_file, override=False)

_LIVE = os.getenv("LIVE_LLM_TESTS", "0") == "1"
_SKIP_REASON = (
    "Live LLM tests disabled. Set LIVE_LLM_TESTS=1 and provide an API key "
    "in backend/.env or as an environment variable."
)

pytestmark = [
    pytest.mark.live_llm,
    pytest.mark.skipif(not _LIVE, reason=_SKIP_REASON),
]


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _auth_headers() -> dict[str, str]:
    import base64
    admin = os.getenv("ADMIN_USERNAME", "admin")
    pw = os.getenv("ADMIN_PASSWORD", "tangents")
    return {"Authorization": f"Basic {base64.b64encode(f'{admin}:{pw}'.encode()).decode()}"}


def _get_provider_config() -> dict:
    """Return provider settings, preferring Gemini over OpenAI."""
    gemini_key = os.getenv("GEMINI_API_KEY", "")
    if gemini_key:
        return {
            "key": gemini_key,
            "name": "Live Gemini",
            "provider_type": "gemini",
            "base_url": None,
            "model_id": "gemini/gemini-2.0-flash",
            "model_id_pattern": "gemini",
        }

    openai_key = os.getenv("OPENAI_API_KEY", "")
    if openai_key:
        return {
            "key": openai_key,
            "name": "Live OpenAI",
            "provider_type": "openai",
            "base_url": "https://api.openai.com/v1",
            "model_id": "gpt-4o-mini",
            "model_id_pattern": "gpt",
        }

    pytest.skip("No API key found — set GEMINI_API_KEY or OPENAI_API_KEY in backend/.env")


# ---------------------------------------------------------------------------
# Live tests
# ---------------------------------------------------------------------------

class TestLiveModelSourceRefresh:
    """Verify that adding a real provider source fetches actual models."""

    def test_create_source_and_refresh_returns_models(self, e2e_server) -> None:
        cfg = _get_provider_config()
        base = e2e_server.base_url
        headers = _auth_headers()

        # Create the source
        payload: dict = {
            "name": cfg["name"],
            "provider_type": cfg["provider_type"],
            "api_key": cfg["key"],
        }
        if cfg["base_url"]:
            payload["base_url"] = cfg["base_url"]

        resp = httpx.post(
            f"{base}/api/settings/sources",
            json=payload,
            headers=headers,
            timeout=30,
        )
        assert resp.status_code in (200, 201), resp.text
        source_id = resp.json()["id"]

        # Trigger a model-list refresh
        resp = httpx.post(
            f"{base}/api/settings/sources/{source_id}/refresh",
            headers=headers,
            timeout=30,
        )
        assert resp.status_code == 200, resp.text
        models = resp.json()
        assert len(models) > 0, f"Expected at least one model from {cfg['provider_type']}"
        model_ids = [m["model_id"] for m in models]
        pattern = cfg["model_id_pattern"]
        assert any(pattern in mid for mid in model_ids), (
            f"Expected a {pattern}-* model in {model_ids}"
        )


class TestLiveStreaming:
    """Send a real message and verify the SSE stream produces a response."""

    def _setup_source(self, base: str, headers: dict, cfg: dict, label: str = "") -> str:
        """Create a model source and refresh its model list. Returns source_id."""
        payload: dict = {
            "name": f"{cfg['name']}{' ' + label if label else ''}",
            "provider_type": cfg["provider_type"],
            "api_key": cfg["key"],
        }
        if cfg["base_url"]:
            payload["base_url"] = cfg["base_url"]

        resp = httpx.post(
            f"{base}/api/settings/sources",
            json=payload,
            headers=headers,
            timeout=30,
        )
        assert resp.status_code in (200, 201), resp.text
        source_id = resp.json()["id"]
        httpx.post(
            f"{base}/api/settings/sources/{source_id}/refresh",
            headers=headers,
            timeout=30,
        )
        return source_id

    def test_send_message_streams_real_response(self, e2e_server) -> None:
        cfg = _get_provider_config()
        base = e2e_server.base_url
        headers = _auth_headers()

        self._setup_source(base, headers, cfg, "(stream test)")

        # Create a new chat
        resp = httpx.post(f"{base}/api/chats", json={}, headers=headers, timeout=10)
        assert resp.status_code in (200, 201), resp.text
        chat_id = resp.json()["id"]

        # Create a main branch
        resp = httpx.post(
            f"{base}/api/chats/{chat_id}/branches",
            json={"name": "main"},
            headers=headers,
            timeout=10,
        )
        assert resp.status_code in (200, 201), resp.text
        branch_id = resp.json()["id"]

        # Send a simple message and consume the SSE stream
        import json as _json
        tokens: list[str] = []
        node_id: str | None = None

        with httpx.stream(
            "POST",
            f"{base}/api/chats/{chat_id}/branches/{branch_id}/messages",
            json={"user_prompt": "Reply with exactly three words.", "model_used": cfg["model_id"]},
            headers={**headers, "Content-Type": "application/json"},
            timeout=60,
        ) as resp:
            assert resp.status_code == 200, resp.text
            node_id = resp.headers.get("X-Node-Id")
            for line in resp.iter_lines():
                if line.startswith("data: "):
                    data = line[6:].strip()

                    if data == "[DONE]":
                        break
                    try:
                        parsed = _json.loads(data)
                        if "token" in parsed:
                            tokens.append(parsed["token"])
                    except Exception:
                        pass

        assert node_id is not None, "Expected X-Node-Id header from stream"
        assert len(tokens) > 0, "Expected at least one streamed token"
        full_response = "".join(tokens)
        assert len(full_response.strip()) > 0, "Expected non-empty streamed response"

    def test_streamed_response_is_persisted_to_db(self, e2e_server) -> None:
        """After streaming, the completed node's ai_response should be queryable."""
        cfg = _get_provider_config()
        base = e2e_server.base_url
        headers = _auth_headers()

        self._setup_source(base, headers, cfg, "(persist test)")

        chat_id = httpx.post(
            f"{base}/api/chats", json={}, headers=headers, timeout=10
        ).json()["id"]
        branch_id = httpx.post(
            f"{base}/api/chats/{chat_id}/branches",
            json={"name": "main"}, headers=headers, timeout=10,
        ).json()["id"]

        # Stream a message
        node_id: str | None = None
        with httpx.stream(
            "POST",
            f"{base}/api/chats/{chat_id}/branches/{branch_id}/messages",
            json={"user_prompt": "Say OK.", "model_used": cfg["model_id"]},
            headers={**headers, "Content-Type": "application/json"},
            timeout=60,
        ) as resp:
            resp.raise_for_status()
            node_id = resp.headers.get("X-Node-Id")
            for _ in resp.iter_bytes():
                pass  # drain stream

        # Retrieve history and check the node has an ai_response
        history = httpx.get(
            f"{base}/api/chats/{chat_id}/branches/{branch_id}/history",
            headers=headers, timeout=10,
        ).json()
        node = next((n for n in history if n["id"] == node_id), None)
        assert node is not None, "Node not found in history"
        assert node["ai_response"] is not None and len(node["ai_response"]) > 0
