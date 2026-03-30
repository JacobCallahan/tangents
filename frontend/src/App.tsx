import { useState, useEffect } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AppShell } from './components/layout/AppShell';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 30_000, retry: 1 },
  },
});

/** Simple Basic-auth login gate. Stores base64(user:pass) in localStorage. */
function LoginGate({ onAuth }: { onAuth: () => void }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const token = btoa(`${username}:${password}`);
      const res = await fetch('/api/settings/me', {
        headers: { Authorization: `Basic ${token}` },
      });
      if (res.ok) {
        localStorage.setItem('tangents_credentials', token);
        onAuth();
      } else {
        setError('Invalid username or password.');
      }
    } catch {
      setError('Could not reach the server.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex h-screen w-screen items-center justify-center bg-neutral-950">
      <form
        onSubmit={handleSubmit}
        className="flex w-80 flex-col gap-4 rounded-lg border border-neutral-800 bg-neutral-900 p-8"
      >
        <h1 className="text-lg font-semibold text-neutral-100">Sign in to Tangents</h1>
        <div className="flex flex-col gap-1">
          <label htmlFor="login-username" className="text-xs text-neutral-400">Username</label>
          <input
            id="login-username"
            autoFocus
            type="text"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            className="rounded border border-neutral-700 bg-neutral-800 px-3 py-2 text-sm text-neutral-100 outline-none focus:border-neutral-500"
          />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="login-password" className="text-xs text-neutral-400">Password</label>
          <input
            id="login-password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="rounded border border-neutral-700 bg-neutral-800 px-3 py-2 text-sm text-neutral-100 outline-none focus:border-neutral-500"
          />
        </div>
        {error && <p className="text-xs text-red-400">{error}</p>}
        <button
          type="submit"
          disabled={loading || !username}
          className="rounded bg-neutral-700 px-4 py-2 text-sm font-medium text-neutral-100 hover:bg-neutral-600 disabled:opacity-50"
        >
          {loading ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
    </div>
  );
}

export default function App() {
  const [authed, setAuthed] = useState(() =>
    Boolean(localStorage.getItem('tangents_credentials'))
  );

  // Re-check on storage changes (e.g. another tab signs out)
  useEffect(() => {
    const handler = () =>
      setAuthed(Boolean(localStorage.getItem('tangents_credentials')));
    window.addEventListener('storage', handler);
    return () => window.removeEventListener('storage', handler);
  }, []);

  if (!authed) return <LoginGate onAuth={() => setAuthed(true)} />;

  return (
    <QueryClientProvider client={queryClient}>
      <AppShell />
    </QueryClientProvider>
  );
}
