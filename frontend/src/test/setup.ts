import '@testing-library/jest-dom';
import { afterAll, afterEach, beforeAll } from 'vitest';
import { server } from './mocks/server';

// ── MSW lifecycle ────────────────────────────────────────────────────────────
// Start MSW before any test; reset handlers after each test; close after all.
beforeAll(() => server.listen({ onUnhandledRequest: 'warn' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

// ── Browser API stubs ────────────────────────────────────────────────────────
// @xyflow/react and Tailwind both need these in jsdom.

// ResizeObserver is not implemented in jsdom
global.ResizeObserver = class ResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
};

// matchMedia is not implemented in jsdom
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  }),
});

// window.location.reload is a no-op inside jsdom but we want to spy on it
Object.defineProperty(window, 'location', {
  writable: true,
  value: { ...window.location, reload: () => {} },
});
