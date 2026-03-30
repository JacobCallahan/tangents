"""
Pydantic DTOs — strict validation for all API request/response payloads.
"""

from __future__ import annotations

from datetime import datetime
from typing import Optional
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field


# ---------------------------------------------------------------------------
# Shared config
# ---------------------------------------------------------------------------


class _OrmBase(BaseModel):
    model_config = ConfigDict(from_attributes=True)


# ---------------------------------------------------------------------------
# Users
# ---------------------------------------------------------------------------


class UserRead(_OrmBase):
    id: UUID
    username: str


# ---------------------------------------------------------------------------
# Chat DTOs
# ---------------------------------------------------------------------------


class ChatCreate(BaseModel):
    """Chats are created lazily on first message; this is used when a title override is needed."""
    title: Optional[str] = None


class ChatUpdate(BaseModel):
    title: Optional[str] = None


class ChatRead(_OrmBase):
    id: UUID
    user_id: UUID
    title: Optional[str]
    created_at: datetime


# ---------------------------------------------------------------------------
# Node (Commit) DTOs
# ---------------------------------------------------------------------------


class NodeCreate(BaseModel):
    user_prompt: str
    model_used: str = Field(default="gpt-4o")
    # Optional — provided when explicitly branching from a specific node (not branch HEAD)
    parent_id: Optional[UUID] = None


class NodeUpdate(BaseModel):
    ai_response: Optional[str] = None


class NodeRead(_OrmBase):
    id: UUID
    chat_id: UUID
    parent_id: Optional[UUID]
    merge_parent_id: Optional[UUID] = None
    user_prompt: str
    ai_response: Optional[str]
    model_used: str
    created_at: datetime
    is_summary: bool = False


# ---------------------------------------------------------------------------
# Branch DTOs
# ---------------------------------------------------------------------------


class BranchCreate(BaseModel):
    name: str
    source_node_id: Optional[UUID] = None


class BranchUpdate(BaseModel):
    name: Optional[str] = None


class BranchRead(_OrmBase):
    id: UUID
    chat_id: UUID
    name: str
    head_node_id: Optional[UUID]


# ---------------------------------------------------------------------------
# Model Source DTOs
# ---------------------------------------------------------------------------


class ModelSourceCreate(BaseModel):
    name: str
    provider_type: str
    base_url: Optional[str] = None
    api_key: Optional[str] = None  # Plaintext; encrypted before storage — write-only


class ModelSourceUpdate(BaseModel):
    name: Optional[str] = None
    base_url: Optional[str] = None
    api_key: Optional[str] = None  # Write-only; replaces existing key when provided


class ModelSourceRead(_OrmBase):
    id: UUID
    user_id: UUID
    name: str
    provider_type: str
    base_url: Optional[str]
    # api_key intentionally omitted — write-only from the UI
    created_at: datetime


# ---------------------------------------------------------------------------
# Model Source Model DTOs
# ---------------------------------------------------------------------------


class ModelSourceModelCreate(BaseModel):
    model_id: str
    display_name: str
    context_window_tokens: int = 4096


class ModelSourceModelUpdate(BaseModel):
    display_name: Optional[str] = None
    context_window_tokens: Optional[int] = None


class ModelSourceModelRead(_OrmBase):
    id: UUID
    source_id: UUID
    model_id: str
    display_name: str
    context_window_tokens: int
    last_fetched_at: datetime


# ---------------------------------------------------------------------------
# User Settings DTOs
# ---------------------------------------------------------------------------


class UserSettingsUpdate(BaseModel):
    default_model_id: Optional[UUID] = None
    synthesis_model_id: Optional[UUID] = None
    custom_instructions: Optional[str] = None
    theme: Optional[str] = None
    share_view_mode: Optional[str] = None
    branch_naming_mode: Optional[str] = None
    keybindings: Optional[dict] = None
    highlight_color: Optional[str] = None


class UserSettingsRead(_OrmBase):
    user_id: UUID
    default_model_id: Optional[UUID]
    synthesis_model_id: Optional[UUID]
    custom_instructions: Optional[str]
    theme: str
    share_view_mode: str
    branch_naming_mode: str
    keybindings: Optional[dict]
    highlight_color: str


# ---------------------------------------------------------------------------
# Share Link DTOs
# ---------------------------------------------------------------------------


class ShareLinkCreate(BaseModel):
    chat_id: UUID
    branch_id: UUID
    node_id: UUID


class ShareLinkRead(_OrmBase):
    id: UUID
    user_id: UUID
    chat_id: UUID
    branch_id: UUID
    node_id: UUID
    created_at: datetime


# ---------------------------------------------------------------------------
# Merge / Synthesis DTOs
# ---------------------------------------------------------------------------


class MergeRequest(BaseModel):
    source_branch_id: UUID
    target_branch_id: UUID
    # Used as synthesis model fallback when neither override nor env var is set
    active_model: str
    synthesis_prompt_override: Optional[str] = None
    synthesis_model_override: Optional[str] = None


class MergeResponse(BaseModel):
    status: str
    new_node_id: UUID


# ---------------------------------------------------------------------------
# Graph DTOs (for React Flow)
# ---------------------------------------------------------------------------


class GraphNodeData(BaseModel):
    id: str
    parent_id: Optional[str]
    merge_parent_id: Optional[str] = None
    chat_id: str
    model_used: str
    created_at: datetime
    # Branch names that point their HEAD at this node (may be empty)
    branch_heads: list[str] = Field(default_factory=list)
    is_branch_origin: bool = False
    is_summary: bool = False


class GraphResponse(BaseModel):
    nodes: list[GraphNodeData]


# ---------------------------------------------------------------------------
# Node management DTOs
# ---------------------------------------------------------------------------


class SummarizeNodeRequest(BaseModel):
    """Payload for POST /api/chats/{chat_id}/nodes/{node_id}/summarize"""
    model: str
    synthesis_prompt_override: Optional[str] = None


class SummarizeNodeResponse(BaseModel):
    new_node_id: UUID
    node: NodeRead


class CopyNodeResponse(BaseModel):
    new_node_id: UUID
    node: NodeRead


# ---------------------------------------------------------------------------
# Streaming / SSE helpers
# ---------------------------------------------------------------------------


class SendMessageRequest(BaseModel):
    """Payload for POST /api/chats/{chat_id}/branches/{branch_id}/messages"""
    user_prompt: str
    model_used: str
    # When branching from a non-HEAD node; overrides branch HEAD as the parent
    parent_node_id: Optional[UUID] = None
    synthesis_model_override: Optional[str] = None


# ---------------------------------------------------------------------------
# Auth
# ---------------------------------------------------------------------------


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
