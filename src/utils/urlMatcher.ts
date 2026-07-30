/**
 * Extracts the hostname from a URL string, stripping the `www.` prefix.
 * If the input has no protocol (i.e. it's already a bare hostname), it is
 * returned as-is after www-stripping.
 */
export function extractHostname(urlOrHostname: string): string {
  try {
    const { hostname } = new URL(urlOrHostname);
    return hostname.replace(/^www\./, '');
  } catch {
    // Not a valid URL — treat as a bare hostname
    return urlOrHostname.replace(/^www\./, '').split('/')[0].split('?')[0];
  }
}

/**
 * Returns true when the page's URL matches the secret's stored URL/hostname.
 * Matches on:
 *  - Exact hostname equality (after www-stripping both sides)
 *  - The page hostname is a subdomain of the secret's hostname
 *    e.g. secretUrl = "example.com", pageUrl = "https://app.example.com" → true
 */
export function hostnamesMatch(secretUrl: string, pageUrl: string): boolean {
  const secretHost = extractHostname(secretUrl);
  const pageHost = extractHostname(pageUrl);

  if (!secretHost || !pageHost) {
    return false;
  }

  // Exact match (both www-stripped)
  if (secretHost === pageHost) {
    return true;
  }

  // Page is a subdomain of the secret host
  if (pageHost.endsWith(`.${secretHost}`)) {
    return true;
  }

  // Secret host is a subdomain of the page host (e.g. secret stored "www.example.com", page is "example.com")
  if (secretHost.endsWith(`.${pageHost}`)) {
    return true;
  }

  return false;
}
