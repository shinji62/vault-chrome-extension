import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, vi } from 'vitest';

// ── MSW server ────────────────────────────────────────────────────────────────
export const server = setupServer();
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

// ── Chrome API mock ───────────────────────────────────────────────────────────
const chromeMock = {
  storage: {
    local: {
      get: vi.fn().mockResolvedValue({}),
      set: vi.fn().mockResolvedValue(undefined),
      remove: vi.fn().mockResolvedValue(undefined),
    },
  },
  identity: {
    getRedirectURL: vi.fn().mockReturnValue('https://abcdefg.chromiumapp.org/'),
    launchWebAuthFlow: vi.fn(),
  },
  runtime: {
    sendMessage: vi.fn(),
    onMessage: { addListener: vi.fn() },
    lastError: undefined,
  },
  alarms: {
    create: vi.fn(),
    clear: vi.fn().mockResolvedValue(true),
    onAlarm: { addListener: vi.fn() },
  },
};

// Attach to global so imported modules that reference `chrome` find it
Object.defineProperty(globalThis, 'chrome', {
  value: chromeMock,
  writable: true,
});
