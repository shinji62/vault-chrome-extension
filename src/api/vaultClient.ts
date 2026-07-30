import { KVv2Metadata, TokenInfo, TokenSelfLookup, VaultApiError, VaultMount } from '../types/vault';
import { Settings } from '../types/settings';

export class VaultClient {
  private readonly token: string | undefined;

  constructor(private settings: Settings, token?: string) {
    this.token = token;
  }

  private logRequest(method: string, url: string, body?: unknown): void {
    console.log('[vault] request', {
      method,
      url,
      namespace: this.settings.namespace,
      hasToken: !!this.token,
      body,
    });
  }

  private logResponse(method: string, url: string, status: number, body: unknown): void {
    console.log('[vault] response', {
      method,
      url,
      status,
      body,
    });
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const { vaultUrl, namespace } = this.settings;
    const url = `${vaultUrl.replace(/\/$/, '')}${path}`;

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

    this.logResponse(method, url, response.status, responseBody);

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
    const response = await this.request<Record<string, VaultMount>>('GET', '/v1/sys/mounts');
    return response;
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
      `/v1/sys/policies/password/${encodeURIComponent(policyName)}/generate`,
    );
    return response.data.password;
  }
}
