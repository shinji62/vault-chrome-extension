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
}
