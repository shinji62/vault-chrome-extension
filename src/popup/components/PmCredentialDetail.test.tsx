import { describe, it, expect, vi, beforeAll } from 'vitest';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import { PmCredentialDetail } from './PmCredentialDetail';
import { VaultClient } from '../../api/vaultClient';
import { FILL_CREDENTIALS } from '../../types/messages';

beforeAll(() => {
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
  const chromeMock = (globalThis as Record<string, unknown>).chrome as Record<string, unknown>;
  chromeMock.tabs = {
    query: vi.fn().mockResolvedValue([{ id: 123 }]),
    sendMessage: vi.fn().mockResolvedValue(undefined),
  };
});

function makeClient(): VaultClient {
  return {
    readSecret: vi.fn().mockResolvedValue({ username: 'alice', password: 's3cret' }),
    readMetadata: vi.fn().mockResolvedValue({ data: { custom_metadata: {} } }),
    deleteSecret: vi.fn(),
  } as unknown as VaultClient;
}

function render(element: React.ReactElement): HTMLElement {
  const host = document.createElement('div');
  document.body.appendChild(host);
  act(() => {
    createRoot(host).render(element);
  });
  return host;
}

describe('PmCredentialDetail fill', () => {
  it('sends FILL_CREDENTIALS with the secret username and password to the active tab', async () => {
    const client = makeClient();
    const host = render(
      <PmCredentialDetail
        client={client}
        mount="secret"
        path="password-manager/ent-1/Example"
        onBack={() => {}}
        onEdit={() => {}}
        onDelete={() => {}}
      />,
    );

    // Let the secret/metadata effect settle.
    await act(async () => {});

    const fillBtn = host.querySelector('button[aria-label="Fill credentials into active tab"]');
    expect(fillBtn).not.toBeNull();

    act(() => fillBtn!.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    await act(async () => {});

    const chromeMock = (globalThis as Record<string, unknown>).chrome as Record<string, unknown>;
    const sendMessage = (chromeMock.tabs as { sendMessage: ReturnType<typeof vi.fn> }).sendMessage;
    expect(sendMessage).toHaveBeenCalledWith(123, {
      type: FILL_CREDENTIALS,
      username: 'alice',
      password: 's3cret',
    });
  });
});
