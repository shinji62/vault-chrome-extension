import overlayCSS from '../styles/content.css?inline';
import { LoginForm } from './formDetector';
import { searchPmSecretsByUrl } from './messaging';
import { setNativeValue } from './domUtils';

interface PmMatch {
  mount: string;
  path: string;
  username: string;
  password: string;
}

const OVERLAY_CSS = `:host { all: initial; display: contents; }\n${overlayCSS}`;

// ---------------------------------------------------------------------------
// Key icon SVG
// ---------------------------------------------------------------------------

const KEY_SVG = `
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" aria-hidden="true">
    <path d="M12.65 10A6 6 0 1 0 12 15h1l1.5 1.5 1.5-1.5 1.5 1.5 1.5-1.5L21 17l-2-2v-3.5L12.65 10zM7 14a2 2 0 1 1 0-4 2 2 0 0 1 0 4z"/>
  </svg>
`;

// ---------------------------------------------------------------------------
// Per-field overlay tracker
// ---------------------------------------------------------------------------

interface OverlayEntry {
  loginForm: LoginForm;
  host: HTMLDivElement;
  shadowRoot: ShadowRoot;
  btn: HTMLButtonElement;
  dropdown: HTMLDivElement;
  cleanupFns: Array<() => void>;
}

const overlays = new Map<HTMLInputElement, OverlayEntry>();

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function attachFillOverlay(loginForm: LoginForm): void {
  const { passwordField } = loginForm;

  // Already attached
  if (overlays.has(passwordField)) return;

  // Create Shadow DOM host
  const host = document.createElement('div');
  host.id = 'vault-fill-host';
  host.style.cssText = 'all: unset; position: fixed; top: 0; left: 0; width: 0; height: 0;';
  document.body.appendChild(host);

  const shadowRoot = host.attachShadow({ mode: 'open' });

  // Inject styles
  const style = document.createElement('style');
  style.textContent = OVERLAY_CSS;
  shadowRoot.appendChild(style);

  // Key button
  const btn = document.createElement('button');
  btn.className = 'vault-fill-btn';
  btn.setAttribute('aria-label', 'Fill from Vault');
  btn.innerHTML = KEY_SVG;
  shadowRoot.appendChild(btn);

  // Dropdown panel
  const dropdown = document.createElement('div');
  dropdown.className = 'vault-dropdown';
  shadowRoot.appendChild(dropdown);

  const entry: OverlayEntry = {
    loginForm,
    host,
    shadowRoot,
    btn,
    dropdown,
    cleanupFns: [],
  };

  // Position the button next to the password field
  positionButton(btn, passwordField);

  // Keep position in sync with layout changes
  const resizeObserver = new ResizeObserver(() => positionButton(btn, passwordField));
  resizeObserver.observe(passwordField);
  const onScroll = (): void => positionButton(btn, passwordField);
  window.addEventListener('scroll', onScroll, { passive: true, capture: true });

  entry.cleanupFns.push(
    () => resizeObserver.disconnect(),
    () => window.removeEventListener('scroll', onScroll, { capture: true }),
  );

  // Toggle dropdown on button click
  const onBtnClick = (e: Event): void => {
    e.stopPropagation();
    void handleKeyBtnClick(entry);
  };
  btn.addEventListener('click', onBtnClick);
  entry.cleanupFns.push(() => btn.removeEventListener('click', onBtnClick));

  // Close dropdown when clicking outside
  const onDocClick = (): void => closeDropdown(entry);
  document.addEventListener('click', onDocClick, { capture: true });
  entry.cleanupFns.push(() => document.removeEventListener('click', onDocClick, { capture: true }));

  overlays.set(passwordField, entry);
}

export function detachAllOverlays(): void {
  for (const entry of overlays.values()) {
    entry.cleanupFns.forEach((fn) => fn());
    entry.host.remove();
  }
  overlays.clear();
}

// ---------------------------------------------------------------------------
// Overlay helpers
// ---------------------------------------------------------------------------

function positionButton(btn: HTMLButtonElement, field: HTMLInputElement): void {
  const rect = field.getBoundingClientRect();
  btn.style.top = `${rect.top + (rect.height - 22) / 2}px`;
  btn.style.left = `${rect.right + 4}px`;
}

function positionDropdown(dropdown: HTMLDivElement, btn: HTMLButtonElement): void {
  const btnRect = btn.getBoundingClientRect();
  dropdown.style.top = `${btnRect.bottom + 4}px`;
  dropdown.style.left = `${btnRect.left}px`;
}

function closeDropdown(entry: OverlayEntry): void {
  entry.dropdown.classList.remove('open');
  entry.dropdown.innerHTML = '';
}

/** Render the dropdown (positioned under the button) with the given content node. */
function openDropdown(entry: OverlayEntry, content: HTMLElement): void {
  const { dropdown, btn } = entry;
  dropdown.innerHTML = '';
  dropdown.appendChild(content);
  dropdown.classList.add('open');
  positionDropdown(dropdown, btn);
}

async function handleKeyBtnClick(entry: OverlayEntry): Promise<void> {
  const { dropdown, btn, loginForm } = entry;

  // Toggle off if already open
  if (dropdown.classList.contains('open')) {
    closeDropdown(entry);
    return;
  }

  // Reflect the in-flight search on the button so the UI stays responsive.
  btn.classList.add('vault-fill-btn-loading');
  btn.setAttribute('aria-busy', 'true');

  let matches: PmMatch[];
  try {
    matches = await searchPmSecretsByUrl(window.location.href);
  } catch (err) {
    btn.classList.remove('vault-fill-btn-loading');
    btn.removeAttribute('aria-busy');
    const error = document.createElement('div');
    error.className = 'vault-dropdown-empty';
    error.textContent = `Error: ${String(err)}`;
    openDropdown(entry, error);
    return;
  }

  btn.classList.remove('vault-fill-btn-loading');
  btn.removeAttribute('aria-busy');

  // Exactly one matching credential for this site — fill it directly so a single
  // click on the key autofills the correct username & password (no dropdown).
  if (matches.length === 1) {
    const ok = await fillCredentials(entry, matches[0], loginForm);
    if (!ok) {
      const error = document.createElement('div');
      error.className = 'vault-dropdown-empty';
      error.textContent =
        'Could not fill — this secret has no password (or it could not be read).';
      openDropdown(entry, error);
    }
    return;
  }

  dropdown.innerHTML = '';

  if (matches.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'vault-dropdown-empty';
    empty.textContent = 'No matching secrets in Vault';
    openDropdown(entry, empty);
    return;
  }

  const header = document.createElement('div');
  header.className = 'vault-dropdown-header';
  header.textContent = 'Vault Passwords';

  const body = document.createElement('div');
  body.appendChild(header);

  for (const match of matches) {
    const item = document.createElement('button');
    item.className = 'vault-dropdown-item';

    const usernameEl = document.createElement('span');
    usernameEl.className = 'vault-dropdown-username';
    usernameEl.textContent = match.username || '(no username)';
    item.appendChild(usernameEl);

    const pathEl = document.createElement('span');
    pathEl.className = 'vault-dropdown-path';
    pathEl.textContent = match.path;
    item.appendChild(pathEl);

    item.addEventListener('click', (e) => {
      e.stopPropagation();
      void fillCredentials(entry, match, loginForm);
    });
    body.appendChild(item);
  }

  openDropdown(entry, body);
}

async function fillCredentials(
  entry: OverlayEntry,
  match: PmMatch,
  loginForm: LoginForm,
): Promise<boolean> {
  closeDropdown(entry);

  const { usernameField, passwordField } = loginForm;
  // The matches returned by the PM search already carry the decrypted password
  // (read via the PM client), so no extra round-trip is needed here.
  const password = match.password ?? '';

  if (!password) return false;
  if (usernameField && match.username) {
    setNativeValue(usernameField, match.username);
  }
  setNativeValue(passwordField, password);
  return true;
}

