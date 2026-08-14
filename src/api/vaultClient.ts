import {
  KVv2Metadata,
  PasskeyRecord,
  TokenInfo,
  TokenSelfLookup,
  VaultApiError,
  VaultMount,
} from '../types/vault';
import { Settings } from '../types/settings';

export class VaultClient {
  private readonly token: string | undefined;

  constructor(private settings: Settings, token?: string) {
    this.token = token;
  }

  private logRequest(method: string, url: string, body?: unknown): void {
    // Bodies are deliberately omitted: they carry passwords, private keys and
    // Transit plaintext, and extension console logs are easily exported.
    console.debug('[vault] request', {
      method,
      url,
      namespace: this.settings.namespace,
      hasToken: !!this.token,
      hasBody: body !== undefined,
    });
  }

  private logResponse(method: string, url: string, status: number): void {
    console.debug('[vault] response', { method, url, status });
  }

  /**
   * Percent-encodes each path segment while preserving "/" separators and any
   * trailing query string, so a secret label containing "?", "#" or ".." cannot
   * alter the request target.
   */
  private encodePath(path: string): string {
    const queryStart = path.indexOf('?');
    const rawPath = queryStart === -1 ? path : path.slice(0, queryStart);
    const query = queryStart === -1 ? '' : path.slice(queryStart);
    const encoded = rawPath
      .split('/')
      .map((segment) => encodeURIComponent(segment))
      .join('/');
    return `${encoded}${query}`;
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const { vaultUrl, namespace } = this.settings;
    const url = `${vaultUrl.replace(/\/$/, '')}${this.encodePath(path)}`;

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (this.token) {
      headers['X-Vault-Token'] = this.token;
    }
    if (namespace) {
      headers['X-Vault-Namespace'] = namespace;
    }

    this.logRequest(method, url, body);

    const response = await fetch(url, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });

    const responseText = await response.text();
    let responseBody: unknown = undefined;

    if (responseText) {
      try {
        responseBody = JSON.parse(responseText) as unknown;
      } catch {
        responseBody = responseText;
      }
    }

    this.logResponse(method, url, response.status);

    if (!response.ok) {
      const vaultErrors =
        responseBody &&
        typeof responseBody === 'object' &&
        'errors' in responseBody &&
        Array.isArray(responseBody.errors)
          ? (responseBody.errors as string[])
          : [];
      throw new VaultApiError(
        vaultErrors[0] ?? `Vault request failed with status ${response.status}`,
        response.status,
        vaultErrors,
      );
    }

    // 204 No Content — return empty object cast to T
    if (response.status === 204) {
      return {} as T;
    }

    return responseBody as T;
  }

  async detectKVVersion(mount: string): Promise<1 | 2> {
    const mounts = await this.listMounts();
    const key = `${mount}/`;
    const mountInfo = mounts[key];
    if (mountInfo?.options?.version === '2') {
      return 2;
    }
    return 1;
  }

  async listMounts(): Promise<Record<string, VaultMount>> {
    // GET /v1/sys/mounts wraps the mount map under `data`.
    const response = await this.request<{ data: Record<string, VaultMount> }>(
      'GET',
      '/v1/sys/mounts',
    );
    return response.data;
  }

  async listNamespaces(): Promise<string[]> {
    const response = await this.request<{ data: { keys: string[] } }>(
      'LIST',
      '/v1/sys/namespaces',
    );
    // Strip trailing slashes from each key and prefix with the root namespace
    // so callers always receive absolute namespace paths.
    const root = this.settings.namespace ? `${this.settings.namespace}/` : '';
    return (response.data?.keys ?? []).map((k) => `${root}${k.replace(/\/$/, '')}`);
  }

  async listSecrets(mount: string, path: string, kvVersion: 1 | 2): Promise<string[]> {
    const cleanPath = path ? `/${path}` : '';

    if (kvVersion === 2) {
      const response = await this.request<{ data: { keys: string[] } }>(
        'GET',
        `/v1/${mount}/metadata${cleanPath}?list=true`,
      );
      return response.data.keys;
    }

    try {
      const response = await this.request<{ data: { keys: string[] } }>('LIST', `/v1/${mount}${cleanPath}`);
      return response.data.keys;
    } catch (error) {
      if (!(error instanceof VaultApiError) || error.statusCode !== 405) {
        throw error;
      }

      const response = await this.request<{ data: { keys: string[] } }>(
        'GET',
        `/v1/${mount}${cleanPath}?list=true`,
      );
      return response.data.keys;
    }
  }

  async readSecret(
    mount: string,
    path: string,
    kvVersion: 1 | 2,
    version?: number,
  ): Promise<Record<string, string>> {
    let apiPath: string;
    if (kvVersion === 2) {
      apiPath = `/v1/${mount}/data/${path}`;
      if (version !== undefined) {
        apiPath += `?version=${version}`;
      }
    } else {
      apiPath = `/v1/${mount}/${path}`;
    }

    if (kvVersion === 2) {
      const response = await this.request<{
        data: { data: Record<string, string> };
      }>('GET', apiPath);
      return response.data.data;
    } else {
      const response = await this.request<{ data: Record<string, string> }>('GET', apiPath);
      return response.data;
    }
  }

  async createOrUpdateSecret(
    mount: string,
    path: string,
    data: Record<string, string>,
    kvVersion: 1 | 2,
  ): Promise<void> {
    if (kvVersion === 2) {
      await this.request('POST', `/v1/${mount}/data/${path}`, { data });
    } else {
      await this.request('POST', `/v1/${mount}/${path}`, data);
    }
  }

  async deleteSecret(mount: string, path: string, kvVersion: 1 | 2): Promise<void> {
    if (kvVersion === 2) {
      await this.request('DELETE', `/v1/${mount}/data/${path}`);
    } else {
      await this.request('DELETE', `/v1/${mount}/${path}`);
    }
  }

  async readMetadata(mount: string, path: string): Promise<KVv2Metadata> {
    return this.request<KVv2Metadata>('GET', `/v1/${mount}/metadata/${path}`);
  }

  async updateMetadata(
    mount: string,
    path: string,
    customMetadata: Record<string, string>,
  ): Promise<void> {
    await this.request('POST', `/v1/${mount}/metadata/${path}`, { custom_metadata: customMetadata });
  }

  async lookupToken(): Promise<TokenInfo> {
    const response = await this.request<{ data: TokenInfo }>('GET', '/v1/auth/token/lookup-self');
    return response.data;
  }

  /** Returns the full self-lookup response from GET /v1/auth/token/lookup-self. */
  async lookupTokenSelf(): Promise<TokenSelfLookup> {
    return this.request<TokenSelfLookup>('GET', '/v1/auth/token/lookup-self');
  }

  async renewToken(increment?: number): Promise<TokenInfo> {
    const body = increment !== undefined ? { increment: `${increment}s` } : undefined;
    const response = await this.request<{
      auth: {
        lease_duration: number;
        renewable: boolean;
        policies: string[];
        metadata?: { display_name?: string };
      };
    }>('POST', '/v1/auth/token/renew-self', body);
    return {
      ttl: response.auth.lease_duration,
      creation_ttl: response.auth.lease_duration,
      expire_time: '',
      renewable: response.auth.renewable,
      explicit_max_ttl: 0,
      period: 0,
      policies: response.auth.policies,
      display_name: response.auth.metadata?.display_name ?? '',
    };
  }

  async revokeToken(): Promise<void> {
    await this.request('POST', '/v1/auth/token/revoke-self');
  }

  async listPasswordPolicies(): Promise<string[]> {
    const response = await this.request<{ data: { keys: string[] } }>(
      'LIST',
      '/v1/sys/policies/password',
    );
    return response.data?.keys ?? [];
  }

  async generatePassword(policyName: string): Promise<string> {
    const response = await this.request<{ data: { password: string } }>(
      'GET',
      `/v1/sys/policies/password/${policyName}/generate`,
    );
    return response.data.password;
  }

  // -------------------------------------------------------------------------
  // Passkeys (Vault Transit)
  // -------------------------------------------------------------------------

  private transitMount(): string {
    return this.settings.pmTransitMount || 'transit';
  }

  /**
   * Transit key used to encrypt a user's passkeys. It is named after the
   * identity's entity ID so an ACL policy can grant each user access to only
   * their own key via the `{{identity.entity.id}}` template.
   */
  transitKeyName(entityId: string): string {
    return `passkey-${entityId}`;
  }

  /** Encrypts a plaintext secret blob via Transit and returns the ciphertext. */
  async transitEncrypt(
    plaintext: string,
    entityId: string,
  ): Promise<{ ciphertext: string; keyVersion: number }> {
    const response = await this.request<{ data: { ciphertext: string; key_version: number } }>(
      'POST',
      `/v1/${this.transitMount()}/encrypt/${this.transitKeyName(entityId)}`,
      { plaintext: this.encodeBase64(plaintext) },
    );
    return { ciphertext: response.data.ciphertext, keyVersion: response.data.key_version };
  }

  /** Decrypts a Transit ciphertext back to the original plaintext secret. */
  async transitDecrypt(ciphertext: string, entityId: string): Promise<string> {
    const response = await this.request<{ data: { plaintext: string } }>(
      'POST',
      `/v1/${this.transitMount()}/decrypt/${this.transitKeyName(entityId)}`,
      { ciphertext },
    );
    return this.decodeBase64(response.data.plaintext);
  }

  /** Saves a passkey: the private key JWK is encrypted via Transit, metadata stays plaintext in KV. */
  async savePasskey(
    entityId: string,
    input: {
      label: string;
      rpId: string;
      username?: string;
      credentialId: string;
      userHandle: string;
      algorithm: number;
      counter: number;
      privateJwk: JsonWebKey;
      /** Preserved across counter updates so it reflects first registration. */
      createdAt?: string;
    },
  ): Promise<void> {
    const mount = this.settings.pmMount || 'secret';
    const path = `password-manager/${entityId}/passkeys/${input.label}`;
    const { ciphertext, keyVersion } = await this.transitEncrypt(JSON.stringify(input.privateJwk), entityId);
    const data: Record<string, string> = {
      ciphertext,
      keyVersion: String(keyVersion),
      rpId: input.rpId,
      credentialId: input.credentialId,
      userHandle: input.userHandle,
      algorithm: String(input.algorithm),
      counter: String(input.counter),
      createdAt: input.createdAt ?? new Date().toISOString(),
    };
    if (input.username) data['username'] = input.username;
    await this.createOrUpdateSecret(mount, path, data, 2);
  }

  /** Reads a passkey from KV and decrypts its private key JWK via Transit. */
  async readPasskey(entityId: string, label: string): Promise<PasskeyRecord & { privateJwk: JsonWebKey }> {
    const mount = this.settings.pmMount || 'secret';
    const path = `password-manager/${entityId}/passkeys/${label}`;
    const data = await this.readSecret(mount, path, 2);
    const secret = JSON.parse(await this.transitDecrypt(data['ciphertext'], entityId)) as JsonWebKey;
    return {
      label,
      rpId: data['rpId'],
      username: data['username'],
      credentialId: data['credentialId'],
      userHandle: data['userHandle'],
      algorithm: data['algorithm'],
      counter: data['counter'],
      keyVersion: data['keyVersion'] ? Number(data['keyVersion']) : undefined,
      createdAt: data['createdAt'],
      ciphertext: data['ciphertext'],
      privateJwk: secret,
    };
  }

  /** Lists passkey metadata (without decrypting secrets). */
  async listPasskeys(
    entityId: string,
  ): Promise<
    Array<{
      label: string;
      rpId?: string;
      username?: string;
      credentialId?: string;
      userHandle?: string;
    }>
  > {
    const mount = this.settings.pmMount || 'secret';
    const prefix = `password-manager/${entityId}/passkeys`;
    let keys: string[];
    try {
      keys = await this.listSecrets(mount, prefix, 2);
    } catch {
      return [];
    }
    const rows: Array<{
      label: string;
      rpId?: string;
      username?: string;
      credentialId?: string;
      userHandle?: string;
    }> = [];
    for (const key of keys) {
      if (key.endsWith('/')) continue;
      try {
        const data = await this.readSecret(mount, `${prefix}/${key}`, 2);
        rows.push({
          label: key,
          rpId: data['rpId'],
          username: data['username'],
          credentialId: data['credentialId'],
          userHandle: data['userHandle'],
        });
      } catch {
        // skip unreadable passkeys
      }
    }
    return rows;
  }

  async deletePasskey(entityId: string, label: string): Promise<void> {
    const mount = this.settings.pmMount || 'secret';
    await this.deleteSecret(mount, `password-manager/${entityId}/passkeys/${label}`, 2);
  }

  private encodeBase64(input: string): string {
    const bytes = new TextEncoder().encode(input);
    let binary = '';
    for (const b of bytes) binary += String.fromCharCode(b);
    return btoa(binary);
  }

  private decodeBase64(input: string): string {
    const binary = atob(input);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return new TextDecoder().decode(bytes);
  }
}
