/**
 * In-page consent UI for the software authenticator.
 *
 * A real authenticator asks the user before it creates a credential or asserts
 * one, and the browser's own dialog is bypassed here because
 * `navigator.credentials` is intercepted. Without these prompts registration
 * happens silently and `get()` picks an identity on the user's behalf.
 *
 * Rendered in a closed-ish Shadow DOM host so page styles cannot reach in, in
 * the isolated world (the MAIN-world hook cannot use chrome.* APIs).
 */
import promptCSS from '../styles/content.css?inline';
import { WebAuthnChoice } from '../types/messages';

const PROMPT_CSS = `:host { all: initial; display: contents; }\n${promptCSS}`;

let host: HTMLDivElement | null = null;
let shadowRoot: ShadowRoot | null = null;

function ensureHost(): ShadowRoot {
  if (host && shadowRoot) return shadowRoot;

  host = document.createElement('div');
  host.id = 'vault-webauthn-host';
  host.style.cssText = 'all: unset; position: fixed; top: 0; left: 0; width: 0; height: 0;';
  document.body.appendChild(host);

  shadowRoot = host.attachShadow({ mode: 'open' });
  const style = document.createElement('style');
  style.textContent = PROMPT_CSS;
  shadowRoot.appendChild(style);
  return shadowRoot;
}

function closePrompt(): void {
  if (!shadowRoot) return;
  shadowRoot.getElementById('vault-wa-backdrop')?.remove();
}

/** Shared chrome: scrim + card + header, plus wiring for the dismiss paths. */
function buildDialog(
  title: string,
  subtitle: string,
  onCancel: () => void,
): { backdrop: HTMLDivElement; card: HTMLDivElement } {
  const backdrop = document.createElement('div');
  backdrop.id = 'vault-wa-backdrop';
  backdrop.className = 'vault-save-backdrop';
  backdrop.addEventListener('click', (e) => {
    if (e.target === backdrop) onCancel();
  });

  const card = document.createElement('div');
  card.className = 'vault-save-banner';
  // Focusable so Escape is caught even before the user tabs to a control.
  card.tabIndex = -1;
  card.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      onCancel();
    }
  });

  const header = document.createElement('div');
  header.className = 'vault-save-header';

  const icon = document.createElement('span');
  icon.className = 'vault-save-icon';
  icon.setAttribute('aria-hidden', 'true');
  icon.textContent = '🔐';
  header.appendChild(icon);

  const titleEl = document.createElement('span');
  titleEl.className = 'vault-save-title';
  titleEl.textContent = title;
  const sub = document.createElement('small');
  sub.textContent = subtitle;
  titleEl.appendChild(sub);
  header.appendChild(titleEl);

  const closeBtn = document.createElement('button');
  closeBtn.type = 'button';
  closeBtn.className = 'vault-save-close';
  closeBtn.textContent = '✕';
  closeBtn.setAttribute('aria-label', 'Cancel');
  closeBtn.addEventListener('click', onCancel);
  header.appendChild(closeBtn);

  card.appendChild(header);
  backdrop.appendChild(card);
  return { backdrop, card };
}

/**
 * Asks permission to create a passkey and lets the user name it.
 *
 * Resolves with the chosen label, or null when the user declines. A null result
 * means "the user said no" and must be surfaced as NotAllowedError rather than
 * as a fallback to the platform authenticator.
 */
export function confirmPasskeyCreate(input: {
  rpId: string;
  userName?: string;
  suggestedLabel: string;
}): Promise<{ label: string } | null> {
  closePrompt();
  const root = ensureHost();

  return new Promise((resolve) => {
    const settle = (value: { label: string } | null): void => {
      closePrompt();
      resolve(value);
    };

    const { backdrop, card } = buildDialog(
      'Create a passkey?',
      `${input.rpId} wants to register a passkey in Vault`,
      () => settle(null),
    );

    const account = document.createElement('div');
    account.className = 'vault-save-user';
    const tag = document.createElement('span');
    tag.className = 'vault-save-user-tag';
    tag.textContent = 'Account';
    account.appendChild(tag);
    const accountVal = document.createElement('span');
    accountVal.textContent = input.userName?.trim() || '(no username)';
    account.appendChild(accountVal);
    card.appendChild(account);

    const field = document.createElement('div');
    field.className = 'vault-save-field';
    const label = document.createElement('label');
    label.className = 'vault-save-label';
    label.textContent = 'Name in Vault';
    field.appendChild(label);
    const input$ = document.createElement('input');
    input$.type = 'text';
    input$.className = 'vault-save-input';
    input$.value = input.suggestedLabel;
    label.htmlFor = 'vault-wa-label';
    input$.id = 'vault-wa-label';
    field.appendChild(input$);
    card.appendChild(field);

    const actions = document.createElement('div');
    actions.className = 'vault-save-actions';

    const create = document.createElement('button');
    create.type = 'button';
    create.className = 'vault-save-btn vault-save-btn-primary';
    create.textContent = 'Create passkey';
    const submit = (): void => {
      const chosen = input$.value.trim() || input.suggestedLabel;
      create.disabled = true;
      create.textContent = 'Creating…';
      settle({ label: chosen });
    };
    create.addEventListener('click', submit);
    input$.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') submit();
    });
    actions.appendChild(create);

    const cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.className = 'vault-save-btn vault-save-btn-ghost';
    cancel.textContent = 'Not now';
    cancel.addEventListener('click', () => settle(null));
    actions.appendChild(cancel);

    card.appendChild(actions);
    root.appendChild(backdrop);
    create.focus();
  });
}

/**
 * Lets the user pick which stored passkey to sign in with.
 *
 * Resolves with the selected label, or null when the user dismisses the
 * chooser. Callers must never substitute a default for null.
 */
export function choosePasskey(
  rpId: string,
  choices: WebAuthnChoice[],
): Promise<{ label: string } | null> {
  closePrompt();
  const root = ensureHost();

  return new Promise((resolve) => {
    const settle = (value: { label: string } | null): void => {
      closePrompt();
      resolve(value);
    };

    const { backdrop, card } = buildDialog(
      'Choose a passkey',
      `Sign in to ${rpId} with Vault`,
      () => settle(null),
    );

    const list = document.createElement('div');
    list.className = 'vault-wa-list';
    list.setAttribute('role', 'listbox');

    choices.forEach((choice, index) => {
      const item = document.createElement('button');
      item.type = 'button';
      item.className = 'vault-wa-item';
      item.setAttribute('role', 'option');

      const name = document.createElement('span');
      name.className = 'vault-wa-item-user';
      name.textContent = choice.username?.trim() || '(no username)';
      item.appendChild(name);

      const meta = document.createElement('span');
      meta.className = 'vault-wa-item-label';
      meta.textContent = choice.label;
      item.appendChild(meta);

      item.addEventListener('click', () => settle({ label: choice.label }));
      list.appendChild(item);
      if (index === 0) setTimeout(() => item.focus(), 0);
    });

    card.appendChild(list);

    const actions = document.createElement('div');
    actions.className = 'vault-save-actions';
    const cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.className = 'vault-save-btn vault-save-btn-ghost';
    cancel.textContent = 'Cancel';
    cancel.addEventListener('click', () => settle(null));
    actions.appendChild(cancel);
    card.appendChild(actions);

    root.appendChild(backdrop);
  });
}
