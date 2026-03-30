/**
 * Unit tests for the Zustand appStore.
 * Tests state transitions and the setTheme DOM-mutation side effect.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { useAppStore } from '../store/appStore';

// Reset store state between tests
beforeEach(() => {
  useAppStore.setState({
    currentView: 'chat',
    sidebarTab: 'chats',
    theme: 'dark',
    activeChatId: null,
    activeBranchId: null,
    activeNodeId: null,
    history: [],
    chats: [],
    branches: [],
    availableModels: [],
    selectedModel: null,
    isStreaming: false,
    streamingNodeId: null,
    streamBuffer: '',
    copySourceNodeId: null,
  });
  // Clear html class list
  document.documentElement.className = '';
});

describe('appStore — view navigation', () => {
  it('starts on chat view', () => {
    expect(useAppStore.getState().currentView).toBe('chat');
  });

  it('setCurrentView transitions to settings', () => {
    useAppStore.getState().setCurrentView('settings');
    expect(useAppStore.getState().currentView).toBe('settings');
  });

  it('setSidebarTab switches between chats and graph', () => {
    useAppStore.getState().setSidebarTab('graph');
    expect(useAppStore.getState().sidebarTab).toBe('graph');
    useAppStore.getState().setSidebarTab('chats');
    expect(useAppStore.getState().sidebarTab).toBe('chats');
  });
});

describe('appStore — theme', () => {
  it('default theme is dark', () => {
    expect(useAppStore.getState().theme).toBe('dark');
  });

  it('setTheme("light") updates store and adds .light to <html>', () => {
    useAppStore.getState().setTheme('light');
    expect(useAppStore.getState().theme).toBe('light');
    expect(document.documentElement.classList.contains('light')).toBe(true);
    expect(document.documentElement.classList.contains('dark')).toBe(false);
  });

  it('setTheme("dark") removes .light and adds .dark', () => {
    document.documentElement.classList.add('light');
    useAppStore.getState().setTheme('dark');
    expect(useAppStore.getState().theme).toBe('dark');
    expect(document.documentElement.classList.contains('dark')).toBe(true);
    expect(document.documentElement.classList.contains('light')).toBe(false);
  });
});

describe('appStore — chat context', () => {
  it('setActiveChat resets branch and node', () => {
    useAppStore.setState({ activeBranchId: 'b1', activeNodeId: 'n1' });
    useAppStore.getState().setActiveChat('chat-1');
    const state = useAppStore.getState();
    expect(state.activeChatId).toBe('chat-1');
    expect(state.activeBranchId).toBeNull();
    expect(state.activeNodeId).toBeNull();
  });

  it('setActiveChat(null) clears everything', () => {
    useAppStore.getState().setActiveChat(null);
    expect(useAppStore.getState().activeChatId).toBeNull();
  });

  it('upsertChat adds a new chat', () => {
    const chat = { id: 'c1', user_id: 'u1', title: 'Test', created_at: '' };
    useAppStore.getState().upsertChat(chat);
    expect(useAppStore.getState().chats).toHaveLength(1);
    expect(useAppStore.getState().chats[0].title).toBe('Test');
  });

  it('upsertChat updates an existing chat', () => {
    const chat = { id: 'c1', user_id: 'u1', title: 'Old', created_at: '' };
    useAppStore.getState().upsertChat(chat);
    useAppStore.getState().upsertChat({ ...chat, title: 'New' });
    const chats = useAppStore.getState().chats;
    expect(chats).toHaveLength(1);
    expect(chats[0].title).toBe('New');
  });
});

describe('appStore — streaming', () => {
  it('startStream sets isStreaming and stores nodeId', () => {
    useAppStore.getState().startStream('node-abc', 'test prompt');
    const state = useAppStore.getState();
    expect(state.isStreaming).toBe(true);
    expect(state.streamingNodeId).toBe('node-abc');
    expect(state.streamBuffer).toBe('');
  });

  it('appendStreamToken accumulates tokens', () => {
    useAppStore.getState().startStream('n1', 'test prompt');
    useAppStore.getState().appendStreamToken('Hello');
    useAppStore.getState().appendStreamToken(', world');
    expect(useAppStore.getState().streamBuffer).toBe('Hello, world');
  });

  it('finalizeStream clears buffer and sets isStreaming false', () => {
    useAppStore.setState({
      isStreaming: true,
      streamingNodeId: 'n1',
      streamBuffer: 'partial',
      history: [{ id: 'n1', chat_id: 'c1', parent_id: null, merge_parent_id: null,
        user_prompt: 'q', ai_response: null, model_used: 'gpt-4', created_at: '',
        is_summary: false }],
    });
    useAppStore.getState().finalizeStream('n1', 'full response');
    const state = useAppStore.getState();
    expect(state.isStreaming).toBe(false);
    expect(state.streamBuffer).toBe('');
    expect(state.history[0].ai_response).toBe('full response');
  });

  it('clearStream resets all streaming state', () => {
    useAppStore.getState().startStream('n1', 'test prompt');
    useAppStore.getState().clearStream();
    const state = useAppStore.getState();
    expect(state.isStreaming).toBe(false);
    expect(state.streamingNodeId).toBeNull();
    expect(state.streamBuffer).toBe('');
  });
});

describe('appStore — node management', () => {
  const makeNode = (id: string, extra: Partial<Parameters<typeof useAppStore.getState>['0']['history'][0]> = {}) => ({
    id,
    chat_id: 'c1',
    parent_id: null,
    merge_parent_id: null,
    user_prompt: 'q',
    ai_response: 'a',
    model_used: 'gpt-4o',
    created_at: '',
    is_summary: false,
    ...extra,
  });

  it('removeNode filters the node from history', () => {
    useAppStore.setState({
      history: [makeNode('n1'), makeNode('n2')],
    });
    useAppStore.getState().removeNode('n1');
    const { history } = useAppStore.getState();
    expect(history.map((n) => n.id)).toEqual(['n2']);
  });

  it('removeNode clears activeNodeId if it matches', () => {
    useAppStore.setState({ history: [makeNode('n1')], activeNodeId: 'n1' });
    useAppStore.getState().removeNode('n1');
    expect(useAppStore.getState().activeNodeId).toBeNull();
  });

  it('removeNode preserves activeNodeId when a different node is removed', () => {
    useAppStore.setState({ history: [makeNode('n1'), makeNode('n2')], activeNodeId: 'n2' });
    useAppStore.getState().removeNode('n1');
    expect(useAppStore.getState().activeNodeId).toBe('n2');
  });

  it('setCopySource stores the nodeId', () => {
    useAppStore.getState().setCopySource('node-xyz');
    expect(useAppStore.getState().copySourceNodeId).toBe('node-xyz');
  });

  it('setCopySource(null) clears the copy source', () => {
    useAppStore.setState({ copySourceNodeId: 'node-xyz' });
    useAppStore.getState().setCopySource(null);
    expect(useAppStore.getState().copySourceNodeId).toBeNull();
  });
});
