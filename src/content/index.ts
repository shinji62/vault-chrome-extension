import { detectLoginForms, observeForms, LoginForm } from './formDetector';
import { attachFillOverlay, detachAllOverlays } from './fillOverlay';
import { showSavePrompt, hideSavePrompt } from './savePrompt';
import {
  searchPmSecretsByUrl,
  storePmPendingSave,
  getPmPendingSave,
  clearPmPendingSave,
} from './messaging';
import { FILL_CREDENTIALS } from '../types/messages';
import { setNativeValue } from './domUtils';
import { Settings } from '../types/settings';

// ---------------------------------------------------------------------------
// Submit listener — attached per form/field to avoid duplicates
// ---------------------------------------------------------------------------

const submittedFields = new WeakSet<HTMLInputElement>();

// Delay before showing the prompt on a same-page (SPA) submit. Long enough to
// let a full-page login navigation unload this document, so the prompt is only
// shown here when no navigation actually happened (see maybeShowPendingSave).
const SPA_SAVE_DELAY_MS = 600;

function attachSubmitListener(loginForm: LoginForm): void {
  const { form, usernameField, passwordField } = loginForm;

  if (submittedFields.has(passwordField)) return;
  submittedFields.add(passwordField);

  const submitTarget: EventTarget = form ?? passwordField;

  submitTarget.addEventListener(
    'submit',
    () => {
      // Capture values at submit time (before the page potentially navigates)
      const username = usernameField?.value ?? '';
      const password = passwordField.value;

      if (!password) return; // nothing to save

      // Persist for the "save after login" flow. getPmPendingSave matches on
      // this tab, so a full-page navigation keeps the credentials long enough
      // for the post-login document to show the prompt.
      void storePmPendingSave(username, password).catch(() => {
        // Background not ready — the auto-save prompt simply won't appear.
      });

      // SPA submit (no navigation): the document stays alive, so show now.
      setTimeout(() => {
        void maybeShowPendingSave();
      }, SPA_SAVE_DELAY_MS);
    },
    { capture: true },
  );
}

/**
 * Show the auto-save prompt if the user just submitted a login form for which
 * Vault has no matching secret. Called both after a same-page submit and on
 * every content-script load (so it survives a full-page login navigation).
 */
async function maybeShowPendingSave(): Promise<void> {
  let pending;
  try {
    pending = await getPmPendingSave();
  } catch {
    return; // background not ready — skip silently
  }
  if (!pending) return;

  try {
    const matches = await searchPmSecretsByUrl(window.location.href);
    if (matches.length > 0) {
      // A secret already exists for this site — drop the pending copy.
      void clearPmPendingSave();
      return;
    }
  } catch {
    // Background not ready — leave the pending save in place.
    return;
  }

  hideSavePrompt();
  showSavePrompt(pending.username, pending.password);
}

// ---------------------------------------------------------------------------
// Wire overlays for a list of detected forms
// ---------------------------------------------------------------------------

function wireLoginForms(forms: LoginForm[]): void {
  // Detach stale overlays and re-attach for current set
  detachAllOverlays();
  for (const form of forms) {
    attachFillOverlay(form);
    attachSubmitListener(form);
  }
}

// ---------------------------------------------------------------------------
// Push-fill listener (triggered by the popup via chrome.tabs.sendMessage)
// ---------------------------------------------------------------------------

chrome.runtime.onMessage.addListener((message: { type: string; username?: string; password?: string }) => {
  if (message.type !== FILL_CREDENTIALS) return;

  const forms = detectLoginForms();
  if (forms.length === 0) return;

  const { usernameField, passwordField } = forms[0];

  if (usernameField && message.username) {
    setNativeValue(usernameField, message.username);
  }
  if (message.password) {
    setNativeValue(passwordField, message.password);
  }
});

// ---------------------------------------------------------------------------
// Entry point — only activate PM overlays if pmNamespace is configured
// ---------------------------------------------------------------------------

chrome.storage.local.get(['vaultSettings'], (result) => {
  const settings = result['vaultSettings'] as Settings | undefined;

  // PM features require the Password Manager to be configured (pmNamespace and/or
  // pmMount). Match the popup's activation rule; if not configured stay silent.
  if (!settings || (!settings.pmNamespace && !settings.pmMount)) return;

  // 1. Detect initial login forms and wire them up
  const initialForms = detectLoginForms();
  wireLoginForms(initialForms);

  // 2. Observe DOM mutations for dynamically added forms (SPAs)
  observeForms((forms) => {
    wireLoginForms(forms);
  });

  // 3. If the user just submitted a login form that navigated to this page,
  //    show the prompt now that the (possibly form-less) page has loaded.
  void maybeShowPendingSave();
});
