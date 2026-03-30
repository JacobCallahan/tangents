/**
 * useKeybindings — registers global keyboard shortcuts.
 *
 * Default bindings (all Ctrl-based):
 *   Ctrl+,        → open Settings
 *   Ctrl+Shift+,  → close Settings (back to chat)
 *   Ctrl+N        → new chat (navigates to chat view with no active chat)
 *   Escape        → close Settings if open
 *
 * Bindings are suppressed when focus is inside a text field so normal typing
 * still works.
 */

import { useEffect } from 'react';
import { useAppStore } from '../store/appStore';
import { chatsApi } from '../api/chats';
import { useQueryClient } from '@tanstack/react-query';

function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName.toLowerCase();
  return tag === 'input' || tag === 'textarea' || target.isContentEditable;
}

export function useKeybindings() {
  const { currentView, setCurrentView, setActiveChat, setActiveBranch } = useAppStore();
  const queryClient = useQueryClient();

  useEffect(() => {
    const handler = async (e: KeyboardEvent) => {
      // Ctrl+, → toggle settings
      if (e.ctrlKey && !e.shiftKey && e.key === ',') {
        e.preventDefault();
        setCurrentView(currentView === 'settings' ? 'chat' : 'settings');
        return;
      }

      // Escape → close settings
      if (e.key === 'Escape' && currentView === 'settings') {
        e.preventDefault();
        setCurrentView('chat');
        return;
      }

      // Skip remaining shortcuts if user is typing
      if (isTyping(e.target)) return;

      // Ctrl+N → new chat
      if (e.ctrlKey && e.key === 'n') {
        e.preventDefault();
        try {
          const chat = await chatsApi.create({});
          queryClient.invalidateQueries({ queryKey: ['chats'] });
          setCurrentView('chat');
          setActiveChat(chat.id);
          // Branches load reactively via useChat
        } catch {
          // ignore — user will see empty chat list
        }
        return;
      }
    };

    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [currentView, setCurrentView, setActiveChat, setActiveBranch, queryClient]);
}
