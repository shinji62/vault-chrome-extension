import { describe, it, expect } from 'vitest';
import { http, HttpResponse } from 'msw';
import { server } from '../test/setup';
import { VaultClient } from './vaultClient';
import { VaultApiError } from '../types/vault';
import type { Settings } from '../types/settings';

const BASE = 'https://vault.example.com';

const defaultSettings: Settings = {
  vaultUrl: BASE,
  authMethod: 'token',
};

const TEST_TOKEN = 's.testtoken';

function makeClient(overrides?: Partial<Settings>): VaultClient {
  return new VaultClient({ ...defaultSettings, ...overrides }, TEST_TOKEN);
}

// ── lookupToken ───────────────────────────────────────────────────────────────
describe('lookupToken', () => {
  it('returns mapped TokenInfo from lookup-self', async () => {
    server.use(
      http.get(`${BASE}/v1/auth/token/lookup-self`, () =>
        HttpResponse.json({
          data: {
            ttl: 3600,
            creation_ttl: 86400,
            expire_time: '2030-01-01T00:00:00Z',
            renewable: true,
            explicit_max_ttl: 0,
            period: 0,
            policies: ['default', 'admin'],
            display_name: 'token-user',
          },
        }),
      ),
    );

    const client = makeClient();
    const info = await client.lookupToken();

    expect(info.ttl).toBe(3600);
    expect(info.creation_ttl).toBe(86400);
    expect(info.expire_time).toBe('2030-01-01T00:00:00Z');
    expect(info.renewable).toBe(true);
    expect(info.explicit_max_ttl).toBe(0);
    expect(info.period).toBe(0);
    expect(info.policies).toEqual(['default', 'admin']);
    expect(info.display_name).toBe('token-user');
  });

  it('throws VaultApiError on 403', async () => {
    server.use(
      http.get(`${BASE}/v1/auth/token/lookup-self`, () =>
        HttpResponse.json({ errors: ['permission denied'] }, { status: 403 }),
      ),
    );

    const client = makeClient();
    await expect(client.lookupToken()).rejects.toThrow(VaultApiError);
    await expect(client.lookupToken()).rejects.toMatchObject({
      statusCode: 403,
      vaultErrors: ['permission denied'],
    });
  });
});

// ── renewToken ────────────────────────────────────────────────────────────────
describe('renewToken', () => {
  it('maps auth.lease_duration to ttl', async () => {
    server.use(
      http.post(`${BASE}/v1/auth/token/renew-self`, () =>
        HttpResponse.json({
          auth: {
            lease_duration: 7200,
            renewable: true,
            policies: ['default'],
            metadata: { display_name: 'token-user' },
          },
        }),
      ),
    );

    const client = makeClient();
    const info = await client.renewToken();

    expect(info.ttl).toBe(7200);
    expect(info.renewable).toBe(true);
  });

  it('sends increment body when increment is provided', async () => {
    let capturedBody: unknown;
    server.use(
      http.post(`${BASE}/v1/auth/token/renew-self`, async ({ request }) => {
        capturedBody = await request.json();
        return HttpResponse.json({
          auth: {
            lease_duration: 3600,
            renewable: true,
            policies: ['default'],
          },
        });
      }),
    );

    const client = makeClient();
    await client.renewToken(60);

    expect(capturedBody).toEqual({ increment: '60s' });
  });
});

// ── revokeToken ───────────────────────────────────────────────────────────────
describe('revokeToken', () => {
  it('calls POST /v1/auth/token/revoke-self', async () => {
    let called = false;
    server.use(
      http.post(`${BASE}/v1/auth/token/revoke-self`, () => {
        called = true;
        return new HttpResponse(null, { status: 204 });
      }),
    );

    const client = makeClient();
    await client.revokeToken();
    expect(called).toBe(true);
  });
});

// ── KV v1 CRUD ────────────────────────────────────────────────────────────────
describe('KV v1', () => {
  it('listSecrets sends LIST to /v1/{mount}/{path}', async () => {
    let capturedMethod: string | undefined;
    server.use(
      http.all(`${BASE}/v1/secret/mypath`, ({ request }) => {
        capturedMethod = request.method;
        return HttpResponse.json({ data: { keys: ['key1', 'key2/'] } });
      }),
    );

    const client = makeClient();
    const keys = await client.listSecrets('secret', 'mypath', 1);

    expect(capturedMethod).toBe('LIST');
    expect(keys).toEqual(['key1', 'key2/']);
  });

  it('listSecrets falls back to GET with ?list=true when LIST is not allowed', async () => {
    let requestCount = 0;
    let fallbackUrl: string | undefined;

    server.use(
      http.all(`${BASE}/v1/secret/mypath`, ({ request }) => {
        requestCount += 1;
        if (request.method === 'LIST') {
          return HttpResponse.json({ errors: ['unsupported operation'] }, { status: 405 });
        }

        fallbackUrl = request.url;
        return HttpResponse.json({ data: { keys: ['key1', 'key2/'] } });
      }),
    );

    const client = makeClient();
    const keys = await client.listSecrets('secret', 'mypath', 1);

    expect(requestCount).toBe(2);
    expect(fallbackUrl).toContain('list=true');
    expect(keys).toEqual(['key1', 'key2/']);
  });

  it('readSecret returns flat data', async () => {
    server.use(
      http.get(`${BASE}/v1/secret/mypath/mykey`, () =>
        HttpResponse.json({ data: { username: 'alice', password: 'hunter2' } }),
      ),
    );

    const client = makeClient();
    const data = await client.readSecret('secret', 'mypath/mykey', 1);

    expect(data).toEqual({ username: 'alice', password: 'hunter2' });
  });

  it('createOrUpdateSecret POSTs flat data', async () => {
    let capturedBody: unknown;
    server.use(
      http.post(`${BASE}/v1/secret/mypath/mykey`, async ({ request }) => {
        capturedBody = await request.json();
        return new HttpResponse(null, { status: 204 });
      }),
    );

    const client = makeClient();
    await client.createOrUpdateSecret('secret', 'mypath/mykey', { username: 'alice' }, 1);

    expect(capturedBody).toEqual({ username: 'alice' });
  });

  it('deleteSecret sends DELETE to /v1/{mount}/{path}', async () => {
    let called = false;
    server.use(
      http.delete(`${BASE}/v1/secret/mypath/mykey`, () => {
        called = true;
        return new HttpResponse(null, { status: 204 });
      }),
    );

    const client = makeClient();
    await client.deleteSecret('secret', 'mypath/mykey', 1);
    expect(called).toBe(true);
  });
});

// ── KV v2 CRUD ────────────────────────────────────────────────────────────────
describe('KV v2', () => {
  it('listSecrets sends GET with ?list=true to /v1/{mount}/metadata/{path}', async () => {
    let capturedUrl: string | undefined;
    server.use(
      http.get(`${BASE}/v1/secret/metadata/mypath`, ({ request }) => {
        capturedUrl = request.url;
        return HttpResponse.json({ data: { keys: ['key1', 'folder/'] } });
      }),
    );

    const client = makeClient();
    const keys = await client.listSecrets('secret', 'mypath', 2);

    expect(capturedUrl).toContain('list=true');
    expect(keys).toEqual(['key1', 'folder/']);
  });

  it('readSecret returns data.data', async () => {
    server.use(
      http.get(`${BASE}/v1/secret/data/mypath/mykey`, () =>
        HttpResponse.json({
          data: {
            data: { username: 'bob', password: 'pass123' },
            metadata: { version: 1, created_time: '', deletion_time: '', destroyed: false },
          },
        }),
      ),
    );

    const client = makeClient();
    const data = await client.readSecret('secret', 'mypath/mykey', 2);

    expect(data).toEqual({ username: 'bob', password: 'pass123' });
  });

  it('readSecret with version appends ?version=N', async () => {
    let capturedUrl: string | undefined;
    server.use(
      http.get(`${BASE}/v1/secret/data/mypath/mykey`, ({ request }) => {
        capturedUrl = request.url;
        return HttpResponse.json({
          data: {
            data: { password: 'old' },
            metadata: { version: 2, created_time: '', deletion_time: '', destroyed: false },
          },
        });
      }),
    );

    const client = makeClient();
    await client.readSecret('secret', 'mypath/mykey', 2, 2);
    expect(capturedUrl).toContain('version=2');
  });

  it('createOrUpdateSecret wraps data in { data }', async () => {
    let capturedBody: unknown;
    server.use(
      http.post(`${BASE}/v1/secret/data/mypath/mykey`, async ({ request }) => {
        capturedBody = await request.json();
        return new HttpResponse(null, { status: 204 });
      }),
    );

    const client = makeClient();
    await client.createOrUpdateSecret('secret', 'mypath/mykey', { password: 'abc' }, 2);

    expect(capturedBody).toEqual({ data: { password: 'abc' } });
  });

  it('deleteSecret sends DELETE to /v1/{mount}/data/{path}', async () => {
    let called = false;
    server.use(
      http.delete(`${BASE}/v1/secret/data/mypath/mykey`, () => {
        called = true;
        return new HttpResponse(null, { status: 204 });
      }),
    );

    const client = makeClient();
    await client.deleteSecret('secret', 'mypath/mykey', 2);
    expect(called).toBe(true);
  });
});

// ── Metadata ──────────────────────────────────────────────────────────────────
describe('metadata', () => {
  it('readMetadata returns KVv2Metadata', async () => {
    server.use(
      http.get(`${BASE}/v1/secret/metadata/mypath/mykey`, () =>
        HttpResponse.json({
          data: {
            custom_metadata: { url: 'https://example.com' },
            versions: {},
            current_version: 1,
            created_time: '2024-01-01T00:00:00Z',
          },
        }),
      ),
    );

    const client = makeClient();
    const meta = await client.readMetadata('secret', 'mypath/mykey');

    expect(meta.data.custom_metadata).toEqual({ url: 'https://example.com' });
    expect(meta.data.current_version).toBe(1);
  });

  it('updateMetadata POSTs { custom_metadata } to /v1/{mount}/metadata/{path}', async () => {
    let capturedBody: unknown;
    server.use(
      http.post(`${BASE}/v1/secret/metadata/mypath/mykey`, async ({ request }) => {
        capturedBody = await request.json();
        return new HttpResponse(null, { status: 204 });
      }),
    );

    const client = makeClient();
    await client.updateMetadata('secret', 'mypath/mykey', { url: 'https://example.com' });

    expect(capturedBody).toEqual({ custom_metadata: { url: 'https://example.com' } });
  });
});

// ── listNamespaces ────────────────────────────────────────────────────────────
describe('listNamespaces', () => {
  it('returns bare names when no root namespace is set', async () => {
    server.use(
      http.all(`${BASE}/v1/sys/namespaces`, ({ request }) => {
        if (request.method !== 'LIST') return;
        return HttpResponse.json({ data: { keys: ['team-a/', 'team-b/'] } });
      }),
    );

    const client = makeClient({ namespace: undefined });
    const result = await client.listNamespaces();
    expect(result).toEqual(['team-a', 'team-b']);
  });

  it('prefixes results with the root namespace when one is configured', async () => {
    server.use(
      http.all(`${BASE}/v1/sys/namespaces`, ({ request }) => {
        if (request.method !== 'LIST') return;
        return HttpResponse.json({ data: { keys: ['team-a/', 'team-b/'] } });
      }),
    );

    const client = makeClient({ namespace: 'admin' });
    const result = await client.listNamespaces();
    expect(result).toEqual(['admin/team-a', 'admin/team-b']);
  });

  it('prefixes results with a nested root namespace', async () => {
    server.use(
      http.all(`${BASE}/v1/sys/namespaces`, ({ request }) => {
        if (request.method !== 'LIST') return;
        return HttpResponse.json({ data: { keys: ['sub/'] } });
      }),
    );

    const client = makeClient({ namespace: 'org/dept' });
    const result = await client.listNamespaces();
    expect(result).toEqual(['org/dept/sub']);
  });
});

// ── Namespace header ──────────────────────────────────────────────────────────
describe('namespace', () => {
  it('includes X-Vault-Namespace header when namespace is set', async () => {
    let capturedHeader: string | null = null;
    server.use(
      http.get(`${BASE}/v1/auth/token/lookup-self`, ({ request }) => {
        capturedHeader = request.headers.get('X-Vault-Namespace');
        return HttpResponse.json({
          data: {
            ttl: 3600, creation_ttl: 86400, expire_time: '', renewable: true,
            explicit_max_ttl: 0, period: 0, policies: [], display_name: '',
          },
        });
      }),
    );

    const client = makeClient({ namespace: 'my-org/my-team' });
    await client.lookupToken();

    expect(capturedHeader).toBe('my-org/my-team');
  });

  it('does not set X-Vault-Namespace when namespace is not set', async () => {
    let capturedHeader: string | null = 'sentinel';
    server.use(
      http.get(`${BASE}/v1/auth/token/lookup-self`, ({ request }) => {
        capturedHeader = request.headers.get('X-Vault-Namespace');
        return HttpResponse.json({
          data: {
            ttl: 3600, creation_ttl: 86400, expire_time: '', renewable: true,
            explicit_max_ttl: 0, period: 0, policies: [], display_name: '',
          },
        });
      }),
    );

    const client = makeClient({ namespace: undefined });
    await client.lookupToken();

    expect(capturedHeader).toBeNull();
  });
});

// ── Mounts ─────────────────────────────────────────────────────────────────────
describe('mounts', () => {
  it('listMounts unwraps the data field to a flat mount map', async () => {
    server.use(
      http.get(`${BASE}/v1/sys/mounts`, () =>
        HttpResponse.json({
          data: {
            'secret/': { type: 'kv', options: { version: '2' } },
            'ssh/': { type: 'ssh', options: {} },
          },
        }),
      ),
    );

    const client = makeClient();
    const mounts = await client.listMounts();

    expect(mounts).toEqual({
      'secret/': { type: 'kv', options: { version: '2' } },
      'ssh/': { type: 'ssh', options: {} },
    });
    expect(mounts['secret/']?.options?.version).toBe('2');
  });

  it('detectKVVersion returns 2 for a KV v2 mount', async () => {
    server.use(
      http.get(`${BASE}/v1/sys/mounts`, () =>
        HttpResponse.json({
          data: { 'secret/': { type: 'kv', options: { version: '2' } } },
        }),
      ),
    );

    const client = makeClient();
    expect(await client.detectKVVersion('secret')).toBe(2);
  });

  it('detectKVVersion returns 1 when the mount is missing or has no version option', async () => {
    server.use(
      http.get(`${BASE}/v1/sys/mounts`, () =>
        HttpResponse.json({ data: { 'kv1/': { type: 'kv', options: {} } } }),
      ),
    );

    const client = makeClient();
    expect(await client.detectKVVersion('secret')).toBe(1);
  });
});

// ── Error handling ────────────────────────────────────────────────────────────
describe('error handling', () => {
  it('throws VaultApiError with correct statusCode and vaultErrors', async () => {
    server.use(
      http.get(`${BASE}/v1/auth/token/lookup-self`, () =>
        HttpResponse.json(
          { errors: ['1 error occurred: * permission denied'] },
          { status: 403 },
        ),
      ),
    );

    const client = makeClient();
    let caught: VaultApiError | null = null;
    try {
      await client.lookupToken();
    } catch (e) {
      caught = e as VaultApiError;
    }

    expect(caught).toBeInstanceOf(VaultApiError);
    expect(caught?.statusCode).toBe(403);
    expect(caught?.vaultErrors).toEqual(['1 error occurred: * permission denied']);
    expect(caught?.message).toBe('1 error occurred: * permission denied');
  });

  it('throws VaultApiError on 500 with no JSON body', async () => {
    server.use(
      http.get(`${BASE}/v1/auth/token/lookup-self`, () =>
        new HttpResponse('Internal Server Error', { status: 500 }),
      ),
    );

    const client = makeClient();
    await expect(client.lookupToken()).rejects.toMatchObject({ statusCode: 500 });
  });
});

// ── Transit / passkeys ────────────────────────────────────────────────────────
describe('transit passkeys', () => {
  it('transitKeyName uses the entity id', () => {
    const client = makeClient();
    expect(client.transitKeyName('ent-123')).toBe('passkey-ent-123');
  });

  it('transitEncrypt posts base64 plaintext and returns ciphertext + key version', async () => {
    let capturedUrl = '';
    let capturedBody: unknown;
    server.use(
      http.post(`${BASE}/v1/transit/encrypt/passkey-ent-123`, async ({ request }) => {
        capturedUrl = request.url;
        capturedBody = await request.json();
        return HttpResponse.json({ data: { ciphertext: 'vault:v1:abc', key_version: 1 } });
      }),
    );

    const client = makeClient(); // no pmTransitMount → default "transit"
    const result = await client.transitEncrypt('hello', 'ent-123');

    expect(capturedUrl).toContain('/v1/transit/encrypt/passkey-ent-123');
    expect(capturedBody).toEqual({ plaintext: btoa('hello') });
    expect(result).toEqual({ ciphertext: 'vault:v1:abc', keyVersion: 1 });
  });

  it('transitDecrypt decodes the base64 plaintext', async () => {
    server.use(
      http.post(`${BASE}/v1/transit/decrypt/passkey-ent-123`, () =>
        HttpResponse.json({ data: { plaintext: btoa('PRIVATE_KEY_ABC') } }),
      ),
    );

    const client = makeClient();
    const secret = await client.transitDecrypt('vault:v1:xyz', 'ent-123');
    expect(secret).toBe('PRIVATE_KEY_ABC');
  });

  it('uses a custom pmTransitMount when configured', async () => {
    server.use(
      http.post(`${BASE}/v1/mytransit/encrypt/passkey-ent-123`, () =>
        HttpResponse.json({ data: { ciphertext: 'vault:v1:abc', key_version: 1 } }),
      ),
    );

    const client = makeClient({ pmTransitMount: 'mytransit' });
    const result = await client.transitEncrypt('hello', 'ent-123');
    expect(result.ciphertext).toBe('vault:v1:abc');
  });

  it('savePasskey encrypts the private JWK then writes ciphertext + metadata to KV', async () => {
    let encryptedBody: unknown;
    let storedBody: unknown;
    server.use(
      http.post(`${BASE}/v1/transit/encrypt/passkey-ent-123`, async ({ request }) => {
        encryptedBody = await request.json();
        return HttpResponse.json({ data: { ciphertext: 'vault:v1:enc', key_version: 2 } });
      }),
      http.post(`${BASE}/v1/secret/data/password-manager/ent-123/passkeys/github`, async ({ request }) => {
        storedBody = await request.json();
        return new HttpResponse(null, { status: 204 });
      }),
    );

    const privateJwk = { kty: 'EC', crv: 'P-256', x: 'xxx', y: 'yyy', d: 'ddd' };
    const client = makeClient();
    await client.savePasskey('ent-123', {
      label: 'github',
      rpId: 'github.com',
      username: 'alice',
      credentialId: 'cred123',
      userHandle: 'uh1',
      algorithm: -7,
      counter: 0,
      privateJwk,
      createdAt: '2024-01-01T00:00:00.000Z',
    });

    expect(encryptedBody).toEqual({ plaintext: btoa(JSON.stringify(privateJwk)) });
    expect(storedBody).toEqual({
      data: {
        ciphertext: 'vault:v1:enc',
        keyVersion: '2',
        rpId: 'github.com',
        credentialId: 'cred123',
        userHandle: 'uh1',
        algorithm: '-7',
        counter: '0',
        username: 'alice',
        createdAt: '2024-01-01T00:00:00.000Z',
      },
    });
  });

  it('savePasskey stamps createdAt when none is supplied', async () => {
    let storedBody: { data: Record<string, string> } | undefined;
    server.use(
      http.post(`${BASE}/v1/transit/encrypt/passkey-ent-123`, () =>
        HttpResponse.json({ data: { ciphertext: 'vault:v1:enc', key_version: 1 } }),
      ),
      http.post(`${BASE}/v1/secret/data/password-manager/ent-123/passkeys/github`, async ({ request }) => {
        storedBody = (await request.json()) as { data: Record<string, string> };
        return new HttpResponse(null, { status: 204 });
      }),
    );

    await makeClient().savePasskey('ent-123', {
      label: 'github',
      rpId: 'github.com',
      credentialId: 'cred123',
      userHandle: 'uh1',
      algorithm: -7,
      counter: 0,
      privateJwk: { kty: 'EC' },
    });

    // Previously never written, so the UI always rendered an empty date.
    expect(storedBody?.data['createdAt']).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('readPasskey reads KV and decrypts the private JWK via transit', async () => {
    const privateJwk = { kty: 'EC', crv: 'P-256', x: 'xxx', y: 'yyy', d: 'ddd' };
    server.use(
      http.get(`${BASE}/v1/secret/data/password-manager/ent-123/passkeys/github`, () =>
        HttpResponse.json({
          data: {
            data: {
              ciphertext: 'vault:v1:xyz',
              keyVersion: '3',
              rpId: 'github.com',
              username: 'alice',
              credentialId: 'cred123',
              userHandle: 'uh1',
              algorithm: '-7',
              counter: '4',
            },
            metadata: { version: 1, created_time: '', deletion_time: '', destroyed: false },
          },
        }),
      ),
      http.post(`${BASE}/v1/transit/decrypt/passkey-ent-123`, () =>
        HttpResponse.json({ data: { plaintext: btoa(JSON.stringify(privateJwk)) } }),
      ),
    );

    const client = makeClient();
    const rec = await client.readPasskey('ent-123', 'github');

    expect(rec.label).toBe('github');
    expect(rec.rpId).toBe('github.com');
    expect(rec.username).toBe('alice');
    expect(rec.credentialId).toBe('cred123');
    expect(rec.userHandle).toBe('uh1');
    expect(rec.algorithm).toBe('-7');
    expect(rec.counter).toBe('4');
    expect(rec.keyVersion).toBe(3);
    expect(rec.privateJwk).toEqual(privateJwk);
  });
});
