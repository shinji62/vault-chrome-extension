import { describe, it, expect, vi, afterEach } from 'vitest';
import { STORE_PM_PENDING_SAVE } from '../types/messages';

// Imported dynamically so the storage mock is configured before the content
// script's entry point runs.
let loaded = false;

async function loadContentScript(): Promise<void> {
  if (loaded) return;
  // The content script only activates when the PM is configured.
  (chrome.storage.local.get as unknown as ReturnType<typeof vi.fn>).mockImplementation(
    (_keys: string | string[], cb?: (result: Record<string, unknown>) => void) => {
      const result = { vaultSettings: { pmNamespace: 'secret' } };
      if (typeof cb === 'function') cb(result);
      return Promise.resolve(result);
    },
  );
  (chrome.runtime.sendMessage as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
    success: true,
    data: undefined,
  });
  await import('./index');
  loaded = true;
}

function pendingSaveCalls(): Array<Array<Record<string, unknown>>> {
  const sendMessage = chrome.runtime.sendMessage as unknown as ReturnType<typeof vi.fn>;
  return sendMessage.mock.calls.filter((c) => c[0]?.type === STORE_PM_PENDING_SAVE) as Array<
    Array<Record<string, unknown>>
  >;
}

afterEach(() => {
  vi.useRealTimers();
  document.body.innerHTML = '';
  (chrome.runtime.sendMessage as unknown as ReturnType<typeof vi.fn>).mockClear();
});

describe('content script — form-less login widget', () => {
  it('captures and persists credentials when the submit button is clicked', async () => {
    // Mirrors practicetestautomation.com: a <div> of inputs plus a button whose
    // click handler navigates — no <form>, so no submit event is ever fired.
    document.body.innerHTML = `
      <section id="login">
        <div id="form">
          <div><label for="username">Username</label><input type="text" id="username" /></div>
          <div><label for="password">Password</label><input type="password" id="password" /></div>
          <button id="submit" class="btn">Submit</button>
        </div>
      </section>
    `;
    vi.useFakeTimers();
    await loadContentScript();

    (document.getElementById('username') as HTMLInputElement).value = 'student';
    (document.getElementById('password') as HTMLInputElement).value = 'Password123';

    (document.getElementById('submit') as HTMLButtonElement).click();

    const calls = pendingSaveCalls();
    expect(calls.length).toBeGreaterThan(0);
    // Each mock call is the argument tuple for chrome.runtime.sendMessage.
    const last = calls.at(-1)![0] as { username: string; password: string };
    expect(last).toMatchObject({
      username: 'student',
      password: 'Password123',
    });
  });

  it('does not capture when the form-less widget is left untouched', async () => {
    document.body.innerHTML = `
      <div id="form">
        <input type="text" id="username" />
        <input type="password" id="password" />
        <button id="submit">Submit</button>
      </div>
    `;
    vi.useFakeTimers();
    await loadContentScript();

    const sendMessage = chrome.runtime.sendMessage as unknown as ReturnType<typeof vi.fn>;
    const before = sendMessage.mock.calls.length;
    // Clicking an unrelated, non-submit control must not capture.
    const other = document.createElement('button');
    other.textContent = 'Upload file';
    document.body.appendChild(other);
    other.click();

    expect(pendingSaveCalls().length).toBe(0);
    expect(sendMessage.mock.calls.length).toBe(before);
  });
});