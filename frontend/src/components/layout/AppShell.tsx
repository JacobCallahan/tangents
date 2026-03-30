/**
 * AppShell — the top-level dual-pane layout.
 *
 * Left pane:  Sidebar (Chats tab / Graph tab) + Settings icon
 * Right pane: Active chat view OR Settings page
 *
 * Also responsible for:
 *  - Loading user settings on mount and applying the saved theme
 *  - Registering global keyboard shortcuts via useKeybindings
 */

import { useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Settings } from 'lucide-react';
import { settingsApi } from '../../api/settings';
import { useAppStore } from '../../store/appStore';
import { useKeybindings } from '../../hooks/useKeybindings';
import { Sidebar } from './Sidebar';
import { ChatView } from '../chat/ChatView';
import { SettingsPage } from '../settings/SettingsPage';

export function AppShell() {
  const { currentView, setCurrentView, setTheme } = useAppStore();

  // Register global keybindings
  useKeybindings();

  // Load saved theme from backend on mount and apply it
  const { data: userSettings } = useQuery({
    queryKey: ['settings'],
    queryFn: settingsApi.getSettings,
  });

  useEffect(() => {
    if (userSettings?.theme === 'light' || userSettings?.theme === 'dark') {
      setTheme(userSettings.theme);
    }
  }, [userSettings?.theme, setTheme]);

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-neutral-950 text-neutral-100">
      {/* ── Left pane ── */}
      <div className="flex w-72 flex-shrink-0 flex-col border-r border-neutral-800">
        <Sidebar />

        {/* Settings icon at the bottom of the sidebar */}
        <button
          onClick={() =>
            setCurrentView(currentView === 'settings' ? 'chat' : 'settings')
          }
          className={`flex items-center gap-2 border-t border-neutral-800 px-4 py-3 text-sm transition-colors hover:bg-neutral-800 ${
            currentView === 'settings' ? 'text-primary-400' : 'text-neutral-400'
          }`}
          title="Settings (Ctrl+,)"
        >
          <Settings size={16} />
          Settings
        </button>
      </div>

      {/* ── Right pane ── */}
      <div className="flex flex-1 flex-col overflow-hidden">
        {currentView === 'settings' ? <SettingsPage /> : <ChatView />}
      </div>
    </div>
  );
}

