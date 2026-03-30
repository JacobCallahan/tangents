"""
Router: /api/chats
Handles chat CRUD, the flat node-list endpoint needed by the React Flow graph,
node deletion (cascading), and on-demand node summarization.
"""

from __future__ import annotations

from typing import Any

import litellm
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select, text, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.database import get_db
from app.dependencies import get_current_user
from app.models import Branch, Chat, Node, UserSettings
from app.schemas import (
    ChatCreate,
    ChatRead,
    ChatUpdate,
    GraphNodeData,
    GraphResponse,
    NodeRead,
    SummarizeNodeRequest,
    SummarizeNodeResponse,
)
from app.services.history import fetch_linear_history, format_history_for_llm

router = APIRouter(prefix="/api/chats", tags=["chats"])


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


# ---------------------------------------------------------------------------
# Chat endpoints
# ---------------------------------------------------------------------------


@router.get("", response_model=list[ChatRead])
async def list_chats(
    db: AsyncSession = Depends(get_db),
    current_user: dict[str, Any] = Depends(get_current_user),
) -> list[Chat]:
    result = await db.execute(
        select(Chat).where(Chat.user_id == current_user["id"]).order_by(Chat.created_at.asc())
    )
    return list(result.scalars().all())


@router.post("", response_model=ChatRead, status_code=status.HTTP_201_CREATED)
async def create_chat(
    payload: ChatCreate,
    db: AsyncSession = Depends(get_db),
    current_user: dict[str, Any] = Depends(get_current_user),
) -> Chat:
    chat = Chat(user_id=current_user["id"], title=payload.title)
    db.add(chat)
    await db.flush()
    await db.refresh(chat)
    return chat


@router.get("/{chat_id}", response_model=ChatRead)
async def get_chat(
    chat_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: dict[str, Any] = Depends(get_current_user),
) -> Chat:
    return await _get_chat_or_404(chat_id, current_user["id"], db)


@router.patch("/{chat_id}", response_model=ChatRead)
async def update_chat(
    chat_id: str,
    payload: ChatUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: dict[str, Any] = Depends(get_current_user),
) -> Chat:
    chat = await _get_chat_or_404(chat_id, current_user["id"], db)
    if payload.title is not None:
        chat.title = payload.title
    await db.flush()
    await db.refresh(chat)
    return chat


@router.delete("/{chat_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_chat(
    chat_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: dict[str, Any] = Depends(get_current_user),
) -> None:
    chat = await _get_chat_or_404(chat_id, current_user["id"], db)
    await db.delete(chat)


# ---------------------------------------------------------------------------
# Graph endpoint — flat node list for React Flow
# ---------------------------------------------------------------------------


@router.get("/{chat_id}/graph", response_model=GraphResponse)
async def get_chat_graph(
    chat_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: dict[str, Any] = Depends(get_current_user),
) -> GraphResponse:
    """
    Returns all nodes for a chat with branch-head and branch-origin metadata
    so the frontend can build the React Flow graph.
    """
    await _get_chat_or_404(chat_id, current_user["id"], db)

    # Fetch all nodes for this chat
    nodes_result = await db.execute(
        select(Node).where(Node.chat_id == chat_id).order_by(Node.created_at.asc())
    )
    db_nodes = list(nodes_result.scalars().all())

    # Fetch all branches to know which nodes are branch HEADs
    branches_result = await db.execute(
        select(Branch).where(Branch.chat_id == chat_id)
    )
    db_branches = list(branches_result.scalars().all())

    # Build lookup: node_id → list of branch names whose HEAD is this node
    head_map: dict[str, list[str]] = {}
    for branch in db_branches:
        head_map.setdefault(branch.head_node_id, []).append(branch.name)

    # Count children per node to detect branch origins
    child_counts: dict[str, int] = {}
    for node in db_nodes:
        if node.parent_id:
            child_counts[node.parent_id] = child_counts.get(node.parent_id, 0) + 1

    graph_nodes = [
        GraphNodeData(
            id=node.id,
            parent_id=node.parent_id,
            merge_parent_id=node.merge_parent_id,
            chat_id=node.chat_id,
            model_used=node.model_used,
            created_at=node.created_at,
            branch_heads=head_map.get(node.id, []),
            is_branch_origin=child_counts.get(node.id, 0) > 1,
            is_summary=node.is_summary,
        )
        for node in db_nodes
    ]
    return GraphResponse(nodes=graph_nodes)


# ---------------------------------------------------------------------------
# Node management endpoints
# ---------------------------------------------------------------------------


async def _get_subtree_ids(node_id: str, db: AsyncSession) -> list[str]:
    """Return node_id and all descendant IDs (depth-first via recursive CTE)."""
    cte = text(
        """
        WITH RECURSIVE subtree AS (
            SELECT id FROM nodes WHERE id = :node_id
            UNION ALL
            SELECT n.id FROM nodes n INNER JOIN subtree s ON n.parent_id = s.id
        )
        SELECT id FROM subtree
        """
    )
    result = await db.execute(cte, {"node_id": node_id})
    return [row[0] for row in result.fetchall()]


@router.delete(
    "/{chat_id}/nodes/{node_id}",
    status_code=status.HTTP_204_NO_CONTENT,
)
async def delete_node(
    chat_id: str,
    node_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: dict[str, Any] = Depends(get_current_user),
) -> None:
    """
    Cascade-delete a node and all its descendants.

    Any branch whose HEAD is one of the deleted nodes is rolled back to the
    deleted root node's parent (or NULL if the deleted node was the root).
    """
    await _get_chat_or_404(chat_id, current_user["id"], db)

    # Verify node belongs to this chat
    node_result = await db.execute(
        select(Node).where(Node.id == node_id, Node.chat_id == chat_id)
    )
    node = node_result.scalar_one_or_none()
    if node is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Node not found")

    rollback_parent = node.parent_id
    subtree_ids = await _get_subtree_ids(node_id, db)
    subtree_set = set(subtree_ids)

    # Roll back any branch heads that point into the deleted subtree
    branches_result = await db.execute(
        select(Branch).where(Branch.chat_id == chat_id)
    )
    for branch in branches_result.scalars().all():
        if branch.head_node_id in subtree_set:
            branch.head_node_id = rollback_parent
    await db.flush()

    # Delete subtree leaves-first to satisfy FK constraints (SET NULL would
    # handle it, but explicit ordering avoids relying on that behaviour).
    # Also clear merge_parent_id references pointing into the subtree.
    await db.execute(
        update(Node)
        .where(Node.merge_parent_id.in_(subtree_ids))
        .values(merge_parent_id=None)
    )
    await db.flush()

    # Delete in reverse-creation order (children before parents)
    for nid in reversed(subtree_ids):
        n = (await db.execute(select(Node).where(Node.id == nid))).scalar_one_or_none()
        if n:
            await db.delete(n)
    await db.flush()


@router.post(
    "/{chat_id}/nodes/{node_id}/summarize",
    response_model=SummarizeNodeResponse,
    status_code=status.HTTP_201_CREATED,
)
async def summarize_node(
    chat_id: str,
    node_id: str,
    payload: SummarizeNodeRequest,
    db: AsyncSession = Depends(get_db),
    current_user: dict[str, Any] = Depends(get_current_user),
) -> SummarizeNodeResponse:
    """
    Generate a summary node as a child of node_id.

    The summary covers the conversation from the most recent previous summary
    (or root) up to and including node_id.  The new node is marked
    is_summary=True so future history queries treat it as a context root.
    """
    await _get_chat_or_404(chat_id, current_user["id"], db)

    node_result = await db.execute(
        select(Node).where(Node.id == node_id, Node.chat_id == chat_id)
    )
    node = node_result.scalar_one_or_none()
    if node is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Node not found")

    # Inject custom instructions if set
    user_settings_result = await db.execute(
        select(UserSettings).where(UserSettings.user_id == current_user["id"])
    )
    user_settings = user_settings_result.scalar_one_or_none()

    # Build context up to node_id (stops at any existing summary node)
    history = await fetch_linear_history(db, node_id)
    messages = await format_history_for_llm(history)

    raw_context = "\n\n".join(
        f"User: {n['user_prompt']}\nAssistant: {n.get('ai_response', '[no response]')}"
        for n in history
    )

    synthesis_prompt = (
        payload.synthesis_prompt_override
        or (
            f"Please summarize the following conversation segment concisely, "
            f"preserving all key facts, decisions, and code:\n\n{raw_context}"
        )
    )

    system_messages = []
    if user_settings and user_settings.custom_instructions:
        system_messages = [{"role": "system", "content": user_settings.custom_instructions}]

    try:
        ai_response = await litellm.acompletion(
            model=payload.model,
            messages=system_messages + [{"role": "user", "content": synthesis_prompt}],
            stream=False,
        )
    except litellm.exceptions.ServiceUnavailableError as exc:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"LLM provider unavailable: {exc}",
        ) from exc
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"LLM call failed: {exc}",
        ) from exc
    summary_text = ai_response.choices[0].message.content

    # Determine synthesis model to record
    synthesis_model = settings.SYNTHESIS_MODEL or payload.model

    new_node = Node(
        chat_id=chat_id,
        parent_id=node_id,
        user_prompt="[Summary]",
        ai_response=summary_text,
        model_used=synthesis_model,
        is_summary=True,
    )
    db.add(new_node)
    await db.flush()
    await db.refresh(new_node)

    return SummarizeNodeResponse(
        new_node_id=new_node.id,  # type: ignore[arg-type]
        node=NodeRead.model_validate(new_node),
    )
