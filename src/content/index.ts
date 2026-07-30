import { detectLoginForms, observeForms, LoginForm } from './formDetector';
import { attachFillOverlay, detachAllOverlays } from './fillOverlay';
import { showSavePrompt, hideSavePrompt } from './savePrompt';
import { searchSecretsByUrl } from './messaging';

// ---------------------------------------------------------------------------
// Submit listener — attached per form/field to avoid duplicates
// ---------------------------------------------------------------------------

const submittedFields = new WeakSet<HTMLInputElement>();

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

      // Check after a short delay to handle SPA navigations that don't reload
      setTimeout(() => {
        void (async () => {
          try {
            const matches = await searchSecretsByUrl(window.location.href);
            if (matches.length === 0) {
              hideSavePrompt();
              showSavePrompt(username, password);
            }
          } catch {
            // Background not ready — skip silently
          }
        })();
      }, 500);
    },
    { capture: true },
  );
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
// Entry point
// ---------------------------------------------------------------------------

// 1. Detect initial login forms and wire them up
const initialForms = detectLoginForms();
wireLoginForms(initialForms);

// 2. Observe DOM mutations for dynamically added forms (SPAs)
observeForms((forms) => {
  wireLoginForms(forms);
});
