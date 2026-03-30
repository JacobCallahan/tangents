"""
E2E test fixtures.

Spins up a real uvicorn server with an ephemeral SQLite database pre-seeded
with dummy data. Playwright browsers talk to this server over localhost.

The server is started once per test session (scope="session") to keep things
fast. The database is recreated once per session; individual tests that need
isolation can call the seed helpers directly.

Environment variables honoured:
  DATABASE_URL   — override DB (default: temp file)
  ADMIN_USERNAME — basic-auth username sent by Playwright (default: admin)
  ADMIN_PASSWORD — basic-auth password (default: tangents)
  ENCRYPTION_KEY — required for model-source encryption (auto-generated if absent)
"""

from __future__ import annotations

import os
import socket
import threading
import time
import tempfile
from pathlib import Path
from typing import Generator

import pytest
import uvicorn
from playwright.sync_api import Browser, BrowserContext, Page, sync_playwright

# ---------------------------------------------------------------------------
# Free-port helper
# ---------------------------------------------------------------------------

def _free_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


# ---------------------------------------------------------------------------
# Server lifecycle
# ---------------------------------------------------------------------------

class _ServerThread:
    """Runs uvicorn in a background thread and waits until it is ready."""

    def __init__(self, host: str, port: int, env: dict[str, str]) -> None:
        self.host = host
        self.port = port
        self._env = env
        self._thread: threading.Thread | None = None
        self._server: uvicorn.Server | None = None

    @property
    def base_url(self) -> str:
        return f"http://{self.host}:{self.port}"

    def start(self) -> None:
        original_env = {k: os.environ.get(k) for k in self._env}
        os.environ.update(self._env)

        # Reload the settings module so pydantic-settings picks up new env vars
        import importlib
        from sqlalchemy import event
        from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession, async_sessionmaker
        import app.config as cfg_module
        import app.database as db_module

        importlib.reload(cfg_module)
        new_url = cfg_module.settings.DATABASE_URL

        # Patch db module WITHOUT reloading — reloading would recreate Base and
        # lose all model table registrations (models.py still holds old Base refs).
        new_engine = create_async_engine(
            new_url,
            echo=False,
            connect_args={"check_same_thread": False} if "sqlite" in new_url else {},
        )

        @event.listens_for(new_engine.sync_engine, "connect")
        def _set_fk_pragma(dbapi_conn, _record):
            if "sqlite" in new_url:
                cursor = dbapi_conn.cursor()
                cursor.execute("PRAGMA foreign_keys=ON")
                cursor.close()

        db_module.engine = new_engine
        db_module.AsyncSessionLocal = async_sessionmaker(
            bind=new_engine,
            class_=AsyncSession,
            expire_on_commit=False,
            autocommit=False,
            autoflush=False,
        )

        # Re-import app after env is set
        from app.main import app  # noqa: PLC0415
        # Remove unit-test auth override so the e2e server uses real basic auth
        from app.dependencies import get_current_user as _gcu
        app.dependency_overrides.pop(_gcu, None)

        config = uvicorn.Config(
            app,
            host=self.host,
            port=self.port,
            log_level="warning",
        )
        self._server = uvicorn.Server(config)

        def run():
            import asyncio
            asyncio.run(self._server.serve())

        self._thread = threading.Thread(target=run, daemon=True)
        self._thread.start()

        # Wait up to 10 s for the server to accept connections
        import httpx
        deadline = time.monotonic() + 10
        while time.monotonic() < deadline:
            try:
                httpx.get(f"{self.base_url}/health", timeout=1)
                break
            except Exception:
                time.sleep(0.1)
        else:
            raise RuntimeError(f"E2E server did not start on {self.base_url}")

        # Restore original env (process env still has what we set, but at least
        # we don't pollute other potential tests running sequentially)
        for k, v in original_env.items():
            if v is None:
                os.environ.pop(k, None)
            else:
                os.environ[k] = v

    def stop(self) -> None:
        if self._server:
            self._server.should_exit = True


# ---------------------------------------------------------------------------
# Session-scoped fixtures
# ---------------------------------------------------------------------------

@pytest.fixture(scope="session")
def e2e_db_path(tmp_path_factory) -> Path:
    """Return path to the ephemeral SQLite file used for E2E tests."""
    return tmp_path_factory.mktemp("e2e") / "e2e_test.db"


@pytest.fixture(scope="session")
def e2e_server(e2e_db_path: Path) -> Generator[_ServerThread, None, None]:
    """Start a real uvicorn server with seeded data for the whole test session."""
    import base64
    from cryptography.fernet import Fernet

    port = _free_port()
    encryption_key = base64.urlsafe_b64encode(Fernet.generate_key()).decode()

    server = _ServerThread(
        host="127.0.0.1",
        port=port,
        env={
            "DATABASE_URL": f"sqlite+aiosqlite:///{e2e_db_path}",
            "ENCRYPTION_KEY": encryption_key,
            "AUTH_MODE": "basic",
            "ADMIN_USERNAME": "admin",
            "ADMIN_PASSWORD": "tangents",
        },
    )
    server.start()

    # Seed the database
    _seed_e2e_db(e2e_db_path)

    yield server
    server.stop()


def _seed_e2e_db(db_path: Path) -> None:
    """Synchronously seed the E2E SQLite database with a complete test graph."""
    import asyncio
    from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession, async_sessionmaker
    from sqlalchemy.orm import sessionmaker
    from app.models import Chat, Branch, Node, ModelSource, ModelSourceModel, UserSettings
    from datetime import datetime, timezone

    from app.dependencies import SINGLE_USER_ID

    url = f"sqlite+aiosqlite:///{db_path}"
    engine = create_async_engine(url, connect_args={"check_same_thread": False})
    Session = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)

    async def _seed():
        # Tables are already created by lifespan; admin user already exists via
        # _ensure_admin_user(). We just add test-specific records here.
        now = datetime.now(timezone.utc)
        USER_ID = SINGLE_USER_ID
        CHAT_ID = "e2e00001-0000-0000-0000-000000000001"
        BRANCH_MAIN = "e2e00002-0000-0000-0000-000000000001"
        BRANCH_TANGENT = "e2e00002-0000-0000-0000-000000000002"
        NODE_ROOT = "e2e00003-0000-0000-0000-000000000001"
        NODE_B = "e2e00003-0000-0000-0000-000000000002"
        NODE_C = "e2e00003-0000-0000-0000-000000000003"
        SOURCE_ID = "e2e00004-0000-0000-0000-000000000001"
        MODEL_ID = "e2e00005-0000-0000-0000-000000000001"

        async with Session() as session:
            async with session.begin():
                session.add_all([
                    Chat(id=CHAT_ID, user_id=USER_ID, title="E2E seed chat", created_at=now),
                    Node(id=NODE_ROOT, chat_id=CHAT_ID, parent_id=None,
                         user_prompt="Root question", ai_response="Root answer",
                         model_used="gpt-4o", created_at=now),
                    Node(id=NODE_B, chat_id=CHAT_ID, parent_id=NODE_ROOT,
                         user_prompt="Main follow-up", ai_response="Main answer",
                         model_used="gpt-4o", created_at=now),
                    Node(id=NODE_C, chat_id=CHAT_ID, parent_id=NODE_ROOT,
                         user_prompt="Tangent question", ai_response="Tangent answer",
                         model_used="gpt-4o", created_at=now),
                    Branch(id=BRANCH_MAIN, chat_id=CHAT_ID, name="main",
                           head_node_id=NODE_B),
                    Branch(id=BRANCH_TANGENT, chat_id=CHAT_ID, name="tangent-explore",
                           head_node_id=NODE_C),
                    ModelSource(id=SOURCE_ID, user_id=USER_ID, name="Test OpenAI",
                                provider_type="openai", base_url="https://api.openai.com/v1",
                                encrypted_api_key=None, created_at=now),
                    ModelSourceModel(id=MODEL_ID, source_id=SOURCE_ID, model_id="gpt-4o",
                                     display_name="GPT-4o", context_window_tokens=128000,
                                     last_fetched_at=now),
                    UserSettings(user_id=USER_ID, default_model_id=MODEL_ID,
                                 highlight_color="#6366f1", theme="dark",
                                 branch_naming_mode="random"),
                ])

    asyncio.run(_seed())


# ---------------------------------------------------------------------------
# Per-test Playwright fixtures
# ---------------------------------------------------------------------------

@pytest.fixture(scope="session")
def browser_instance() -> Generator[Browser, None, None]:
    with sync_playwright() as pw:
        browser = pw.chromium.launch(headless=True)
        yield browser
        browser.close()


@pytest.fixture
def browser_context(
    browser_instance: Browser,
    e2e_server: _ServerThread,
) -> Generator[BrowserContext, None, None]:
    """Fresh browser context with Basic-auth credentials pre-configured."""
    ctx = browser_instance.new_context(
        base_url=e2e_server.base_url,
        http_credentials={"username": "admin", "password": "tangents"},
    )
    yield ctx
    ctx.close()


@pytest.fixture
def page(browser_context: BrowserContext) -> Generator[Page, None, None]:
    pg = browser_context.new_page()
    yield pg
    pg.close()
