/**
 * WebAuthn Signal API selection logic (WebAuthn L3 §5.1.5–5.1.7).
 *
 * A relying party that removes a passkey server-side has no way to reach into
 * an authenticator from `create()`/`get()`; it announces the change through
 * `PublicKeyCredential.signalUnknownCredential()` and
 * `signalAllAcceptedCredentials()`. These helpers decide which stored records a
 * signal condemns, kept pure so the deletion rules are unit-testable without a
 * Vault or a DOM.
 */

/** The subset of stored passkey metadata a signal is matched against. */
export interface SignalTarget {
  label: string;
  rpId?: string;
  credentialId?: string;
  userHandle?: string;
}

/**
 * Canonicalises a base64url value for comparison.
 *
 * Signalled ids cross a process boundary from the page, so padding and the
 * base64 alphabet cannot be assumed to match what was stored. Comparing raw
 * strings would silently fail to match and leave the passkey in Vault — the
 * exact bug this module exists to fix.
 */
export function canonicaliseB64Url(value: string): string {
  return value.trim().replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function sameId(a: string | undefined, b: string | undefined): boolean {
  if (!a || !b) return false;
  return canonicaliseB64Url(a) === canonicaliseB64Url(b);
}

/**
 * Records condemned by `signalUnknownCredential`: the relying party no longer
 * recognises this one credential, so only an exact rpId + credentialId pair
 * matches.
 */
export function selectSignalledUnknownCredential<T extends SignalTarget>(
  rows: T[],
  rpId: string,
  credentialId: string,
): T[] {
  if (!rpId || !credentialId) return [];
  return rows.filter((row) => row.rpId === rpId && sameId(row.credentialId, credentialId));
}

/**
 * Records condemned by `signalAllAcceptedCredentials`: everything this user
 * still has for `rpId` is enumerated, so a stored credential missing from the
 * list has been revoked.
 *
 * Scoping by `userHandle` is what keeps the call from being a site-wide erase —
 * a relying party may only speak for the user it identifies, never for other
 * accounts stored under the same rpId. An empty `allAcceptedCredentialIds` is a
 * legitimate statement ("this user has none left") and is honoured, but only
 * within that one user's scope.
 */
export function selectSignalledRevokedCredentials<T extends SignalTarget>(
  rows: T[],
  rpId: string,
  userHandle: string,
  allAcceptedCredentialIds: string[],
): T[] {
  if (!rpId || !userHandle) return [];
  const accepted = new Set(allAcceptedCredentialIds.map(canonicaliseB64Url));
  return rows.filter(
    (row) =>
      row.rpId === rpId &&
      sameId(row.userHandle, userHandle) &&
      !!row.credentialId &&
      !accepted.has(canonicaliseB64Url(row.credentialId)),
  );
}
