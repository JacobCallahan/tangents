"""
SQLAlchemy ORM models — Adjacency List design.

All primary keys are UUIDs stored as strings (SQLite-compatible).
Timestamps are naive UTC datetimes.
"""

import uuid
from datetime import datetime, timezone

from sqlalchemy import (
    Boolean,
    DateTime,
    ForeignKey,
    Integer,
    String,
    Text,
    JSON,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


def _uuid() -> str:
    return str(uuid.uuid4())


def _now() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


# ---------------------------------------------------------------------------
# Users
# ---------------------------------------------------------------------------


class User(Base):
    __tablename__ = "users"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    username: Mapped[str] = mapped_column(String(255), unique=True, nullable=False)
    hashed_password: Mapped[str | None] = mapped_column(Text, nullable=True)

    # Relationships
    chats: Mapped[list["Chat"]] = relationship(
        "Chat", back_populates="user", cascade="all, delete-orphan"
    )
    model_sources: Mapped[list["ModelSource"]] = relationship(
        "ModelSource", back_populates="user", cascade="all, delete-orphan"
    )
    settings: Mapped["UserSettings | None"] = relationship(
        "UserSettings", back_populates="user", uselist=False, cascade="all, delete-orphan"
    )
    share_links: Mapped[list["ShareLink"]] = relationship(
        "ShareLink", back_populates="user", cascade="all, delete-orphan"
    )


# ---------------------------------------------------------------------------
# Chats (conversation repositories)
# ---------------------------------------------------------------------------


class Chat(Base):
    __tablename__ = "chats"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    user_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    title: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_now, nullable=False)

    # Relationships
    user: Mapped["User"] = relationship("User", back_populates="chats")
    nodes: Mapped[list["Node"]] = relationship(
        "Node", back_populates="chat", cascade="all, delete-orphan"
    )
    branches: Mapped[list["Branch"]] = relationship(
        "Branch", back_populates="chat", cascade="all, delete-orphan"
    )
    share_links: Mapped[list["ShareLink"]] = relationship(
        "ShareLink", back_populates="chat", cascade="all, delete-orphan"
    )


# ---------------------------------------------------------------------------
# Nodes (commits — single user/AI message pair)
# ---------------------------------------------------------------------------


class Node(Base):
    __tablename__ = "nodes"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    chat_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("chats.id", ondelete="CASCADE"), nullable=False, index=True
    )
    parent_id: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("nodes.id", ondelete="SET NULL"), nullable=True, index=True
    )
    # True for summary nodes (on-demand summaries and merge nodes).
    # Summary nodes act as AI context roots — history stops here rather than
    # continuing up to the tree root.
    is_summary: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    # For merge nodes: stores the ID of the second parent (source branch head).
    # Renders a second edge in the graph without affecting AI context.
    merge_parent_id: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("nodes.id", ondelete="SET NULL"), nullable=True, index=True
    )
    user_prompt: Mapped[str] = mapped_column(Text, nullable=False)
    # Nullable until AI streaming completes; partial responses are never persisted
    ai_response: Mapped[str | None] = mapped_column(Text, nullable=True)
    model_used: Mapped[str] = mapped_column(String(255), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_now, nullable=False)

    # Relationships
    chat: Mapped["Chat"] = relationship("Chat", back_populates="nodes")
    parent: Mapped["Node | None"] = relationship(
        "Node", remote_side="Node.id", back_populates="children",
        foreign_keys="[Node.parent_id]",
    )
    children: Mapped[list["Node"]] = relationship(
        "Node", back_populates="parent", foreign_keys="[Node.parent_id]"
    )
    merge_parent: Mapped["Node | None"] = relationship(
        "Node", foreign_keys="[Node.merge_parent_id]",
    )
    share_links: Mapped[list["ShareLink"]] = relationship(
        "ShareLink", back_populates="node", cascade="all, delete-orphan"
    )


# ---------------------------------------------------------------------------
# Branches (named HEAD pointers)
# ---------------------------------------------------------------------------


class Branch(Base):
    __tablename__ = "branches"
    __table_args__ = (UniqueConstraint("chat_id", "name", name="uq_branch_chat_name"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    chat_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("chats.id", ondelete="CASCADE"), nullable=False, index=True
    )
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    head_node_id: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("nodes.id", ondelete="RESTRICT"), nullable=True
    )

    # Relationships
    chat: Mapped["Chat"] = relationship("Chat", back_populates="branches")
    head_node: Mapped["Node | None"] = relationship("Node", foreign_keys=[head_node_id])
    share_links: Mapped[list["ShareLink"]] = relationship(
        "ShareLink", back_populates="branch", cascade="all, delete-orphan"
    )


# ---------------------------------------------------------------------------
# Model Sources (configured AI providers)
# ---------------------------------------------------------------------------


class ModelSource(Base):
    __tablename__ = "model_sources"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    user_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    provider_type: Mapped[str] = mapped_column(String(100), nullable=False)
    base_url: Mapped[str | None] = mapped_column(Text, nullable=True)
    # Fernet-encrypted; write-only from the UI
    encrypted_api_key: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_now, nullable=False)

    # Relationships
    user: Mapped["User"] = relationship("User", back_populates="model_sources")
    models: Mapped[list["ModelSourceModel"]] = relationship(
        "ModelSourceModel",
        back_populates="source",
        cascade="all, delete-orphan",
    )


# ---------------------------------------------------------------------------
# Model Source Models (available models per source)
# ---------------------------------------------------------------------------


class ModelSourceModel(Base):
    __tablename__ = "model_source_models"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    source_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("model_sources.id", ondelete="CASCADE"), nullable=False, index=True
    )
    model_id: Mapped[str] = mapped_column(String(255), nullable=False)
    display_name: Mapped[str] = mapped_column(String(255), nullable=False)
    # Token budget; defaults to 4096 for unknown models
    context_window_tokens: Mapped[int] = mapped_column(Integer, nullable=False, default=4096)
    last_fetched_at: Mapped[datetime] = mapped_column(DateTime, default=_now, nullable=False)

    # Relationships
    source: Mapped["ModelSource"] = relationship("ModelSource", back_populates="models")


# ---------------------------------------------------------------------------
# User Settings (one row per user)
# ---------------------------------------------------------------------------


class UserSettings(Base):
    __tablename__ = "user_settings"

    user_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="CASCADE"), primary_key=True
    )
    default_model_id: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("model_source_models.id", ondelete="SET NULL"), nullable=True
    )
    synthesis_model_id: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("model_source_models.id", ondelete="SET NULL"), nullable=True
    )
    custom_instructions: Mapped[str | None] = mapped_column(Text, nullable=True)
    theme: Mapped[str] = mapped_column(String(20), nullable=False, default="dark")
    share_view_mode: Mapped[str] = mapped_column(String(20), nullable=False, default="linear")
    branch_naming_mode: Mapped[str] = mapped_column(String(20), nullable=False, default="random")
    # JSON blob of user-overridden keybindings; NULL falls back to built-in defaults
    keybindings: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    # CSS hex colour used to highlight the selected graph node
    highlight_color: Mapped[str] = mapped_column(String(20), nullable=False, default='#6366f1')

    # Relationships
    user: Mapped["User"] = relationship("User", back_populates="settings")
    default_model: Mapped["ModelSourceModel | None"] = relationship(
        "ModelSourceModel", foreign_keys=[default_model_id]
    )
    synthesis_model: Mapped["ModelSourceModel | None"] = relationship(
        "ModelSourceModel", foreign_keys=[synthesis_model_id]
    )


# ---------------------------------------------------------------------------
# Share Links
# ---------------------------------------------------------------------------


class ShareLink(Base):
    __tablename__ = "share_links"

    # Full UUID as the token — security through obscurity for public read-only access
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    user_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    chat_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("chats.id", ondelete="CASCADE"), nullable=False
    )
    branch_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("branches.id", ondelete="CASCADE"), nullable=False
    )
    node_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("nodes.id", ondelete="CASCADE"), nullable=False
    )
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_now, nullable=False)

    # Relationships
    user: Mapped["User"] = relationship("User", back_populates="share_links")
    chat: Mapped["Chat"] = relationship("Chat", back_populates="share_links")
    branch: Mapped["Branch"] = relationship("Branch", back_populates="share_links")
    node: Mapped["Node"] = relationship("Node", back_populates="share_links")
