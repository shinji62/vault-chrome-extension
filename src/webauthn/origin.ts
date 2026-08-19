/**
 * Origin/rpId validation for the WebAuthn bridge.
 *
 * The MAIN-world interceptor is reachable by any page, and a page can post a
 * forged request to the isolated-world bridge. The background worker therefore
 * cannot trust the `origin`/`rpId` a message claims: it must check them against
 * the sender's real origin, which only Chrome can set.
 */

/** Extracts the hostname from an origin, or null when it isn't a valid URL. */
function hostnameOf(origin: string): string | null {
  try {
    return new URL(origin).hostname.toLowerCase() || null;
  } catch {
    return null;
  }
}

/** Extracts the origin from a URL, or null when it isn't a valid URL. */
function originOf(url: string): string | null {
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

/**
 * Implements the WebAuthn "registrable domain suffix" rule (L2 §5.1.3 step 7):
 * an rpId must equal the caller's hostname or be a parent domain of it.
 * "example.com" is valid for "app.example.com"; "evil.com" and the bare
 * public suffix "com" are not.
 */
export function isRpIdValidForOrigin(rpId: string, origin: string): boolean {
  const host = hostnameOf(origin);
  const id = rpId.trim().toLowerCase();
  if (!host || !id) return false;
  if (host === id) return true;
  // A suffix match must fall on a label boundary so "notexample.com" does not
  // match rpId "example.com".
  if (!host.endsWith(`.${id}`)) return false;
  // Reject a bare public suffix like "com", which would be far too broad.
  return id.includes('.');
}

/**
 * Throws unless the message genuinely came from a tab whose origin matches the
 * claimed origin, and that origin is entitled to the requested rpId.
 */
export function assertTrustedWebAuthnSender(
  sender: { origin?: string; url?: string; tab?: { id?: number } },
  claimedOrigin: string,
  rpId: string,
): void {
  // Chrome populates sender.origin for content scripts; fall back to the frame
  // URL's origin for older builds where only `url` is set.
  const senderOrigin = sender.origin ?? (sender.url ? originOf(sender.url) : null);

  if (!senderOrigin) {
    throw new Error('WebAuthn: request has no verifiable sender origin.');
  }
  if (senderOrigin !== claimedOrigin) {
    throw new Error(
      `WebAuthn: sender origin ${senderOrigin} does not match requested origin ${claimedOrigin}.`,
    );
  }
  if (!isRpIdValidForOrigin(rpId, senderOrigin)) {
    throw new Error(`WebAuthn: origin ${senderOrigin} may not act for rpId "${rpId}".`);
  }
}
