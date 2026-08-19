/**
 * MAIN-world content script: intercepts navigator.credentials.create()/get()
 * so the extension can act as a WebAuthn software authenticator.
 *
 * This script runs in the page's MAIN world (world: "MAIN"), where chrome.*
 * APIs are unavailable, so it communicates with the isolated-world bridge
 * (webauthnBridge.ts) via window.postMessage. The bridge forwards to the
 * background service worker, which performs the actual WebAuthn crypto (using
 * passkeys stored in Vault, gated on the Transit feature) and replies with a
 * synthetic public-key credential.
 *
 * If the extension cannot service a request (no bridge, transit disabled, or
 * no matching passkey), the original native flow is invoked as a fallback.
 */

(function () {
  const win = window as unknown as { __vaultWebAuthnInstalled?: boolean } & Window;
  if (win.__vaultWebAuthnInstalled) return;
  win.__vaultWebAuthnInstalled = true;

  const cred = win.navigator.credentials;
  if (!cred) return;
  const origCreate = cred.create.bind(cred);
  const origGet = cred.get.bind(cred);

  // Base64url <-> bytes (self-contained so the MAIN world has no dependencies).
  function bytesToB64(bytes: ArrayBuffer | ArrayBufferView): string {
    const u8 =
      bytes instanceof ArrayBuffer
        ? new Uint8Array(bytes)
        : new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    let binary = '';
    for (let i = 0; i < u8.length; i++) binary += String.fromCharCode(u8[i]);
    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }
  function toBytes(b64: string): Uint8Array {
    const b64std = b64.replace(/-/g, '+').replace(/_/g, '/');
    const padded = b64std + '='.repeat((4 - (b64std.length % 4)) % 4);
    const binary = atob(padded);
    const out = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
    return out;
  }

  // Time allowed for the bridge to acknowledge a request. Only covers "is the
  // extension there?" — once acknowledged the user may be reading a dialog, so
  // the deadline is relaxed rather than cancelling their session mid-decision.
  const ACK_TIMEOUT_MS = 5000;
  const INTERACTION_TIMEOUT_MS = 120000;

  /** Sentinel the bridge sends when the *user* declined (not a capability gap). */
  const CANCELLED = 'vault-webauthn:cancelled';

  interface PendingRequest {
    resolve: (result: unknown) => void;
    reject: (err: Error) => void;
    acknowledge: () => void;
  }
  const pending = new Map<string, PendingRequest>();

  function post(
    kind: 'create' | 'get' | 'signalUnknownCredential' | 'signalAllAcceptedCredentials',
    payload: unknown,
  ): Promise<unknown> {
    const requestId = `vaultwa-${Date.now()}-${Math.floor(Math.random() * 1e9)}`;
    return new Promise<unknown>((resolve, reject) => {
      let timer = setTimeout(() => {
        pending.delete(requestId);
        reject(new Error('vault-webauthn: no response from extension'));
      }, ACK_TIMEOUT_MS);

      pending.set(requestId, {
        resolve: (value) => {
          clearTimeout(timer);
          resolve(value);
        },
        reject: (err) => {
          clearTimeout(timer);
          reject(err);
        },
        acknowledge: () => {
          clearTimeout(timer);
          timer = setTimeout(() => {
            pending.delete(requestId);
            reject(new Error('vault-webauthn: timed out waiting for the user'));
          }, INTERACTION_TIMEOUT_MS);
        },
      });
      win.postMessage({ __vaultWebAuthn: 'request', kind, requestId, payload }, '*');
    });
  }

  win.addEventListener('message', (event) => {
    if (event.source !== win) return;
    const data = event.data as {
      __vaultWebAuthn?: string;
      requestId?: string;
      result?: unknown;
      error?: string;
    } | null;
    if (!data || !data.requestId) return;
    if (data.__vaultWebAuthn !== 'response' && data.__vaultWebAuthn !== 'ack') return;
    const entry = pending.get(data.requestId);
    if (!entry) return;
    if (data.__vaultWebAuthn === 'ack') {
      entry.acknowledge();
      return;
    }
    pending.delete(data.requestId);
    if (data.error) entry.reject(new Error(data.error));
    else entry.resolve(data.result);
  });

  function serializeCreate(
    options: PublicKeyCredentialCreationOptions,
  ): Record<string, unknown> {
    return {
      // rp.id is optional per spec; it defaults to the origin's effective domain.
      rpId: options.rp.id || win.location.hostname,
      rpName: options.rp.name,
      userHandle: options.user.id ? bytesToB64(options.user.id) : '',
      userName: options.user.name,
      userDisplayName: options.user.displayName,
      challenge: options.challenge ? bytesToB64(options.challenge) : '',
      pubKeyCredParams: (options.pubKeyCredParams || [{ type: 'public-key', alg: -7 }]).map((p) => ({
        type: p.type,
        alg: p.alg,
      })),
      origin: win.location.origin,
      userVerification: options.authenticatorSelection?.userVerification ?? 'preferred',
    };
  }

  function serializeGet(options: PublicKeyCredentialRequestOptions): Record<string, unknown> {
    return {
      // rpId is optional per spec; it defaults to the origin's effective domain.
      rpId: options.rpId || win.location.hostname,
      challenge: options.challenge ? bytesToB64(options.challenge) : '',
      origin: win.location.origin,
      userVerification: options.userVerification ?? 'preferred',
      allowCredentials: (options.allowCredentials || []).map((c) => ({
        type: c.type,
        id: c.id ? bytesToB64(c.id) : '',
      })),
    };
  }

  function buildGetCredential(result: Record<string, unknown>): PublicKeyCredential {
    const response = result.response as Record<string, string>;
    return {
      id: String(result.id),
      rawId: toBytes(String(result.rawId)),
      type: 'public-key',
      getClientExtensionResults: () => ({}),
      response: {
        clientDataJSON: toBytes(response.clientDataJSON),
        authenticatorData: toBytes(response.authenticatorData),
        signature: toBytes(response.signature),
        // Per spec userHandle is null when the credential has none; decoding an
        // absent value would throw.
        userHandle: response.userHandle ? toBytes(response.userHandle) : null,
      },
    } as unknown as PublicKeyCredential;
  }

  function buildCreateCredential(result: Record<string, unknown>): PublicKeyCredential {
    const response = result.response as Record<string, string>;
    return {
      id: String(result.id),
      rawId: toBytes(String(result.rawId)),
      type: 'public-key',
      getClientExtensionResults: () => ({}),
      response: {
        clientDataJSON: toBytes(response.clientDataJSON),
        attestationObject: toBytes(response.attestationObject),
        getTransports: () => ['internal'],
      },
    } as unknown as PublicKeyCredential;
  }

  /**
   * A dismissed dialog is an answer, not a missing capability. Retrying on the
   * platform authenticator would immediately re-prompt with the OS dialog the
   * user just declined, so cancellation is reported as the spec's
   * NotAllowedError instead.
   */
  function isCancellation(err: unknown): boolean {
    return err instanceof Error && err.message === CANCELLED;
  }

  function cancellationError(): DOMException {
    return new DOMException('The operation either timed out or was not allowed.', 'NotAllowedError');
  }

  // Falling back silently makes real failures indistinguishable from "no passkey
  // here", which is very hard to debug, so the reason is always logged before
  // deferring to the native authenticator.
  function fallback<T>(kind: string, err: unknown, invokeNative: () => T): T {
    console.info(
      `[vault-webauthn] ${kind}: deferring to the native authenticator — ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
    return invokeNative();
  }

  cred.create = (async (options?: CredentialCreationOptions) => {
    if (!options || !options.publicKey) return origCreate(options);
    try {
      const result = (await post('create', serializeCreate(options.publicKey))) as Record<
        string,
        unknown
      >;
      return buildCreateCredential(result);
    } catch (err) {
      if (isCancellation(err)) throw cancellationError();
      return fallback('create', err, () => origCreate(options));
    }
  }) as typeof cred.create;

  cred.get = (async (options?: CredentialRequestOptions) => {
    if (!options || !options.publicKey) return origGet(options);
    try {
      const result = (await post('get', serializeGet(options.publicKey))) as Record<string, unknown>;
      return buildGetCredential(result);
    } catch (err) {
      if (isCancellation(err)) throw cancellationError();
      return fallback('get', err, () => origGet(options));
    }
  }) as typeof cred.get;

  // -------------------------------------------------------------------------
  // Signal API (WebAuthn L3 §5.1.5–5.1.7)
  //
  // Deleting a passkey on a website only removes the server's copy; the site
  // tells authenticators to drop theirs through these static methods. Patching
  // create()/get() does not cover them, so without this a passkey deleted on the
  // site stays in Vault forever.
  //
  // Unlike create()/get(), a signal is a broadcast rather than a request for one
  // authenticator to service: the native implementation is still invoked so
  // Chrome can prune its own credentials too.
  // -------------------------------------------------------------------------

  interface SignalReport {
    rpId?: string;
    credentialId?: string;
    userId?: string;
    allAcceptedCredentialIds?: string[];
  }

  const PublicKeyCredentialCtor = (
    win as unknown as { PublicKeyCredential?: Record<string, unknown> }
  ).PublicKeyCredential;

  function installSignal(
    name: 'signalUnknownCredential' | 'signalAllAcceptedCredentials',
    serialize: (report: SignalReport) => Record<string, unknown>,
  ): void {
    if (!PublicKeyCredentialCtor) return;
    const native = PublicKeyCredentialCtor[name];
    const callNative =
      typeof native === 'function'
        ? (report: SignalReport) =>
            Promise.resolve(
              (native as (r: SignalReport) => unknown).call(PublicKeyCredentialCtor, report),
            ).catch(() => undefined)
        : () => Promise.resolve(undefined);

    PublicKeyCredentialCtor[name] = async (report: SignalReport) => {
      const forwarded = post(name, serialize(report || {})).catch((err: unknown) => {
        console.info(
          `[vault-webauthn] ${name}: not applied to Vault — ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      });
      // Per spec these resolve without revealing whether anything matched, so
      // both legs are awaited but neither failure is surfaced to the page.
      await Promise.all([callNative(report || {}), forwarded]);
    };
  }

  installSignal('signalUnknownCredential', (report) => ({
    rpId: report.rpId || win.location.hostname,
    credentialId: report.credentialId || '',
    origin: win.location.origin,
  }));

  installSignal('signalAllAcceptedCredentials', (report) => ({
    rpId: report.rpId || win.location.hostname,
    userId: report.userId || '',
    allAcceptedCredentialIds: Array.isArray(report.allAcceptedCredentialIds)
      ? report.allAcceptedCredentialIds
      : [],
    origin: win.location.origin,
  }));
})();
