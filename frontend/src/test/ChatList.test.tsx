/**
 * Component tests for ChatList.
 * Verifies empty state rendering and chat item rendering.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { screen, fireEvent } from '@testing-library/react';
import { ChatList } from '../components/chat/ChatList';
import { useAppStore } from '../store/appStore';
import { renderWithProviders } from './utils';
import type { Chat } from '../types';

const MOCK_CHATS: Chat[] = [
  { id: 'c1', user_id: 'u1', title: 'First Chat', created_at: '2024-01-01T00:00:00' },
  { id: 'c2', user_id: 'u1', title: null, created_at: '2024-01-02T00:00:00' },
];

beforeEach(() => {
  useAppStore.setState({
    chats: [],
    activeChatId: null,
    currentView: 'chat',
  });
});

describe('ChatList', () => {
  it('renders empty state when there are no chats', () => {
    renderWithProviders(<ChatList />);
    expect(screen.getByText(/no chats yet/i)).toBeInTheDocument();
  });

  it('renders a list item for each chat', () => {
    useAppStore.setState({ chats: MOCK_CHATS });
    renderWithProviders(<ChatList />);
    expect(screen.getByText('First Chat')).toBeInTheDocument();
    expect(screen.getByText('Untitled chat')).toBeInTheDocument();
  });

  it('clicking a chat item sets it as active', () => {
    useAppStore.setState({ chats: MOCK_CHATS });
    renderWithProviders(<ChatList />);
    fireEvent.click(screen.getByText('First Chat'));
    expect(useAppStore.getState().activeChatId).toBe('c1');
  });

  it('active chat has distinct styling', () => {
    useAppStore.setState({ chats: MOCK_CHATS, activeChatId: 'c1' });
    renderWithProviders(<ChatList />);
    // The primary classes are on the wrapping <div>, not the inner <button>
    const wrapper = screen.getByText('First Chat').closest('div[class*="primary"]');
    expect(wrapper).not.toBeNull();
  });
});
