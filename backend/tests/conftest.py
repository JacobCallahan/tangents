"""
Pytest fixtures shared across all backend tests.

Uses an in-memory SQLite database so tests are fully isolated and fast.
FastAPI dependencies (get_db, get_current_user) are overridden.
"""

from __future__ import annotations

from typing import AsyncGenerator

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine
from sqlalchemy.orm import sessionmaker

from app.database import Base
from app.dependencies import get_current_user
from app.main import app
from app.models import User


# ---------------------------------------------------------------------------
# In-memory test database
# ---------------------------------------------------------------------------

TEST_DATABASE_URL = "sqlite+aiosqlite:///:memory:"

_test_engine = create_async_engine(
    TEST_DATABASE_URL,
    connect_args={"check_same_thread": False},
)
_TestSessionLocal = sessionmaker(
    _test_engine, class_=AsyncSession, expire_on_commit=False
)


@pytest_asyncio.fixture(scope="session", autouse=True)
async def create_tables():
    """Create all ORM tables once per test session."""
    async with _test_engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    yield
    async with _test_engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)


@pytest_asyncio.fixture(autouse=True)
async def clear_tables():
    """Truncate all data tables before each test for full isolation."""
    async with _TestSessionLocal() as session:
        async with session.begin():
            # Delete in reverse FK dependency order
            for table in (
                "share_links",
                "branches",
                "nodes",
                "chats",
                "model_source_models",
                "model_sources",
                "user_settings",
                # Keep users — test user is recreated per-session
            ):
                await session.execute(text(f"DELETE FROM {table}"))


@pytest_asyncio.fixture
async def db_session() -> AsyncGenerator[AsyncSession, None]:
    """Provide a test database session."""
    async with _TestSessionLocal() as session:
        async with session.begin():
            yield session


# ---------------------------------------------------------------------------
# App dependency overrides
# ---------------------------------------------------------------------------

TEST_USER_ID = "00000000-0000-0000-0000-000000000001"
TEST_USERNAME = "testuser"

_TEST_USER = {"id": TEST_USER_ID, "username": TEST_USERNAME}


async def override_get_current_user() -> dict:
    return _TEST_USER


app.dependency_overrides[get_current_user] = override_get_current_user


@pytest_asyncio.fixture(scope="session", autouse=True)
async def create_test_user():
    """Ensure the test user row exists for the entire test session."""
    async with _TestSessionLocal() as session:
        async with session.begin():
            from sqlalchemy import select

            result = await session.execute(select(User).where(User.id == TEST_USER_ID))
            if result.scalar_one_or_none() is None:
                session.add(User(id=TEST_USER_ID, username=TEST_USERNAME))


@pytest_asyncio.fixture
async def client() -> AsyncGenerator[AsyncClient, None]:
    """Async HTTP test client with DB override applied."""

    async def _get_db_override():
        async with _TestSessionLocal() as session:
            async with session.begin():
                yield session

    from app.database import get_db

    app.dependency_overrides[get_db] = _get_db_override

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        yield ac

    app.dependency_overrides.pop(get_db, None)


# ---------------------------------------------------------------------------
# Seed-data IDs — stable UUIDs used in fixtures and E2E tests
# ---------------------------------------------------------------------------

SEED_CHAT_ID = "aaaaaaaa-0000-0000-0000-000000000001"
SEED_MAIN_BRANCH_ID = "bbbbbbbb-0000-0000-0000-000000000001"
SEED_TANGENT_BRANCH_ID = "bbbbbbbb-0000-0000-0000-000000000002"
SEED_NODE_ROOT_ID = "cccccccc-0000-0000-0000-000000000001"
SEED_NODE_B_ID = "cccccccc-0000-0000-0000-000000000002"
SEED_NODE_C_ID = "cccccccc-0000-0000-0000-000000000003"
SEED_SOURCE_ID = "dddddddd-0000-0000-0000-000000000001"
SEED_MODEL_ID = "eeeeeeee-0000-0000-0000-000000000001"


async def _seed_all(session) -> None:
    """Insert a complete conversation graph usable by unit and E2E tests.

    Graph layout
    ============
    root (A)  ← shared ancestor
      ├─ B    ← main branch HEAD
      └─ C    ← tangent branch HEAD

    Branches
    --------
    main    → head = B
    tangent → head = C
    """
    from datetime import datetime, timezone
    from app.models import (
        Chat, Branch, Node, ModelSource, ModelSourceModel, UserSettings
    )

    now = datetime.now(timezone.utc)

    # Chat
    session.add(Chat(
        id=SEED_CHAT_ID,
        user_id=TEST_USER_ID,
        title="Seed conversation",
        created_at=now,
    ))

    # Nodes (insert in parent-first order)
    session.add(Node(
        id=SEED_NODE_ROOT_ID,
        chat_id=SEED_CHAT_ID,
        parent_id=None,
        user_prompt="What is a tangent?",
        ai_response="A tangent is a diverging path.",
        model_used="gpt-4o",
        created_at=now,
    ))
    session.add(Node(
        id=SEED_NODE_B_ID,
        chat_id=SEED_CHAT_ID,
        parent_id=SEED_NODE_ROOT_ID,
        user_prompt="Tell me more.",
        ai_response="In Tangents, a branch is a named pointer.",
        model_used="gpt-4o",
        created_at=now,
    ))
    session.add(Node(
        id=SEED_NODE_C_ID,
        chat_id=SEED_CHAT_ID,
        parent_id=SEED_NODE_ROOT_ID,
        user_prompt="Give me an example.",
        ai_response="Here is an example tangent.",
        model_used="gpt-4o",
        created_at=now,
    ))

    # Branches
    session.add(Branch(
        id=SEED_MAIN_BRANCH_ID,
        chat_id=SEED_CHAT_ID,
        name="main",
        head_node_id=SEED_NODE_B_ID,
    ))
    session.add(Branch(
        id=SEED_TANGENT_BRANCH_ID,
        chat_id=SEED_CHAT_ID,
        name="tangent-explore",
        head_node_id=SEED_NODE_C_ID,
    ))

    # Model source + one model
    session.add(ModelSource(
        id=SEED_SOURCE_ID,
        user_id=TEST_USER_ID,
        name="Test OpenAI",
        provider_type="openai",
        base_url="https://api.openai.com/v1",
        encrypted_api_key=None,
        created_at=now,
    ))
    session.add(ModelSourceModel(
        id=SEED_MODEL_ID,
        source_id=SEED_SOURCE_ID,
        model_id="gpt-4o",
        display_name="GPT-4o",
        context_window_tokens=128000,
        last_fetched_at=now,
    ))

    # User settings
    session.add(UserSettings(
        user_id=TEST_USER_ID,
        default_model_id=SEED_MODEL_ID,
        highlight_color="#6366f1",
        theme="dark",
        branch_naming_mode="random",
    ))


@pytest_asyncio.fixture
async def seed_db(db_session) -> None:
    """Populate the in-memory test database with a complete conversation graph."""
    await _seed_all(db_session)


@pytest_asyncio.fixture
async def seeded_client(seed_db) -> AsyncGenerator[AsyncClient, None]:  # noqa: F811
    """HTTP test client with seed data already committed to the DB."""

    async def _get_db_override():
        async with _TestSessionLocal() as session:
            async with session.begin():
                yield session

    from app.database import get_db

    app.dependency_overrides[get_db] = _get_db_override
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        yield ac
    app.dependency_overrides.pop(get_db, None)

