import { TokenInfo } from './vault';
import { WebAuthnGetResult, WebAuthnRegisterResult } from '../webauthn/webauthn';

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
export const STORE_PM_PENDING_USERNAME = 'STORE_PM_PENDING_USERNAME' as const;
export const GET_PM_PENDING_USERNAME = 'GET_PM_PENDING_USERNAME' as const;
export const WEB_AUTHN_CREATE = 'WEB_AUTHN_CREATE' as const;
export const WEB_AUTHN_GET = 'WEB_AUTHN_GET' as const;
export const WEB_AUTHN_LIST = 'WEB_AUTHN_LIST' as const;
export const WEB_AUTHN_SIGNAL_UNKNOWN_CREDENTIAL = 'WEB_AUTHN_SIGNAL_UNKNOWN_CREDENTIAL' as const;
export const WEB_AUTHN_SIGNAL_ALL_ACCEPTED_CREDENTIALS =
  'WEB_AUTHN_SIGNAL_ALL_ACCEPTED_CREDENTIALS' as const;

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

/**
 * Progress of an OIDC login, mirrored into session storage under
 * `OIDC_STATUS_KEY`.
 *
 * The popup is destroyed the moment the auth window takes focus, so the
 * `sendMessage` response is usually never delivered. This lets a reopened popup
 * tell "still in progress" and "failed" apart from "never attempted".
 */
export const OIDC_STATUS_KEY = 'vaultOidcStatus' as const;

/**
 * Upper bound on one OIDC login attempt, including credentials and MFA.
 * Shared so the background can abort the flow and the UI can discard a stale
 * `in-progress` status left behind by a service worker that died mid-flow.
 */
export const OIDC_TAB_TIMEOUT_MS = 5 * 60 * 1000;

export type OidcStatus =
  | { state: 'in-progress'; startedAt: number }
  | { state: 'error'; error: string; failedAt: number };

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

/** The RP's user-verification requirement (WebAuthn L2 §5.4.5). */
export type UserVerificationRequirement = 'required' | 'preferred' | 'discouraged';

export interface WebAuthnCreateMessage {
  type: typeof WEB_AUTHN_CREATE;
  rpId: string;
  rpName?: string;
  userHandle: string; // base64url
  userName: string;
  userDisplayName?: string;
  challenge: string; // base64url
  pubKeyCredParams: Array<{ type: string; alg: number }>;
  origin: string;
  userVerification?: UserVerificationRequirement;
  /** Name the user typed in the consent dialog; falls back to a derived label. */
  label?: string;
}

export interface WebAuthnGetMessage {
  type: typeof WEB_AUTHN_GET;
  rpId: string;
  challenge: string; // base64url
  origin: string;
  allowCredentials?: Array<{ type: string; id: string }>; // id base64url
  userVerification?: UserVerificationRequirement;
  /**
   * KV label of the passkey the user picked in the content-script chooser.
   * Required: without it the authenticator would have to guess which identity
   * to assert, which is exactly the silent behaviour the chooser replaces.
   */
  label: string;
}

/**
 * Asks which stored passkeys could satisfy a `get()` for this origin, so the
 * content script can render a chooser *before* any signature is produced.
 *
 * Returns metadata only — never key material.
 */
export interface WebAuthnListMessage {
  type: typeof WEB_AUTHN_LIST;
  rpId: string;
  origin: string;
  allowCredentials?: Array<{ type: string; id: string }>;
  userVerification?: UserVerificationRequirement;
}

/**
 * Relying party reports that it no longer recognises one credential — normally
 * because the user deleted the passkey on the website (WebAuthn L3 §5.1.6).
 * Without this, a deleted passkey lingers in Vault forever, since `create()`
 * and `get()` are the only other things the page ever calls.
 */
export interface WebAuthnSignalUnknownCredentialMessage {
  type: typeof WEB_AUTHN_SIGNAL_UNKNOWN_CREDENTIAL;
  rpId: string;
  credentialId: string; // base64url
  origin: string;
}

/**
 * Relying party enumerates every credential it still accepts for one user
 * (WebAuthn L3 §5.1.5). Anything stored for that user and rpId but absent from
 * the list has been revoked and is removed from Vault.
 */
export interface WebAuthnSignalAllAcceptedCredentialsMessage {
  type: typeof WEB_AUTHN_SIGNAL_ALL_ACCEPTED_CREDENTIALS;
  rpId: string;
  userId: string; // base64url user handle
  allAcceptedCredentialIds: string[]; // base64url
  origin: string;
}

/** One selectable passkey, as offered to the user. */
export interface WebAuthnChoice {
  label: string;
  username?: string;
  rpId: string;
  createdAt?: string;
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

export interface StorePmPendingUsernameMessage {
  type: typeof STORE_PM_PENDING_USERNAME;
  username: string;
  hostname: string;
}

export interface GetPmPendingUsernameMessage {
  type: typeof GET_PM_PENDING_USERNAME;
}

/** Credentials captured from a submitted login form, persisted so the auto-save
 *  prompt can be shown after a full-page navigation destroys the submit page. */
export interface PendingPmSave {
  username: string;
  password: string;
  storedAt: number;
}

/** Username typed on an earlier step of a multi-page login (e.g. a username
 *  page separate from the password page). Persisted per tab so the password
 *  page can pair it with the entered password when offering to save. */
export interface PendingPmUsername {
  username: string;
  hostname: string;
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
  | ClearPmPendingSaveMessage
  | StorePmPendingUsernameMessage
  | GetPmPendingUsernameMessage
  | WebAuthnCreateMessage
  | WebAuthnGetMessage
  | WebAuthnListMessage
  | WebAuthnSignalUnknownCredentialMessage
  | WebAuthnSignalAllAcceptedCredentialsMessage;

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
  Array<{ mount: string; path: string; username: string; password: string }>
>;
export type SavePmSecretResponse = BackgroundResponse<void>;
export type ListPmPasswordPoliciesResponse = BackgroundResponse<string[]>;
export type GeneratePmPasswordResponse = BackgroundResponse<string>;
export type StorePmPendingSaveResponse = BackgroundResponse<void>;
export type GetPmPendingSaveResponse = BackgroundResponse<PendingPmSave | undefined>;
export type ClearPmPendingSaveResponse = BackgroundResponse<void>;
export type StorePmPendingUsernameResponse = BackgroundResponse<void>;
export type GetPmPendingUsernameResponse = BackgroundResponse<PendingPmUsername | undefined>;
export type WebAuthnCreateResponse = BackgroundResponse<WebAuthnRegisterResult>;
export type WebAuthnGetResponse = BackgroundResponse<WebAuthnGetResult>;
export type WebAuthnListResponse = BackgroundResponse<WebAuthnChoice[]>;
/** Number of passkeys a signal removed from Vault. */
export type WebAuthnSignalResponse = BackgroundResponse<{ deleted: number }>;
