"""
Integration tests for /api/chats/{chat_id}/branches endpoints.
SSE streaming tests are excluded (require live LLM); CRUD + history are covered.
"""

from __future__ import annotations

import pytest


async def _mk_chat(client, title: str = "TestChat") -> dict:
    return (await client.post("/api/chats", json={"title": title})).json()


async def _mk_node(db_session, chat_id: str, parent_id: str | None = None) -> str:
    """Insert a bare node directly into the DB and return its ID."""
    import uuid
    from app.models import Node

    node = Node(
        id=str(uuid.uuid4()),
        chat_id=chat_id,
        parent_id=parent_id,
        user_prompt="seed node",
        ai_response="seed response",
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
class TestListBranches:
    async def test_empty_initially(self, client):
        chat = await _mk_chat(client)
        resp = await client.get(f"/api/chats/{chat['id']}/branches")
        assert resp.status_code == 200
        assert resp.json() == []


@pytest.mark.asyncio
class TestCreateBranch:
    async def test_create(self, client, db_session):
        chat = await _mk_chat(client)
        node_id = await _mk_node(db_session, chat["id"])
        branch = await _mk_branch(client, chat["id"], node_id, "feature")
        assert branch["name"] == "feature"
        assert branch["head_node_id"] == node_id

    async def test_invalid_source_node_returns_404(self, client):
        chat = await _mk_chat(client)
        resp = await client.post(
            f"/api/chats/{chat['id']}/branches",
            json={"name": "x", "source_node_id": "00000000-0000-0000-0000-000000000000"},
        )
        assert resp.status_code == 404

    async def test_duplicate_name_returns_error(self, client, db_session):
        chat = await _mk_chat(client)
        node_id = await _mk_node(db_session, chat["id"])
        await _mk_branch(client, chat["id"], node_id, "dup")
        resp = await client.post(
            f"/api/chats/{chat['id']}/branches",
            json={"name": "dup", "source_node_id": node_id},
        )
        # Unique constraint violation — should 4xx or 5xx
        assert resp.status_code >= 400


@pytest.mark.asyncio
class TestGetBranch:
    async def test_get(self, client, db_session):
        chat = await _mk_chat(client)
        node_id = await _mk_node(db_session, chat["id"])
        branch = await _mk_branch(client, chat["id"], node_id)
        resp = await client.get(f"/api/chats/{chat['id']}/branches/{branch['id']}")
        assert resp.status_code == 200
        assert resp.json()["id"] == branch["id"]

    async def test_nonexistent_returns_404(self, client):
        chat = await _mk_chat(client)
        resp = await client.get(
            f"/api/chats/{chat['id']}/branches/00000000-0000-0000-0000-000000000000"
        )
        assert resp.status_code == 404


@pytest.mark.asyncio
class TestRenameBranch:
    async def test_rename(self, client, db_session):
        chat = await _mk_chat(client)
        node_id = await _mk_node(db_session, chat["id"])
        branch = await _mk_branch(client, chat["id"], node_id, "old")
        resp = await client.patch(
            f"/api/chats/{chat['id']}/branches/{branch['id']}",
            json={"name": "renamed"},
        )
        assert resp.status_code == 200
        assert resp.json()["name"] == "renamed"


@pytest.mark.asyncio
class TestBranchHistory:
    async def test_history_returns_list(self, client, db_session):
        chat = await _mk_chat(client)
        node_id = await _mk_node(db_session, chat["id"])
        branch = await _mk_branch(client, chat["id"], node_id)
        resp = await client.get(
            f"/api/chats/{chat['id']}/branches/{branch['id']}/history"
        )
        assert resp.status_code == 200
        history = resp.json()
        assert isinstance(history, list)
        assert len(history) >= 1
        assert history[0]["user_prompt"] == "seed node"


@pytest.mark.asyncio
class TestDeleteBranch:
    async def test_delete(self, client, db_session):
        chat = await _mk_chat(client)
        node_id = await _mk_node(db_session, chat["id"])
        branch = await _mk_branch(client, chat["id"], node_id)
        resp = await client.delete(
            f"/api/chats/{chat['id']}/branches/{branch['id']}"
        )
        assert resp.status_code == 204

        get_resp = await client.get(
            f"/api/chats/{chat['id']}/branches/{branch['id']}"
        )
        assert get_resp.status_code == 404


# ---------------------------------------------------------------------------
# Copy (cherry-pick) endpoint tests
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
class TestCopyNode:
    async def test_copy_appends_node_to_branch(self, client, db_session):
        """Copying a node creates a new node on the target branch HEAD."""
        chat = await _mk_chat(client)
        root_id = await _mk_node(db_session, chat["id"])
        # Source node on same chat (different ancestry)
        source_id = await _mk_node(db_session, chat["id"])

        branch = await _mk_branch(client, chat["id"], root_id, "target")

        resp = await client.post(
            f"/api/chats/{chat['id']}/branches/{branch['id']}/copy/{source_id}"
        )
        assert resp.status_code == 201
        data = resp.json()
        assert "new_node_id" in data
        new_node = data["node"]
        assert new_node["parent_id"] == root_id
        assert new_node["is_summary"] is False

    async def test_copy_advances_branch_head(self, client, db_session):
        """After copy, the branch HEAD should point at the new node."""
        chat = await _mk_chat(client)
        root_id = await _mk_node(db_session, chat["id"])
        source_id = await _mk_node(db_session, chat["id"])
        branch = await _mk_branch(client, chat["id"], root_id, "main")

        copy_resp = await client.post(
            f"/api/chats/{chat['id']}/branches/{branch['id']}/copy/{source_id}"
        )
        new_node_id = copy_resp.json()["new_node_id"]

        branch_resp = await client.get(f"/api/chats/{chat['id']}/branches/{branch['id']}")
        assert branch_resp.json()["head_node_id"] == new_node_id

    async def test_copy_preserves_prompt_and_response(self, client, db_session):
        """Copied node retains user_prompt and ai_response from source."""
        import uuid as _uuid
        from app.models import Node

        chat = await _mk_chat(client)
        root_id = await _mk_node(db_session, chat["id"])

        source = Node(
            id=str(_uuid.uuid4()),
            chat_id=chat["id"],
            parent_id=None,
            user_prompt="original question",
            ai_response="original answer",
            model_used="gpt-4o",
        )
        db_session.add(source)
        await db_session.flush()

        branch = await _mk_branch(client, chat["id"], root_id, "dest")
        resp = await client.post(
            f"/api/chats/{chat['id']}/branches/{branch['id']}/copy/{source.id}"
        )
        assert resp.status_code == 201
        node = resp.json()["node"]
        assert node["user_prompt"] == "original question"
        assert node["ai_response"] == "original answer"

    async def test_copy_nonexistent_node_returns_404(self, client, db_session):
        chat = await _mk_chat(client)
        root_id = await _mk_node(db_session, chat["id"])
        branch = await _mk_branch(client, chat["id"], root_id, "main")

        resp = await client.post(
            f"/api/chats/{chat['id']}/branches/{branch['id']}/copy/00000000-0000-0000-0000-000000000000"
        )
        assert resp.status_code == 404

    async def test_copy_wrong_branch_returns_404(self, client, db_session):
        chat = await _mk_chat(client)
        node_id = await _mk_node(db_session, chat["id"])

        resp = await client.post(
            f"/api/chats/{chat['id']}/branches/00000000-0000-0000-0000-000000000000/copy/{node_id}"
        )
        assert resp.status_code == 404


# ---------------------------------------------------------------------------
# Merge endpoint — verify is_summary + merge_parent_id on result
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
class TestMergeIsSummary:
    async def test_merge_creates_summary_node(self, client, db_session):
        """Merge node must have is_summary=True and a merge_parent_id."""
        from unittest.mock import AsyncMock, MagicMock, patch

        chat = await _mk_chat(client)
        root_id = await _mk_node(db_session, chat["id"])
        source_node_id = await _mk_node(db_session, chat["id"], parent_id=root_id)
        target_node_id = await _mk_node(db_session, chat["id"], parent_id=root_id)

        source_branch = await _mk_branch(client, chat["id"], source_node_id, "feature")
        target_branch = await _mk_branch(client, chat["id"], target_node_id, "main")

        mock_response = MagicMock()
        mock_response.choices = [MagicMock()]
        mock_response.choices[0].message.content = "Merge summary text."

        with patch(
            "app.routers.branches.litellm.acompletion",
            new=AsyncMock(return_value=mock_response),
        ):
            resp = await client.post(
                f"/api/chats/{chat['id']}/branches/merge",
                json={
                    "source_branch_id": source_branch["id"],
                    "target_branch_id": target_branch["id"],
                    "active_model": "gpt-4o",
                },
            )

        assert resp.status_code == 201
        data = resp.json()
        new_node_id = data["new_node_id"]

        # Retrieve the graph and find the merge node
        graph_resp = await client.get(f"/api/chats/{chat['id']}/graph")
        graph_nodes = {n["id"]: n for n in graph_resp.json()["nodes"]}

        merge_node = graph_nodes[new_node_id]
        assert merge_node["is_summary"] is True
        assert merge_node["merge_parent_id"] == source_node_id
        assert merge_node["parent_id"] == target_node_id

