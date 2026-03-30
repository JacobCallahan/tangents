/**
 * useStream — sends a message and consumes the SSE stream.
 *
 * Uses fetch() + ReadableStream (not EventSource) so that we can pass
 * Authorization headers and POST a body.
 */

import { useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { SendMessageRequest } from '../types';
import { useAppStore } from '../store/appStore';

export function useStream() {
  const {
    activeChatId,
    activeBranchId,
    activeNodeId,
    selectedModel,
    startStream,
    appendStreamToken,
    finalizeStream,
    clearStream,
  } = useAppStore();

  const queryClient = useQueryClient();

  const sendMessage = useCallback(
    async (userPrompt: string, overrides?: { chatId: string; branchId: string }) => {
      const chatId = overrides?.chatId ?? activeChatId;
      const branchId = overrides?.branchId ?? activeBranchId;
      if (!chatId || !branchId || !selectedModel) return;

      const credentials = localStorage.getItem('tangents_credentials');
      if (!credentials) {
        console.error('No credentials in localStorage — cannot send message');
        return;
      }

      const body: SendMessageRequest = {
        user_prompt: userPrompt,
        model_used: selectedModel.model_id,
        parent_node_id: activeNodeId ?? undefined,
      };

      let nodeId: string | null = null;
      let fullResponse = '';

      try {
        const response = await fetch(
          `/api/chats/${chatId}/branches/${branchId}/messages`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Basic ${credentials!}`,  // credentials checked above
            },
            body: JSON.stringify(body),
          }
        );

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }

        nodeId = response.headers.get('X-Node-Id');
        if (nodeId) startStream(nodeId, userPrompt);

        const reader = response.body!.getReader();
        const decoder = new TextDecoder();

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          const lines = decoder.decode(value, { stream: true }).split('\n');
          for (const line of lines) {
            if (!line.startsWith('data: ')) continue;
            const data = line.slice(6).trim();
            if (data === '[DONE]') break;

            try {
              const parsed = JSON.parse(data);
              if (parsed.error) throw new Error(parsed.error);
              if (parsed.token) {
                const token = parsed.token.replace(/\\n/g, '\n');
                appendStreamToken(token);
                fullResponse += token;
              }
            } catch {
              // Non-JSON lines (e.g. the initial node_id event)
            }
          }
        }

        if (nodeId) {
          finalizeStream(nodeId, fullResponse);
          // Advance to branch head — clear any manually-selected node so the
          // UI follows the newly created assistant node automatically.
          useAppStore.getState().setActiveNode(null);
        }

        // Invalidate history to pick up the completed node from the server
        queryClient.invalidateQueries({
          queryKey: ['history', chatId, branchId],
        });
        queryClient.invalidateQueries({
          queryKey: ['branches', chatId],
        });
        // Refresh graph view
        queryClient.invalidateQueries({
          queryKey: ['graph', chatId],
        });
        // Background title generation — refresh chat list after a short delay
        setTimeout(() => {
          queryClient.invalidateQueries({ queryKey: ['chats'] });
        }, 3000);
      } catch (err) {
        clearStream();
        console.error('Stream error:', err);
        throw err;
      }
    },
    [
      activeChatId,
      activeBranchId,
      activeNodeId,
      selectedModel,
      startStream,
      appendStreamToken,
      finalizeStream,
      clearStream,
      queryClient,
    ]
  );

  return { sendMessage };
}
