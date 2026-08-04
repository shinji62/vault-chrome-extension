import { TokenInfo } from './vault';

// Message type constants
export const LOOKUP_TOKEN = 'LOOKUP_TOKEN' as const;
export const RENEW_TOKEN = 'RENEW_TOKEN' as const;
export const SEARCH_SECRETS_BY_URL = 'SEARCH_SECRETS_BY_URL' as const;
export const GET_SECRET = 'GET_SECRET' as const;
export const SAVE_SECRET = 'SAVE_SECRET' as const;
export const OIDC_LOGIN = 'OIDC_LOGIN' as const;
export const FILL_CREDENTIALS = 'FILL_CREDENTIALS' as const;
export const SEARCH_PM_SECRETS_BY_URL = 'SEARCH_PM_SECRETS_BY_URL' as const;
export const SAVE_PM_SECRET = 'SAVE_PM_SECRET' as const;
export const LIST_PM_PASSWORD_POLICIES = 'LIST_PM_PASSWORD_POLICIES' as const;
export const GENERATE_PM_PASSWORD = 'GENERATE_PM_PASSWORD' as const;
export const STORE_PM_PENDING_SAVE = 'STORE_PM_PENDING_SAVE' as const;
export const GET_PM_PENDING_SAVE = 'GET_PM_PENDING_SAVE' as const;
export const CLEAR_PM_PENDING_SAVE = 'CLEAR_PM_PENDING_SAVE' as const;

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

export interface FillCredentialsMessage {
  type: typeof FILL_CREDENTIALS;
  username: string;
  password: string;
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

export interface SearchPmSecretsByUrlMessage {
  type: typeof SEARCH_PM_SECRETS_BY_URL;
  url: string;
}

export interface SavePmSecretMessage {
  type: typeof SAVE_PM_SECRET;
  username: string;
  password: string;
  url: string;
  label: string;
}

export interface ListPmPasswordPoliciesMessage {
  type: typeof LIST_PM_PASSWORD_POLICIES;
}

export interface GeneratePmPasswordMessage {
  type: typeof GENERATE_PM_PASSWORD;
  policyName: string;
}

export interface StorePmPendingSaveMessage {
  type: typeof STORE_PM_PENDING_SAVE;
  username: string;
  password: string;
}

export interface GetPmPendingSaveMessage {
  type: typeof GET_PM_PENDING_SAVE;
}

export interface ClearPmPendingSaveMessage {
  type: typeof CLEAR_PM_PENDING_SAVE;
}

/** Credentials captured from a submitted login form, persisted so the auto-save
 *  prompt can be shown after a full-page navigation destroys the submit page. */
export interface PendingPmSave {
  username: string;
  password: string;
  storedAt: number;
}

// Discriminated union of all message types
export type ExtensionMessage =
  | LookupTokenMessage
  | RenewTokenMessage
  | SearchSecretsByUrlMessage
  | GetSecretMessage
  | SaveSecretMessage
  | OidcLoginMessage
  | FillCredentialsMessage
  | SearchPmSecretsByUrlMessage
  | SavePmSecretMessage
  | ListPmPasswordPoliciesMessage
  | GeneratePmPasswordMessage
  | StorePmPendingSaveMessage
  | GetPmPendingSaveMessage
  | ClearPmPendingSaveMessage;

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
export type SearchPmSecretsByUrlResponse = BackgroundResponse<
  Array<{ mount: string; path: string; username: string }>
>;
export type SavePmSecretResponse = BackgroundResponse<void>;
export type ListPmPasswordPoliciesResponse = BackgroundResponse<string[]>;
export type GeneratePmPasswordResponse = BackgroundResponse<string>;
export type StorePmPendingSaveResponse = BackgroundResponse<void>;
export type GetPmPendingSaveResponse = BackgroundResponse<PendingPmSave | undefined>;
export type ClearPmPendingSaveResponse = BackgroundResponse<void>;
