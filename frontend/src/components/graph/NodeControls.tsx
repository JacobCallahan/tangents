/**
 * NodeControls — contextual action buttons shown above the node graph.
 *
 * Replaces the "New Chat" button when the Graph tab is active.  Available
 * actions depend on what is currently selected:
 *
 *   • Delete   — removes the selected node and all descendants
 *   • Summarize — generates a summary (coral) node as a child of the selection
 *   • Copy      — two-step: mark a source node then paste it onto a branch
 *   • Merge     — merge two branches via a summary node (pick source branch)
 */

import { useState, useEffect, useRef } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Copy, GitMerge, Scissors, Sparkles, X } from 'lucide-react';
import { chatsApi } from '../../api/chats';
import { branchesApi } from '../../api/branches';
import { useAppStore } from '../../store/appStore';

interface NodeControlsProps {
  chatId: string;
}

export function NodeControls({ chatId }: NodeControlsProps) {
  const {
    activeBranchId,
    activeNodeId,
    branches,
    selectedModel,
    copySourceNodeId,
    setCopySource,
    removeNode,
    setBranches,
  } = useAppStore();

  const queryClient = useQueryClient();

  // Local state
  const [mergeMode, setMergeMode] = useState(false);
  const [mergeBranchId, setMergeBranchId] = useState<string>('');
  /** Countdown seconds until auto-retry; null when no retry is pending */
  const [retryCountdown, setRetryCountdown] = useState<number | null>(null);
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Track which branch was active when Copy was initiated
  const [copySourceBranchId, setCopySourceBranchId] = useState<string | null>(null);

  const activeBranch = branches.find((b) => b.id === activeBranchId) ?? null;
  const otherBranches = branches.filter((b) => b.id !== activeBranchId);

  // ── Delete ────────────────────────────────────────────────────────────────

  const deleteMutation = useMutation({
    mutationFn: () => chatsApi.deleteNode(chatId, activeNodeId!),
    onSuccess: () => {
      removeNode(activeNodeId!);
      queryClient.invalidateQueries({ queryKey: ['graph', chatId] });
      queryClient.invalidateQueries({ queryKey: ['branches', chatId] });
    },
  });

  // ── Summarize ─────────────────────────────────────────────────────────────

  const summarizeMutation = useMutation({
    mutationFn: () =>
      chatsApi.summarizeNode(chatId, activeNodeId!, {
        model: selectedModel?.model_id ?? 'gpt-4o',
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['graph', chatId] });
    },
  });

  // ── Retry logic for summarize errors ──────────────────────────────────────

  // Start countdown when summarize first errors out
  useEffect(() => {
    if (summarizeMutation.isError && retryCountdown === null) {
      setRetryCountdown(10);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [summarizeMutation.isError]);

  // Tick down; at 0 auto-retry
  useEffect(() => {
    if (retryCountdown === null) return;
    if (retryCountdown <= 0) {
      setRetryCountdown(null);
      summarizeMutation.mutate();
      return;
    }
    const id = setTimeout(() => setRetryCountdown((c) => (c !== null ? c - 1 : null)), 1000);
    retryTimerRef.current = id;
    return () => clearTimeout(id);
  }, [retryCountdown]); // eslint-disable-line react-hooks/exhaustive-deps

  // Cleanup on unmount
  useEffect(() => () => {
    if (retryTimerRef.current) clearTimeout(retryTimerRef.current);
  }, []);

  // ── Copy / paste ──────────────────────────────────────────────────────────

  const handleCopyClick = () => {
    if (copySourceNodeId) {
      // Already in copy mode — cancel
      setCopySource(null);
      setCopySourceBranchId(null);
    } else {
      setCopySource(activeNodeId!);
      setCopySourceBranchId(activeBranchId);
    }
  };

  const copyMutation = useMutation({
    mutationFn: () =>
      branchesApi.copyNode(chatId, activeBranchId!, copySourceNodeId!),
    onSuccess: () => {
      setCopySource(null);
      setCopySourceBranchId(null);
      queryClient.invalidateQueries({ queryKey: ['graph', chatId] });
      queryClient.invalidateQueries({ queryKey: ['branches', chatId] });
    },
  });

  // ── Merge ─────────────────────────────────────────────────────────────────

  const mergeMutation = useMutation({
    mutationFn: () =>
      branchesApi.merge(chatId, {
        source_branch_id: activeBranchId!,
        target_branch_id: mergeBranchId,
        active_model: selectedModel?.model_id ?? 'gpt-4o',
      }),
    onSuccess: (data) => {
      setMergeMode(false);
      setMergeBranchId('');
      // Advance the target branch head in local state
      const targetBranchIdx = branches.findIndex((b) => b.id === mergeBranchId);
      if (targetBranchIdx >= 0) {
        const updatedBranches = [...branches];
        updatedBranches[targetBranchIdx] = {
          ...updatedBranches[targetBranchIdx],
          head_node_id: data.new_node_id,
        };
        setBranches(updatedBranches);
      }
      queryClient.invalidateQueries({ queryKey: ['graph', chatId] });
      queryClient.invalidateQueries({ queryKey: ['branches', chatId] });
    },
  });

  const isPending =
    deleteMutation.isPending ||
    summarizeMutation.isPending ||
    copyMutation.isPending ||
    mergeMutation.isPending;

  // ── Copy mode ─────────────────────────────────────────────────────────────
  // Show "Paste here" when:
  // - we have a copy source selected
  // - the active branch is different from where we copied from
  // - the active branch has a head node (somewhere to attach)
  const canPasteHere =
    copySourceNodeId !== null &&
    activeBranchId !== null &&
    activeBranchId !== copySourceBranchId &&
    activeBranch?.head_node_id !== null;

  // ── Render ────────────────────────────────────────────────────────────────

  // Copy mode bar
  if (copySourceNodeId) {
    return (
      <div className="mx-3 my-2 flex flex-col gap-1.5 rounded-md border border-secondary-700 bg-neutral-900 px-3 py-2">
        <p className="text-xs text-secondary-400">
          <Copy size={11} className="mr-1 inline" />
          Copy mode — navigate to a target branch then paste.
        </p>
        <div className="flex gap-1.5">
          {canPasteHere && (
            <button
              onClick={() => copyMutation.mutate()}
              disabled={isPending}
              className="flex-1 rounded bg-secondary-700 px-2 py-1 text-xs text-white transition-colors hover:bg-secondary-600 disabled:opacity-50"
            >
              {copyMutation.isPending
                ? 'Pasting…'
                : `Paste to ${activeBranch?.name ?? 'branch'}`}
            </button>
          )}
          <button
            onClick={() => {
              setCopySource(null);
              setCopySourceBranchId(null);
            }}
            className="flex items-center gap-1 rounded border border-neutral-700 px-2 py-1 text-xs text-neutral-400 transition-colors hover:border-neutral-500 hover:text-neutral-300"
          >
            <X size={11} />
            Cancel
          </button>
        </div>
        {copyMutation.isError && (
          <p className="text-xs text-red-400">
            Copy failed: {(copyMutation.error as Error).message}
          </p>
        )}
      </div>
    );
  }

  // Merge mode bar
  if (mergeMode) {
    return (
      <div className="mx-3 my-2 flex flex-col gap-1.5 rounded-md border border-primary-700 bg-neutral-900 px-3 py-2">
        <p className="text-xs text-primary-400">
          <GitMerge size={11} className="mr-1 inline" />
          Merge <strong>{activeBranch?.name}</strong> into:
        </p>
        <select
          value={mergeBranchId}
          onChange={(e) => setMergeBranchId(e.target.value)}
          className="rounded border border-neutral-700 bg-neutral-800 px-2 py-1 text-xs text-neutral-200 focus:outline-none"
        >
          <option value="">Select target branch…</option>
          {otherBranches.map((b) => (
            <option key={b.id} value={b.id}>
              {b.name}
            </option>
          ))}
        </select>
        <div className="flex gap-1.5">
          <button
            onClick={() => mergeMutation.mutate()}
            disabled={!mergeBranchId || isPending}
            className="flex-1 rounded bg-primary-700 px-2 py-1 text-xs text-white transition-colors hover:bg-primary-600 disabled:opacity-50"
          >
            {mergeMutation.isPending ? 'Merging…' : 'Confirm Merge'}
          </button>
          <button
            onClick={() => {
              setMergeMode(false);
              setMergeBranchId('');
            }}
            className="flex items-center gap-1 rounded border border-neutral-700 px-2 py-1 text-xs text-neutral-400 transition-colors hover:border-neutral-500 hover:text-neutral-300"
          >
            <X size={11} />
            Cancel
          </button>
        </div>
        {mergeMutation.isError && (
          <p className="text-xs text-red-400">
            Merge failed: {(mergeMutation.error as Error).message}
          </p>
        )}
      </div>
    );
  }

  // Default: no node selected
  if (!activeNodeId) {
    return (
      <div className="mx-3 my-2 px-1 py-1 text-center text-xs text-neutral-600">
        Select a node to manage it
      </div>
    );
  }

  // Default: node selected
  return (
    <div className="mx-3 my-2 flex flex-col gap-1.5">
      {/* Delete + Summarize */}
      <div className="flex gap-1.5">
        <button
          onClick={() => deleteMutation.mutate()}
          disabled={isPending}
          title="Delete this node and all its descendants"
          className="flex flex-1 items-center justify-center gap-1 rounded border border-red-800 px-2 py-1.5 text-xs text-red-400 transition-colors hover:border-red-600 hover:bg-red-900/30 hover:text-red-300 disabled:opacity-50"
        >
          <Scissors size={11} />
          {deleteMutation.isPending ? 'Deleting…' : 'Delete'}
        </button>
        <button
          onClick={() => summarizeMutation.mutate()}
          disabled={isPending}
          title="Generate a summary node as a child of this node"
          className="flex flex-1 items-center justify-center gap-1 rounded border border-secondary-800 px-2 py-1.5 text-xs text-secondary-400 transition-colors hover:border-secondary-600 hover:bg-secondary-900/30 hover:text-secondary-300 disabled:opacity-50"
        >
          <Sparkles size={11} />
          {summarizeMutation.isPending ? 'Summarizing…' : 'Summarize'}
        </button>
      </div>

      {/* Copy + Merge */}
      <div className="flex gap-1.5">
        <button
          onClick={handleCopyClick}
          disabled={isPending}
          title="Copy this node to paste onto another branch"
          className="flex flex-1 items-center justify-center gap-1 rounded border border-neutral-700 px-2 py-1.5 text-xs text-neutral-400 transition-colors hover:border-neutral-500 hover:text-neutral-300 disabled:opacity-50"
        >
          <Copy size={11} />
          Copy Node
        </button>
        <button
          onClick={() => {
            setMergeMode(true);
            setMergeBranchId(otherBranches[0]?.id ?? '');
          }}
          disabled={isPending || otherBranches.length === 0 || !activeBranchId}
          title={
            otherBranches.length === 0
              ? 'Need at least two branches to merge'
              : 'Merge this branch into another branch'
          }
          className="flex flex-1 items-center justify-center gap-1 rounded border border-neutral-700 px-2 py-1.5 text-xs text-neutral-400 transition-colors hover:border-primary-600 hover:text-primary-400 disabled:opacity-30 disabled:cursor-not-allowed"
        >
          <GitMerge size={11} />
          Merge
        </button>
      </div>

      {/* Inline error display */}
      {deleteMutation.isError && (
        <p className="text-xs text-red-400">
          Delete failed: {(deleteMutation.error as Error).message}
        </p>
      )}
      {summarizeMutation.isError && retryCountdown !== null && (
        <div className="fixed bottom-6 right-6 z-50 w-72 rounded-lg border border-orange-700 bg-neutral-900 p-4 shadow-xl">
          <p className="text-sm font-semibold text-orange-300">Summarize failed</p>
          <p className="mt-1 text-xs text-neutral-400 line-clamp-3">
            {(summarizeMutation.error as Error).message}
          </p>
          <p className="mt-2 text-xs text-neutral-300">
            Retrying in{' '}
            <span className="font-mono font-bold text-orange-300">{retryCountdown}s</span>…
          </p>
          <div className="mt-3 flex gap-2">
            <button
              onClick={() => {
                setRetryCountdown(null);
                summarizeMutation.mutate();
              }}
              className="flex-1 rounded bg-orange-700 px-3 py-1.5 text-xs text-white transition-colors hover:bg-orange-600"
            >
              Continue
            </button>
            <button
              onClick={() => {
                setRetryCountdown(null);
                summarizeMutation.reset();
              }}
              className="flex-1 rounded border border-neutral-700 px-3 py-1.5 text-xs text-neutral-400 transition-colors hover:border-neutral-500 hover:text-neutral-300"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
