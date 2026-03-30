/**
 * MSW request handlers — mock every API endpoint used by the frontend.
 * Import and override individual handlers in tests that need custom behaviour.
 */

import { http, HttpResponse } from 'msw';

// ── Shared fixture data ───────────────────────────────────────────────────────

export const MOCK_USER_ID = 'user-0001';
export const MOCK_CHAT_ID = 'chat-0001';
export const MOCK_BRANCH_ID = 'branch-main';
export const MOCK_TANGENT_ID = 'branch-tangent';
export const MOCK_NODE_ID_A = 'node-a';
export const MOCK_NODE_ID_B = 'node-b';
export const MOCK_NODE_ID_C = 'node-c';
export const MOCK_SOURCE_ID = 'source-0001';
export const MOCK_MODEL_ID = 'model-0001';

export const mockSettings = {
  user_id: MOCK_USER_ID,
  default_model_id: MOCK_MODEL_ID,
  synthesis_model_id: null,
  custom_instructions: null,
  theme: 'dark' as const,
  highlight_color: '#6366f1',
  share_view_mode: 'linear' as const,
  keybindings: null,
  branch_naming: 'random' as const,
};

export const mockSource = {
  id: MOCK_SOURCE_ID,
  user_id: MOCK_USER_ID,
  name: 'OpenAI',
  provider_type: 'openai',
  base_url: 'https://api.openai.com/v1',
  created_at: '2025-01-01T00:00:00Z',
};

export const mockModel = {
  id: MOCK_MODEL_ID,
  source_id: MOCK_SOURCE_ID,
  model_id: 'gpt-4o',
  display_name: 'GPT-4o',
  context_window_tokens: 128000,
  last_fetched_at: '2025-01-01T00:00:00Z',
};

export const mockChat = {
  id: MOCK_CHAT_ID,
  user_id: MOCK_USER_ID,
  title: 'Test Chat',
  created_at: '2025-01-01T00:00:00Z',
};

export const mockBranchMain = {
  id: MOCK_BRANCH_ID,
  chat_id: MOCK_CHAT_ID,
  name: 'main',
  head_node_id: MOCK_NODE_ID_B,
};

export const mockBranchTangent = {
  id: MOCK_TANGENT_ID,
  chat_id: MOCK_CHAT_ID,
  name: 'tangent-explore',
  head_node_id: MOCK_NODE_ID_C,
};

export const mockNodes = {
  a: {
    id: MOCK_NODE_ID_A,
    chat_id: MOCK_CHAT_ID,
    parent_id: null,
    merge_parent_id: null,
    user_prompt: 'Root question',
    ai_response: 'Root answer',
    model_used: 'gpt-4o',
    created_at: '2025-01-01T00:00:01Z',
    is_summary: false,
  },
  b: {
    id: MOCK_NODE_ID_B,
    chat_id: MOCK_CHAT_ID,
    parent_id: MOCK_NODE_ID_A,
    merge_parent_id: null,
    user_prompt: 'Follow-up',
    ai_response: 'Follow-up answer',
    model_used: 'gpt-4o',
    created_at: '2025-01-01T00:00:02Z',
    is_summary: false,
  },
  c: {
    id: MOCK_NODE_ID_C,
    chat_id: MOCK_CHAT_ID,
    parent_id: MOCK_NODE_ID_A,
    merge_parent_id: null,
    user_prompt: 'Tangent question',
    ai_response: 'Tangent answer',
    model_used: 'gpt-4o',
    created_at: '2025-01-01T00:00:03Z',
    is_summary: false,
  },
};

export const mockGraphNodes = [
  {
    id: MOCK_NODE_ID_A,
    parent_id: null,
    merge_parent_id: null,
    branch_heads: [MOCK_BRANCH_ID],
    is_summary: false,
    is_branch_origin: false,
    chat_id: MOCK_CHAT_ID,
    model_used: 'gpt-4o',
    created_at: '2025-01-01T00:00:01Z',
  },
  {
    id: MOCK_NODE_ID_B,
    parent_id: MOCK_NODE_ID_A,
    merge_parent_id: null,
    branch_heads: [MOCK_BRANCH_ID],
    is_summary: false,
    is_branch_origin: false,
    chat_id: MOCK_CHAT_ID,
    model_used: 'gpt-4o',
    created_at: '2025-01-01T00:00:02Z',
  },
  {
    id: MOCK_NODE_ID_C,
    parent_id: MOCK_NODE_ID_A,
    merge_parent_id: null,
    branch_heads: [MOCK_TANGENT_ID],
    is_summary: false,
    is_branch_origin: false,
    chat_id: MOCK_CHAT_ID,
    model_used: 'gpt-4o',
    created_at: '2025-01-01T00:00:03Z',
  },
];

// ── Default handlers (happy-path) ─────────────────────────────────────────────

export const handlers = [
  // Settings
  http.get('/api/settings/me', () => HttpResponse.json(mockSettings)),
  http.patch('/api/settings/me', async ({ request }) => {
    const body = await request.json() as Record<string, unknown>;
    return HttpResponse.json({ ...mockSettings, ...body });
  }),

  // Model sources
  http.get('/api/settings/sources', () => HttpResponse.json([mockSource])),
  http.post('/api/settings/sources', () => HttpResponse.json(mockSource, { status: 201 })),
  http.delete('/api/settings/sources/:id', () => new HttpResponse(null, { status: 204 })),
  http.post('/api/settings/sources/:id/refresh', () => HttpResponse.json([mockModel])),
  http.get('/api/settings/sources/:id/models', () => HttpResponse.json([mockModel])),

  // Chats
  http.get('/api/chats', () => HttpResponse.json([mockChat])),
  http.post('/api/chats', () => HttpResponse.json(mockChat, { status: 201 })),
  http.patch('/api/chats/:id', async ({ request }) => {
    const body = await request.json() as Record<string, unknown>;
    return HttpResponse.json({ ...mockChat, ...body });
  }),

  // Branches
  http.get('/api/chats/:chatId/branches', () =>
    HttpResponse.json([mockBranchMain, mockBranchTangent]),
  ),
  http.post('/api/chats/:chatId/branches', async ({ request }) => {
    const body = await request.json() as { name: string };
    return HttpResponse.json(
      { ...mockBranchMain, id: 'branch-new', name: body.name ?? 'new-branch' },
      { status: 201 },
    );
  }),
  http.patch('/api/chats/:chatId/branches/:branchId', async ({ request }) => {
    const body = await request.json() as Record<string, unknown>;
    return HttpResponse.json({ ...mockBranchMain, ...body });
  }),
  http.delete('/api/chats/:chatId/branches/:branchId', () =>
    new HttpResponse(null, { status: 204 }),
  ),

  // History
  http.get('/api/chats/:chatId/branches/:branchId/history', () =>
    HttpResponse.json([mockNodes.a, mockNodes.b]),
  ),

  // Graph
  http.get('/api/chats/:chatId/graph', () => HttpResponse.json({ nodes: mockGraphNodes })),

  // Node management
  http.delete('/api/chats/:chatId/nodes/:nodeId', () =>
    new HttpResponse(null, { status: 204 }),
  ),
  http.post('/api/chats/:chatId/nodes/:nodeId/summarize', () =>
    HttpResponse.json(
      {
        new_node_id: 'node-summary',
        node: {
          ...mockNodes.b,
          id: 'node-summary',
          parent_id: MOCK_NODE_ID_B,
          is_summary: true,
          merge_parent_id: null,
          user_prompt: '[Summary]',
          ai_response: 'Summary text',
        },
      },
      { status: 201 },
    ),
  ),

  // Branch copy
  http.post('/api/chats/:chatId/branches/:branchId/copy/:nodeId', () =>
    HttpResponse.json(
      {
        new_node_id: 'node-copy',
        node: {
          ...mockNodes.b,
          id: 'node-copy',
          parent_id: MOCK_NODE_ID_B,
          is_summary: false,
          merge_parent_id: null,
        },
      },
      { status: 201 },
    ),
  ),

  // Share links
  http.get('/api/share', () => HttpResponse.json([])),
  http.post('/api/share', () =>
    HttpResponse.json({ id: 'share-0001', token: 'abc123', created_at: '2025-01-01T00:00:00Z' }),
  ),
  http.delete('/api/share/:token', () => new HttpResponse(null, { status: 204 })),

  // SSE streaming — responds with a minimal well-formed event stream
  http.post('/api/chats/:chatId/branches/:branchId/messages', () => {
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode('data: {"token": "Hello"}\n\n'));
        controller.enqueue(encoder.encode('data: {"token": " world"}\n\n'));
        controller.enqueue(encoder.encode('data: [DONE]\n\n'));
        controller.close();
      },
    });
    return new HttpResponse(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'X-Node-Id': 'node-new',
      },
    });
  }),
];
