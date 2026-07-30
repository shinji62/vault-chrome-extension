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
