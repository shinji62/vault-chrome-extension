import { describe, it, expect } from 'vitest';
import {
  canonicaliseB64Url,
  selectSignalledUnknownCredential,
  selectSignalledRevokedCredentials,
  SignalTarget,
} from './signal';

const rows: SignalTarget[] = [
  { label: 'example-alice-aaaa', rpId: 'example.com', credentialId: 'AAAA', userHandle: 'dXNlcjE' },
  { label: 'example-alice-bbbb', rpId: 'example.com', credentialId: 'BBBB', userHandle: 'dXNlcjE' },
  { label: 'example-bob-cccc', rpId: 'example.com', credentialId: 'CCCC', userHandle: 'dXNlcjI' },
  { label: 'other-alice-dddd', rpId: 'other.com', credentialId: 'DDDD', userHandle: 'dXNlcjE' },
];

describe('canonicaliseB64Url', () => {
  it('normalises padding and the base64 alphabet', () => {
    expect(canonicaliseB64Url('a+b/c==')).toBe('a-b_c');
    expect(canonicaliseB64Url('  AAAA  ')).toBe('AAAA');
  });
});

describe('selectSignalledUnknownCredential', () => {
  it('condemns only the named credential', () => {
    const hits = selectSignalledUnknownCredential(rows, 'example.com', 'AAAA');
    expect(hits.map((r) => r.label)).toEqual(['example-alice-aaaa']);
  });

  it('matches ids that differ only in base64url encoding', () => {
    const padded: SignalTarget[] = [
      { label: 'padded', rpId: 'example.com', credentialId: 'a-b_c', userHandle: 'u' },
    ];
    expect(selectSignalledUnknownCredential(padded, 'example.com', 'a+b/c==')).toHaveLength(1);
  });

  it('does not cross rpIds', () => {
    expect(selectSignalledUnknownCredential(rows, 'evil.com', 'AAAA')).toEqual([]);
  });

  it('ignores an empty rpId or credentialId rather than matching broadly', () => {
    expect(selectSignalledUnknownCredential(rows, 'example.com', '')).toEqual([]);
    expect(selectSignalledUnknownCredential(rows, '', 'AAAA')).toEqual([]);
  });
});

describe('selectSignalledRevokedCredentials', () => {
  it('condemns the signalling user\u2019s credentials that are no longer accepted', () => {
    const hits = selectSignalledRevokedCredentials(rows, 'example.com', 'dXNlcjE', ['AAAA']);
    expect(hits.map((r) => r.label)).toEqual(['example-alice-bbbb']);
  });

  it('keeps credentials that are still accepted', () => {
    const hits = selectSignalledRevokedCredentials(rows, 'example.com', 'dXNlcjE', [
      'AAAA',
      'BBBB',
    ]);
    expect(hits).toEqual([]);
  });

  it('honours an empty accepted list, but only for the signalling user', () => {
    const hits = selectSignalledRevokedCredentials(rows, 'example.com', 'dXNlcjE', []);
    expect(hits.map((r) => r.label)).toEqual(['example-alice-aaaa', 'example-alice-bbbb']);
  });

  it('never touches another account at the same rpId', () => {
    const hits = selectSignalledRevokedCredentials(rows, 'example.com', 'dXNlcjE', []);
    expect(hits.map((r) => r.label)).not.toContain('example-bob-cccc');
  });

  it('never touches another rpId for the same user', () => {
    const hits = selectSignalledRevokedCredentials(rows, 'example.com', 'dXNlcjE', []);
    expect(hits.map((r) => r.label)).not.toContain('other-alice-dddd');
  });

  it('refuses to act without a user scope, which would erase the whole site', () => {
    expect(selectSignalledRevokedCredentials(rows, 'example.com', '', [])).toEqual([]);
  });

  it('skips records with no stored credential id', () => {
    const partial: SignalTarget[] = [{ label: 'x', rpId: 'example.com', userHandle: 'dXNlcjE' }];
    expect(selectSignalledRevokedCredentials(partial, 'example.com', 'dXNlcjE', [])).toEqual([]);
  });
});
