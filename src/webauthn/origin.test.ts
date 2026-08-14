import { describe, it, expect } from 'vitest';
import { isRpIdValidForOrigin, assertTrustedWebAuthnSender } from './origin';
import { passkeyLabel } from './webauthn';

describe('isRpIdValidForOrigin', () => {
  it('accepts an exact hostname match', () => {
    expect(isRpIdValidForOrigin('example.com', 'https://example.com')).toBe(true);
  });

  it('accepts a parent domain (registrable suffix) of the caller', () => {
    expect(isRpIdValidForOrigin('example.com', 'https://app.example.com')).toBe(true);
    expect(isRpIdValidForOrigin('example.com', 'https://a.b.example.com')).toBe(true);
  });

  it('rejects an unrelated domain', () => {
    expect(isRpIdValidForOrigin('evil.com', 'https://example.com')).toBe(false);
  });

  it('rejects a sibling that merely shares a suffix string', () => {
    // "notexample.com".endsWith("example.com") is true, but it is a different site.
    expect(isRpIdValidForOrigin('example.com', 'https://notexample.com')).toBe(false);
  });

  it('rejects a child domain claiming to be its own parent', () => {
    // A page on example.com may not claim rpId "app.example.com".
    expect(isRpIdValidForOrigin('app.example.com', 'https://example.com')).toBe(false);
  });

  it('rejects a bare public suffix', () => {
    expect(isRpIdValidForOrigin('com', 'https://example.com')).toBe(false);
  });

  it('is case insensitive', () => {
    expect(isRpIdValidForOrigin('Example.COM', 'https://EXAMPLE.com')).toBe(true);
  });

  it('rejects empty or malformed input', () => {
    expect(isRpIdValidForOrigin('', 'https://example.com')).toBe(false);
    expect(isRpIdValidForOrigin('example.com', 'not-a-url')).toBe(false);
  });
});

describe('assertTrustedWebAuthnSender', () => {
  const ORIGIN = 'https://example.com';

  it('accepts a genuine content-script sender', () => {
    expect(() =>
      assertTrustedWebAuthnSender({ origin: ORIGIN, tab: { id: 1 } }, ORIGIN, 'example.com'),
    ).not.toThrow();
  });

  it('falls back to the frame URL when sender.origin is absent', () => {
    expect(() =>
      assertTrustedWebAuthnSender(
        { url: 'https://example.com/login?x=1', tab: { id: 1 } },
        ORIGIN,
        'example.com',
      ),
    ).not.toThrow();
  });

  // A page can post a forged request to the isolated-world bridge, so a lying
  // `origin` in the message body must not be trusted.
  it('rejects a message whose claimed origin differs from the sender', () => {
    expect(() =>
      assertTrustedWebAuthnSender(
        { origin: 'https://evil.com', tab: { id: 1 } },
        ORIGIN,
        'example.com',
      ),
    ).toThrow(/does not match requested origin/i);
  });

  it('rejects a site requesting an rpId it does not own', () => {
    expect(() =>
      assertTrustedWebAuthnSender(
        { origin: 'https://evil.com', tab: { id: 1 } },
        'https://evil.com',
        'example.com',
      ),
    ).toThrow(/may not act for rpId/i);
  });

  it('rejects a sender with no verifiable origin', () => {
    expect(() => assertTrustedWebAuthnSender({}, ORIGIN, 'example.com')).toThrow(
      /no verifiable sender origin/i,
    );
  });
});

describe('passkeyLabel', () => {
  it('distinguishes accounts on the same site', () => {
    const a = passkeyLabel('example.com', 'alice', 'AAAAbbbbCCCC');
    const b = passkeyLabel('example.com', 'bob', 'DDDDeeeeFFFF');
    expect(a).not.toBe(b);
    expect(a).toBe('example.com-alice-AAAAbbbb');
  });

  it('distinguishes re-registrations for the same account', () => {
    expect(passkeyLabel('example.com', 'alice', 'AAAAAAAA')).not.toBe(
      passkeyLabel('example.com', 'alice', 'BBBBBBBB'),
    );
  });

  it('never emits a slash that would nest the KV path', () => {
    const label = passkeyLabel('exa/mple.com', 'a/b', 'cred/id+value');
    expect(label).not.toContain('/');
  });

  it('falls back to "default" when no username is given', () => {
    expect(passkeyLabel('example.com', undefined, 'AAAAAAAA')).toContain('-default-');
    expect(passkeyLabel('example.com', '  ', 'AAAAAAAA')).toContain('-default-');
  });
});
