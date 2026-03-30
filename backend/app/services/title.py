"""
Title generation service — background async task.

Called after the first SSE stream completes to give the chat a meaningful name.
Uses LiteLLM so it works with any configured provider.
"""

from __future__ import annotations

import logging

import litellm
from sqlalchemy import select

import app.database as _db
from app.models import Chat

logger = logging.getLogger(__name__)


async def generate_chat_title(chat_id: str, first_prompt: str, model: str) -> None:
    """
    Background task: generate a short title from the first user message and
    write it to the chat row.  Silently no-ops on any failure — title generation
    is purely cosmetic and must never break the main request path.
    """
    async with _db.AsyncSessionLocal() as db:
        async with db.begin():
            try:
                result = await db.execute(select(Chat).where(Chat.id == chat_id))
                chat = result.scalar_one_or_none()
                if chat is None or chat.title is not None:
                    return  # already titled or chat was deleted

                response = await litellm.acompletion(
                    model=model,
                    messages=[
                        {
                            "role": "user",
                            "content": (
                                "Write a short descriptive title (one sentence, 6-12 words) for "
                                "a conversation that begins with the following message. "
                                "Reply with the title only — no period at the end, no quotes:\n\n"
                                + first_prompt[:300]
                            ),
                        }
                    ],
                    max_tokens=30,
                    stream=False,
                )
                raw = response.choices[0].message.content or ""
                title = raw.strip().strip("\"'").rstrip(".").strip()
                if title:
                    chat.title = title
            except Exception as exc:  # noqa: BLE001
                logger.warning("Title generation failed for chat %s: %s", chat_id, exc)
