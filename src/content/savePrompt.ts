import promptCSS from '../styles/content.css?inline';
import { savePmSecret, listPmPasswordPolicies, generatePmPassword } from './messaging';

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
  // Only one banner at a time
  hideSavePrompt();

  const root = ensureHost();

  // Mutable password — may be replaced by the generator
  let password = capturedPassword;

  const banner = document.createElement('div');
  banner.id = 'vault-save-banner';
  banner.className = 'vault-save-banner';
  // Wider banner to accommodate the extra fields
  banner.style.cssText = 'flex-direction: column; align-items: stretch; gap: 8px; min-width: 280px;';

  // ── Header row ──────────────────────────────────────────────────────────
  const headerRow = document.createElement('div');
  headerRow.style.cssText = 'display: flex; align-items: center; gap: 8px;';

  const icon = document.createElement('span');
  icon.className = 'vault-save-icon';
  icon.setAttribute('aria-hidden', 'true');
  icon.textContent = '🔑';
  headerRow.appendChild(icon);

  const title = document.createElement('span');
  title.className = 'vault-save-title';
  title.textContent = 'Save to Vault?';
  title.style.flex = '1';
  headerRow.appendChild(title);

  const dismissBtn = document.createElement('button');
  dismissBtn.className = 'vault-save-btn vault-save-btn-ghost';
  dismissBtn.textContent = '✕';
  dismissBtn.setAttribute('aria-label', 'Dismiss');
  dismissBtn.addEventListener('click', hideSavePrompt);
  headerRow.appendChild(dismissBtn);

  banner.appendChild(headerRow);

  // ── Label field ─────────────────────────────────────────────────────────
  const defaultLabel = new URL(window.location.href).hostname;

  const labelRow = document.createElement('div');
  labelRow.style.cssText = 'display: flex; flex-direction: column; gap: 2px;';

  const labelLbl = document.createElement('label');
  labelLbl.textContent = 'Label';
  labelLbl.style.cssText = 'font-size: 11px; color: var(--color-text-muted, #666);';
  labelRow.appendChild(labelLbl);

  const labelInput = document.createElement('input');
  labelInput.type = 'text';
  labelInput.value = defaultLabel;
  labelInput.placeholder = 'e.g. github.com';
  labelInput.style.cssText = 'font-size: 12px; padding: 4px 6px; border-radius: 4px; border: 1px solid var(--color-border, #ccc); background: var(--color-input-bg, #fff); color: var(--color-text, #000); width: 100%;';
  labelRow.appendChild(labelInput);
  banner.appendChild(labelRow);

  // ── Username (read-only display) ─────────────────────────────────────────
  const userRow = document.createElement('div');
  userRow.style.cssText = 'font-size: 11px; color: var(--color-text-muted, #666);';
  userRow.textContent = `Username: ${username || '(none)'}`;
  banner.appendChild(userRow);

  // ── Generate password row ────────────────────────────────────────────────
  const generateRow = document.createElement('div');
  generateRow.style.cssText = 'display: flex; align-items: center; gap: 6px; flex-wrap: wrap;';

  const generateLink = document.createElement('button');
  generateLink.className = 'vault-save-btn vault-save-btn-ghost';
  generateLink.textContent = 'Generate password…';
  generateLink.style.fontSize = '11px';
  generateRow.appendChild(generateLink);

  // Policy picker (hidden until Generate is clicked)
  const policySelect = document.createElement('select');
  policySelect.style.cssText = 'display: none; font-size: 11px; padding: 2px 4px; border-radius: 4px; border: 1px solid var(--color-border, #ccc); background: var(--color-input-bg, #fff); color: var(--color-text, #000);';
  generateRow.appendChild(policySelect);

  const generatedDisplay = document.createElement('span');
  generatedDisplay.style.cssText = 'display: none; font-size: 11px; font-family: monospace; color: var(--color-text-muted, #666); word-break: break-all;';
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
  actions.style.cssText = 'display: flex; gap: 6px; padding-top: 4px;';

  const saveBtn = document.createElement('button');
  saveBtn.className = 'vault-save-btn vault-save-btn-primary';
  saveBtn.textContent = 'Save';
  saveBtn.addEventListener('click', () =>
    void handleSave(banner, saveBtn, username, () => password, labelInput),
  );
  actions.appendChild(saveBtn);

  banner.appendChild(actions);

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
    status.className = 'vault-save-success';
    status.style.color = '#f85149';
    status.textContent = `Error: ${String(err)}`;
    banner.appendChild(status);
    return;
  }

  // Show "Saved!" confirmation and auto-dismiss after 2 s
  saveBtn.remove();
  const status = document.createElement('span');
  status.className = 'vault-save-success';
  status.textContent = 'Saved!';
  banner.appendChild(status);

  setTimeout(hideSavePrompt, 2000);
}
