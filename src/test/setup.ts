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
      onChanged: { addListener: vi.fn(), removeListener: vi.fn() },
    },
    session: {
      get: vi.fn().mockResolvedValue({}),
      set: vi.fn().mockResolvedValue(undefined),
      remove: vi.fn().mockResolvedValue(undefined),
      onChanged: { addListener: vi.fn(), removeListener: vi.fn() },
    },
  },
  identity: {
    getRedirectURL: vi.fn().mockReturnValue('https://abcdefg.chromiumapp.org/'),
    launchWebAuthFlow: vi.fn(),
  },
  tabs: {
    create: vi.fn().mockResolvedValue({ id: 42 }),
    remove: vi.fn().mockResolvedValue(undefined),
    update: vi.fn().mockResolvedValue(undefined),
    onUpdated: { addListener: vi.fn(), removeListener: vi.fn() },
    onRemoved: { addListener: vi.fn(), removeListener: vi.fn() },
  },
  scripting: {
    executeScript: vi.fn().mockResolvedValue([{ result: null }]),
  },
  runtime: {
    sendMessage: vi.fn(),
    onMessage: { addListener: vi.fn() },
    getPlatformInfo: vi.fn().mockResolvedValue({ os: 'mac' }),
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
