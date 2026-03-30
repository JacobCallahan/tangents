"""
Router: /api/share
Handles share link generation, listing, and revocation.
Share links are publicly accessible and read-only — no authentication to view.
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.dependencies import get_current_user
from app.models import Branch, Chat, Node, ShareLink
from app.schemas import NodeRead, ShareLinkCreate, ShareLinkRead
from app.services.history import fetch_linear_history

router = APIRouter(prefix="/api/share", tags=["share"])


# ---------------------------------------------------------------------------
# Share link management (authenticated)
# ---------------------------------------------------------------------------


@router.get("", response_model=list[ShareLinkRead])
async def list_share_links(
    db: AsyncSession = Depends(get_db),
    current_user: dict[str, Any] = Depends(get_current_user),
) -> list[ShareLink]:
    result = await db.execute(
        select(ShareLink).where(ShareLink.user_id == current_user["id"])
    )
    return list(result.scalars().all())


@router.post("", response_model=ShareLinkRead, status_code=status.HTTP_201_CREATED)
async def create_share_link(
    payload: ShareLinkCreate,
    db: AsyncSession = Depends(get_db),
    current_user: dict[str, Any] = Depends(get_current_user),
) -> ShareLink:
    # Verify the chat belongs to the user
    chat_result = await db.execute(
        select(Chat).where(Chat.id == str(payload.chat_id), Chat.user_id == current_user["id"])
    )
    if chat_result.scalar_one_or_none() is None:
        raise HTTPException(status_code=404, detail="Chat not found")

    share_link = ShareLink(
        user_id=current_user["id"],
        chat_id=str(payload.chat_id),
        branch_id=str(payload.branch_id),
        node_id=str(payload.node_id),
    )
    db.add(share_link)
    await db.flush()
    await db.refresh(share_link)
    return share_link


@router.delete("/{link_id}", status_code=status.HTTP_204_NO_CONTENT)
async def revoke_share_link(
    link_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: dict[str, Any] = Depends(get_current_user),
) -> None:
    result = await db.execute(
        select(ShareLink).where(
            ShareLink.id == link_id, ShareLink.user_id == current_user["id"]
        )
    )
    link = result.scalar_one_or_none()
    if link is None:
        raise HTTPException(status_code=404, detail="Share link not found")
    await db.delete(link)


# ---------------------------------------------------------------------------
# Public read-only share link view (no authentication required)
# ---------------------------------------------------------------------------


@router.get("/view/{token}", response_model=list[NodeRead])
async def view_share_link(
    token: str,
    db: AsyncSession = Depends(get_db),
) -> list[dict]:
    """
    Public endpoint. Returns the linear chat history for the shared node.
    No authentication required — the UUID token is the access credential.
    """
    result = await db.execute(
        select(ShareLink).where(ShareLink.id == token)
    )
    link = result.scalar_one_or_none()
    if link is None:
        raise HTTPException(status_code=404, detail="Share link not found or has been revoked")

    history = await fetch_linear_history(db, link.node_id)
    return history
