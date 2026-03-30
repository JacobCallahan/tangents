/**
 * MessageInput — the text field + model picker + Send/Branch button.
 *
 * - When viewing the branch HEAD: shows "Send"
 * - When viewing a non-HEAD node: shows "Branch" (will create a new branch)
 * - Enter sends; Shift+Enter inserts a newline
 * - Shows a context token usage bar; offers manual compression when high
 */

import { useRef, useState, useCallback, type KeyboardEvent } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Cpu } from 'lucide-react';
import { branchesApi } from '../../api/branches';
import { chatsApi } from '../../api/chats';
import { useAppStore } from '../../store/appStore';
import { useStream } from '../../hooks/useStream';
import { ModelPicker } from './ModelPicker';

export function MessageInput() {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);
  /** Estimated context token count from most recent stream response header */
  const [contextTokens, setContextTokens] = useState<number | null>(null);

  const {
    activeChatId,
    activeBranchId,
    activeNodeId,
    branches,
    isStreaming,
    selectedModel,
  } = useAppStore();
  const { sendMessage } = useStream();
  const queryClient = useQueryClient();

  // Determine if the viewed node is the branch HEAD
  const activeBranch = branches.find((b) => b.id === activeBranchId);
  const isAtHead = !activeNodeId || activeBranch?.head_node_id === activeNodeId;
  const buttonLabel = isAtHead ? 'Send' : 'Tangent';

  const contextWindow = selectedModel?.context_window_tokens ?? 8192;
  const tokenUsagePct = contextTokens !== null ? Math.min(1, contextTokens / contextWindow) : null;
  const tokenHigh = tokenUsagePct !== null && tokenUsagePct > 0.75;

  // Compression mutation
  const compressMutation = useMutation({
    mutationFn: async () => {
      if (!activeChatId || !activeBranchId || !selectedModel) return;
      return branchesApi.compress(activeChatId, activeBranchId, {
        model: selectedModel.model_id,
        context_window_tokens: selectedModel.context_window_tokens,
      });
    },
    onSuccess: (result) => {
      if (result?.compressed) {
        queryClient.invalidateQueries({ queryKey: ['history', activeChatId, activeBranchId] });
        setContextTokens(null);
      }
    },
  });

  // Create a new branch from the viewed node
  const branchMutation = useMutation({
    mutationFn: async (prompt: string) => {
      if (!activeChatId || !activeNodeId || !selectedModel) return;
      const newBranch = await branchesApi.create(activeChatId, {
        name: `tangent-${Date.now()}`,
        source_node_id: activeNodeId,
      });
      useAppStore.getState().setActiveBranch(newBranch.id);
      useAppStore.getState().setActiveNode(null);
      // Pass explicit chatId + branchId so the stale closure in sendMessage
      // sends to the NEW branch instead of the previous one.
      await sendMessage(prompt, { chatId: activeChatId, branchId: newBranch.id });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['branches', activeChatId] });
    },
  });

  const handleSubmit = useCallback(async () => {
    const prompt = value.trim();
    if (!prompt || isStreaming) return;
    setError(null);
    setValue('');
    textareaRef.current?.focus();

    try {
      // New-chat mode: no activeChatId yet — create chat + main branch first
      if (!activeChatId) {
        const newChat = await chatsApi.create({});
        const newBranch = await branchesApi.create(newChat.id, { name: 'main' });
        useAppStore.getState().setActiveChat(newChat.id);
        useAppStore.getState().setActiveBranch(newBranch.id);
        queryClient.invalidateQueries({ queryKey: ['chats'] });
        await sendMessage(prompt, { chatId: newChat.id, branchId: newBranch.id });
        return;
      }

      if (isAtHead) {
        await sendMessage(prompt);
      } else {
        await branchMutation.mutateAsync(prompt);
      }
    } catch (err) {
      setError('Something went wrong. Please try again.');
      setValue(prompt); // Restore prompt on failure
    }
  }, [value, isStreaming, isAtHead, activeChatId, sendMessage, branchMutation, queryClient]);

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  // Auto-grow textarea
  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setValue(e.target.value);
    e.target.style.height = 'auto';
    e.target.style.height = `${Math.min(e.target.scrollHeight, 200)}px`;
  };

  return (
    <div className="border-t border-neutral-800 px-4 py-3">
      {error && (
        <div className="mb-2 flex items-center justify-between rounded-md bg-red-950 px-3 py-2 text-xs text-red-400">
          {error}
          <button onClick={() => setError(null)} className="ml-2 text-red-500 hover:text-red-300">
            ✕
          </button>
        </div>
      )}

      {/* Context usage bar */}
      {tokenUsagePct !== null && (
        <div className="mx-auto mb-2 max-w-3xl">
          <div className="flex items-center justify-between text-xs text-neutral-600 mb-1">
            <span className="flex items-center gap-1">
              <Cpu size={11} />
              Context: {contextTokens?.toLocaleString()} / {contextWindow.toLocaleString()} tokens
            </span>
            {tokenHigh && (
              <button
                onClick={() => compressMutation.mutate()}
                disabled={compressMutation.isPending}
                className="text-amber-500 hover:text-amber-300 disabled:opacity-50"
              >
                {compressMutation.isPending ? 'Compressing…' : 'Compress context'}
              </button>
            )}
          </div>
          <div className="h-0.5 w-full rounded-full bg-neutral-800">
            <div
              className={`h-0.5 rounded-full transition-all ${
                tokenUsagePct > 0.9
                  ? 'bg-red-500'
                  : tokenUsagePct > 0.75
                    ? 'bg-amber-500'
                    : 'bg-primary-500'
              }`}
              style={{ width: `${tokenUsagePct * 100}%` }}
            />
          </div>
        </div>
      )}

      <div className="mx-auto flex max-w-3xl flex-col gap-2">
        <textarea
          ref={textareaRef}
          rows={1}
          value={value}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          placeholder={
            !selectedModel
              ? 'Configure a model in Settings to start chatting…'
              : isAtHead
                ? 'Message…'
                : 'Tangent from this point…'
          }
          disabled={isStreaming}
          className="w-full resize-none rounded-xl border border-neutral-700 bg-neutral-900 px-4 py-2.5 text-sm text-neutral-100 placeholder-neutral-600 focus:border-primary-500 focus:outline-none disabled:opacity-50"
          style={{ minHeight: '42px' }}
        />

        <div className="flex items-center justify-end gap-2">
          <ModelPicker />

          <button
            onClick={handleSubmit}
            disabled={!value.trim() || isStreaming || !selectedModel}
            className={`rounded-xl px-4 py-2.5 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
              buttonLabel === 'Tangent'
                ? 'bg-purple-700 text-white hover:bg-purple-600'
                : 'bg-primary-600 text-white hover:bg-primary-500'
            }`}
          >
            {isStreaming ? '…' : buttonLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
