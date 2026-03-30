/**
 * SettingsPage tests.
 * Covers the highlight colour debounce, model source refresh flow,
 * and inline error/success display.
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { screen, waitFor, fireEvent, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { server } from './mocks/server';
import { SettingsPage } from '../components/settings/SettingsPage';
import { renderWithProviders, resetStore } from './utils';
import { useAppStore } from '../store/appStore';
import { mockSource, mockModel, mockSettings } from './mocks/handlers';

beforeEach(() => {
  resetStore();
  localStorage.setItem('tangents_credentials', btoa('admin:tangents'));
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('SettingsPage — highlight colour picker', () => {
  it('saves highlight colour after 600 ms debounce on change', async () => {
    const mutateSpy = vi.fn();
    server.use(
      http.patch('/api/settings/me', async ({ request }) => {
        const body = await request.json();
        mutateSpy(body);
        return HttpResponse.json({ ...mockSettings, ...(body as object) });
      }),
    );

    renderWithProviders(<SettingsPage />);
    // Wait for initial data load with real timers
    await waitFor(() => expect(screen.getByText(/highlight color/i)).toBeInTheDocument());

    // Switch to fake timers only after the page has loaded
    vi.useFakeTimers({ shouldAdvanceTime: false });

    const colorInput = screen.getByDisplayValue(mockSettings.highlight_color);
    fireEvent.change(colorInput, { target: { value: '#ff0000' } });

    // Mutation should NOT fire immediately
    expect(mutateSpy).not.toHaveBeenCalled();

    // Advance past the 600 ms debounce, then restore real timers for async resolution
    vi.advanceTimersByTime(700);
    vi.useRealTimers();

    await waitFor(() => {
      expect(mutateSpy).toHaveBeenCalledWith(
        expect.objectContaining({ highlight_color: '#ff0000' }),
      );
    });
  });

  it('does not save on blur alone (no onChange)', async () => {
    const mutateSpy = vi.fn();
    server.use(
      http.patch('/api/settings/me', async ({ request }) => {
        const body = await request.json();
        mutateSpy(body);
        return HttpResponse.json({ ...mockSettings, ...(body as object) });
      }),
    );

    renderWithProviders(<SettingsPage />);
    await waitFor(() => expect(screen.getByText(/highlight color/i)).toBeInTheDocument());

    vi.useFakeTimers({ shouldAdvanceTime: false });

    const colorInput = screen.getByDisplayValue(mockSettings.highlight_color);
    fireEvent.blur(colorInput);

    vi.advanceTimersByTime(1000);
    vi.useRealTimers();

    expect(mutateSpy).not.toHaveBeenCalled();
  });

  it('updates the store highlight colour immediately on change (before saving)', async () => {
    renderWithProviders(<SettingsPage />);
    await waitFor(() => expect(screen.getByText(/highlight color/i)).toBeInTheDocument());

    vi.useFakeTimers({ shouldAdvanceTime: false });

    const colorInput = screen.getByDisplayValue(mockSettings.highlight_color);
    act(() => {
      fireEvent.change(colorInput, { target: { value: '#abcdef' } });
    });

    expect(useAppStore.getState().highlightColor).toBe('#abcdef');
  });
});

describe('SettingsPage — model source refresh', () => {
  beforeEach(() => {
    vi.useRealTimers(); // these tests use real async
  });

  it('shows an inline error banner when refresh returns 502', async () => {
    const user = userEvent.setup();
    server.use(
      http.post('/api/settings/sources/:id/refresh', () =>
        HttpResponse.json({ detail: 'Provider unreachable' }, { status: 502 }),
      ),
    );

    renderWithProviders(<SettingsPage />);
    await waitFor(() => expect(screen.getByText(mockSource.name)).toBeInTheDocument());

    // Expand the source row (click the chevron/row header)
    await user.click(screen.getByText(mockSource.name));

    // Click the refresh button
    const refreshBtn = await screen.findByRole('button', { name: /refresh/i });
    await user.click(refreshBtn);

    await waitFor(() => {
      expect(screen.getByText(/provider unreachable/i)).toBeInTheDocument();
    });
  });

  it('clears an inline error when refresh subsequently succeeds', async () => {
    const user = userEvent.setup();

    // First call fails
    let callCount = 0;
    server.use(
      http.post('/api/settings/sources/:id/refresh', () => {
        callCount++;
        if (callCount === 1) {
          return HttpResponse.json({ detail: 'Temporary failure' }, { status: 502 });
        }
        return HttpResponse.json([mockModel]);
      }),
    );

    renderWithProviders(<SettingsPage />);
    await waitFor(() => expect(screen.getByText(mockSource.name)).toBeInTheDocument());

    await user.click(screen.getByText(mockSource.name));
    const refreshBtn = await screen.findByRole('button', { name: /refresh/i });

    // First click — shows error
    await user.click(refreshBtn);
    await waitFor(() => expect(screen.getByText(/temporary failure/i)).toBeInTheDocument());

    // Second click — succeeds; error should disappear
    await user.click(refreshBtn);
    await waitFor(() => {
      expect(screen.queryByText(/temporary failure/i)).not.toBeInTheDocument();
    });
  });

  it('lists fetched model display names in the expanded source row after refresh', async () => {
    const user = userEvent.setup();
    const updatedModels = [
      { ...mockModel, display_name: 'GPT-4o' },
      { ...mockModel, id: 'model-2', model_id: 'gpt-4-turbo', display_name: 'GPT-4 Turbo' },
    ];
    // Override both the refresh POST and subsequent GET models refetch
    server.use(
      http.post('/api/settings/sources/:id/refresh', () =>
        HttpResponse.json(updatedModels),
      ),
      http.get('/api/settings/sources/:id/models', () =>
        HttpResponse.json(updatedModels),
      ),
    );

    renderWithProviders(<SettingsPage />);
    await waitFor(() => expect(screen.getByText(mockSource.name)).toBeInTheDocument());

    await user.click(screen.getByText(mockSource.name));
    const refreshBtn = await screen.findByRole('button', { name: /refresh/i });
    await user.click(refreshBtn);

    await waitFor(() => {
      // The model ID only appears in the source list row (not in select dropdowns)
      expect(screen.getByText('gpt-4-turbo')).toBeInTheDocument();
    });
  });
});
