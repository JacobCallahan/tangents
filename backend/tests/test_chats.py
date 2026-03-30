"""
Integration tests for /api/chats endpoints.
Uses the shared AsyncClient fixture from conftest.py.
"""

from __future__ import annotations

import uuid
from unittest.mock import AsyncMock, MagicMock, patch

import pytest


# ---------------------------------------------------------------------------
# Node helpers (shared by node-management tests)
# ---------------------------------------------------------------------------


async def _mk_chat(client, title: str = "TestChat") -> dict:
    return (await client.post("/api/chats", json={"title": title})).json()


async def _mk_node(db_session, chat_id: str, parent_id: str | None = None) -> str:
    """Insert a bare node directly into the DB and return its ID."""
    from app.models import Node

    node = Node(
        id=str(uuid.uuid4()),
        chat_id=chat_id,
        parent_id=parent_id,
        user_prompt="test prompt",
        ai_response="test response",
        model_used="gpt-4o",
    )
    db_session.add(node)
    await db_session.flush()
    return node.id


async def _mk_branch(client, chat_id: str, node_id: str, name: str = "main") -> dict:
    resp = await client.post(
        f"/api/chats/{chat_id}/branches",
        json={"name": name, "source_node_id": node_id},
    )
    assert resp.status_code == 201, resp.text
    return resp.json()


@pytest.mark.asyncio
class TestListChats:
    async def test_empty_initially(self, client):
        resp = await client.get("/api/chats")
        assert resp.status_code == 200
        assert resp.json() == []


@pytest.mark.asyncio
class TestCreateChat:
    async def test_create_without_title(self, client):
        resp = await client.post("/api/chats", json={})
        assert resp.status_code == 201
        data = resp.json()
        assert data["title"] is None
        assert "id" in data

    async def test_create_with_title(self, client):
        resp = await client.post("/api/chats", json={"title": "My Chat"})
        assert resp.status_code == 201
        assert resp.json()["title"] == "My Chat"

    async def test_created_chat_appears_in_list(self, client):
        await client.post("/api/chats", json={"title": "Listed"})
        resp = await client.get("/api/chats")
        assert resp.status_code == 200
        titles = [c["title"] for c in resp.json()]
        assert "Listed" in titles


@pytest.mark.asyncio
class TestGetChat:
    async def test_get_existing(self, client):
        created = (await client.post("/api/chats", json={"title": "GetMe"})).json()
        resp = await client.get(f"/api/chats/{created['id']}")
        assert resp.status_code == 200
        assert resp.json()["title"] == "GetMe"

    async def test_get_nonexistent_returns_404(self, client):
        resp = await client.get("/api/chats/00000000-0000-0000-0000-000000000999")
        assert resp.status_code == 404


@pytest.mark.asyncio
class TestUpdateChat:
    async def test_rename(self, client):
        created = (await client.post("/api/chats", json={"title": "OldTitle"})).json()
        resp = await client.patch(
            f"/api/chats/{created['id']}", json={"title": "NewTitle"}
        )
        assert resp.status_code == 200
        assert resp.json()["title"] == "NewTitle"


@pytest.mark.asyncio
class TestDeleteChat:
    async def test_delete(self, client):
        created = (await client.post("/api/chats", json={"title": "ToDelete"})).json()
        resp = await client.delete(f"/api/chats/{created['id']}")
        assert resp.status_code == 204

        get_resp = await client.get(f"/api/chats/{created['id']}")
        assert get_resp.status_code == 404


# ---------------------------------------------------------------------------
# Node deletion tests
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
class TestDeleteNode:
    async def test_delete_leaf_node(self, client, db_session):
        """Deleting a leaf node returns 204 and node is gone from graph."""
        chat = await _mk_chat(client)
        root_id = await _mk_node(db_session, chat["id"])
        child_id = await _mk_node(db_session, chat["id"], parent_id=root_id)

        resp = await client.delete(f"/api/chats/{chat['id']}/nodes/{child_id}")
        assert resp.status_code == 204

        graph_resp = await client.get(f"/api/chats/{chat['id']}/graph")
        node_ids = [n["id"] for n in graph_resp.json()["nodes"]]
        assert child_id not in node_ids
        assert root_id in node_ids

    async def test_delete_cascades_to_children(self, client, db_session):
        """Deleting a parent node also removes all its descendants."""
        chat = await _mk_chat(client)
        root_id = await _mk_node(db_session, chat["id"])
        child_id = await _mk_node(db_session, chat["id"], parent_id=root_id)
        grandchild_id = await _mk_node(db_session, chat["id"], parent_id=child_id)

        resp = await client.delete(f"/api/chats/{chat['id']}/nodes/{child_id}")
        assert resp.status_code == 204

        graph_resp = await client.get(f"/api/chats/{chat['id']}/graph")
        node_ids = [n["id"] for n in graph_resp.json()["nodes"]]
        assert child_id not in node_ids
        assert grandchild_id not in node_ids
        assert root_id in node_ids

    async def test_delete_rolls_back_branch_head(self, client, db_session):
        """Branch head is moved to the deleted node's parent."""
        chat = await _mk_chat(client)
        root_id = await _mk_node(db_session, chat["id"])
        child_id = await _mk_node(db_session, chat["id"], parent_id=root_id)
        branch = await _mk_branch(client, chat["id"], child_id, "main")

        resp = await client.delete(f"/api/chats/{chat['id']}/nodes/{child_id}")
        assert resp.status_code == 204

        branch_resp = await client.get(f"/api/chats/{chat['id']}/branches/{branch['id']}")
        assert branch_resp.json()["head_node_id"] == root_id

    async def test_delete_root_node_sets_branch_head_null(self, client, db_session):
        """Deleting a root node rolls branch head back to None."""
        chat = await _mk_chat(client)
        root_id = await _mk_node(db_session, chat["id"])
        branch = await _mk_branch(client, chat["id"], root_id, "main")

        resp = await client.delete(f"/api/chats/{chat['id']}/nodes/{root_id}")
        assert resp.status_code == 204

        branch_resp = await client.get(f"/api/chats/{chat['id']}/branches/{branch['id']}")
        assert branch_resp.json()["head_node_id"] is None

    async def test_delete_nonexistent_returns_404(self, client):
        chat = await _mk_chat(client)
        resp = await client.delete(
            f"/api/chats/{chat['id']}/nodes/00000000-0000-0000-0000-000000000000"
        )
        assert resp.status_code == 404

    async def test_delete_wrong_chat_returns_404(self, client, db_session):
        """Node from another chat cannot be deleted via the wrong chat route."""
        chat_a = await _mk_chat(client, "ChatA")
        chat_b = await _mk_chat(client, "ChatB")
        node_id = await _mk_node(db_session, chat_a["id"])

        resp = await client.delete(f"/api/chats/{chat_b['id']}/nodes/{node_id}")
        assert resp.status_code == 404


# ---------------------------------------------------------------------------
# Node summarize tests
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
class TestSummarizeNode:
    async def test_summarize_creates_summary_node(self, client, db_session):
        """Summarize endpoint creates a child node marked is_summary=True."""
        chat = await _mk_chat(client)
        node_id = await _mk_node(db_session, chat["id"])

        mock_response = MagicMock()
        mock_response.choices = [MagicMock()]
        mock_response.choices[0].message.content = "This is a summary."

        with patch("app.routers.chats.litellm.acompletion", new=AsyncMock(return_value=mock_response)):
            resp = await client.post(
                f"/api/chats/{chat['id']}/nodes/{node_id}/summarize",
                json={"model": "gpt-4o"},
            )

        assert resp.status_code == 201
        data = resp.json()
        assert "new_node_id" in data
        node_data = data["node"]
        assert node_data["is_summary"] is True
        assert node_data["parent_id"] == node_id
        assert node_data["ai_response"] == "This is a summary."

    async def test_summarize_nonexistent_node_returns_404(self, client):
        chat = await _mk_chat(client)
        resp = await client.post(
            f"/api/chats/{chat['id']}/nodes/00000000-0000-0000-0000-000000000000/summarize",
            json={"model": "gpt-4o"},
        )
        assert resp.status_code == 404

    async def test_summarize_wrong_chat_returns_404(self, client, db_session):
        chat_a = await _mk_chat(client, "ChatA")
        chat_b = await _mk_chat(client, "ChatB")
        node_id = await _mk_node(db_session, chat_a["id"])

        resp = await client.post(
            f"/api/chats/{chat_b['id']}/nodes/{node_id}/summarize",
            json={"model": "gpt-4o"},
        )
        assert resp.status_code == 404

    async def test_summarize_custom_prompt_override(self, client, db_session):
        """Custom synthesis_prompt_override is forwarded to litellm."""
        chat = await _mk_chat(client)
        node_id = await _mk_node(db_session, chat["id"])

        captured: list = []

        async def mock_completion(**kwargs):
            captured.append(kwargs["messages"])
            resp = MagicMock()
            resp.choices = [MagicMock()]
            resp.choices[0].message.content = "custom summary"
            return resp

        with patch("app.routers.chats.litellm.acompletion", new=mock_completion):
            resp = await client.post(
                f"/api/chats/{chat['id']}/nodes/{node_id}/summarize",
                json={"model": "gpt-4o", "synthesis_prompt_override": "Summarize briefly."},
            )

        assert resp.status_code == 201
        # Verify the override prompt was used
        assert any("Summarize briefly." in m["content"] for m in captured[0])
