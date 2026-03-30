/**
 * Test utilities — wraps components in the providers they need
 * (React Query QueryClientProvider) and exposes a Zustand store reset helper.
 */

import { type ReactNode } from 'react';
import { render, type RenderOptions } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useAppStore } from '../store/appStore';

/** Create a fresh QueryClient configured for tests (no retries, no stale time). */
export function createTestQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, staleTime: 0, gcTime: 0 },
      mutations: { retry: false },
    },
  });
}

/** Default initial store state — call useAppStore.setState(defaultState()) to reset. */
export function defaultStoreState() {
  return {
    currentView: 'chat' as const,
    sidebarTab: 'chats' as const,
    theme: 'dark' as const,
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
  };
}

/** Render a component wrapped in a React Query provider with a fresh client. */
export function renderWithProviders(
  ui: ReactNode,
  {
    queryClient = createTestQueryClient(),
    ...options
  }: RenderOptions & { queryClient?: QueryClient } = {},
) {
  function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  }
  return { queryClient, ...render(ui, { wrapper: Wrapper, ...options }) };
}

/** Reset the Zustand store to defaults before each test. */
export function resetStore(overrides: Partial<ReturnType<typeof defaultStoreState>> = {}) {
  useAppStore.setState({ ...defaultStoreState(), ...overrides });
}
