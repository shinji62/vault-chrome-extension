export type AuthMethod = 'token' | 'oidc';

export interface Settings {
  vaultUrl: string;
  namespace?: string;
  authMethod: AuthMethod;
  oidcRole?: string;
  /** Auth mount path for OIDC (default: "oidc") */
  oidcMount?: string;
  /** Override the redirect URI sent to Vault (must be in allowed_redirect_uris) */
  oidcRedirectUri?: string;
  /** Vault namespace dedicated to Password Manager storage (empty = root namespace) */
  pmNamespace?: string;
  /** KV v2 mount inside pmNamespace used for Password Manager storage (default: "secret") */
  pmMount?: string;
  /** Enable passkey support via the Vault Transit engine. When disabled, passkeys
   *  cannot be saved or read from this extension. */
  pmTransitEnabled?: boolean;
  /** Transit mount inside pmNamespace used to encrypt passkeys (default: "transit"). */
  pmTransitMount?: string;
}
