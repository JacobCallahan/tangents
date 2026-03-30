/**
 * Global application state — active chat, branch, and node selection.
 * Navigation state is kept in React/Zustand, NOT reflected in the URL.
 */

import { create } from 'zustand';
import type { Branch, Chat, ModelSourceModel, Node } from '../types';

export type SidebarTab = 'chats' | 'graph';
export type AppView = 'chat' | 'settings';
export type AppTheme = 'dark' | 'light';

interface AppState {
  // Page / view
  currentView: AppView;
  sidebarTab: SidebarTab;

  // Active chat context
  activeChatId: string | null;
  activeBranchId: string | null;
  /** The node currently being viewed. When null, shows the branch HEAD. */
  activeNodeId: string | null;

  /** The linear history for the currently viewed branch/node */
  history: Node[];

  /** All chats visible in the sidebar */
  chats: Chat[];

  /** Branches for the active chat */
  branches: Branch[];

  /** All available models from configured sources */
  availableModels: ModelSourceModel[];

  /** Currently selected model in the picker */
  selectedModel: ModelSourceModel | null;

  // Streaming state
  isStreaming: boolean;
  streamingNodeId: string | null;
  /** The user prompt that triggered the current stream (shown optimistically) */
  streamingPrompt: string | null;
  streamBuffer: string;

  /** Currently active colour theme (applied to <html> via class) */
  theme: AppTheme;

  /** Hex colour used to highlight the selected graph node */
  highlightColor: string;

  /**
   * The node ID selected as the source for a Copy operation.  Non-null while
   * the user has clicked "Copy" and is choosing a target branch/node.
   */
  copySourceNodeId: string | null;

  // Actions
  setCurrentView: (view: AppView) => void;
  setSidebarTab: (tab: SidebarTab) => void;
  setTheme: (theme: AppTheme) => void;
  setHighlightColor: (color: string) => void;
  setActiveChat: (chatId: string | null) => void;
  setActiveBranch: (branchId: string | null) => void;
  setActiveNode: (nodeId: string | null) => void;
  setHistory: (nodes: Node[]) => void;
  setChats: (chats: Chat[]) => void;
  setBranches: (branches: Branch[]) => void;
  setAvailableModels: (models: ModelSourceModel[]) => void;
  setSelectedModel: (model: ModelSourceModel | null) => void;
  appendStreamToken: (token: string) => void;
  finalizeStream: (nodeId: string, fullResponse: string) => void;
  startStream: (nodeId: string, prompt: string) => void;
  clearStream: () => void;
  upsertChat: (chat: Chat) => void;
  upsertNode: (node: Node) => void;
  /** Remove a node and clear active context if it was the deleted node. */
  removeNode: (nodeId: string) => void;
  /** Set/clear the copy source node for a pending Copy operation. */
  setCopySource: (nodeId: string | null) => void;
}

export const useAppStore = create<AppState>((set) => ({
  currentView: 'chat',
  sidebarTab: 'chats',
  theme: 'dark',
  highlightColor: '#FF7F50',
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
  streamingPrompt: null,
  streamBuffer: '',
  copySourceNodeId: null,

  setCurrentView: (view) => set({ currentView: view }),
  setSidebarTab: (tab) => set({ sidebarTab: tab }),

  setTheme: (theme) => {
    document.documentElement.classList.remove('dark', 'light');
    document.documentElement.classList.add(theme);
    set({ theme });
  },
  setHighlightColor: (color) => set({ highlightColor: color }),
  setActiveChat: (chatId) =>
    set({ activeChatId: chatId, activeBranchId: null, activeNodeId: null, history: [] }),
  setActiveBranch: (branchId) => set({ activeBranchId: branchId, activeNodeId: null }),
  setActiveNode: (nodeId) => set({ activeNodeId: nodeId }),
  setHistory: (nodes) => set({ history: nodes }),
  setChats: (chats) => set({ chats }),
  setBranches: (branches) => set({ branches }),
  setAvailableModels: (models) => set({ availableModels: models }),
  setSelectedModel: (model) => set({ selectedModel: model }),

  startStream: (nodeId, prompt) =>
    set({ isStreaming: true, streamingNodeId: nodeId, streamingPrompt: prompt, streamBuffer: '' }),

  appendStreamToken: (token) =>
    set((state) => ({ streamBuffer: state.streamBuffer + token })),

  finalizeStream: (nodeId, fullResponse) =>
    set((state) => ({
      isStreaming: false,
      streamingNodeId: null,
      streamingPrompt: null,
      streamBuffer: '',
      history: state.history.map((n) =>
        n.id === nodeId ? { ...n, ai_response: fullResponse } : n
      ),
    })),

  clearStream: () =>
    set({ isStreaming: false, streamingNodeId: null, streamingPrompt: null, streamBuffer: '' }),

  upsertChat: (chat) =>
    set((state) => {
      const existing = state.chats.findIndex((c) => c.id === chat.id);
      if (existing >= 0) {
        const updated = [...state.chats];
        updated[existing] = chat;
        return { chats: updated };
      }
      return { chats: [...state.chats, chat] };
    }),

  upsertNode: (node) =>
    set((state) => {
      const existing = state.history.findIndex((n) => n.id === node.id);
      if (existing >= 0) {
        const updated = [...state.history];
        updated[existing] = node;
        return { history: updated };
      }
      return { history: [...state.history, node] };
    }),

  removeNode: (nodeId) =>
    set((state) => ({
      history: state.history.filter((n) => n.id !== nodeId),
      activeNodeId: state.activeNodeId === nodeId ? null : state.activeNodeId,
    })),

  setCopySource: (nodeId) => set({ copySourceNodeId: nodeId }),
}));
