/**
 * ChatView tests.
 * Covers the branch label display, reactive updates, inline rename,
 * and the compose-mode prompt.
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { screen, waitFor, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { server } from './mocks/server';
import { ChatView } from '../components/chat/ChatView';
import { renderWithProviders, resetStore } from './utils';
import { useAppStore } from '../store/appStore';
import {
  mockBranchMain,
  mockBranchTangent,
  MOCK_CHAT_ID,
  MOCK_BRANCH_ID,
  MOCK_TANGENT_ID,
  mockModel,
} from './mocks/handlers';

// useChat loads history — mock it so tests don't need a full history endpoint
vi.mock('../hooks/useChat', () => ({ useChat: () => {} }));
// useStream — avoid real fetch in unit tests
vi.mock('../hooks/useStream', () => ({
  useStream: () => ({ sendMessage: vi.fn() }),
}));

beforeEach(() => {
  resetStore();
  localStorage.setItem('tangents_credentials', btoa('admin:tangents'));
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('ChatView — compose mode', () => {
  it('shows the "Start a new conversation below" prompt when no chat is active', async () => {
    useAppStore.setState({ activeChatId: null, availableModels: [mockModel] });
    renderWithProviders(<ChatView />);
    await waitFor(() => {
      expect(screen.getByText(/start a new conversation below/i)).toBeInTheDocument();
    });
  });

  it('renders MessageInput in compose mode with zero available models', async () => {
    useAppStore.setState({ activeChatId: null, availableModels: [], selectedModel: null });
    renderWithProviders(<ChatView />);
    await waitFor(() => {
      expect(screen.getByRole('textbox')).toBeInTheDocument();
    });
  });
});

describe('ChatView — branch label', () => {
  it('displays the active branch name in the header', async () => {
    useAppStore.setState({
      activeChatId: MOCK_CHAT_ID,
      activeBranchId: MOCK_BRANCH_ID,
      branches: [mockBranchMain],
      availableModels: [mockModel],
    });
    renderWithProviders(<ChatView />);
    await waitFor(() => {
      expect(screen.getByText(mockBranchMain.name)).toBeInTheDocument();
    });
  });

  it('branch label text uses the store highlight colour', async () => {
    useAppStore.setState({
      activeChatId: MOCK_CHAT_ID,
      activeBranchId: MOCK_BRANCH_ID,
      branches: [mockBranchMain],
      availableModels: [mockModel],
      highlightColor: '#ff0000',
    });
    renderWithProviders(<ChatView />);
    await waitFor(() => {
      const label = screen.getByText(mockBranchMain.name);
      expect(label).toHaveStyle({ color: 'rgb(255, 0, 0)' });
    });
  });

  it('updates the branch label when activeBranch changes', async () => {
    useAppStore.setState({
      activeChatId: MOCK_CHAT_ID,
      activeBranchId: MOCK_BRANCH_ID,
      branches: [mockBranchMain, mockBranchTangent],
      availableModels: [mockModel],
    });
    const { rerender } = renderWithProviders(<ChatView />);
    await waitFor(() => expect(screen.getByText(mockBranchMain.name)).toBeInTheDocument());

    // Switch active branch in the store
    useAppStore.setState({ activeBranchId: MOCK_TANGENT_ID });
    rerender(<ChatView />);

    await waitFor(() => {
      expect(screen.getByText(mockBranchTangent.name)).toBeInTheDocument();
    });
  });
});

describe('ChatView — inline branch rename', () => {
  beforeEach(() => {
    useAppStore.setState({
      activeChatId: MOCK_CHAT_ID,
      activeBranchId: MOCK_BRANCH_ID,
      branches: [mockBranchMain],
      availableModels: [mockModel],
    });
  });

  it('shows an input when the branch label is clicked', async () => {
    const user = userEvent.setup();
    renderWithProviders(<ChatView />);
    await waitFor(() => expect(screen.getByText(mockBranchMain.name)).toBeInTheDocument());

    // The branch name is wrapped in a <button title="Click to rename branch">
    const renameBtn = screen.getByRole('button', { name: new RegExp(mockBranchMain.name) });
    await user.click(renameBtn);
    // After click an <input> with the current name value should appear
    await waitFor(() => {
      expect(screen.getByDisplayValue(mockBranchMain.name)).toBeInTheDocument();
    });
  });

  it('commits rename on Enter and calls PATCH /branches/:id', async () => {
    const user = userEvent.setup();
    const patchSpy = vi.fn();
    server.use(
      http.patch('/api/chats/:chatId/branches/:branchId', async ({ request }) => {
        const body = await request.json();
        patchSpy(body);
        return HttpResponse.json({ ...mockBranchMain, ...(body as object) });
      }),
    );

    renderWithProviders(<ChatView />);
    await waitFor(() => expect(screen.getByText(mockBranchMain.name)).toBeInTheDocument());

    await user.click(screen.getByTitle('Click to rename tangent'));
    const input = screen.getByDisplayValue(mockBranchMain.name);
    await user.clear(input);
    await user.type(input, 'new-name');
    await user.keyboard('{Enter}');

    await waitFor(() => {
      expect(patchSpy).toHaveBeenCalledWith(expect.objectContaining({ name: 'new-name' }));
    });
  });

  it('cancels rename on Escape without calling the API', async () => {
    const user = userEvent.setup();
    const patchSpy = vi.fn();
    server.use(
      http.patch('/api/chats/:chatId/branches/:branchId', () => {
        patchSpy();
        return HttpResponse.json(mockBranchMain);
      }),
    );

    renderWithProviders(<ChatView />);
    await waitFor(() => expect(screen.getByText(mockBranchMain.name)).toBeInTheDocument());

    await user.click(screen.getByTitle('Click to rename tangent'));
    const input = screen.getByDisplayValue(mockBranchMain.name);
    await user.type(input, 'something-new');
    await user.keyboard('{Escape}');

    // Input should be gone; label should be back; no API call
    await waitFor(() => expect(screen.getByText(mockBranchMain.name)).toBeInTheDocument());
    expect(patchSpy).not.toHaveBeenCalled();
  });
});

describe('ChatView — no models banner', () => {
  it('shows the "no models" link when availableModels is empty and chat is active', async () => {
    useAppStore.setState({
      activeChatId: MOCK_CHAT_ID,
      activeBranchId: MOCK_BRANCH_ID,
      branches: [mockBranchMain],
      availableModels: [],
    });
    // Return empty sources so ChatView doesn't load any models
    server.use(http.get('/api/settings/sources', () => HttpResponse.json([])));
    renderWithProviders(<ChatView />);
    await waitFor(() => {
      expect(screen.getByText(/no ai models configured/i)).toBeInTheDocument();
    });
  });
});
