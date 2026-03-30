/**
 * Auth / LoginGate tests.
 * Tests the login form, credential storage, and 401 interceptor behaviour.
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { server } from './mocks/server';
import App from '../App';
import { resetStore } from './utils';

beforeEach(() => {
  resetStore();
  localStorage.clear();
  document.documentElement.className = '';
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('Auth — LoginGate', () => {
  it('renders login form when localStorage has no credentials', () => {
    localStorage.removeItem('tangents_credentials');
    render(<App />);
    expect(screen.getByText('Sign in to Tangents')).toBeInTheDocument();
  });

  it('does not render AppShell when not authenticated', () => {
    localStorage.removeItem('tangents_credentials');
    render(<App />);
    // AppShell renders a sidebar — if it's not there we're on the login page
    expect(screen.queryByRole('navigation')).not.toBeInTheDocument();
  });

  it('stores credentials and shows app on successful login', async () => {
    const user = userEvent.setup();
    server.use(
      http.get('/api/settings/me', () => HttpResponse.json({ user_id: 'u1' })),
    );

    render(<App />);

    await user.type(screen.getByLabelText(/username/i), 'admin');
    await user.type(screen.getByLabelText(/password/i), 'tangents');
    await user.click(screen.getByRole('button', { name: /sign in/i }));

    await waitFor(() => {
      expect(localStorage.getItem('tangents_credentials')).toBe(btoa('admin:tangents'));
    });
  });

  it('shows error message and does not store credentials on 401', async () => {
    const user = userEvent.setup();
    server.use(
      http.get('/api/settings/me', () => new HttpResponse(null, { status: 401 })),
    );

    render(<App />);

    await user.type(screen.getByLabelText(/username/i), 'wrong');
    await user.type(screen.getByLabelText(/password/i), 'creds');
    await user.click(screen.getByRole('button', { name: /sign in/i }));

    await waitFor(() => {
      expect(screen.getByText('Invalid username or password.')).toBeInTheDocument();
    });
    expect(localStorage.getItem('tangents_credentials')).toBeNull();
  });

  it('disables the sign-in button while the request is in flight', async () => {
    const user = userEvent.setup();
    // Hang the request so we can inspect intermediate state
    server.use(
      http.get('/api/settings/me', () => new Promise(() => {})),
    );

    render(<App />);

    await user.type(screen.getByLabelText(/username/i), 'admin');
    await user.type(screen.getByLabelText(/password/i), 'pass');
    await user.click(screen.getByRole('button', { name: /sign in/i }));

    expect(screen.getByRole('button', { name: /signing in/i })).toBeDisabled();
  });
});

describe('Auth — 401 axios interceptor', () => {
  it('clears credentials and reloads on any 401 API response', async () => {
    // Pre-load credentials as if user was already logged in
    localStorage.setItem('tangents_credentials', btoa('admin:tangents'));
    const reloadSpy = vi.spyOn(window.location, 'reload');

    // Return 401 for settings
    server.use(
      http.get('/api/settings/me', () => new HttpResponse(null, { status: 401 })),
    );

    // Trigger an axios request through the apiClient
    const { apiClient } = await import('../api/client');
    try {
      await apiClient.get('/settings/me');
    } catch {
      // Expected to throw
    }

    expect(localStorage.getItem('tangents_credentials')).toBeNull();
    expect(reloadSpy).toHaveBeenCalled();
  });
});
