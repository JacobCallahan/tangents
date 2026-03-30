"""
Tangents — FastAPI application entry point.
"""

from contextlib import asynccontextmanager
from typing import AsyncIterator

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import select

from app.config import settings as app_settings
import app.database as _db
from app.models import User
from app.routers import branches, chats, settings, share_links
from app.dependencies import SINGLE_USER_ID, SINGLE_USER_NAME


async def _ensure_admin_user() -> None:
    """In basic-auth mode, guarantee the fixed admin User row exists."""
    if app_settings.AUTH_MODE != "basic":
        return
    async with _db.AsyncSessionLocal() as db:
        result = await db.execute(select(User).where(User.id == SINGLE_USER_ID))
        if result.scalar_one_or_none() is None:
            db.add(User(id=SINGLE_USER_ID, username=SINGLE_USER_NAME))
            await db.commit()


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    """Run startup / shutdown tasks."""
    # In development, auto-create tables. Production should use `alembic upgrade head`.
    await _db.init_db()
    await _ensure_admin_user()
    yield


app = FastAPI(
    title="Tangents API",
    description="AI chat with Git-like branching history.",
    version="0.1.0",
    lifespan=lifespan,
)

# ---------------------------------------------------------------------------
# CORS — allow the Vite dev server during development
# ---------------------------------------------------------------------------
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",  # Vite default
        "http://localhost:3000",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ---------------------------------------------------------------------------
# Routers
# ---------------------------------------------------------------------------
app.include_router(chats.router)
app.include_router(branches.router)
app.include_router(settings.router)
app.include_router(share_links.router)


@app.get("/health", tags=["meta"])
async def health() -> dict:
    return {"status": "ok"}
