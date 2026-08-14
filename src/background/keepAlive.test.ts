import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { withKeepAlive } from './keepAlive';

describe('withKeepAlive', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.mocked(chrome.runtime.getPlatformInfo).mockClear();
  });
  afterEach(() => vi.useRealTimers());

  it('pings periodically while the operation is pending', async () => {
    let release!: () => void;
    const pending = new Promise<string>((resolve) => {
      release = () => resolve('token');
    });

    const result = withKeepAlive(() => pending, 20_000);

    // A user at the IdP for 70s would previously have had the worker reaped.
    await vi.advanceTimersByTimeAsync(70_000);
    expect(chrome.runtime.getPlatformInfo).toHaveBeenCalledTimes(3);

    release();
    await expect(result).resolves.toBe('token');
  });

  it('stops pinging once the operation resolves', async () => {
    await withKeepAlive(async () => 'done', 20_000);
    const callsAtFinish = vi.mocked(chrome.runtime.getPlatformInfo).mock.calls.length;

    await vi.advanceTimersByTimeAsync(120_000);
    expect(chrome.runtime.getPlatformInfo).toHaveBeenCalledTimes(callsAtFinish);
  });

  it('stops pinging when the operation rejects, and propagates the error', async () => {
    await expect(
      withKeepAlive(async () => {
        throw new Error('auth_url failed');
      }, 20_000),
    ).rejects.toThrow('auth_url failed');

    const callsAtFinish = vi.mocked(chrome.runtime.getPlatformInfo).mock.calls.length;
    await vi.advanceTimersByTimeAsync(120_000);
    expect(chrome.runtime.getPlatformInfo).toHaveBeenCalledTimes(callsAtFinish);
  });

  it('survives a callback-style getPlatformInfo that returns undefined', async () => {
    // Chrome < 116 returns undefined instead of a promise.
    vi.mocked(chrome.runtime.getPlatformInfo).mockReturnValue(undefined as never);

    let release!: () => void;
    const pending = new Promise<string>((resolve) => {
      release = () => resolve('token');
    });
    const result = withKeepAlive(() => pending, 20_000);

    await vi.advanceTimersByTimeAsync(45_000);
    expect(chrome.runtime.getPlatformInfo).toHaveBeenCalledTimes(2);

    release();
    await expect(result).resolves.toBe('token');

    vi.mocked(chrome.runtime.getPlatformInfo).mockResolvedValue({ os: 'mac' } as never);
  });

  it('does not fail the operation when a ping rejects', async () => {
    vi.mocked(chrome.runtime.getPlatformInfo).mockRejectedValue(new Error('worker going away'));

    let release!: () => void;
    const pending = new Promise<string>((resolve) => {
      release = () => resolve('token');
    });
    const result = withKeepAlive(() => pending, 20_000);

    await vi.advanceTimersByTimeAsync(45_000);
    release();
    await expect(result).resolves.toBe('token');

    vi.mocked(chrome.runtime.getPlatformInfo).mockResolvedValue({ os: 'mac' } as never);
  });
});
