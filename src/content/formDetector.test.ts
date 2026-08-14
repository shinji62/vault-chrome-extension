import { describe, it, expect, afterEach } from 'vitest';
import {
  detectLoginForms,
  isSubmitControl,
  findRelatedLoginForm,
} from './formDetector';

function cleanup(): void {
  document.body.innerHTML = '';
  document.body.querySelectorAll('*').forEach((el) => {
    if (el.shadowRoot) el.shadowRoot.innerHTML = '';
  });
}

afterEach(cleanup);

describe('detectLoginForms', () => {
  it('detects a plain light-DOM login form and its username', () => {
    const form = document.createElement('form');
    form.innerHTML = `
      <input type="text" name="username" />
      <input type="password" name="password" />
    `;
    document.body.appendChild(form);

    const forms = detectLoginForms();
    expect(forms).toHaveLength(1);
    expect(forms[0].passwordField).not.toBeNull();
    expect(forms[0].usernameField?.type).toBe('text');
  });

  it('detects a login form rendered inside a shadow root (component fields)', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const shadow = host.attachShadow({ mode: 'open' });
    shadow.innerHTML = `
      <form>
        <input type="text" name="username" />
        <input type="password" name="password" />
      </form>
    `;

    const forms = detectLoginForms();
    expect(forms).toHaveLength(1);
    expect(forms[0].usernameField?.type).toBe('text');
  });

  it('detects a form-less login widget (a <div> of inputs plus a button)', () => {
    document.body.innerHTML = `
      <div id="form">
        <div><input type="text" name="username" /></div>
        <div><input type="password" name="password" /></div>
        <button id="submit">Submit</button>
      </div>
    `;

    const forms = detectLoginForms();
    expect(forms).toHaveLength(1);
    expect(forms[0].form).toBeNull();
    expect(forms[0].usernameField?.type).toBe('text');
  });
});

describe('isSubmitControl', () => {
  it('recognises a button whose text mentions submit/login', () => {
    const b = document.createElement('button');
    b.textContent = 'Submit';
    expect(isSubmitControl(b)).toBe(true);
  });

  it('recognises "Log in" / "Sign in" wording', () => {
    for (const text of ['Log in', 'Sign in', 'Log In']) {
      const b = document.createElement('button');
      b.textContent = text;
      expect(isSubmitControl(b), text).toBe(true);
    }
  });

  it('rejects controls that do not look like a login submit', () => {
    for (const text of ['Sign up', 'Register', 'Search', 'Forgot password?', 'Show password']) {
      const b = document.createElement('button');
      b.textContent = text;
      expect(isSubmitControl(b), text).toBe(false);
    }
  });

  it('rejects a plain div (not a control)', () => {
    const div = document.createElement('div');
    div.textContent = 'Submit';
    expect(isSubmitControl(div)).toBe(false);
  });

  it('recognises a true type="submit" inside a form even with no hint words', () => {
    const form = document.createElement('form');
    form.innerHTML = `<input type="password" name="password"><button type="submit">Go</button>`;
    document.body.appendChild(form);
    const btn = form.querySelector('button')!;
    expect(isSubmitControl(btn)).toBe(true);
  });

  it('treats a button with a generic "continue" label as a submit control (multi-step logins)', () => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = 'Continue';
    expect(isSubmitControl(btn)).toBe(true);
  });

  it('does not treat a plain button with neutral text as a submit control', () => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = 'Upload file';
    expect(isSubmitControl(btn)).toBe(false);
  });
});

describe('findRelatedLoginForm', () => {
  it('relates a click on a form-less widget submit button to its login form', () => {
    document.body.innerHTML = `
      <div id="form">
        <div><input type="text" name="username" /></div>
        <div><input type="password" name="password" /></div>
        <button id="submit">Submit</button>
      </div>
    `;
    const forms = detectLoginForms();
    const btn = document.getElementById('submit')!;
    expect(findRelatedLoginForm(btn, forms)?.passwordField).toBe(
      document.querySelector('input[type="password"]'),
    );
  });

  it('relates a click to the tightest containing login form when several exist', () => {
    document.body.innerHTML = `
      <div id="loginForm">
        <input type="text" name="username" />
        <input type="password" name="password" />
        <button id="loginSubmit">Submit</button>
      </div>
      <div id="emailForm">
        <input type="text" name="email" />
        <input type="password" name="pw" />
        <button id="emailSubmit">Submit</button>
      </div>
    `;
    const forms = detectLoginForms();
    expect(forms.length).toBe(2);
    const emailSubmit = document.getElementById('emailSubmit')!;
    // The submit button is nested inside the second form's container, so it
    // must relate to the second form, never the first.
    expect(findRelatedLoginForm(emailSubmit, forms)?.passwordField.name).toBe('pw');
  });
});
