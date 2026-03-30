/**
 * MSW Node server — used by Vitest (jsdom environment).
 * Tests import { server } from './mocks/server' to add per-test overrides.
 */

import { setupServer } from 'msw/node';
import { handlers } from './handlers';

export const server = setupServer(...handlers);
