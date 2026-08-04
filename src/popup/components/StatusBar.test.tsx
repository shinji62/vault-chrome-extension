import { describe, it, expect, vi, beforeAll } from 'vitest';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import { StatusBar } from './StatusBar';
import { VaultClient } from '../../api/vaultClient';

beforeAll(() => {
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
});

function makeClient(listNamespaces: () => Promise<string[]>): VaultClient {
  // Only listNamespaces is exercised by the namespace picker.
  return { listNamespaces } as unknown as VaultClient;
}

function render(element: React.ReactElement): HTMLElement {
  const host = document.createElement('div');
  document.body.appendChild(host);
  act(() => {
    createRoot(host).render(element);
  });
  return host;
}

describe('StatusBar namespace picker', () => {
  it('shows the parent-namespace arrow in secrets mode below the root namespace', async () => {
    const onChange = vi.fn();
    const host = render(
      <StatusBar
        connected
        client={makeClient(() => Promise.resolve([]))}
        namespace="admin/team-a"
        rootNamespace="admin"
        tokenInfo={null}
        onNamespaceChange={onChange}
        onOpenSettings={() => {}}
      />,
    );

    // Wait for the namespaces effect to settle.
    await act(async () => {});

    const parentBtn = host.querySelector('button[aria-label="Go to parent namespace"]');
    expect(parentBtn).not.toBeNull();

    act(() => parentBtn!.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    expect(onChange).toHaveBeenCalledWith('admin');
  });

  it('hides the parent-namespace arrow at the root namespace', async () => {
    const host = render(
      <StatusBar
        connected
        client={makeClient(() => Promise.resolve([]))}
        namespace="admin"
        rootNamespace="admin"
        tokenInfo={null}
        onNamespaceChange={() => {}}
        onOpenSettings={() => {}}
      />,
    );
    await act(async () => {});

    expect(host.querySelector('button[aria-label="Go to parent namespace"]')).toBeNull();
  });

  it('renders the PM namespace as read-only text in passwords mode', async () => {
    const host = render(
      <StatusBar
        connected
        client={makeClient(() => Promise.resolve([]))}
        namespace="admin/team-a"
        rootNamespace="admin"
        pmNamespace="admin/passwords"
        mode="passwords"
        tokenInfo={null}
        onNamespaceChange={() => {}}
        onOpenSettings={() => {}}
      />,
    );
    await act(async () => {});

    const picker = host.querySelector('.ns-picker-wrapper');
    expect(picker).not.toBeNull();
    expect(picker!.textContent).toContain('admin/passwords');
    expect(host.querySelector('select')).toBeNull();
    expect(host.querySelector('button[aria-label="Go to parent namespace"]')).toBeNull();
  });
});
