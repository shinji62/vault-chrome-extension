// ---------------------------------------------------------------------------
// Login form detection
// ---------------------------------------------------------------------------

export interface LoginForm {
  form: HTMLFormElement | null; // null if no wrapping <form> element
  usernameField: HTMLInputElement | null;
  passwordField: HTMLInputElement;
}

/**
 * Collect every element in the document, recursively descending into open
 * shadow roots. Many modern UI frameworks (MDUI, Material Web, etc.) render
 * form fields inside a component's shadow DOM, so a plain querySelectorAll
 * would miss them entirely.
 */
function collectElements(root: ParentNode): Element[] {
  const all = Array.from(root.querySelectorAll('*'));
  for (const el of [...all]) {
    if (el.shadowRoot) all.push(...collectElements(el.shadowRoot));
  }
  return all;
}

const isUsernameCandidate = (el: Element): el is HTMLInputElement =>
  el instanceof HTMLInputElement &&
  ['text', 'email', 'tel', ''].includes((el.type || 'text').toLowerCase());

/** True for a field taking part in layout (i.e. not hidden). */
export const isRendered = (el: HTMLElement): boolean =>
  typeof el.checkVisibility === 'function' ? el.checkVisibility() : el.offsetParent !== null;

/**
 * Find all password inputs on the page and pair each with the nearest
 * username-like input (type="text", type="email", or no type attribute).
 * Searches across shadow DOM so component-based login forms are detected.
 */
export function detectLoginForms(): LoginForm[] {
  const elements = collectElements(document);
  const passwordFields = elements.filter(
    (el): el is HTMLInputElement =>
      el instanceof HTMLInputElement && el.type === 'password' && isRendered(el),
  );

  return passwordFields.map((passwordField) => {
    const form = passwordField.closest('form') as HTMLFormElement | null;
    const usernameField = findUsernameField(passwordField, elements);
    return { form, usernameField, passwordField };
  });
}

/**
 * Look for a username / email input associated with the given password field.
 * Only considers candidates living in the same shadow root (or document) as the
 * password field, and prefers the nearest preceding one in DOM order.
 */
function findUsernameField(
  passwordField: HTMLInputElement,
  elements: Element[],
): HTMLInputElement | null {
  const passwordRoot = passwordField.getRootNode();
  const candidates = elements
    .filter(isUsernameCandidate)
    .filter((el) => el !== passwordField && el.getRootNode() === passwordRoot);

  if (candidates.length === 0) return null;

  let closest: HTMLInputElement | null = null;
  for (const c of candidates) {
    // compareDocumentPosition bit 4 = preceding
    if (passwordField.compareDocumentPosition(c) & Node.DOCUMENT_POSITION_PRECEDING) {
      closest = c;
    }
  }
  return closest ?? candidates[0];
}

// ---------------------------------------------------------------------------
// Submit-control detection
// ---------------------------------------------------------------------------

/** Words that identify a control as the one that logs the user in. */
const SUBMIT_HINTS = [
  'log in',
  'login',
  'log on',
  'logon',
  'sign in',
  'signin',
  'submit',
  'continue',
  'next',
  'connect',
  'anmelden',
  'connexion',
  "s'identifier",
  'se connecter',
  'valider',
  'suivant',
];

/** Words that mean "this button does something else", checked before the hints. */
const SUBMIT_ANTI_HINTS = [
  'sign up',
  'signup',
  'register',
  'create account',
  'forgot',
  'reset',
  'cancel',
  'show password',
  'hide password',
  'search',
];

/**
 * True when activating `el` plausibly submits a login form.
 *
 * A `<button>` with no explicit type defaults to `type="submit"`, but only
 * *inside* a form does that produce a submit event — form-less login widgets
 * (a `<div>` of inputs plus a click handler) are common, and there the type is
 * meaningless. So an accessible-name match is accepted as well, which is what
 * makes `<button id="submit">Submit</button>` outside a form recognisable.
 */
export function isSubmitControl(el: Element): boolean {
  const isButton =
    el instanceof HTMLButtonElement ||
    (el instanceof HTMLInputElement && ['submit', 'button', 'image'].includes(el.type)) ||
    el.getAttribute('role') === 'button' ||
    el instanceof HTMLAnchorElement;
  if (!isButton) return false;

  const name = [
    el.textContent ?? '',
    el.getAttribute('value') ?? '',
    el.getAttribute('aria-label') ?? '',
    el.getAttribute('title') ?? '',
    el.getAttribute('name') ?? '',
    el.id,
  ]
    .join(' ')
    .toLowerCase();

  if (SUBMIT_ANTI_HINTS.some((w) => name.includes(w))) return false;
  if (SUBMIT_HINTS.some((w) => name.includes(w))) return true;

  // A real submit button inside a form needs no name match: the form's submit
  // event is authoritative.
  const type = el instanceof HTMLButtonElement ? el.type : (el as HTMLInputElement).type;
  return type === 'submit' && el.closest('form') !== null;
}

/**
 * Pick the login form that `el` (a clicked button or a field taking Enter)
 * belongs to.
 *
 * Prefers a shared `<form>`, then a shared shadow root, and finally falls back
 * to the only candidate on the page — form-less widgets give no containment to
 * match on, and a login page normally has exactly one password field.
 */
export function findRelatedLoginForm(el: Element, forms: LoginForm[]): LoginForm | null {
  if (forms.length === 0) return null;

  const form = el.closest('form');
  if (form) {
    const inSameForm = forms.find((f) => f.form === form);
    if (inSameForm) return inSameForm;
  }

  const root = el.getRootNode();
  const inSameRoot = forms.filter((f) => f.passwordField.getRootNode() === root);
  if (inSameRoot.length === 1) return inSameRoot[0];

  // Several password fields share the root (e.g. a change-password form): pick
  // the one whose closest common ancestor with `el` is tightest, so a click
  // can't credit the wrong field.
  if (inSameRoot.length > 1) {
    let best: LoginForm | null = null;
    let bestDepth = Infinity;
    for (const candidate of inSameRoot) {
      let ancestor: Element | null = candidate.passwordField;
      let depth = 0;
      while (ancestor) {
        if (ancestor.contains(el)) {
          if (depth < bestDepth) {
            best = candidate;
            bestDepth = depth;
          }
          break;
        }
        ancestor = ancestor.parentElement;
        depth += 1;
      }
    }
    if (best) return best;
  }

  return forms.length === 1 ? forms[0] : null;
}

// ---------------------------------------------------------------------------
// DOM mutation observer
// ---------------------------------------------------------------------------

/**
 * Watch `document.body` for subtree changes and call `callback` whenever the
 * set of detected login forms changes (by password-field count or identity).
 */
export function observeForms(callback: (forms: LoginForm[]) => void): MutationObserver {
  let previousPasswordFields: HTMLInputElement[] = [];

  const observer = new MutationObserver(() => {
    const forms = detectLoginForms();
    const currentPasswordFields = forms.map((f) => f.passwordField);

    const changed =
      currentPasswordFields.length !== previousPasswordFields.length ||
      currentPasswordFields.some((f, i) => f !== previousPasswordFields[i]);

    if (changed) {
      previousPasswordFields = currentPasswordFields;
      callback(forms);
    }
  });

  observer.observe(document.body, { childList: true, subtree: true });
  return observer;
}
