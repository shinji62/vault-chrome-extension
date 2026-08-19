import { describe, it, expect } from 'vitest';
import { createPublicKey, createHash, verify as nodeVerify } from 'node:crypto';
import {
  webAuthnCreate,
  webAuthnGet,
  COSE_ES256,
  selectPasskeyCandidates,
  passkeyLabelFromUserName,
  isUserVerificationSatisfiable,
} from './webauthn';
import { cborDecode } from './cbor';
import { base64UrlToBytes, bytesToBase64Url, bytesToHex } from './base64';

const ORIGIN = 'https://example.com';

function createRequest() {
  return {
    rp: { id: 'example.com', name: 'Example' },
    user: { id: bytesToBase64Url(new TextEncoder().encode('user-1')), name: 'alice' },
    challenge: bytesToBase64Url(new TextEncoder().encode('challenge-bytes')),
    pubKeyCredParams: [{ type: 'public-key', alg: COSE_ES256 }],
    origin: ORIGIN,
  };
}

describe('webAuthnCreate', () => {
  it('returns a public-key credential with a decodable attestation object', async () => {
    const result = await webAuthnCreate(createRequest());

    expect(result.type).toBe('public-key');
    expect(result.id).toBe(result.rawId);
    expect(result.response.clientDataJSON).toBeTruthy();
    expect(result.response.attestationObject).toBeTruthy();

    // clientDataJSON is the plaintext JSON of the create request, base64url-encoded.
    const clientData = JSON.parse(
      new TextDecoder().decode(base64UrlToBytes(result.response.clientDataJSON)),
    );
    expect(clientData.type).toBe('webauthn.create');
    expect(clientData.origin).toBe(ORIGIN);
    expect(clientData.crossOrigin).toBe(false);

    // Attestation object is a CBOR map {fmt, attStmt, authData}.
    const attObj = cborDecode(base64UrlToBytes(result.response.attestationObject)) as Record<
      string,
      unknown
    >;
    expect(attObj['fmt']).toBe('none');
    expect(attObj['attStmt']).toEqual({});

    // authData: rpIdHash(32) + flags(1) + counter(4) + attestedCredentialData
    const authData = attObj['authData'] as Uint8Array;
    expect(authData.length).toBeGreaterThan(37);
    expect(authData[32] & 0x40).toBe(0x40); // AT flag set for registration
    expect(authData[32] & 0x01).toBe(0x01); // UP (user present)
    // UV must NOT be set: this authenticator performs no user verification.
    expect(authData[32] & 0x04).toBe(0);
    // attestedCredentialData begins at 37: AAGUID(16) then credIdLen(2).
    const credIdLen = (authData[53] << 8) | authData[54];
    expect(credIdLen).toBeGreaterThan(0);
    const credentialId = authData.slice(55, 55 + credIdLen);
    expect(bytesToBase64Url(credentialId)).toBe(result.id);
  });

  it('returns saveable secret metadata (private JWK + identifiers)', async () => {
    const result = await webAuthnCreate(createRequest());
    expect(result.secret.rpId).toBe('example.com');
    expect(result.secret.userName).toBe('alice');
    expect(result.secret.algorithm).toBe(COSE_ES256);
    expect(result.secret.counter).toBe(0);
    expect(result.secret.userHandle).toBeTruthy();
    // P-256 private JWK has the "d" component.
    expect(result.secret.privateJwk.d).toBeTruthy();
    expect(result.secret.privateJwk.crv).toBe('P-256');
  });

  it('throws when no supported algorithm is requested', async () => {
    const req = createRequest();
    req.pubKeyCredParams = [{ type: 'public-key', alg: -8 }]; // EdDSA only
    await expect(webAuthnCreate(req)).rejects.toThrow(/no supported algorithm/i);
  });

  // This is what a relying party actually does: pull the COSE_Key out of the
  // attested credential data and import it. It only works if the COSE map uses
  // integer labels, so it guards against the text-key regression.
  it('embeds a COSE_Key a relying party can import and verify against', async () => {
    const result = await webAuthnCreate(createRequest());
    const attObj = cborDecode(base64UrlToBytes(result.response.attestationObject)) as Record<
      string,
      unknown
    >;
    const authData = attObj['authData'] as Uint8Array;

    // authData: rpIdHash(32) + flags(1) + counter(4) + AAGUID(16) + credIdLen(2) + credId + COSE
    const credIdLen = (authData[53] << 8) | authData[54];
    const coseBytes = authData.slice(55 + credIdLen);

    // Assert the raw label bytes directly. Decoding with our own decoder would
    // hide a symmetric encode/decode bug, so check the wire format first:
    // a5 (map of 5), then integer labels 01, 03, 20 (-1), 21 (-2), 22 (-3).
    expect(coseBytes[0]).toBe(0xa5);
    expect(bytesToHex(coseBytes.slice(0, 7))).toBe('a501020326' + '2001');

    const coseKey = cborDecode(coseBytes) as Record<string, unknown>;

    // Integer COSE labels — decoded object keys are the stringified integers.
    expect(coseKey['1']).toBe(2); // kty: EC2
    expect(coseKey['3']).toBe(COSE_ES256); // alg: ES256
    expect(coseKey['-1']).toBe(1); // crv: P-256

    const x = coseKey['-2'] as Uint8Array;
    const y = coseKey['-3'] as Uint8Array;
    expect(x.length).toBe(32);
    expect(y.length).toBe(32);

    // The embedded coordinates must match the generated keypair.
    expect(bytesToBase64Url(x)).toBe(result.secret.privateJwk.x);
    expect(bytesToBase64Url(y)).toBe(result.secret.privateJwk.y);

    // And Node must accept it as a usable P-256 public key.
    const publicKey = createPublicKey({
      key: {
        kty: 'EC',
        crv: 'P-256',
        x: bytesToBase64Url(x),
        y: bytesToBase64Url(y),
      },
      format: 'jwk',
    });
    expect(publicKey.asymmetricKeyType).toBe('ec');
  });

  it('derives rpIdHash from the real rp.id', async () => {
    const result = await webAuthnCreate(createRequest());
    const attObj = cborDecode(base64UrlToBytes(result.response.attestationObject)) as Record<
      string,
      unknown
    >;
    const authData = attObj['authData'] as Uint8Array;
    const expected = createHash('sha256').update('example.com').digest();
    expect(Buffer.from(authData.slice(0, 32))).toEqual(expected);
  });

  // A missing rpId used to hash "" silently, yielding an unusable credential
  // stored under the literal path "undefined".
  it('rejects a missing rp.id instead of hashing the empty string', async () => {
    for (const badId of [undefined, '', '   ']) {
      const req = { ...createRequest(), rp: { id: badId as unknown as string, name: 'Example' } };
      await expect(webAuthnCreate(req)).rejects.toThrow(/rpId is missing/i);
    }
  });

  it('refuses userVerification="required" rather than faking the UV flag', async () => {
    const req = { ...createRequest(), userVerification: 'required' as const };
    await expect(webAuthnCreate(req)).rejects.toThrow(/userVerification="required"/i);
  });
});

describe('webAuthnGet', () => {
  it('produces a cryptographically valid assertion', async () => {
    // Register first to obtain a keypair.
    const createResult = await webAuthnCreate(createRequest());
    const { privateJwk, credentialId, userHandle, rpId } = createResult.secret;

    const getResult = await webAuthnGet({
      rpId,
      challenge: bytesToBase64Url(new TextEncoder().encode('new-challenge')),
      origin: ORIGIN,
      userHandle,
      credentialId,
      privateJwk,
      signCount: 0,
    });

    expect(getResult.type).toBe('public-key');
    expect(getResult.id).toBe(credentialId);
    expect(getResult.response.userHandle).toBe(userHandle);
    expect(getResult.newSignCount).toBe(1);

    // clientDataJSON for get
    const clientData = JSON.parse(
      new TextDecoder().decode(base64UrlToBytes(getResult.response.clientDataJSON)),
    );
    expect(clientData.type).toBe('webauthn.get');

    // Verify the DER-encoded ECDSA signature over authenticatorData || clientDataHash.
    // Node's crypto.verify accepts DER (as released by the WebAuthn module), matching
    // what a relying party would do server-side.
    const authData = base64UrlToBytes(getResult.response.authenticatorData);
    const clientDataHash = createHash('sha256')
      .update(Buffer.from(base64UrlToBytes(getResult.response.clientDataJSON)))
      .digest();
    const message = Buffer.concat([Buffer.from(authData), clientDataHash]);
    const publicKey = createPublicKey({
      key: { kty: 'EC', crv: 'P-256', x: privateJwk.x, y: privateJwk.y },
      format: 'jwk',
    });
    const ok = nodeVerify(
      null,
      message,
      publicKey,
      Buffer.from(base64UrlToBytes(getResult.response.signature)),
    );
    expect(ok).toBe(true);

    // UP set, UV clear — no user verification actually happened.
    expect(authData[32] & 0x01).toBe(0x01);
    expect(authData[32] & 0x04).toBe(0);
  });

  async function getRequestFor(overrides: Record<string, unknown> = {}) {
    const createResult = await webAuthnCreate(createRequest());
    const { privateJwk, credentialId, userHandle, rpId } = createResult.secret;
    return {
      rpId,
      challenge: bytesToBase64Url(new TextEncoder().encode('c')),
      origin: ORIGIN,
      userHandle,
      credentialId,
      privateJwk,
      signCount: 0,
      ...overrides,
    };
  }

  it('rejects a missing rpId instead of hashing the empty string', async () => {
    await expect(webAuthnGet(await getRequestFor({ rpId: '' }))).rejects.toThrow(
      /rpId is missing/i,
    );
  });

  it('refuses userVerification="required" rather than faking the UV flag', async () => {
    await expect(
      webAuthnGet(await getRequestFor({ userVerification: 'required' })),
    ).rejects.toThrow(/userVerification="required"/i);
  });
});

describe('selectPasskeyCandidates', () => {
  const rows = [
    { label: 'a', rpId: 'example.com', username: 'alice', credentialId: 'cred-a' },
    { label: 'b', rpId: 'example.com', username: 'bob', credentialId: 'cred-b' },
    { label: 'c', rpId: 'other.com', username: 'carol', credentialId: 'cred-c' },
  ];

  it('returns every passkey for the rpId so the user can choose', () => {
    expect(selectPasskeyCandidates(rows, 'example.com').map((r) => r.label)).toEqual(['a', 'b']);
  });

  it('restricts the choice to allowCredentials when the RP supplies it', () => {
    const chosen = selectPasskeyCandidates(rows, 'example.com', [{ id: 'cred-b' }]);
    expect(chosen.map((r) => r.label)).toEqual(['b']);
  });

  it('ignores an empty allowCredentials list rather than excluding everything', () => {
    expect(selectPasskeyCandidates(rows, 'example.com', []).map((r) => r.label)).toEqual(['a', 'b']);
  });

  it('never crosses rpId boundaries', () => {
    expect(selectPasskeyCandidates(rows, 'other.com').map((r) => r.label)).toEqual(['c']);
    expect(selectPasskeyCandidates(rows, 'evil.com')).toEqual([]);
  });

  it('skips records with no credential id, which cannot be asserted', () => {
    const partial = [{ label: 'd', rpId: 'example.com', username: 'dave' }];
    expect(selectPasskeyCandidates(partial, 'example.com')).toEqual([]);
  });
});

describe('passkeyLabelFromUserName', () => {
  it('keeps a credential-id suffix so a second registration cannot overwrite the first', () => {
    const first = passkeyLabelFromUserName('My key', 'AAAAAAAA-first');
    const second = passkeyLabelFromUserName('My key', 'BBBBBBBB-second');
    expect(first).not.toBe(second);
  });

  it('replaces path separators that would create nested KV paths', () => {
    expect(passkeyLabelFromUserName('a/b c', 'cred1234')).toBe('a_b_c-cred1234');
  });

  it('falls back to a usable name when the input sanitises to nothing', () => {
    expect(passkeyLabelFromUserName('   ', 'cred1234')).toBe('passkey-cred1234');
  });
});

describe('isUserVerificationSatisfiable', () => {
  it('accepts anything short of "required", since UP alone is honest', () => {
    expect(isUserVerificationSatisfiable(undefined)).toBe(true);
    expect(isUserVerificationSatisfiable('preferred')).toBe(true);
    expect(isUserVerificationSatisfiable('discouraged')).toBe(true);
  });

  it('rejects "required" so callers can bail out before prompting', () => {
    expect(isUserVerificationSatisfiable('required')).toBe(false);
  });
});
