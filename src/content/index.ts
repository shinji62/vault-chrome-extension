import {
  detectLoginForms,
  observeForms,
  LoginForm,
  isSubmitControl,
  findRelatedLoginForm,
  isRendered,
} from './formDetector';
import { attachFillOverlay, detachAllOverlays } from './fillOverlay';
import { showSavePrompt, hideSavePrompt } from './savePrompt';
import {
  searchPmSecretsByUrl,
  storePmPendingSave,
  getPmPendingSave,
  clearPmPendingSave,
  storePmPendingUsername,
  getPmPendingUsername,
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

/**
 * Remember the username typed on the first step of a multi-page login (a page
 * with a username/email field but no password field). On the later password
 * page the saved username is paired with the entered password when offering to
 * save (see maybeShowPendingSave).
 */
function attachUsernameRecorder(): void {
  // Same-page forms capture the username from the form directly — only record
  // on pages that have a username-like field but no password field.
  if (detectLoginForms().length > 0) return;

  const hostname = window.location.hostname;
  const inputs = Array.from(
    document.querySelectorAll<HTMLInputElement>(
      'input[type="text"], input[type="email"], input[type="tel"], input:not([type])',
    ),
  ).filter((el) => el.offsetParent !== null); // visible only

  if (inputs.length === 0) return;

  const record = (value: string): void => {
    const u = value.trim();
    if (!u) return;
    void storePmPendingUsername(u, hostname).catch(() => {
      // Background not ready — nothing to persist.
    });
  };

  for (const input of inputs) {
    // Persist on every keystroke so the value is recorded even if the user
    // immediately clicks "Next" and the page navigates (no blur/change fired).
    input.addEventListener('input', () => record(input.value));
    input.addEventListener('change', () => record(input.value));
  }
}

function attachSubmitListener(loginForm: LoginForm): void {
  const { form, passwordField } = loginForm;

  if (submittedFields.has(passwordField)) return;
  submittedFields.add(passwordField);

  const recordSubmit = (): void => {
    captureCredentials(loginForm);
  };

  // Real <form> submit (fires on Enter and on submit-button click).
  const submitTarget: EventTarget = form ?? passwordField;
  submitTarget.addEventListener('submit', recordSubmit, { capture: true });

  // Form-less login widgets (a <div> of inputs plus a click handler that
  // navigates, e.g. practicetestautomation.com) never dispatch a submit event.
  // Capture the click and the Enter keypress on the submit control first, so
  // the credentials are read before the page's own handler runs.
  if (!form || passwordField.closest('form') === null) {
    attachWidgetCapture(passwordField);
  }
}

const widgetCaptured = new WeakSet<HTMLElement>();

/**
 * Listen for clicks on a login submit control and Enter inside a password
 * field, then capture the credentials. The listeners run on the capture phase
 * at `document` level so they fire *before* the page's own handler clears the
 * fields and navigates away.
 */
function attachWidgetCapture(passwordField: HTMLInputElement): void {
  if (widgetCaptured.has(passwordField)) return;
  widgetCaptured.add(passwordField);

  document.addEventListener(
    'click',
    (e) => {
      const t = e.target instanceof Element ? e.target : null;
      if (!t) return;
      // A click may land on an element inside the control (an icon or span);
      // walk up to the nearest button-like ancestor before classifying it.
      const control =
        (t.closest('button, [role="button"], input[type="submit"], input[type="button"]') as
          | Element
          | null) ?? t;
      if (!isSubmitControl(control)) return;
      const forms = detectLoginForms();
      const loginForm = findRelatedLoginForm(control, forms);
      if (!loginForm || loginForm.passwordField !== passwordField) return;
      captureCredentials(loginForm);
    },
    { capture: true },
  );

  document.addEventListener(
    'keydown',
    (e) => {
      if (e.key !== 'Enter' || !isRendered(passwordField)) return;
      const active = document.activeElement;
      if (active !== passwordField) return;
      const forms = detectLoginForms();
      const loginForm = findRelatedLoginForm(passwordField, forms);
      if (!loginForm) return;
      captureCredentials(loginForm);
    },
    { capture: true },
  );
}

function captureCredentials(loginForm: LoginForm): void {
  const { usernameField, passwordField } = loginForm;

  // Capture values at submit time (before the page potentially navigates)
  const username = usernameField?.value ?? '';
  const password = passwordField.value;

  if (!password) return; // nothing to save

  // Persist for the "save after login" flow. getPmPendingSave matches on this
  // tab, so a full-page navigation keeps the credentials long enough for the
  // post-login document to show the prompt.
  void storePmPendingSave(username, password).catch(() => {
    // Background not ready — the auto-save prompt simply won't appear.
  });

  // Full-page logins unload this document before the timer fires, so the prompt
  // shows on the destination page's entry check. On a same-page login the timer
  // runs and the prompt is shown — provided the login form actually left the
  // page (guarded inside maybeShowPendingSave, so a failed login offers nothing).
  setTimeout(() => {
    void maybeShowPendingSave();
  }, SPA_SAVE_DELAY_MS);
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

  // A still-rendered password field means the login did not succeed and this
  // page did not navigate — don't offer to save a login that never happened.
  // (On the real destination page after a full-page navigation there is no
  // login form left, so this check lets the genuine prompt through.)
  if (detectLoginForms().length > 0) return;

  let username = pending.username;
  // Multi-page login (e.g. username on one page, password on the next): the
  // password page has no username field, so pair the captured password with the
  // username typed on the earlier step.
  if (!username) {
    try {
      const pu = await getPmPendingUsername();
      if (pu && pu.hostname === window.location.hostname) username = pu.username;
    } catch {
      // Background not ready — proceed without a username.
    }
  }

  try {
    const matches = await searchPmSecretsByUrl(window.location.href);
    const normalize = (u: string): string => u.trim().toLowerCase();
    // Only treat the credentials as already saved when the exact username is
    // already stored for this site — logging in with a different username on the
    // same site should still offer to save it.
    const alreadySaved = matches.some((m) => normalize(m.username) === normalize(username));
    if (alreadySaved) {
      // This username is already stored for this site — drop the pending copy.
      void clearPmPendingSave();
      return;
    }
  } catch {
    // Background not ready — leave the pending save in place.
    return;
  }

  hideSavePrompt();
  showSavePrompt(username, pending.password);
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

  // 2. On pages without a password field (username-first step of a multi-page
  //    login), remember the typed username so the password page can save it.
  attachUsernameRecorder();

  // 3. Observe DOM mutations for dynamically added forms (SPAs)
  observeForms((forms) => {
    wireLoginForms(forms);
  });

  // 4. If the user just submitted a login form that navigated to this page,
  //    show the prompt now that the (possibly form-less) page has loaded.
  void maybeShowPendingSave();
});
