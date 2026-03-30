/**
 * NodeControls tests.
 * Verifies contextual rendering based on selected node state and copy mode.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { server } from './mocks/server';
import { http, HttpResponse } from 'msw';
import { NodeControls } from '../components/graph/NodeControls';
import { useAppStore } from '../store/appStore';
import { renderWithProviders, resetStore } from './utils';
import { MOCK_CHAT_ID, MOCK_BRANCH_ID, MOCK_NODE_ID_B, mockBranchMain, mockBranchTangent } from './mocks/handlers';

beforeEach(() => {
  resetStore();
});

describe('NodeControls — no node selected', () => {
  it('shows placeholder when no node is active', () => {
    renderWithProviders(<NodeControls chatId={MOCK_CHAT_ID} />);
    expect(screen.getByText(/Select a node/i)).toBeInTheDocument();
  });
});

describe('NodeControls — node selected', () => {
  beforeEach(() => {
    useAppStore.setState({
      activeChatId: MOCK_CHAT_ID,
      activeBranchId: MOCK_BRANCH_ID,
      activeNodeId: MOCK_NODE_ID_B,
      branches: [mockBranchMain, mockBranchTangent],
    });
  });

  it('shows Delete, Summarize, Copy and Merge buttons', () => {
    renderWithProviders(<NodeControls chatId={MOCK_CHAT_ID} />);
    expect(screen.getByText('Delete')).toBeInTheDocument();
    expect(screen.getByText('Summarize')).toBeInTheDocument();
    expect(screen.getByText('Copy Node')).toBeInTheDocument();
    expect(screen.getByText('Merge')).toBeInTheDocument();
  });

  it('enters copy mode when Copy Node is clicked', () => {
    renderWithProviders(<NodeControls chatId={MOCK_CHAT_ID} />);
    fireEvent.click(screen.getByText('Copy Node'));
    expect(useAppStore.getState().copySourceNodeId).toBe(MOCK_NODE_ID_B);
    expect(screen.getByText(/Copy mode/i)).toBeInTheDocument();
  });

  it('exits copy mode when Cancel is clicked', () => {
    renderWithProviders(<NodeControls chatId={MOCK_CHAT_ID} />);
    fireEvent.click(screen.getByText('Copy Node'));
    fireEvent.click(screen.getByText('Cancel'));
    expect(useAppStore.getState().copySourceNodeId).toBeNull();
  });

  it('disables Merge when only one branch exists', () => {
    useAppStore.setState({ branches: [mockBranchMain] });
    renderWithProviders(<NodeControls chatId={MOCK_CHAT_ID} />);
    expect(screen.getByText('Merge')).toBeDisabled();
  });
});

describe('NodeControls — merge mode', () => {
  beforeEach(() => {
    useAppStore.setState({
      activeChatId: MOCK_CHAT_ID,
      activeBranchId: MOCK_BRANCH_ID,
      activeNodeId: MOCK_NODE_ID_B,
      branches: [mockBranchMain, mockBranchTangent],
    });
  });

  it('shows merge UI when Merge button is clicked', () => {
    renderWithProviders(<NodeControls chatId={MOCK_CHAT_ID} />);
    fireEvent.click(screen.getByText('Merge'));
    expect(screen.getByText('Confirm Merge')).toBeInTheDocument();
  });

  it('cancels merge mode on Cancel', () => {
    renderWithProviders(<NodeControls chatId={MOCK_CHAT_ID} />);
    fireEvent.click(screen.getByText('Merge'));
    fireEvent.click(screen.getByText('Cancel'));
    // Should be back to default controls
    expect(screen.getByText('Delete')).toBeInTheDocument();
  });
});

describe('NodeControls — delete action', () => {
  it('calls delete API and removes node from store', async () => {
    useAppStore.setState({
      activeChatId: MOCK_CHAT_ID,
      activeBranchId: MOCK_BRANCH_ID,
      activeNodeId: MOCK_NODE_ID_B,
      branches: [mockBranchMain, mockBranchTangent],
      history: [
        {
          id: MOCK_NODE_ID_B,
          chat_id: MOCK_CHAT_ID,
          parent_id: null,
          merge_parent_id: null,
          user_prompt: 'q',
          ai_response: 'a',
          model_used: 'gpt-4o',
          created_at: '',
          is_summary: false,
        },
      ],
    });

    renderWithProviders(<NodeControls chatId={MOCK_CHAT_ID} />);
    fireEvent.click(screen.getByText('Delete'));

    await waitFor(() => {
      // Node should be removed from history after delete
      expect(useAppStore.getState().history.find((n) => n.id === MOCK_NODE_ID_B)).toBeUndefined();
    });
  });
});
