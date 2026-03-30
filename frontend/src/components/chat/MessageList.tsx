/**
 * MessageList — renders the linear chat history.
 * Streams the latest assistant token in place when isStreaming=true.
 */

import { useEffect, useRef } from 'react';
import { useAppStore } from '../../store/appStore';

export function MessageList() {
  const { history, isStreaming, streamBuffer, streamingNodeId, streamingPrompt } = useAppStore();
  const bottomRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom when new content arrives
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [history, streamBuffer]);

  if (history.length === 0 && !isStreaming) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <p className="text-sm text-neutral-600">Send a message to start the conversation</p>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto px-6 py-4">
      <div className="mx-auto flex max-w-3xl flex-col gap-6">
        {history.map((node) => (
          <div key={node.id} className="flex flex-col gap-3">
            {/* User message */}
            <div className="flex justify-end">
              <div className="max-w-[75%] rounded-2xl rounded-tr-sm bg-primary-700 px-4 py-2.5 text-sm text-white">
                {node.user_prompt}
              </div>
            </div>

            {/* AI response */}
            {(node.ai_response || node.id === streamingNodeId) && (
              <div className="flex justify-start">
                <div className="max-w-[80%] rounded-2xl rounded-tl-sm bg-neutral-800 px-4 py-2.5 text-sm text-neutral-100">
                  <pre className="whitespace-pre-wrap font-sans">
                    {node.id === streamingNodeId
                      ? streamBuffer || (
                          <span className="animate-pulse text-neutral-500">▍</span>
                        )
                      : node.ai_response}
                  </pre>
                </div>
              </div>
            )}
          </div>
        ))}

        {/* Streaming skeleton when the node isn't in history yet */}
        {isStreaming && !history.find((n) => n.id === streamingNodeId) && (
          <div className="flex flex-col gap-3">
            {/* Optimistically show the user prompt */}
            {streamingPrompt && (
              <div className="flex justify-end">
                <div className="max-w-[75%] rounded-2xl rounded-tr-sm bg-primary-700 px-4 py-2.5 text-sm text-white">
                  {streamingPrompt}
                </div>
              </div>
            )}
            {/* Streaming AI response */}
            <div className="flex justify-start">
              <div className="max-w-[80%] rounded-2xl rounded-tl-sm bg-neutral-800 px-4 py-2.5 text-sm text-neutral-100">
                <pre className="whitespace-pre-wrap font-sans">
                  {streamBuffer || <span className="animate-pulse text-neutral-500">▍</span>}
                </pre>
              </div>
            </div>
          </div>
        )}

        <div ref={bottomRef} />
      </div>
    </div>
  );
}
