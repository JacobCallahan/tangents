/**
 * ChatView — the right pane.
 * Shows the linear message history for the active branch/node,
 * plus the input bar at the bottom.
 */

import { useEffect, useRef, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Pencil } from 'lucide-react';
import { settingsApi } from '../../api/settings';
import { branchesApi } from '../../api/branches';
import { useAppStore } from '../../store/appStore';
import { useChat } from '../../hooks/useChat';
import { MessageList } from './MessageList';
import { MessageInput } from './MessageInput';

export function ChatView() {
  const {
    activeChatId,
    activeBranchId,
    branches,
    availableModels,
    setAvailableModels,
    setSelectedModel,
    selectedModel,
    highlightColor,
    setHighlightColor,
    setTheme,
  } = useAppStore();

  const queryClient = useQueryClient();

  // ── Load available models ───────────────────────────────────────────────
  const { data: sources } = useQuery({
    queryKey: ['sources'],
    queryFn: settingsApi.listSources,
  });

  const { data: userSettings } = useQuery({
    queryKey: ['settings'],
    queryFn: settingsApi.getSettings,
  });

  // Sync persisted highlight colour from backend into the store
  useEffect(() => {
    if (userSettings?.highlight_color && userSettings.highlight_color !== highlightColor) {
      setHighlightColor(userSettings.highlight_color);
    }
  }, [userSettings?.highlight_color, highlightColor, setHighlightColor]);

  // Sync persisted theme
  useEffect(() => {
    if (userSettings?.theme) setTheme(userSettings.theme);
  }, [userSettings?.theme, setTheme]);

  useEffect(() => {
    if (!sources) return;

    const loadModels = async () => {
      const allModels = await Promise.all(
        sources.map((s) => settingsApi.listSourceModels(s.id))
      );
      const flat = allModels.flat();
      setAvailableModels(flat);
      if (!selectedModel && flat.length > 0) {
        const preferred = userSettings?.default_model_id
          ? flat.find((m) => m.id === userSettings.default_model_id)
          : undefined;
        setSelectedModel(preferred ?? flat[0]);
      }
    };

    loadModels().catch(console.error);
  }, [sources, userSettings?.default_model_id, setAvailableModels, setSelectedModel, selectedModel]);

  // Initialise hooks (loads history reactively)
  useChat();

  // ── Branch label editing ─────────────────────────────────────────────────
  const activeBranch = branches.find((b) => b.id === activeBranchId) ?? null;
  const [editingBranchName, setEditingBranchName] = useState(false);
  const [branchNameDraft, setBranchNameDraft] = useState('');
  const branchInputRef = useRef<HTMLInputElement>(null);

  const renameBranchMutation = useMutation({
    mutationFn: ({ name }: { name: string }) =>
      branchesApi.update(activeChatId!, activeBranchId!, { name }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['branches', activeChatId] });
    },
  });

  const startEditingBranch = () => {
    if (!activeBranch) return;
    setBranchNameDraft(activeBranch.name);
    setEditingBranchName(true);
    setTimeout(() => branchInputRef.current?.select(), 0);
  };

  const commitBranchRename = () => {
    const trimmed = branchNameDraft.trim();
    if (trimmed && trimmed !== activeBranch?.name) {
      renameBranchMutation.mutate({ name: trimmed });
    }
    setEditingBranchName(false);
  };

  const noModels = availableModels.length === 0;

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      {/* Empty / new-chat compose state — no active chat selected */}
      {!activeChatId && (
        <div className="flex flex-1 flex-col">
          <div className="flex flex-1 items-center justify-center">
            <p className="text-sm text-neutral-600">Start a new conversation below</p>
          </div>
          <MessageInput />
        </div>
      )}

      {activeChatId && (
        <>
          {/* Branch label — editable */}
          {activeBranch && (
            <div className="flex items-center gap-1.5 border-b border-neutral-800 px-4 py-2">
              {editingBranchName ? (
                <input
                  ref={branchInputRef}
                  autoFocus
                  value={branchNameDraft}
                  onChange={(e) => setBranchNameDraft(e.target.value)}
                  onBlur={commitBranchRename}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') commitBranchRename();
                    if (e.key === 'Escape') setEditingBranchName(false);
                  }}
                  className="min-w-0 flex-1 rounded bg-neutral-800 px-2 py-0.5 text-xs text-neutral-200 outline-none"
                  style={{ boxShadow: `0 0 0 1px ${highlightColor}` }}
                />
              ) : (
                <button
                  onClick={startEditingBranch}
                  className="group flex items-center gap-1 rounded px-1 py-0.5 text-xs text-neutral-400 hover:text-neutral-200"
                  title="Click to rename tangent"
                >
                  <span
                    className="font-medium"
                    style={{ color: highlightColor }}
                  >
                    {activeBranch.name}
                  </span>
                  <Pencil size={10} className="opacity-0 group-hover:opacity-60" />
                </button>
              )}
            </div>
          )}

          {/* Messages */}
          <MessageList />

          {/* Input bar */}
          {noModels ? (
            <div className="border-t border-neutral-800 px-4 py-4 text-center text-sm text-neutral-500">
              No AI models configured —{' '}
              <button
                className="text-primary-400 underline"
                onClick={() => useAppStore.getState().setCurrentView('settings')}
              >
                go to Settings
              </button>{' '}
              to add a provider.
            </div>
          ) : (
            <MessageInput />
          )}
        </>
      )}
    </div>
  );
}

