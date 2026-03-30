/**
 * TypeScript interfaces that mirror the backend Pydantic DTOs.
 * Keep in sync with backend/app/schemas.py.
 */

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

export interface TokenResponse {
  access_token: string;
  token_type: string;
}

// ---------------------------------------------------------------------------
// Chats
// ---------------------------------------------------------------------------

export interface Chat {
  id: string;
  user_id: string;
  title: string | null;
  created_at: string;
}

export interface ChatCreate {
  title?: string;
}

export interface ChatUpdate {
  title?: string;
}

// ---------------------------------------------------------------------------
// Nodes
// ---------------------------------------------------------------------------

export interface Node {
  id: string;
  chat_id: string;
  parent_id: string | null;
  merge_parent_id: string | null;
  user_prompt: string;
  ai_response: string | null;
  model_used: string;
  created_at: string;
  is_summary: boolean;
}

export interface NodeCreate {
  user_prompt: string;
  model_used: string;
  parent_id?: string;
}

// ---------------------------------------------------------------------------
// Branches
// ---------------------------------------------------------------------------

export interface Branch {
  id: string;
  chat_id: string;
  name: string;
  head_node_id: string | null;
}

export interface BranchCreate {
  name: string;
  source_node_id?: string;
}

export interface BranchUpdate {
  name?: string;
}

// ---------------------------------------------------------------------------
// Messages (sending)
// ---------------------------------------------------------------------------

export interface SendMessageRequest {
  user_prompt: string;
  model_used: string;
  parent_node_id?: string;
  synthesis_model_override?: string;
}

// ---------------------------------------------------------------------------
// Model Sources
// ---------------------------------------------------------------------------

export interface ModelSource {
  id: string;
  user_id: string;
  name: string;
  provider_type: string;
  base_url: string | null;
  created_at: string;
}

export interface ModelSourceCreate {
  name: string;
  provider_type: string;
  base_url?: string;
  api_key?: string;
}

export interface ModelSourceUpdate {
  name?: string;
  base_url?: string;
  api_key?: string;
}

export interface ModelSourceModel {
  id: string;
  source_id: string;
  model_id: string;
  display_name: string;
  context_window_tokens: number;
  last_fetched_at: string;
}

export interface ModelSourceModelCreate {
  model_id: string;
  display_name: string;
  context_window_tokens?: number;
}

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

export interface UserSettings {
  user_id: string;
  default_model_id: string | null;
  synthesis_model_id: string | null;
  custom_instructions: string | null;
  theme: 'dark' | 'light';
  share_view_mode: 'linear' | 'full';
  branch_naming_mode: 'random' | 'ai';
  keybindings: Record<string, string> | null;
  highlight_color: string;
}

export interface UserSettingsUpdate {
  default_model_id?: string;
  synthesis_model_id?: string;
  custom_instructions?: string;
  theme?: 'dark' | 'light';
  share_view_mode?: 'linear' | 'full';
  branch_naming_mode?: 'random' | 'ai';
  keybindings?: Record<string, string>;
  highlight_color?: string;
}

// ---------------------------------------------------------------------------
// Share Links
// ---------------------------------------------------------------------------

export interface ShareLink {
  id: string;
  user_id: string;
  chat_id: string;
  branch_id: string;
  node_id: string;
  created_at: string;
}

export interface ShareLinkCreate {
  chat_id: string;
  branch_id: string;
  node_id: string;
}

// ---------------------------------------------------------------------------
// Merge
// ---------------------------------------------------------------------------

export interface MergeRequest {
  source_branch_id: string;
  target_branch_id: string;
  active_model: string;
  synthesis_prompt_override?: string;
  synthesis_model_override?: string;
}

export interface MergeResponse {
  status: string;
  new_node_id: string;
}

// ---------------------------------------------------------------------------
// Graph
// ---------------------------------------------------------------------------

export interface GraphNodeData {
  id: string;
  parent_id: string | null;
  merge_parent_id: string | null;
  chat_id: string;
  model_used: string;
  created_at: string;
  branch_heads: string[];
  is_branch_origin: boolean;
  is_summary: boolean;
}

export interface GraphResponse {
  nodes: GraphNodeData[];
}

// ---------------------------------------------------------------------------
// Node management
// ---------------------------------------------------------------------------

export interface SummarizeNodeRequest {
  model: string;
  synthesis_prompt_override?: string;
}

export interface SummarizeNodeResponse {
  new_node_id: string;
  node: Node;
}

export interface CopyNodeResponse {
  new_node_id: string;
  node: Node;
}

// ---------------------------------------------------------------------------
// Context compression
// ---------------------------------------------------------------------------

export interface CompressRequest {
  model: string;
  context_window_tokens?: number;
}

export interface CompressResponse {
  compressed: boolean;
  new_node_id: string | null;
  message: string;
}

