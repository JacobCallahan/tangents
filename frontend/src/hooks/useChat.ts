/**
 * useChat — loads and manages the active chat context.
 * Handles lazy chat creation, branch history loading, and navigation.
 */

import { useCallback, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { branchesApi } from '../api/branches';
import { chatsApi } from '../api/chats';
import { useAppStore } from '../store/appStore';

export function useChat() {
  const {
    activeChatId,
    activeBranchId,
    activeNodeId,
    setHistory,
    setChats,
    setBranches,
    upsertChat,
  } = useAppStore();
  const queryClient = useQueryClient();

  // Load all chats for sidebar
  const { data: chats } = useQuery({
    queryKey: ['chats'],
    queryFn: chatsApi.list,
  });

  useEffect(() => {
    if (chats) setChats(chats);
  }, [chats, setChats]);

  // Load branches for active chat
  const { data: branches } = useQuery({
    queryKey: ['branches', activeChatId],
    queryFn: () => branchesApi.list(activeChatId!),
    enabled: !!activeChatId,
  });

  // Auto-select first branch when a chat is opened and no branch is active yet
  useEffect(() => {
    if (branches && branches.length > 0 && !activeBranchId) {
      useAppStore.getState().setActiveBranch(branches[0].id);
    }
  }, [branches, activeBranchId]);

  useEffect(() => {
    if (branches) setBranches(branches);
  }, [branches, setBranches]);

  // Load linear history for active branch/node
  const { data: history } = useQuery({
    queryKey: ['history', activeChatId, activeBranchId, activeNodeId],
    queryFn: () =>
      branchesApi.getHistory(activeChatId!, activeBranchId!, activeNodeId ?? undefined),
    enabled: !!activeChatId && !!activeBranchId,
  });

  useEffect(() => {
    if (history) setHistory(history);
  }, [history, setHistory]);

  // Rename chat
  const renameChatMutation = useMutation({
    mutationFn: ({ chatId, title }: { chatId: string; title: string }) =>
      chatsApi.update(chatId, { title }),
    onSuccess: (updatedChat) => {
      upsertChat(updatedChat);
      queryClient.invalidateQueries({ queryKey: ['chats'] });
    },
  });

  // Delete chat
  const deleteChatMutation = useMutation({
    mutationFn: (chatId: string) => chatsApi.delete(chatId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['chats'] });
    },
  });

  const renameChat = useCallback(
    (chatId: string, title: string) => renameChatMutation.mutate({ chatId, title }),
    [renameChatMutation]
  );

  const deleteChat = useCallback(
    (chatId: string) => deleteChatMutation.mutate(chatId),
    [deleteChatMutation]
  );

  return { renameChat, deleteChat };
}
