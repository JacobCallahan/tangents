/**
 * ShareView — public read-only view for a shared chat branch.
 *
 * Accessible at /share/{token} — no authentication required.
 * Shows the linear message history up to the shared node.
 */

import { useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { shareApi } from '../../api/share';
import type { Node } from '../../types';

const shareQueryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 60_000, retry: 1 } },
});

// ── Message bubble ────────────────────────────────────────────────────────

function MessageBubble({ node }: { node: Node }) {
  return (
    <div className="space-y-3">
      {/* User prompt */}
      <div className="flex justify-end">
        <div className="max-w-[75%] rounded-2xl rounded-tr-sm bg-primary-700 px-4 py-3 text-sm text-white">
          {node.user_prompt}
        </div>
      </div>

      {/* AI response */}
      {node.ai_response && (
        <div className="flex justify-start">
          <div className="max-w-[75%] rounded-2xl rounded-tl-sm bg-neutral-800 px-4 py-3 text-sm text-neutral-100 whitespace-pre-wrap">
            {node.ai_response}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Inner share page ──────────────────────────────────────────────────────

function SharePage({ token }: { token: string }) {
  const { data: history, isLoading, isError } = useQuery({
    queryKey: ['share', token],
    queryFn: () => shareApi.view(token),
  });

  useEffect(() => {
    // Ensure dark theme on the share page
    document.documentElement.classList.add('dark');
  }, []);

  if (isLoading) {
    return (
      <div className="flex h-screen items-center justify-center bg-neutral-950 text-sm text-neutral-500">
        Loading shared conversation…
      </div>
    );
  }

  if (isError || !history) {
    return (
      <div className="flex h-screen items-center justify-center bg-neutral-950 text-sm text-neutral-500">
        This share link has expired or does not exist.
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-neutral-950 text-neutral-100">
      {/* Header */}
      <header className="sticky top-0 z-10 border-b border-neutral-800 bg-neutral-950 px-6 py-4">
        <div className="mx-auto flex max-w-3xl items-center gap-3">
          <span className="text-lg font-semibold text-primary-400">Tangents</span>
          <span className="text-neutral-600">·</span>
          <span className="text-sm text-neutral-500">Shared conversation (read-only)</span>
        </div>
      </header>

      {/* Message history */}
      <main className="mx-auto max-w-3xl space-y-6 px-6 py-8">
        {history.length === 0 ? (
          <p className="text-sm text-neutral-600">No messages in this share.</p>
        ) : (
          history.map((node) => <MessageBubble key={node.id} node={node} />)
        )}
      </main>

      {/* Footer */}
      <footer className="border-t border-neutral-800 px-6 py-4 text-center text-xs text-neutral-700">
        Powered by Tangents · {history.length} message{history.length !== 1 ? 's' : ''}
      </footer>
    </div>
  );
}

// ── Export with its own QueryClient ──────────────────────────────────────

export function ShareView({ token }: { token: string }) {
  return (
    <QueryClientProvider client={shareQueryClient}>
      <SharePage token={token} />
    </QueryClientProvider>
  );
}
