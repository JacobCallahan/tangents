/**
 * MessageInput tests.
 * Covers compose mode, send-button state, placeholder text, and the
 * create-chat-then-stream flow.
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { server } from './mocks/server';
import { MessageInput } from '../components/chat/MessageInput';
import { renderWithProviders, resetStore } from './utils';
import { useAppStore } from '../store/appStore';
import {
  mockModel as handlerMockModel,
  mockBranchMain as handlerBranchMain,
  MOCK_CHAT_ID as HANDLER_CHAT_ID,
  MOCK_BRANCH_ID as HANDLER_BRANCH_ID,
} from './mocks/handlers';

// ModelPicker uses a query — wire up basic state so it renders without errors
vi.mock('../hooks/useStream', () => ({
  useStream: () => ({
    sendMessage: vi.fn().mockResolvedValue(undefined),
  }),
}));

beforeEach(() => {
  resetStore();
  localStorage.setItem('tangents_credentials', btoa('admin:tangents'));
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('MessageInput — compose mode (no active chat)', () => {
  it('renders the textarea with no active chat', () => {
    useAppStore.setState({ activeChatId: null, availableModels: [handlerMockModel] });
    renderWithProviders(<MessageInput />);
    expect(screen.getByRole('textbox')).toBeInTheDocument();
  });

  it('renders with zero available models and no model configured', () => {
    useAppStore.setState({ activeChatId: null, availableModels: [], selectedModel: null });
    renderWithProviders(<MessageInput />);
    expect(screen.getByRole('textbox')).toBeInTheDocument();
  });
});

describe('MessageInput — send button state', () => {
  it('send button is disabled when selectedModel is null', () => {
    useAppStore.setState({
      activeChatId: HANDLER_CHAT_ID,
      activeBranchId: HANDLER_BRANCH_ID,
      selectedModel: null,
      branches: [handlerBranchMain],
    });
    renderWithProviders(<MessageInput />);
    expect(screen.getByRole('button', { name: /send/i })).toBeDisabled();
  });

  it('send button is disabled when input is empty even with model set', () => {
    useAppStore.setState({
      activeChatId: HANDLER_CHAT_ID,
      activeBranchId: HANDLER_BRANCH_ID,
      selectedModel: handlerMockModel,
      branches: [handlerBranchMain],
    });
    renderWithProviders(<MessageInput />);
    expect(screen.getByRole('button', { name: /send/i })).toBeDisabled();
  });

  it('send button enables when model is set and input is non-empty', async () => {
    const user = userEvent.setup();
    useAppStore.setState({
      activeChatId: HANDLER_CHAT_ID,
      activeBranchId: HANDLER_BRANCH_ID,
      selectedModel: handlerMockModel,
      branches: [handlerBranchMain],
    });
    renderWithProviders(<MessageInput />);
    await user.type(screen.getByRole('textbox'), 'Hello');
    expect(screen.getByRole('button', { name: /send/i })).not.toBeDisabled();
  });

  it('shows placeholder when no model configured', () => {
    useAppStore.setState({
      activeChatId: HANDLER_CHAT_ID,
      activeBranchId: HANDLER_BRANCH_ID,
      selectedModel: null,
    });
    renderWithProviders(<MessageInput />);
    expect(screen.getByPlaceholderText('Configure a model in Settings to start chatting…')).toBeInTheDocument();
  });

  it('shows Branch button when viewing a non-HEAD node', () => {
    useAppStore.setState({
      activeChatId: HANDLER_CHAT_ID,
      activeBranchId: HANDLER_BRANCH_ID,
      activeNodeId: 'node-old',            // not the head
      selectedModel: handlerMockModel,
      branches: [{ ...handlerBranchMain, head_node_id: 'node-latest' }],
    });
    renderWithProviders(<MessageInput />);
    expect(screen.getByRole('button', { name: /tangent/i })).toBeInTheDocument();
  });

  it('shows Send button when viewing the HEAD node', () => {
    useAppStore.setState({
      activeChatId: HANDLER_CHAT_ID,
      activeBranchId: HANDLER_BRANCH_ID,
      activeNodeId: handlerBranchMain.head_node_id,
      selectedModel: handlerMockModel,
      branches: [handlerBranchMain],
    });
    renderWithProviders(<MessageInput />);
    expect(screen.getByRole('button', { name: /send/i })).toBeInTheDocument();
  });
});

describe('MessageInput — compose mode creates chat + branch then streams', () => {
  it('calls POST /api/chats then POST .../branches before streaming', async () => {
    const user = userEvent.setup();
    const chatCreated = vi.fn();
    const branchCreated = vi.fn();

    server.use(
      http.post('/api/chats', () => {
        chatCreated();
        return HttpResponse.json(
          { id: 'new-chat', user_id: 'u1', title: null, created_at: '' },
          { status: 201 },
        );
      }),
      http.post('/api/chats/:chatId/branches', ({ params }) => {
        branchCreated(params.chatId);
        return HttpResponse.json(
          { id: 'new-branch', chat_id: params.chatId as string, name: 'main', head_node_id: null },
          { status: 201 },
        );
      }),
    );

    useAppStore.setState({
      activeChatId: null,
      selectedModel: handlerMockModel,
      availableModels: [handlerMockModel],
    });

    renderWithProviders(<MessageInput />);
    await user.type(screen.getByRole('textbox'), 'Hello from compose');
    await user.click(screen.getByRole('button', { name: /send/i }));

    await waitFor(() => {
      expect(chatCreated).toHaveBeenCalledOnce();
      expect(branchCreated).toHaveBeenCalledWith('new-chat');
    });
  });
});
