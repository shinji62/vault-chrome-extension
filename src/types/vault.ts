export class VaultApiError extends Error {
  constructor(
    message: string,
    public statusCode: number,
    public vaultErrors: string[],
  ) {
    super(message);
    this.name = 'VaultApiError';
  }
}

export interface VaultMount {
  type: string;
  options: { version?: string };
}

export interface VaultAuthToken {
  client_token: string;
  lease_duration: number;
  renewable: boolean;
  policies: string[];
}

export interface KVv1Secret {
  data: Record<string, string>;
}

export interface KVv2Secret {
  data: {
    data: Record<string, string>;
    metadata: {
      version: number;
      created_time: string;
      deletion_time: string;
      destroyed: boolean;
    };
  };
}

export interface KVv2Metadata {
  data: {
    custom_metadata: Record<string, string> | null;
    versions: Record<string, unknown>;
    current_version: number;
    created_time: string;
  };
}

export interface TokenInfo {
  ttl: number;
  creation_ttl: number;
  expire_time: string;
  renewable: boolean;
  explicit_max_ttl: number;
  period: number;
  policies: string[];
  display_name: string;
}

/** Full response shape from GET /v1/auth/token/lookup-self */
export interface TokenSelfLookup {
  request_id: string;
  data: {
    accessor: string;
    creation_time: number;
    creation_ttl: number;
    display_name: string;
    entity_id: string;
    expire_time: string | null;
    explicit_max_ttl: number;
    id: string;
    issue_time: string;
    meta: Record<string, string> | null;
    num_uses: number;
    orphan: boolean;
    path: string;
    period: number;
    policies: string[];
    renewable: boolean;
    ttl: number;
    type: string;
  };
}
