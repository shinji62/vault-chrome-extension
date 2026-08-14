/**
 * Isolated-world bridge for WebAuthn interception.
 *
 * The MAIN-world script (webauthnMain.ts) intercepts navigator.credentials and
 * posts structured requests here via window.postMessage. This script obtains
 * user consent in the page (the browser's own authenticator dialog is bypassed
 * by the interception, so nothing else would ask), then forwards the request to
 * the background service worker, which performs the crypto against
 * Vault-stored passkeys.
 *
 * Ordering matters: consent is collected *before* the background is asked to
 * create or assert a credential, so declining leaves no key material behind.
 */
import {
  WEB_AUTHN_CREATE,
  WEB_AUTHN_GET,
  WEB_AUTHN_LIST,
  WEB_AUTHN_SIGNAL_ALL_ACCEPTED_CREDENTIALS,
  WEB_AUTHN_SIGNAL_UNKNOWN_CREDENTIAL,
  WebAuthnChoice,
  WebAuthnCreateMessage,
  WebAuthnGetMessage,
  WebAuthnListMessage,
  WebAuthnSignalAllAcceptedCredentialsMessage,
  WebAuthnSignalUnknownCredentialMessage,
  BackgroundResponse,
} from '../types/messages';
import { confirmPasskeyCreate, choosePasskey } from './webauthnPrompt';

type BridgeKind = 'create' | 'get' | 'signalUnknownCredential' | 'signalAllAcceptedCredentials';

interface BridgeRequest {
  __vaultWebAuthn?: 'request';
  kind?: BridgeKind;
  requestId?: string;
  payload?: Record<string, unknown>;
}

/**
 * Marks a refusal that came from the user rather than from a missing
 * capability. The MAIN world must reject with NotAllowedError instead of
 * silently retrying on the platform authenticator, which would re-prompt and
 * defeat the choice just made.
 */
const CANCELLED = 'vault-webauthn:cancelled';

function reply(requestId: string, body: Record<string, unknown>): void {
  window.postMessage({ __vaultWebAuthn: 'response', requestId, ...body }, '*');
}

function send<T>(message: unknown): Promise<BackgroundResponse<T>> {
  return chrome.runtime.sendMessage(message) as Promise<BackgroundResponse<T>>;
}

/** Suggested Vault name for a new passkey, shown pre-filled in the dialog. */
function suggestedLabel(rpId: string, userName: string): string {
  return userName.trim() ? `${rpId}-${userName.trim()}` : rpId;
}

async function handleCreate(requestId: string, payload: Record<string, unknown>): Promise<void> {
  const rpId = String(payload.rpId ?? '');
  const userName = String(payload.userName ?? '');

  const consent = await confirmPasskeyCreate({
    rpId,
    userName,
    suggestedLabel: suggestedLabel(rpId, userName),
  });
  if (!consent) {
    reply(requestId, { error: CANCELLED });
    return;
  }

  const response = await send<unknown>({
    type: WEB_AUTHN_CREATE,
    ...payload,
    label: consent.label,
  } as WebAuthnCreateMessage);

  reply(
    requestId,
    response?.success ? { result: response.data } : { error: response?.error || 'Extension error' },
  );
}

async function handleGet(requestId: string, payload: Record<string, unknown>): Promise<void> {
  const rpId = String(payload.rpId ?? '');

  // Ask what is available first: with nothing stored the page should fall back
  // to the platform authenticator without the user ever seeing a Vault dialog.
  const listed = await send<WebAuthnChoice[]>({
    type: WEB_AUTHN_LIST,
    rpId,
    origin: payload.origin,
    allowCredentials: payload.allowCredentials,
    userVerification: payload.userVerification,
  } as WebAuthnListMessage);

  if (!listed?.success) {
    reply(requestId, { error: listed?.error || 'Extension error' });
    return;
  }
  if (listed.data.length === 0) {
    reply(requestId, { error: 'No passkey for this site' });
    return;
  }

  const choice = await choosePasskey(rpId, listed.data);
  if (!choice) {
    reply(requestId, { error: CANCELLED });
    return;
  }

  const response = await send<unknown>({
    type: WEB_AUTHN_GET,
    ...payload,
    label: choice.label,
  } as WebAuthnGetMessage);

  reply(
    requestId,
    response?.success ? { result: response.data } : { error: response?.error || 'Extension error' },
  );
}

/**
 * Forwards a Signal API report so the background can drop revoked passkeys from
 * Vault.
 *
 * No consent dialog: the relying party is the authority on which of *its*
 * credentials still exist, and the user already expressed intent by deleting the
 * passkey on the site. Prompting here would also violate the spec's requirement
 * that these calls resolve without user-visible interaction.
 */
async function handleSignal(
  requestId: string,
  kind: 'signalUnknownCredential' | 'signalAllAcceptedCredentials',
  payload: Record<string, unknown>,
): Promise<void> {
  const message =
    kind === 'signalUnknownCredential'
      ? ({
          type: WEB_AUTHN_SIGNAL_UNKNOWN_CREDENTIAL,
          rpId: String(payload.rpId ?? ''),
          credentialId: String(payload.credentialId ?? ''),
          origin: String(payload.origin ?? ''),
        } as WebAuthnSignalUnknownCredentialMessage)
      : ({
          type: WEB_AUTHN_SIGNAL_ALL_ACCEPTED_CREDENTIALS,
          rpId: String(payload.rpId ?? ''),
          userId: String(payload.userId ?? ''),
          allAcceptedCredentialIds: Array.isArray(payload.allAcceptedCredentialIds)
            ? payload.allAcceptedCredentialIds.map(String)
            : [],
          origin: String(payload.origin ?? ''),
        } as WebAuthnSignalAllAcceptedCredentialsMessage);

  const response = await send<{ deleted: number }>(message);
  reply(
    requestId,
    response?.success ? { result: response.data } : { error: response?.error || 'Extension error' },
  );
}

const handlers: Record<
  BridgeKind,
  (requestId: string, payload: Record<string, unknown>) => Promise<void>
> = {
  create: handleCreate,
  get: handleGet,
  signalUnknownCredential: (id, payload) => handleSignal(id, 'signalUnknownCredential', payload),
  signalAllAcceptedCredentials: (id, payload) =>
    handleSignal(id, 'signalAllAcceptedCredentials', payload),
};

window.addEventListener('message', (event) => {
  if (event.source !== window) return;
  const data = event.data as BridgeRequest | null;
  if (!data || data.__vaultWebAuthn !== 'request' || !data.requestId || !data.payload) return;

  const { requestId, payload } = data;
  // `kind` arrives from the page, so only own properties count — an inherited
  // name like "constructor" would otherwise resolve to a callable.
  const work =
    data.kind && Object.prototype.hasOwnProperty.call(handlers, data.kind)
      ? handlers[data.kind]
      : undefined;
  if (!work) return;

  // The dialogs are open-ended, so the MAIN world stops waiting on a fixed
  // timer once this ack arrives (see webauthnMain.ts).
  window.postMessage({ __vaultWebAuthn: 'ack', requestId }, '*');

  work(requestId, payload).catch((err) => {
    reply(requestId, { error: err instanceof Error ? err.message : String(err) });
  });
});
