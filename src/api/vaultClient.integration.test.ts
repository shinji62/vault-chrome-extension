/**
 * @vitest-environment node
 *
 * Integration tests against a real Vault dev server.
 *
 * Runs in the node environment on purpose: happy-dom enforces browser CORS and
 * would block these cross-origin requests, which the extension itself is exempt
 * from via host_permissions.
 *
 * Unit tests stub Vault with msw, so they only prove we are self-consistent —
 * they cannot catch a wrong assumption about Vault's actual API shape. These
 * tests talk to a live server instead.
 *
 * Opt-in: skipped unless VAULT_TEST_ADDR is set, so `npm test` stays hermetic.
 * Run `npm run test:integration` (see package.json) to set the server up and
 * execute this file.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createPublicKey, createHash, verify as nodeVerify } from 'node:crypto';
import { server } from '../test/setup';
import { VaultClient } from './vaultClient';
import { Settings } from '../types/settings';
import { webAuthnCreate, webAuthnGet, passkeyLabel } from '../webauthn/webauthn';
import {
  selectSignalledRevokedCredentials,
  selectSignalledUnknownCredential,
} from '../webauthn/signal';
import { base64UrlToBytes } from '../webauthn/base64';

const ADDR = process.env['VAULT_TEST_ADDR'];
const TOKEN = process.env['VAULT_TEST_TOKEN'] ?? 'root-test-token';

const describeIntegration = ADDR ? describe : describe.skip;

describeIntegration('VaultClient against a real Vault dev server', () => {
  // The shared msw server intercepts all fetch traffic and errors on unhandled
  // requests, so it must stand down for these tests to reach the network.
  beforeAll(() => server.close());
  afterAll(() => server.listen({ onUnhandledRequest: 'error' }));

  const settings: Settings = {
    vaultUrl: ADDR as string,
    authMethod: 'token',
    pmMount: 'secret',
    pmTransitEnabled: true,
    pmTransitMount: 'transit',
  } as Settings;

  const client = () => new VaultClient(settings, TOKEN);
  const ENTITY = 'itest-entity';

  /**
   * Mirrors the background worker's mapping. `webAuthnCreate` returns `userName`
   * (WebAuthn naming) whereas the KV record uses `username`, so callers must
   * translate; a spread would silently drop it.
   */
  function toPasskeyInput(
    secret: Awaited<ReturnType<typeof webAuthnCreate>>['secret'],
    label: string,
  ) {
    return {
      label,
      rpId: secret.rpId,
      username: secret.userName || undefined,
      credentialId: secret.credentialId,
      userHandle: secret.userHandle,
      algorithm: secret.algorithm,
      counter: secret.counter,
      privateJwk: secret.privateJwk,
    };
  }

  it('looks up its own token', async () => {
    const info = await client().lookupToken();
    expect(info.policies).toContain('root');
  });

  it('lists mounts and detects the KV v2 secret mount', async () => {
    const mounts = await client().listMounts();
    expect(mounts['secret/']?.type).toBe('kv');
    expect(mounts['secret/']?.options?.version).toBe('2');
  });

  it('round-trips a KV v2 secret', async () => {
    const c = client();
    const path = 'itest/login';
    await c.createOrUpdateSecret('secret', path, { username: 'alice', password: 'p@ss word/?#' }, 2);

    const read = await c.readSecret('secret', path, 2);
    expect(read['username']).toBe('alice');
    expect(read['password']).toBe('p@ss word/?#');
  });

  it('round-trips custom_metadata used for URL matching', async () => {
    const c = client();
    const path = 'itest/with-meta';
    await c.createOrUpdateSecret('secret', path, { username: 'bob', password: 'x' }, 2);
    await c.updateMetadata('secret', path, { url: 'https://github.com/login' });

    const meta = await c.readMetadata('secret', path);
    expect(meta.data?.custom_metadata?.url).toBe('https://github.com/login');
  });

  it('detects the KV version of the secret mount', async () => {
    expect(await client().detectKVVersion('secret')).toBe(2);
  });

  it('lists nested secrets with directory markers', async () => {
    const c = client();
    await c.createOrUpdateSecret('secret', 'itest/nested/deep/item', { password: 'x' }, 2);

    const keys = await c.listSecrets('secret', 'itest/nested', 2);
    expect(keys).toContain('deep/');
  });

  // Vault treats "/" as a hierarchy separator, so a label must not be able to
  // escape its intended prefix. encodePath() percent-encodes each segment.
  it('stores secrets whose names need percent-encoding', async () => {
    const c = client();
    const path = 'itest/weird name?&#x';
    await c.createOrUpdateSecret('secret', path, { password: 'ok' }, 2);
    expect((await c.readSecret('secret', path, 2))['password']).toBe('ok');
  });

  it('encrypts and decrypts through Transit', async () => {
    const c = client();
    const plaintext = 'super-secret-value';
    const { ciphertext, keyVersion } = await c.transitEncrypt(plaintext, ENTITY);

    expect(ciphertext.startsWith('vault:v')).toBe(true);
    expect(keyVersion).toBeGreaterThanOrEqual(1);
    expect(await c.transitDecrypt(ciphertext, ENTITY)).toBe(plaintext);
  });

  // The policy itself is created by the test harness (see integration-test
  // instructions in the file header); the client only reads and generates.
  it('lists password policies and generates from one', async () => {
    const c = client();
    const policies = await c.listPasswordPolicies();
    expect(policies).toContain('itest-policy');

    const pw = await c.generatePassword('itest-policy');
    expect(pw).toHaveLength(24);
  });

  describe('passkey storage', () => {
    it('saves a passkey and reads back a usable private key', async () => {
      const c = client();
      const created = await webAuthnCreate({
        rp: { id: 'example.com', name: 'Example' },
        user: { id: 'dXNlcg', name: 'alice' },
        challenge: 'Y2hhbGxlbmdl',
        pubKeyCredParams: [{ type: 'public-key', alg: -7 }],
        origin: 'https://example.com',
      });

      const label = passkeyLabel('example.com', 'alice', created.secret.credentialId);
      await c.savePasskey(ENTITY, toPasskeyInput(created.secret, label));

      const record = await c.readPasskey(ENTITY, label);
      expect(record.rpId).toBe('example.com');
      expect(record.username).toBe('alice');
      expect(record.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
      expect(record.privateJwk.d).toBe(created.secret.privateJwk.d);

      // The decrypted key must still produce assertions the RP can verify.
      const assertion = await webAuthnGet({
        rpId: record.rpId,
        challenge: 'bmV3LWNoYWxsZW5nZQ',
        origin: 'https://example.com',
        userHandle: record.userHandle,
        credentialId: record.credentialId,
        privateJwk: record.privateJwk,
        signCount: Number(record.counter) || 0,
      });

      const authData = base64UrlToBytes(assertion.response.authenticatorData);
      const clientDataHash = createHash('sha256')
        .update(Buffer.from(base64UrlToBytes(assertion.response.clientDataJSON)))
        .digest();

      // Verify with the public key recovered from the stored attestation, i.e.
      // exactly what a relying party keeps server-side.
      //
      // The attestation object is {fmt: "none", attStmt: {}, authData: bstr}.
      // Locating authData by its CBOR header keeps this independent of our own
      // decoder while still asserting the bytes are laid out as the spec says.
      const attBytes = Buffer.from(base64UrlToBytes(created.response.attestationObject));
      const authDataMarker = attBytes.indexOf(Buffer.from('68617574684461746158', 'hex'));
      expect(authDataMarker).toBeGreaterThan(-1); // text(8) "authData", bstr(1-byte len)
      const attAuthDataLen = attBytes[authDataMarker + 10];
      const attAuthData = attBytes.subarray(
        authDataMarker + 11,
        authDataMarker + 11 + attAuthDataLen,
      );
      const credIdLen = (attAuthData[53] << 8) | attAuthData[54];
      // Parsed at fixed offsets rather than with our own cborDecode: a
      // symmetric encode/decode bug would cancel out and the test would pass
      // against a COSE key no relying party can read.
      //
      //   a5 | 01 02 | 03 26 | 20 01 | 21 58 20 <x:32> | 22 58 20 <y:32>
      //   map(5) kty:EC2  alg:ES256  crv:P-256   x-coord        y-coord
      const cose = Buffer.from(attAuthData.slice(55 + credIdLen));
      expect(cose).toHaveLength(77);
      expect(cose.subarray(0, 10).toString('hex')).toBe('a5010203262001215820');
      expect(cose.subarray(42, 45).toString('hex')).toBe('225820');

      const publicKey = createPublicKey({
        key: {
          kty: 'EC',
          crv: 'P-256',
          x: cose.subarray(10, 42).toString('base64url'),
          y: cose.subarray(45, 77).toString('base64url'),
        },
        format: 'jwk',
      });

      const ok = nodeVerify(
        null,
        Buffer.concat([Buffer.from(authData), clientDataHash]),
        publicKey,
        Buffer.from(base64UrlToBytes(assertion.response.signature)),
      );
      expect(ok).toBe(true);
    });

    it('keeps separate entries for two accounts on one site', async () => {
      const c = client();
      const labels: string[] = [];

      for (const user of ['alice', 'bob']) {
        const created = await webAuthnCreate({
          rp: { id: 'multi.example', name: 'Multi' },
          user: { id: 'dXNlcg', name: user },
          challenge: 'Y2hhbGxlbmdl',
          pubKeyCredParams: [{ type: 'public-key', alg: -7 }],
          origin: 'https://multi.example',
        });
        const label = passkeyLabel('multi.example', user, created.secret.credentialId);
        labels.push(label);
        await c.savePasskey(ENTITY, toPasskeyInput(created.secret, label));
      }

      expect(labels[0]).not.toBe(labels[1]);
      const listed = (await c.listPasskeys(ENTITY)).map((r) => r.label);
      // Previously both used label=rpId, so the second overwrote the first.
      expect(listed).toContain(labels[0]);
      expect(listed).toContain(labels[1]);
    });

    it('preserves createdAt when only the sign counter changes', async () => {
      const c = client();
      const created = await webAuthnCreate({
        rp: { id: 'counter.example', name: 'Counter' },
        user: { id: 'dXNlcg', name: 'carol' },
        challenge: 'Y2hhbGxlbmdl',
        pubKeyCredParams: [{ type: 'public-key', alg: -7 }],
        origin: 'https://counter.example',
      });
      const label = passkeyLabel('counter.example', 'carol', created.secret.credentialId);
      await c.savePasskey(ENTITY, toPasskeyInput(created.secret, label));

      // Same shape as the background's post-assertion counter write.
      const first = await c.readPasskey(ENTITY, label);
      await c.savePasskey(ENTITY, {
        label: first.label,
        rpId: first.rpId,
        username: first.username,
        credentialId: first.credentialId,
        userHandle: first.userHandle,
        algorithm: Number(first.algorithm),
        counter: 5,
        privateJwk: first.privateJwk,
        createdAt: first.createdAt,
      });

      const second = await c.readPasskey(ENTITY, label);
      expect(second.counter).toBe('5');
      expect(second.createdAt).toBe(first.createdAt);
    });

    /**
     * The selection helpers are unit-tested against literals, which cannot prove
     * the ids they compare survive a Vault round trip, nor that the chosen label
     * really deletes the entry. These tests drive the full path a website's
     * Signal API call takes.
     */
    describe('Signal API deletion', () => {
      const RP = 'signal.example';

      async function storePasskey(userName: string, userHandle: string) {
        const c = client();
        const created = await webAuthnCreate({
          rp: { id: RP, name: 'Signal' },
          user: { id: userHandle, name: userName },
          challenge: 'Y2hhbGxlbmdl',
          pubKeyCredParams: [{ type: 'public-key', alg: -7 }],
          origin: `https://${RP}`,
        });
        const label = passkeyLabel(RP, userName, created.secret.credentialId);
        await c.savePasskey(ENTITY, toPasskeyInput(created.secret, label));
        return { label, credentialId: created.secret.credentialId };
      }

      it('signalUnknownCredential removes exactly that passkey from Vault', async () => {
        const c = client();
        const doomed = await storePasskey('unknown-a', 'dXNlckE');
        const keep = await storePasskey('unknown-b', 'dXNlckI');

        const doomedRows = selectSignalledUnknownCredential(
          await c.listPasskeys(ENTITY),
          RP,
          doomed.credentialId,
        );
        expect(doomedRows.map((r) => r.label)).toEqual([doomed.label]);

        await c.deletePasskey(ENTITY, doomedRows[0].label);

        const remaining = (await c.listPasskeys(ENTITY)).map((r) => r.label);
        expect(remaining).not.toContain(doomed.label);
        expect(remaining).toContain(keep.label);
      });

      it('signalAllAcceptedCredentials prunes revoked keys but spares other accounts', async () => {
        const c = client();
        const userHandle = 'c2hhcmVkLXVzZXI';
        const kept = await storePasskey('accepted-keep', userHandle);
        const revoked = await storePasskey('accepted-revoked', userHandle);
        const otherAccount = await storePasskey('accepted-other', 'b3RoZXItdXNlcg');

        const rows = await c.listPasskeys(ENTITY);
        const doomedRows = selectSignalledRevokedCredentials(rows, RP, userHandle, [
          kept.credentialId,
        ]);
        expect(doomedRows.map((r) => r.label)).toEqual([revoked.label]);

        for (const row of doomedRows) await c.deletePasskey(ENTITY, row.label);

        const remaining = (await c.listPasskeys(ENTITY)).map((r) => r.label);
        expect(remaining).not.toContain(revoked.label);
        expect(remaining).toContain(kept.label);
        expect(remaining).toContain(otherAccount.label);
      });
    });
  });

  it('surfaces Vault error messages on a bad path', async () => {
    await expect(client().readSecret('secret', 'itest/does-not-exist', 2)).rejects.toThrow();
  });

  it('rejects an invalid token', async () => {
    const bad = new VaultClient(settings, 'not-a-real-token');
    await expect(bad.lookupToken()).rejects.toThrow();
  });
});
