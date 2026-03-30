/**
 * Sidebar — switchable between Chats and Graph tabs.
 */

import { GitBranch, MessageSquare, Plus } from 'lucide-react';
import { useAppStore } from '../../store/appStore';
import { ChatList } from '../chat/ChatList';
import { GraphView } from '../graph/GraphView';
import { NodeControls } from '../graph/NodeControls';

export function Sidebar() {
  const { sidebarTab, setSidebarTab, setActiveChat, setCurrentView, activeChatId } =
    useAppStore();

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      {/* Tab bar */}
      <div className="flex border-b border-neutral-800">
        <button
          onClick={() => setSidebarTab('chats')}
          className={`flex flex-1 items-center justify-center gap-1.5 py-2.5 text-xs font-medium transition-colors ${
            sidebarTab === 'chats'
              ? 'border-b-2 border-primary-500 text-primary-400'
              : 'text-neutral-500 hover:text-neutral-300'
          }`}
        >
          <MessageSquare size={13} />
          Chats
        </button>
        <button
          onClick={() => setSidebarTab('graph')}
          className={`flex flex-1 items-center justify-center gap-1.5 py-2.5 text-xs font-medium transition-colors ${
            sidebarTab === 'graph'
              ? 'border-b-2 border-primary-500 text-primary-400'
              : 'text-neutral-500 hover:text-neutral-300'
          }`}
        >
          <GitBranch size={13} />
          Graph
        </button>
      </div>

      {/* Context-sensitive action area */}
      {sidebarTab === 'chats' ? (
        /* Chats tab: New chat button */
        <button
          onClick={() => {
            setActiveChat(null);
            setCurrentView('chat');
          }}
          className="mx-3 my-2 flex items-center gap-1.5 rounded-md border border-neutral-700 px-3 py-1.5 text-xs text-neutral-400 transition-colors hover:border-primary-600 hover:text-primary-400"
          title="New chat (Ctrl+N)"
        >
          <Plus size={13} />
          New chat
        </button>
      ) : activeChatId ? (
        /* Graph tab with chat: node management controls */
        <NodeControls chatId={activeChatId} />
      ) : null}

      {/* Tab content */}
      <div className="flex-1 overflow-y-auto">
        {sidebarTab === 'chats' ? (
          <ChatList />
        ) : activeChatId ? (
          <GraphView chatId={activeChatId} />
        ) : (
          <div className="px-4 py-8 text-center text-xs text-neutral-600">
            Open a chat to view its graph
          </div>
        )}
      </div>
    </div>
  );
}
