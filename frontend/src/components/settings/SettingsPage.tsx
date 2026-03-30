/**
 * SettingsPage — full-page settings view.
 * Covers: Model Sources, Default Model, Synthesis Model, Context Budget,
 * Custom Instructions, Theme, Branch Naming, Share Links.
 */

import { useState, useRef } from 'react';
import { useQuery, useMutation, useQueryClient, useQueries } from '@tanstack/react-query';
import { ChevronDown, ChevronRight, Plus, RefreshCw, Trash2, X } from 'lucide-react';
import { settingsApi } from '../../api/settings';
import { shareApi } from '../../api/share';
import { useAppStore } from '../../store/appStore';
import type { ModelSourceCreate, UserSettingsUpdate } from '../../types';

const PROVIDERS = [
  { key: 'openai',     label: 'OpenAI',         providerType: 'openai',      defaultName: 'OpenAI',         defaultBaseUrl: 'https://api.openai.com/v1' },
  { key: 'anthropic',  label: 'Anthropic',       providerType: 'anthropic',   defaultName: 'Anthropic',      defaultBaseUrl: '' },
  { key: 'gemini',     label: 'Google Gemini',   providerType: 'gemini',      defaultName: 'Google Gemini',  defaultBaseUrl: '' },
  { key: 'groq',       label: 'Groq',            providerType: 'groq',        defaultName: 'Groq',           defaultBaseUrl: 'https://api.groq.com/openai/v1' },
  { key: 'mistral',    label: 'Mistral',         providerType: 'mistral',     defaultName: 'Mistral',        defaultBaseUrl: 'https://api.mistral.ai/v1' },
  { key: 'openrouter', label: 'OpenRouter',      providerType: 'openrouter',  defaultName: 'OpenRouter',     defaultBaseUrl: 'https://openrouter.ai/api/v1' },
  { key: 'ollama',     label: 'Ollama (local)',  providerType: 'ollama_chat', defaultName: 'Ollama',         defaultBaseUrl: 'http://localhost:11434' },
  { key: 'custom',     label: 'Custom',          providerType: '',            defaultName: '',               defaultBaseUrl: '' },
];

const DEFAULT_PROVIDER = PROVIDERS[0];

export function SettingsPage() {
  const queryClient = useQueryClient();
  const { setCurrentView, setTheme, highlightColor, setHighlightColor } = useAppStore();
  const saveColorTimeout = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  // ── Queries ──────────────────────────────────────────────────────────────
  const { data: settings, isLoading: settingsLoading } = useQuery({
    queryKey: ['settings'],
    queryFn: settingsApi.getSettings,
  });

  const { data: sources = [] } = useQuery({
    queryKey: ['sources'],
    queryFn: settingsApi.listSources,
  });

  // Load models for each source
  const sourceModelResults = useQueries({
    queries: sources.map((src) => ({
      queryKey: ['sourceModels', src.id],
      queryFn: () => settingsApi.listSourceModels(src.id),
      staleTime: 5 * 60 * 1000,
    })),
  });
  const allModels = sourceModelResults.flatMap((r) => r.data ?? []);
  const [expandedSources, setExpandedSources] = useState<Set<string>>(new Set());
  const [refreshErrors, setRefreshErrors] = useState<Record<string, string>>({});

  const { data: shareLinks = [] } = useQuery({
    queryKey: ['shareLinks'],
    queryFn: shareApi.list,
  });

  // ── Mutations ─────────────────────────────────────────────────────────────
  const updateSettingsMutation = useMutation({
    mutationFn: (data: UserSettingsUpdate) => settingsApi.updateSettings(data),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['settings'] }),
  });

  const createSourceMutation = useMutation({
    mutationFn: (data: ModelSourceCreate) => settingsApi.createSource(data),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['sources'] }),
  });

  const deleteSourceMutation = useMutation({
    mutationFn: (sourceId: string) => settingsApi.deleteSource(sourceId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['sources'] }),
  });

  const refreshModelsMutation = useMutation({
    mutationFn: (sourceId: string) => settingsApi.refreshModels(sourceId),
    onSuccess: (_data, sourceId) => {
      queryClient.invalidateQueries({ queryKey: ['sourceModels', sourceId] });
      queryClient.invalidateQueries({ queryKey: ['sources'] });
      setRefreshErrors((prev) => { const next = { ...prev }; delete next[sourceId]; return next; });
    },
    onError: (error: unknown, sourceId) => {
      const msg =
        (error as any)?.response?.data?.detail ??
        (error as Error)?.message ??
        'Unknown error';
      setRefreshErrors((prev) => ({ ...prev, [sourceId]: String(msg) }));
    },
  });

  const revokeShareLinkMutation = useMutation({
    mutationFn: (id: string) => shareApi.revoke(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['shareLinks'] }),
  });

  // ── New source form state ─────────────────────────────────────────────────
  const [showAddSource, setShowAddSource] = useState(false);
  const [selectedProviderKey, setSelectedProviderKey] = useState(DEFAULT_PROVIDER.key);
  const [newSource, setNewSource] = useState<ModelSourceCreate>({
    name: DEFAULT_PROVIDER.defaultName,
    provider_type: DEFAULT_PROVIDER.providerType,
    base_url: DEFAULT_PROVIDER.defaultBaseUrl,
    api_key: '',
  });

  const handleProviderChange = (key: string) => {
    const p = PROVIDERS.find((p) => p.key === key) ?? PROVIDERS[PROVIDERS.length - 1];
    setSelectedProviderKey(key);
    setNewSource((s) => ({
      ...s,
      name: p.defaultName,
      provider_type: p.providerType,
      base_url: p.defaultBaseUrl,
    }));
  };

  const closeAddSource = () => {
    setShowAddSource(false);
    setSelectedProviderKey(DEFAULT_PROVIDER.key);
    setNewSource({ name: DEFAULT_PROVIDER.defaultName, provider_type: DEFAULT_PROVIDER.providerType, base_url: DEFAULT_PROVIDER.defaultBaseUrl, api_key: '' });
    createSourceMutation.reset();
  };

  const handleAddSource = () => {
    createSourceMutation.mutate(
      { ...newSource, base_url: newSource.base_url || undefined, api_key: newSource.api_key || undefined },
      { onSuccess: () => closeAddSource() }
    );
  };

  const isCustomProvider = selectedProviderKey === 'custom';
  const sourceErrorMsg = createSourceMutation.error
    ? ((createSourceMutation.error as any)?.response?.data?.detail ??
       (createSourceMutation.error as Error).message ??
       'Failed to save source.')
    : null;

  if (settingsLoading) {
    return (
      <div className="flex flex-1 items-center justify-center text-sm text-neutral-500">
        Loading settings…
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col overflow-y-auto">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-neutral-800 px-6 py-4">
        <h1 className="text-lg font-semibold">Settings</h1>
        <button
          onClick={() => setCurrentView('chat')}
          className="rounded-md p-1.5 text-neutral-500 hover:bg-neutral-800 hover:text-neutral-300"
        >
          <X size={16} />
        </button>
      </div>

      <div className="mx-auto w-full max-w-2xl space-y-10 px-6 py-8">

        {/* ── Model Sources ─────────────────────────────────────────────── */}
        <section>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-neutral-200">Model Sources</h2>
            <button
              onClick={() => setShowAddSource((v) => !v)}
              className="flex items-center gap-1 rounded-md bg-primary-700 px-2.5 py-1 text-xs text-white hover:bg-primary-600"
            >
              <Plus size={12} /> Add source
            </button>
          </div>

          {showAddSource && (
            <div className="mb-4 space-y-3 rounded-lg border border-neutral-700 bg-neutral-900 p-4">
              {/* Provider dropdown — first */}
              <div>
                <label className="mb-1 block text-xs text-neutral-400">Provider</label>
                <select
                  className="settings-input"
                  value={selectedProviderKey}
                  onChange={(e) => handleProviderChange(e.target.value)}
                >
                  {PROVIDERS.map((p) => (
                    <option key={p.key} value={p.key}>{p.label}</option>
                  ))}
                </select>
              </div>

              {/* Name */}
              <div>
                <label className="mb-1 block text-xs text-neutral-400">Display name</label>
                <input
                  className="settings-input"
                  placeholder="e.g. My OpenAI"
                  value={newSource.name}
                  onChange={(e) => setNewSource((s) => ({ ...s, name: e.target.value }))}
                />
              </div>

              {/* Base URL */}
              <div>
                <label className="mb-1 block text-xs text-neutral-400">
                  Base URL{!isCustomProvider && <span className="ml-1 text-neutral-600">(optional)</span>}
                </label>
                <input
                  className="settings-input"
                  placeholder={isCustomProvider ? 'https://…/v1' : 'Leave blank for default'}
                  value={newSource.base_url ?? ''}
                  onChange={(e) => setNewSource((s) => ({ ...s, base_url: e.target.value }))}
                />
              </div>

              {/* Provider type — editable only for Custom */}
              {isCustomProvider && (
                <div>
                  <label className="mb-1 block text-xs text-neutral-400">Provider type</label>
                  <input
                    className="settings-input"
                    placeholder="e.g. openai"
                    value={newSource.provider_type}
                    onChange={(e) => setNewSource((s) => ({ ...s, provider_type: e.target.value }))}
                  />
                  <p className="mt-1 text-xs text-neutral-600">LiteLLM provider prefix used to build model IDs.</p>
                </div>
              )}

              {/* API key */}
              <div>
                <label className="mb-1 block text-xs text-neutral-400">API key</label>
                <input
                  type="password"
                  className="settings-input"
                  placeholder="sk-…"
                  value={newSource.api_key ?? ''}
                  onChange={(e) => setNewSource((s) => ({ ...s, api_key: e.target.value }))}
                />
              </div>

              {/* Error */}
              {sourceErrorMsg && (
                <p className="rounded bg-red-950 px-3 py-2 text-xs text-red-400">{String(sourceErrorMsg)}</p>
              )}

              <div className="flex gap-2 pt-1">
                <button
                  onClick={handleAddSource}
                  disabled={!newSource.name || !newSource.provider_type || createSourceMutation.isPending}
                  className="rounded-md bg-primary-700 px-3 py-1.5 text-xs text-white hover:bg-primary-600 disabled:opacity-40"
                >
                  {createSourceMutation.isPending ? 'Saving…' : 'Save'}
                </button>
                <button
                  onClick={closeAddSource}
                  className="rounded-md px-3 py-1.5 text-xs text-neutral-400 hover:text-neutral-200"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}

          {sources.length === 0 ? (
            <p className="text-xs text-neutral-600">No sources configured yet.</p>
          ) : (
            <ul className="space-y-2">
              {sources.map((src, i) => {
                const srcModels = sourceModelResults[i]?.data ?? [];
                const isExpanded = expandedSources.has(src.id);
                return (
                  <li
                    key={src.id}
                    className="rounded-lg border border-neutral-800 bg-neutral-900"
                  >
                    <div className="flex items-center justify-between px-4 py-3">
                      <button
                        className="flex flex-1 items-center gap-2 text-left"
                        onClick={() =>
                          setExpandedSources((prev) => {
                            const next = new Set(prev);
                            if (next.has(src.id)) next.delete(src.id);
                            else next.add(src.id);
                            return next;
                          })
                        }
                      >
                        {isExpanded ? <ChevronDown size={13} className="text-neutral-500" /> : <ChevronRight size={13} className="text-neutral-500" />}
                        <div>
                          <p className="text-sm font-medium text-neutral-200">{src.name}</p>
                          <p className="text-xs text-neutral-500">
                            {src.provider_type}
                            {src.base_url && ` · ${src.base_url}`}
                            {srcModels.length > 0 && ` · ${srcModels.length} model${srcModels.length !== 1 ? 's' : ''}`}
                          </p>
                        </div>
                      </button>
                      <div className="flex gap-2">
                        <button
                          onClick={() => refreshModelsMutation.mutate(src.id)}
                          title="Refresh model list"
                          disabled={refreshModelsMutation.isPending && refreshModelsMutation.variables === src.id}
                          className="rounded p-1 text-neutral-500 hover:text-primary-400 disabled:opacity-50"
                        >
                          <RefreshCw
                            size={14}
                            className={
                              refreshModelsMutation.isPending && refreshModelsMutation.variables === src.id
                                ? 'animate-spin'
                                : ''
                            }
                          />
                        </button>
                        <button
                          onClick={() => deleteSourceMutation.mutate(src.id)}
                          title="Delete source"
                          className="rounded p-1 text-neutral-500 hover:text-red-400"
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </div>

                    {/* Refresh error */}
                    {refreshErrors[src.id] && (
                      <div className="border-t border-red-900 bg-red-950 px-4 py-2">
                        <p className="text-xs text-red-400">
                          <span className="font-medium">Refresh failed: </span>
                          {refreshErrors[src.id]}
                        </p>
                      </div>
                    )}

                    {/* Expanded model list */}
                    {isExpanded && (
                      <div className="border-t border-neutral-800 px-4 py-2">
                        {srcModels.length === 0 ? (
                          <p className="py-1 text-xs text-neutral-600">
                            No models loaded — click the refresh icon to fetch from the provider.
                          </p>
                        ) : (
                          <ul className="space-y-1 py-1">
                            {srcModels.map((m) => (
                              <li key={m.id} className="flex items-center justify-between">
                                <span className="text-xs text-neutral-300">{m.display_name}</span>
                                <span className="font-mono text-xs text-neutral-600">{m.model_id}</span>
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        {/* ── Default Model ──────────────────────────────────────────── */}
        <section>
          <h2 className="mb-2 text-sm font-semibold text-neutral-200">Default Chat Model</h2>
          <p className="mb-2 text-xs text-neutral-500">
            Pre-selected model in the chat picker. You can always change it per conversation.
          </p>
          {allModels.length === 0 ? (
            <p className="text-xs text-neutral-600">Add and refresh a model source to see models here.</p>
          ) : (
            <select
              className="settings-input"
              value={settings?.default_model_id ?? ''}
              onChange={(e) =>
                updateSettingsMutation.mutate({ default_model_id: e.target.value || undefined })
              }
            >
              <option value="">None (use first available)</option>
              {allModels.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.display_name}
                </option>
              ))}
            </select>
          )}
        </section>

        {/* ── Synthesis Model ────────────────────────────────────────── */}
        <section>
          <h2 className="mb-2 text-sm font-semibold text-neutral-200">Synthesis Model</h2>
          <p className="mb-2 text-xs text-neutral-500">
            Used for tangent merging, title generation, and context compression. Falls back to the
            active chat model if not set.
          </p>
          {allModels.length === 0 ? (
            <p className="text-xs text-neutral-600">Add and refresh a model source to see models here.</p>
          ) : (
            <select
              className="settings-input"
              value={settings?.synthesis_model_id ?? ''}
              onChange={(e) =>
                updateSettingsMutation.mutate({ synthesis_model_id: e.target.value || undefined })
              }
            >
              <option value="">None (use active model)</option>
              {allModels.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.display_name}
                </option>
              ))}
            </select>
          )}
        </section>

        {/* ── Custom Instructions ───────────────────────────────────────────── */}
        <section>
          <h2 className="mb-2 text-sm font-semibold text-neutral-200">Custom Instructions</h2>
          <p className="mb-2 text-xs text-neutral-500">
            Injected as a system prompt at the start of every conversation.
          </p>
          <textarea
            rows={4}
            className="settings-input resize-y"
            placeholder="You are a helpful assistant…"
            defaultValue={settings?.custom_instructions ?? ''}
            onBlur={(e) =>
              updateSettingsMutation.mutate({ custom_instructions: e.target.value })
            }
          />
        </section>

        {/* ── Theme ─────────────────────────────────────────────────────── */}
        <section>
          <h2 className="mb-2 text-sm font-semibold text-neutral-200">Theme</h2>
          <div className="flex gap-3">
            {(['dark', 'light'] as const).map((t) => (
              <button
                key={t}
                onClick={() => {
                  setTheme(t);
                  updateSettingsMutation.mutate({ theme: t });
                }}
                className={`rounded-lg border px-4 py-2 text-sm capitalize transition-colors ${
                  settings?.theme === t
                    ? 'border-primary-500 bg-primary-950 text-primary-300'
                    : 'border-neutral-700 text-neutral-400 hover:border-neutral-600'
                }`}
              >
                {t}
              </button>
            ))}
          </div>
        </section>

        {/* ── Highlight Color ──────────────────────────────────────── */}
        <section>
          <h2 className="mb-2 text-sm font-semibold text-neutral-200">Highlight Color</h2>
          <p className="mb-3 text-xs text-neutral-500">
            Color used to highlight the selected node in the graph view.
          </p>
          <div className="flex items-center gap-3">
            <input
              type="color"
              value={settings?.highlight_color ?? highlightColor}
              onChange={(e) => {
                const color = e.target.value;
                setHighlightColor(color);
                // Debounce the backend save — color inputs fire on every
                // pointer movement, so we wait until the user stops dragging.
                clearTimeout(saveColorTimeout.current);
                saveColorTimeout.current = setTimeout(() => {
                  updateSettingsMutation.mutate({ highlight_color: color });
                }, 600);
              }}
              className="h-8 w-10 cursor-pointer rounded border border-neutral-700 bg-neutral-900 p-0.5"
            />
            <span className="font-mono text-xs text-neutral-500">
              {settings?.highlight_color ?? highlightColor}
            </span>
            <button
              onClick={() => {
                const def = '#6366f1';
                setHighlightColor(def);
                updateSettingsMutation.mutate({ highlight_color: def });
              }}
              className="text-xs text-neutral-600 hover:text-neutral-400 underline"
            >
              Reset to default
            </button>
          </div>
        </section>

        {/* ── Tangent Naming ────────────────────────────────────────────── */}
        <section>
          <h2 className="mb-2 text-sm font-semibold text-neutral-200">Tangent Naming</h2>
          <div className="flex gap-3">
            {([['random', 'Random (e.g. wispy-river-42)'], ['ai', 'AI-generated']] as const).map(
              ([mode, label]) => (
                <button
                  key={mode}
                  onClick={() => updateSettingsMutation.mutate({ branch_naming_mode: mode })}
                  className={`rounded-lg border px-4 py-2 text-sm transition-colors ${
                    settings?.branch_naming_mode === mode
                      ? 'border-primary-500 bg-primary-950 text-primary-300'
                      : 'border-neutral-700 text-neutral-400 hover:border-neutral-600'
                  }`}
                >
                  {label}
                </button>
              )
            )}
          </div>
        </section>

        {/* ── Share Links ───────────────────────────────────────────────── */}
        <section>
          <h2 className="mb-3 text-sm font-semibold text-neutral-200">Active Share Links</h2>
          {shareLinks.length === 0 ? (
            <p className="text-xs text-neutral-600">No active share links.</p>
          ) : (
            <ul className="space-y-2">
              {shareLinks.map((link) => (
                <li
                  key={link.id}
                  className="flex items-center justify-between rounded-lg border border-neutral-800 bg-neutral-900 px-4 py-3"
                >
                  <div>
                    <p className="font-mono text-xs text-neutral-300">
                      /share/{link.id}
                    </p>
                    <p className="text-xs text-neutral-600">
                      Created {new Date(link.created_at).toLocaleDateString()}
                    </p>
                  </div>
                  <button
                    onClick={() => revokeShareLinkMutation.mutate(link.id)}
                    className="rounded p-1 text-neutral-500 hover:text-red-400"
                    title="Revoke"
                  >
                    <Trash2 size={14} />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

      </div>
    </div>
  );
}
