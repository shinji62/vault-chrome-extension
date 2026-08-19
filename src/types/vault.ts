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

/** A WebAuthn passkey stored by the Password Manager. Only the private key
 *  (JWK) is encrypted at rest via the Vault Transit engine; the remaining
 *  fields are plaintext metadata the software authenticator needs. */
export interface PasskeyRecord {
  /** Human-readable name shown in the list (leaf key of the stored path). */
  label: string;
  /** Relying party ID the passkey belongs to (e.g. "example.com"). */
  rpId: string;
  /** Account username associated with the passkey. */
  username?: string;
  /** WebAuthn credential id, base64url. */
  credentialId: string;
  /** WebAuthn user handle, base64url. */
  userHandle: string;
  /** COSE signing algorithm as a string, e.g. "-7" for ES256. */
  algorithm: string;
  /** WebAuthn signature counter as a string. */
  counter: string;
  /** Transit-encrypted private key (JWK) JSON. */
  ciphertext: string;
  /** Transit key version used when encrypting (v1/v2...). */
  keyVersion?: number;
  /** ISO timestamp of creation. */
  createdAt?: string;
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
