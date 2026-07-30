// ---------------------------------------------------------------------------
// Login form detection
// ---------------------------------------------------------------------------

export interface LoginForm {
  form: HTMLFormElement | null; // null if no wrapping <form> element
  usernameField: HTMLInputElement | null;
  passwordField: HTMLInputElement;
}

/**
 * Find all password inputs on the page and pair each with the nearest
 * username-like input (type="text", type="email", or no type attribute).
 */
export function detectLoginForms(): LoginForm[] {
  const passwordFields = Array.from(
    document.querySelectorAll<HTMLInputElement>('input[type="password"]'),
  ).filter((el) => el.offsetParent !== null); // exclude hidden fields

  return passwordFields.map((passwordField) => {
    const form = passwordField.closest('form') as HTMLFormElement | null;
    const usernameField = findUsernameField(passwordField, form);
    return { form, usernameField, passwordField };
  });
}

/**
 * Look for a username / email input associated with the given password field.
 * Search order:
 *   1. Siblings or cousins inside the same <form> (or common ancestor)
 *   2. Any preceding text/email input in the document
 */
function findUsernameField(
  passwordField: HTMLInputElement,
  form: HTMLFormElement | null,
): HTMLInputElement | null {
  const isUsernameCandidate = (el: HTMLInputElement): boolean => {
    const type = (el.type || 'text').toLowerCase();
    return type === 'text' || type === 'email' || type === '';
  };

  // Search within the form or the closest containing block element
  const container: Element = form ?? (passwordField.parentElement ?? document.body);
  const candidates = Array.from(
    container.querySelectorAll<HTMLInputElement>(
      'input[type="text"], input[type="email"], input:not([type])',
    ),
  ).filter(isUsernameCandidate);

  if (candidates.length > 0) {
    // Prefer the one immediately before the password field in DOM order
    let closest: HTMLInputElement | null = null;
    for (const c of candidates) {
      // compareDocumentPosition bit 4 = preceding
      if (passwordField.compareDocumentPosition(c) & Node.DOCUMENT_POSITION_PRECEDING) {
        closest = c;
      }
    }
    if (closest) return closest;
    return candidates[0];
  }

  return null;
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
