import overlayCSS from '../styles/content.css?inline';
import { LoginForm } from './formDetector';
import { searchSecretsByUrl, getSecret } from './messaging';

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
  btn.id = 'vault-key-btn';
  btn.setAttribute('aria-label', 'Fill from Vault');
  btn.innerHTML = KEY_SVG;
  shadowRoot.appendChild(btn);

  // Dropdown panel
  const dropdown = document.createElement('div');
  dropdown.id = 'vault-dropdown';
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

function closeDropdown(entry: OverlayEntry): void {
  entry.dropdown.classList.remove('open');
  entry.dropdown.innerHTML = '';
}

async function handleKeyBtnClick(entry: OverlayEntry): Promise<void> {
  const { dropdown, btn, loginForm } = entry;

  // Toggle off if already open
  if (dropdown.classList.contains('open')) {
    closeDropdown(entry);
    return;
  }

  dropdown.innerHTML = '<div class="vault-dropdown-empty">Searching Vault…</div>';
  dropdown.classList.add('open');

  // Position dropdown below the button
  const btnRect = btn.getBoundingClientRect();
  dropdown.style.top = `${btnRect.bottom + 4}px`;
  dropdown.style.left = `${btnRect.left}px`;

  let matches: Array<{ mount: string; path: string; username: string }>;
  try {
    matches = await searchSecretsByUrl(window.location.href);
  } catch (err) {
    dropdown.innerHTML = `<div class="vault-dropdown-empty">Error: ${String(err)}</div>`;
    return;
  }

  dropdown.innerHTML = '';

  if (matches.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'vault-dropdown-empty';
    empty.textContent = 'No matching secrets in Vault';
    dropdown.appendChild(empty);
    return;
  }

  for (const match of matches) {
    const item = document.createElement('div');
    item.className = 'vault-dropdown-item';
    item.textContent = `${match.username} @ ${match.path}`;
    item.addEventListener('click', (e) => {
      e.stopPropagation();
      void fillCredentials(entry, match, loginForm);
    });
    dropdown.appendChild(item);
  }
}

async function fillCredentials(
  entry: OverlayEntry,
  match: { mount: string; path: string; username: string },
  loginForm: LoginForm,
): Promise<void> {
  closeDropdown(entry);

  let data: Record<string, string>;
  try {
    data = await getSecret(match.mount, match.path, 2);
  } catch {
    return;
  }

  const { usernameField, passwordField } = loginForm;
  const password = data['password'] ?? '';

  if (usernameField) {
    setNativeValue(usernameField, match.username);
  }
  setNativeValue(passwordField, password);
}

/**
 * Set the value on an input and fire `input` + `change` events so that
 * React / Vue / Angular form bindings update their internal state.
 */
function setNativeValue(field: HTMLInputElement, value: string): void {
  const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
    window.HTMLInputElement.prototype,
    'value',
  )?.set;
  if (nativeInputValueSetter) {
    nativeInputValueSetter.call(field, value);
  } else {
    field.value = value;
  }
  field.dispatchEvent(new Event('input', { bubbles: true }));
  field.dispatchEvent(new Event('change', { bubbles: true }));
}
