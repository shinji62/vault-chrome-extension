import { TokenInfo } from './vault';

// Message type constants
export const LOOKUP_TOKEN = 'LOOKUP_TOKEN' as const;
export const RENEW_TOKEN = 'RENEW_TOKEN' as const;
export const SEARCH_SECRETS_BY_URL = 'SEARCH_SECRETS_BY_URL' as const;
export const GET_SECRET = 'GET_SECRET' as const;
export const SAVE_SECRET = 'SAVE_SECRET' as const;
export const OIDC_LOGIN = 'OIDC_LOGIN' as const;

// Message interfaces
export interface LookupTokenMessage {
  type: typeof LOOKUP_TOKEN;
}

export interface RenewTokenMessage {
  type: typeof RENEW_TOKEN;
  increment?: number;
}

export interface SearchSecretsByUrlMessage {
  type: typeof SEARCH_SECRETS_BY_URL;
  url: string;
}

export interface GetSecretMessage {
  type: typeof GET_SECRET;
  mount: string;
  path: string;
  kvVersion: 1 | 2;
}

export interface SaveSecretMessage {
  type: typeof SAVE_SECRET;
  mount: string;
  path: string;
  username: string;
  password: string;
  url: string;
}

export interface OidcLoginMessage {
  type: typeof OIDC_LOGIN;
  vaultUrl: string;
  mount: string;
  role?: string;
  namespace?: string;
  redirectUri?: string;
  /** Full settings draft — background will persist settings+token to storage on success */
  settings: import('./settings').Settings;
}

// Discriminated union of all message types
export type ExtensionMessage =
  | LookupTokenMessage
  | RenewTokenMessage
  | SearchSecretsByUrlMessage
  | GetSecretMessage
  | SaveSecretMessage
  | OidcLoginMessage;

// Typed response wrapper
export type BackgroundResponse<T> = { success: true; data: T } | { success: false; error: string };

// Convenience response aliases
export type LookupTokenResponse = BackgroundResponse<TokenInfo>;
export type RenewTokenResponse = BackgroundResponse<TokenInfo>;
export type SearchSecretsByUrlResponse = BackgroundResponse<
  Array<{ mount: string; path: string; username: string }>
>;
export type GetSecretResponse = BackgroundResponse<Record<string, string>>;
export type SaveSecretResponse = BackgroundResponse<void>;
