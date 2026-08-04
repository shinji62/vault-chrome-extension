import promptCSS from '../styles/content.css?inline';
import { savePmSecret, listPmPasswordPolicies, generatePmPassword, clearPmPendingSave } from './messaging';

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

export function showSavePrompt(username: string, capturedPassword: string): void {
  // Only one prompt at a time
  hideSavePrompt();

  const root = ensureHost();

  // Mutable password — may be replaced by the generator
  let password = capturedPassword;

  // Dismiss removes the prompt and forgets the pending credentials so the
  // prompt is not re-shown on a later visit to the site.
  const dismiss = (): void => {
    hideSavePrompt();
    void clearPmPendingSave();
  };

  // ── Backdrop (modal scrim + centering) ──────────────────────────────────
  const backdrop = document.createElement('div');
  backdrop.id = 'vault-save-backdrop';
  backdrop.className = 'vault-save-backdrop';
  backdrop.addEventListener('click', (e) => {
    if (e.target === backdrop) dismiss();
  });

  const banner = document.createElement('div');
  banner.id = 'vault-save-banner';
  banner.className = 'vault-save-banner';

  // ── Header row ──────────────────────────────────────────────────────────
  const headerRow = document.createElement('div');
  headerRow.className = 'vault-save-header';

  const icon = document.createElement('span');
  icon.className = 'vault-save-icon';
  icon.setAttribute('aria-hidden', 'true');
  icon.textContent = '🔑';
  headerRow.appendChild(icon);

  const title = document.createElement('span');
  title.className = 'vault-save-title';
  title.textContent = 'Save to Vault?';

  const subtitle = document.createElement('small');
  subtitle.textContent = `Add password for ${new URL(window.location.href).hostname}`;
  title.appendChild(subtitle);
  headerRow.appendChild(title);

  const dismissBtn = document.createElement('button');
  dismissBtn.type = 'button';
  dismissBtn.className = 'vault-save-close';
  dismissBtn.textContent = '✕';
  dismissBtn.setAttribute('aria-label', 'Dismiss');
  dismissBtn.addEventListener('click', dismiss);
  headerRow.appendChild(dismissBtn);

  banner.appendChild(headerRow);

  // ── Label field ─────────────────────────────────────────────────────────
  const defaultLabel = new URL(window.location.href).hostname;

  const labelRow = document.createElement('div');
  labelRow.className = 'vault-save-field';

  const labelLbl = document.createElement('label');
  labelLbl.className = 'vault-save-label';
  labelLbl.textContent = 'Label';
  labelRow.appendChild(labelLbl);

  const labelInput = document.createElement('input');
  labelInput.type = 'text';
  labelInput.className = 'vault-save-input';
  labelInput.value = defaultLabel;
  labelInput.placeholder = 'e.g. github.com';
  labelRow.appendChild(labelInput);
  banner.appendChild(labelRow);

  // ── Username (read-only display) ─────────────────────────────────────────
  const userRow = document.createElement('div');
  userRow.className = 'vault-save-user';

  const userTag = document.createElement('span');
  userTag.className = 'vault-save-user-tag';
  userTag.textContent = 'User';
  userRow.appendChild(userTag);

  const userVal = document.createElement('span');
  userVal.textContent = username || '(none)';
  userRow.appendChild(userVal);
  banner.appendChild(userRow);

  // ── Generate password row ────────────────────────────────────────────────
  const generateRow = document.createElement('div');
  generateRow.className = 'vault-save-gen';

  const generateLink = document.createElement('button');
  generateLink.type = 'button';
  generateLink.className = 'vault-save-gen-link';
  generateLink.textContent = 'Generate password…';
  generateRow.appendChild(generateLink);

  // Policy picker (hidden until Generate is clicked)
  const policySelect = document.createElement('select');
  policySelect.className = 'vault-save-gen-select';
  policySelect.style.display = 'none';
  generateRow.appendChild(policySelect);

  const generatedDisplay = document.createElement('span');
  generatedDisplay.className = 'vault-save-gen-display';
  generatedDisplay.style.display = 'none';
  generateRow.appendChild(generatedDisplay);

  generateLink.addEventListener('click', () => {
    void (async () => {
      generateLink.disabled = true;
      generateLink.textContent = 'Loading policies…';
      let policies: string[];
      try {
        policies = await listPmPasswordPolicies();
      } catch {
        generateLink.textContent = 'Error loading policies';
        generateLink.disabled = false;
        return;
      }
      if (policies.length === 0) {
        generateLink.textContent = 'No password policies in Vault';
        generateLink.disabled = false;
        return;
      }
      // Populate and show the select
      policySelect.innerHTML = '';
      for (const p of policies) {
        const opt = document.createElement('option');
        opt.value = p;
        opt.textContent = p;
        policySelect.appendChild(opt);
      }
      policySelect.style.display = '';
      generateLink.textContent = 'Generate';
      generateLink.disabled = false;

      // On policy select: generate immediately on change, or on button re-click
      const doGenerate = async () => {
        generateLink.disabled = true;
        generateLink.textContent = 'Generating…';
        try {
          const generated = await generatePmPassword(policySelect.value);
          password = generated;
          generatedDisplay.textContent = `Generated: ${generated}`;
          generatedDisplay.style.display = '';
        } catch {
          generatedDisplay.textContent = 'Generation failed';
          generatedDisplay.style.display = '';
        }
        generateLink.textContent = 'Regenerate';
        generateLink.disabled = false;
      };

      policySelect.addEventListener('change', () => void doGenerate());
      generateLink.addEventListener('click', () => void doGenerate(), { once: false });
      // Trigger immediately for the default selected policy
      void doGenerate();
    })();
  });

  banner.appendChild(generateRow);

  // ── Action buttons ───────────────────────────────────────────────────────
  const actions = document.createElement('div');
  actions.className = 'vault-save-actions';

  const saveBtn = document.createElement('button');
  saveBtn.type = 'button';
  saveBtn.className = 'vault-save-btn vault-save-btn-primary';
  saveBtn.textContent = 'Save';
  saveBtn.addEventListener('click', () =>
    void handleSave(banner, saveBtn, username, () => password, labelInput),
  );
  actions.appendChild(saveBtn);

  banner.appendChild(actions);

  backdrop.appendChild(banner);
  root.appendChild(backdrop);
}

export function hideSavePrompt(): void {
  if (!shadowRoot) return;
  const backdrop = shadowRoot.getElementById('vault-save-backdrop');
  if (backdrop) backdrop.remove();
}

// ---------------------------------------------------------------------------
// Save handler
// ---------------------------------------------------------------------------

async function handleSave(
  banner: HTMLDivElement,
  saveBtn: HTMLButtonElement,
  username: string,
  getPassword: () => string,
  labelInput: HTMLInputElement,
): Promise<void> {
  saveBtn.disabled = true;
  saveBtn.textContent = 'Saving…';

  const label = labelInput.value.trim() || new URL(window.location.href).hostname;

  try {
    await savePmSecret(username, getPassword(), window.location.href, label);
  } catch (err) {
    saveBtn.disabled = false;
    saveBtn.textContent = 'Save';
    const status = document.createElement('span');
    status.className = 'vault-save-error';
    const icon = document.createElement('span');
    icon.className = 'vault-save-status-icon';
    icon.setAttribute('aria-hidden', 'true');
    icon.textContent = '✕';
    status.appendChild(icon);
    status.appendChild(document.createTextNode(`Error: ${String(err)}`));
    banner.appendChild(status);
    return;
  }

  // Credentials are stored — forget the pending save so the prompt is not
  // re-shown on a later visit to the site.
  void clearPmPendingSave();

  // Show "Saved!" confirmation and auto-dismiss after 2 s
  saveBtn.remove();
  const status = document.createElement('span');
  status.className = 'vault-save-success';
  const icon = document.createElement('span');
  icon.className = 'vault-save-status-icon';
  icon.setAttribute('aria-hidden', 'true');
  icon.textContent = '✓';
  status.appendChild(icon);
  status.appendChild(document.createTextNode('Saved!'));
  banner.appendChild(status);

  setTimeout(hideSavePrompt, 2000);
}
