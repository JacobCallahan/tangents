/**
 * ChatList — lists all chats in the sidebar, ordered oldest → newest.
 * Supports inline rename (click pencil icon) and delete (click trash icon).
 */

import { useRef, useState } from 'react';
import { Check, MessageSquare, Pencil, Trash2, X } from 'lucide-react';
import { useAppStore } from '../../store/appStore';
import { useChat } from '../../hooks/useChat';

export function ChatList() {
  const { chats, activeChatId, setActiveChat, setCurrentView } = useAppStore();
  const { renameChat, deleteChat } = useChat();

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  const startEdit = (chatId: string, currentTitle: string) => {
    setEditingId(chatId);
    setEditValue(currentTitle);
    // Focus happens via autoFocus on the input
  };

  const confirmEdit = () => {
    if (editingId && editValue.trim()) {
      renameChat(editingId, editValue.trim());
    }
    setEditingId(null);
  };

  const cancelEdit = () => setEditingId(null);

  const handleDelete = (chatId: string) => {
    if (activeChatId === chatId) setActiveChat(null);
    deleteChat(chatId);
  };

  if (chats.length === 0) {
    return (
      <div className="px-4 py-8 text-center text-xs text-neutral-600">
        No chats yet. Start a new one!
      </div>
    );
  }

  return (
    <ul className="flex flex-col gap-0.5 px-2 py-1">
      {chats.map((chat) => {
        const isActive = activeChatId === chat.id;

        if (editingId === chat.id) {
          return (
            <li key={chat.id}>
              <div className="flex items-center gap-1 rounded-md px-2 py-1.5">
                <input
                  ref={inputRef}
                  autoFocus
                  value={editValue}
                  onChange={(e) => setEditValue(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') confirmEdit();
                    if (e.key === 'Escape') cancelEdit();
                  }}
                  className="min-w-0 flex-1 rounded bg-neutral-800 px-2 py-0.5 text-sm text-neutral-100 outline-none ring-1 ring-primary-500"
                />
                <button
                  onClick={confirmEdit}
                  className="flex-shrink-0 text-primary-400 hover:text-primary-300"
                  title="Confirm rename"
                >
                  <Check size={13} />
                </button>
                <button
                  onClick={cancelEdit}
                  className="flex-shrink-0 text-neutral-500 hover:text-neutral-300"
                  title="Cancel"
                >
                  <X size={13} />
                </button>
              </div>
            </li>
          );
        }

        return (
          <li key={chat.id}>
            <div
              className={`group flex items-center gap-1 rounded-md pl-3 pr-1.5 py-2 text-sm transition-colors ${
                isActive
                  ? 'bg-primary-950 text-primary-300'
                  : 'text-neutral-400 hover:bg-neutral-800 hover:text-neutral-200'
              }`}
            >
              {/* Main clickable area */}
              <button
                onClick={() => {
                  setActiveChat(chat.id);
                  setCurrentView('chat');
                }}
                className="flex min-w-0 flex-1 items-center gap-2 text-left"
              >
                <MessageSquare size={13} className="flex-shrink-0" />
                <span className="truncate">{chat.title ?? 'Untitled chat'}</span>
              </button>

              {/* Hover actions */}
              <div className="flex flex-shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    startEdit(chat.id, chat.title ?? '');
                  }}
                  className="rounded p-1 text-neutral-500 hover:bg-neutral-700 hover:text-neutral-200"
                  title="Rename chat"
                >
                  <Pencil size={11} />
                </button>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    handleDelete(chat.id);
                  }}
                  className="rounded p-1 text-neutral-500 hover:bg-red-950 hover:text-red-400"
                  title="Delete chat"
                >
                  <Trash2 size={11} />
                </button>
              </div>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
