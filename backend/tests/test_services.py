"""
Unit tests for backend services: encryption and history.
These tests do not require HTTP — they test the service layer directly.
"""

from __future__ import annotations

import pytest


# ---------------------------------------------------------------------------
# Encryption service
# ---------------------------------------------------------------------------


class TestEncryption:
    def test_round_trip(self, monkeypatch):
        """Encrypted text decrypts back to the original plaintext."""
        from cryptography.fernet import Fernet
        import app.services.encryption as enc_module

        key = Fernet.generate_key().decode()
        monkeypatch.setattr(enc_module.settings, "ENCRYPTION_KEY", key)

        from app.services.encryption import decrypt_api_key, encrypt_api_key

        plaintext = "sk-test-abc123"
        ciphertext = encrypt_api_key(plaintext)
        assert ciphertext != plaintext
        assert decrypt_api_key(ciphertext) == plaintext

    def test_different_ciphertexts(self, monkeypatch):
        """Each encryption call produces a unique ciphertext (Fernet uses random IV)."""
        from cryptography.fernet import Fernet
        import app.services.encryption as enc_module

        key = Fernet.generate_key().decode()
        monkeypatch.setattr(enc_module.settings, "ENCRYPTION_KEY", key)

        from app.services.encryption import encrypt_api_key

        c1 = encrypt_api_key("same-key")
        c2 = encrypt_api_key("same-key")
        assert c1 != c2

    def test_raises_without_encryption_key(self, monkeypatch):
        """encrypt_api_key raises HTTP 503 when ENCRYPTION_KEY is not set."""
        import app.services.encryption as enc_module
        monkeypatch.setattr(enc_module.settings, "ENCRYPTION_KEY", None)

        from fastapi import HTTPException
        from app.services.encryption import encrypt_api_key

        with pytest.raises(HTTPException) as exc_info:
            encrypt_api_key("some-key")
        assert exc_info.value.status_code == 503


# ---------------------------------------------------------------------------
# Token counting
# ---------------------------------------------------------------------------


class TestTokenCounting:
    def test_non_zero(self):
        """Token count for a non-empty message list is positive."""
        from app.services.history import count_messages_tokens

        messages = [
        ]
        count = count_messages_tokens(messages)
        assert count > 0

    def test_empty_list(self):
        """Empty message list has a minimal token count (just the reply priming)."""
        from app.services.history import count_messages_tokens

        count = count_messages_tokens([])
        assert count >= 0

    def test_longer_content_has_more_tokens(self):
        """More content means more tokens."""
        from app.services.history import count_messages_tokens

        short = [{"role": "user", "content": "Hi"}]
        long = [{"role": "user", "content": "Hi " * 100}]
        assert count_messages_tokens(long) > count_messages_tokens(short)


# ---------------------------------------------------------------------------
# History / LLM formatting
# ---------------------------------------------------------------------------


class TestHistoryFormatting:
    import pytest

    @pytest.mark.asyncio
    async def test_format_history_for_llm(self):
        """format_history_for_llm converts node dicts into LiteLLM message format."""
        from app.services.history import format_history_for_llm

        history = [
            {"user_prompt": "Hello", "ai_response": "Hi there"},
            {"user_prompt": "How are you?", "ai_response": None},
        ]
        messages = await format_history_for_llm(history)

        assert messages[0] == {"role": "user", "content": "Hello"}
        assert messages[1] == {"role": "assistant", "content": "Hi there"}
        assert messages[2] == {"role": "user", "content": "How are you?"}
        assert len(messages) == 3


# ---------------------------------------------------------------------------
# History CTE — summary node acts as context root
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
class TestHistorySummaryCutoff:
    async def test_history_halts_at_summary_node(self, db_session):
        """fetch_linear_history must stop recursion at is_summary=True nodes."""
        import uuid as _uuid
        from app.models import Chat, Node, User
        from app.services.history import fetch_linear_history
        from sqlalchemy import select

        # Ensure test user row exists
        user_result = await db_session.execute(
            select(User).where(User.id == "00000000-0000-0000-0000-000000000001")
        )
        user = user_result.scalar_one_or_none()
        if user is None:
            user = User(id="00000000-0000-0000-0000-000000000001", username="testuser")
            db_session.add(user)
            await db_session.flush()

        chat = Chat(user_id=user.id, title="history-test")
        db_session.add(chat)
        await db_session.flush()

        # Build: root → old_context → summary (is_summary=True) → new_msg
        root = Node(
            id=str(_uuid.uuid4()), chat_id=chat.id, parent_id=None,
            user_prompt="root q", ai_response="root a", model_used="gpt-4o",
        )
        db_session.add(root)
        await db_session.flush()

        old_ctx = Node(
            id=str(_uuid.uuid4()), chat_id=chat.id, parent_id=root.id,
            user_prompt="old q", ai_response="old a", model_used="gpt-4o",
        )
        db_session.add(old_ctx)
        await db_session.flush()

        summary = Node(
            id=str(_uuid.uuid4()), chat_id=chat.id, parent_id=old_ctx.id,
            user_prompt="[Summary]", ai_response="summarized content", model_used="gpt-4o",
            is_summary=True,
        )
        db_session.add(summary)
        await db_session.flush()

        new_msg = Node(
            id=str(_uuid.uuid4()), chat_id=chat.id, parent_id=summary.id,
            user_prompt="new q", ai_response="new a", model_used="gpt-4o",
        )
        db_session.add(new_msg)
        await db_session.flush()

        history = await fetch_linear_history(db_session, new_msg.id)
        ids = [n["id"] for n in history]

        # Must include the summary node and new_msg, but NOT root or old_ctx
        assert summary.id in ids
        assert new_msg.id in ids
        assert root.id not in ids
        assert old_ctx.id not in ids

    async def test_history_without_summary_traverses_to_root(self, db_session):
        """Without any summary node, fetch_linear_history returns all ancestors."""
        import uuid as _uuid
        from app.models import Chat, Node, User
        from app.services.history import fetch_linear_history
        from sqlalchemy import select

        user_result = await db_session.execute(
            select(User).where(User.id == "00000000-0000-0000-0000-000000000001")
        )
        user = user_result.scalar_one_or_none()
        if user is None:
            user = User(id="00000000-0000-0000-0000-000000000001", username="testuser")
            db_session.add(user)
            await db_session.flush()

        chat = Chat(user_id=user.id, title="history-test-no-summary")
        db_session.add(chat)
        await db_session.flush()

        root = Node(
            id=str(_uuid.uuid4()), chat_id=chat.id, parent_id=None,
            user_prompt="root q", ai_response="root a", model_used="gpt-4o",
        )
        db_session.add(root)
        await db_session.flush()

        child = Node(
            id=str(_uuid.uuid4()), chat_id=chat.id, parent_id=root.id,
            user_prompt="child q", ai_response="child a", model_used="gpt-4o",
        )
        db_session.add(child)
        await db_session.flush()

        history = await fetch_linear_history(db_session, child.id)
        ids = [n["id"] for n in history]
        assert root.id in ids
        assert child.id in ids
