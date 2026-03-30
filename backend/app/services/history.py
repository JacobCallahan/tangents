"""
History service — raw SQL recursive CTE for linear ancestry retrieval.

This is the core query powering the chat view: given any node_id, walk up
the parent_id chain to the root and return nodes in chronological order.
"""

from __future__ import annotations

import logging

import tiktoken
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Node

logger = logging.getLogger(__name__)

# Default encoding used when the specific model is unknown.
_DEFAULT_ENCODING = "cl100k_base"


def count_messages_tokens(messages: list[dict]) -> int:
    """
    Estimate the total token count for a list of LiteLLM-style messages.

    Uses ``cl100k_base`` (GPT-4/GPT-3.5) encoding by default; falls back to
    character-based estimation on encoding errors.
    """
    try:
        enc = tiktoken.get_encoding(_DEFAULT_ENCODING)
        # Each message has a 4-token overhead in the chat format
        total = sum(4 + len(enc.encode(m.get("content", "") or "")) for m in messages)
        total += 2  # priming for reply
        return total
    except Exception as exc:  # noqa: BLE001
        logger.debug("tiktoken encoding failed, falling back to char estimate: %s", exc)
        return sum(len(m.get("content", "") or "") // 4 for m in messages)


_LINEAR_HISTORY_CTE = text(
    """
    WITH RECURSIVE chat_history AS (
        -- Base case: the target node
        SELECT id, parent_id, user_prompt, ai_response, model_used, created_at, chat_id, is_summary
        FROM nodes
        WHERE id = :node_id

        UNION ALL

        -- Recursive step: walk up through parent_id.
        -- Stop recursing ABOVE a summary node — it acts as a context root.
        SELECT n.id, n.parent_id, n.user_prompt, n.ai_response, n.model_used, n.created_at, n.chat_id, n.is_summary
        FROM nodes n
        INNER JOIN chat_history ch ON n.id = ch.parent_id
        WHERE ch.is_summary = 0
    )
    SELECT * FROM chat_history ORDER BY created_at ASC
    """
)


async def fetch_linear_history(db: AsyncSession, node_id: str) -> list[dict]:
    """
    Return the full linear history from root to ``node_id`` (inclusive),
    ordered oldest → newest.

    Each row is a plain dict with keys matching the ``nodes`` table columns.
    """
    result = await db.execute(_LINEAR_HISTORY_CTE, {"node_id": node_id})
    rows = result.mappings().all()
    return [dict(row) for row in rows]


async def format_history_for_llm(history: list[dict]) -> list[dict]:
    """
    Convert a linear history list into the ``messages`` format expected by LiteLLM.
    Skips nodes where ai_response is None (in-flight or failed).
    """
    messages: list[dict] = []
    for node in history:
        messages.append({"role": "user", "content": node["user_prompt"]})
        if node.get("ai_response"):
            messages.append({"role": "assistant", "content": node["ai_response"]})
    return messages
