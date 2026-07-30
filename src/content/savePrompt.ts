import promptCSS from '../styles/content.css?inline';
import { searchSecretsByUrl, saveSecret } from './messaging';

const PROMPT_CSS = `:host { all: initial; display: contents; }\n${promptCSS}`;

// ---------------------------------------------------------------------------
// Module-level Shadow DOM host
// ---------------------------------------------------------------------------

let saveHost: HTMLDivElement | null = null;
let shadowRoot: ShadowRoot | null = null;

function ensureHost(): ShadowRoot {
  if (saveHost && shadowRoot) return shadowRoot;

  saveHost = document.createElement('div');
  saveHost.id = 'vault-save-host';
  saveHost.style.cssText = 'all: unset; position: fixed; top: 0; left: 0; width: 0; height: 0;';
  document.body.appendChild(saveHost);

  shadowRoot = saveHost.attachShadow({ mode: 'open' });

  const style = document.createElement('style');
  style.textContent = PROMPT_CSS;
  shadowRoot.appendChild(style);

  return shadowRoot;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function showSavePrompt(username: string, password: string): void {
  // Only one banner at a time
  hideSavePrompt();

  const root = ensureHost();

  const banner = document.createElement('div');
  banner.id = 'vault-save-banner';

  const message = document.createElement('span');
  message.className = 'vault-save-message';
  message.innerHTML = `Save password for <span class="vault-save-username">${escapeHtml(username)}</span> to Vault?`;
  banner.appendChild(message);

  const saveBtn = document.createElement('button');
  saveBtn.className = 'vault-btn-save';
  saveBtn.textContent = 'Save';
  saveBtn.addEventListener('click', () => void handleSave(banner, saveBtn, username, password));
  banner.appendChild(saveBtn);

  const dismissBtn = document.createElement('button');
  dismissBtn.className = 'vault-btn-dismiss';
  dismissBtn.textContent = 'Dismiss';
  dismissBtn.addEventListener('click', hideSavePrompt);
  banner.appendChild(dismissBtn);

  root.appendChild(banner);
}

export function hideSavePrompt(): void {
  if (!shadowRoot) return;
  const banner = shadowRoot.getElementById('vault-save-banner');
  if (banner) banner.remove();
}

// ---------------------------------------------------------------------------
// Save handler
// ---------------------------------------------------------------------------

async function handleSave(
  banner: HTMLDivElement,
  saveBtn: HTMLButtonElement,
  username: string,
  password: string,
): Promise<void> {
  saveBtn.disabled = true;
  saveBtn.textContent = 'Saving…';

  const hostname = new URL(window.location.href).hostname;
  const path = `passwords/${hostname}`;

  // Try to use the mount from an existing matching secret; fall back to 'secret'
  let mount = 'secret';
  try {
    const matches = await searchSecretsByUrl(window.location.href);
    if (matches.length > 0) {
      mount = matches[0].mount;
    }
  } catch {
    // Keep default mount
  }

  try {
    await saveSecret(mount, path, username, password, window.location.href);
  } catch (err) {
    saveBtn.disabled = false;
    saveBtn.textContent = 'Save';
    const status = document.createElement('span');
    status.className = 'vault-save-status';
    status.style.color = '#f85149';
    status.textContent = `Error: ${String(err)}`;
    banner.appendChild(status);
    return;
  }

  // Show "Saved!" confirmation and auto-dismiss after 2 s
  saveBtn.remove();
  const status = document.createElement('span');
  status.className = 'vault-save-status';
  status.textContent = 'Saved!';
  banner.appendChild(status);

  setTimeout(hideSavePrompt, 2000);
}

// ---------------------------------------------------------------------------
// Utility
// ---------------------------------------------------------------------------

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
