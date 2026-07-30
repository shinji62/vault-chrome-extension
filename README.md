# Vault Chrome Extension

A password manager Chrome extension that connects to HashiCorp Vault. Browse, create, edit, and
delete KV secrets directly from your browser, with auto-fill and auto-save for login forms.

---

## Screenshots

| Options page | Mount picker |
|---|---|
| ![Options page](docs/screenshots/options-page.png) | ![Mount picker](docs/screenshots/mount-picker.png) |

| Secret browser | Secret detail |
|---|---|
| ![Secret browser](docs/screenshots/secret-browser.png) | ![Secret detail](docs/screenshots/secret-detail.png) |

| Auto-fill overlay | Auto-save banner |
|---|---|
| ![Auto-fill overlay](docs/screenshots/autofill-overlay.png) | ![Auto-save banner](docs/screenshots/autosave-banner.png) |

---

## Prerequisites

| Requirement | Version |
|---|---|
| Node.js | 18 or later |
| npm | 9 or later |
| Google Chrome | 88 or later (Manifest V3 support) |
| HashiCorp Vault | 1.9 or later |
| Vault KV secret engine | v1 or v2 mounted (v2 required for auto-fill/auto-save) |

For OIDC authentication, your Vault instance must have the OIDC auth method enabled and configured.

---

## Build & Install

```bash
# 1. Install dependencies
cd vault-chrome-extension
npm install

# 2. Build the extension
npm run build

# 3. Load in Chrome
#    → Open chrome://extensions
#    → Enable "Developer mode" (top-right toggle)
#    → Click "Load unpacked"
#    → Select the dist/ folder produced by the build
```

For development with automatic rebuilds on file changes:

```bash
npm run dev
```

---

## Configuration

Open the extension options page by:
- Clicking the extension icon → **⚙ Settings**, or
- Navigating to `chrome://extensions` → Vault Extension → "Extension options"

### Vault URL

Enter the full HTTPS URL of your Vault instance, e.g. `https://vault.example.com`.
HTTP URLs are not accepted.

### Namespace _(optional)_

For Vault Enterprise, enter your namespace path, e.g. `admin` or `my-org/my-team`.
Leave blank for open-source Vault.

This namespace becomes the **root namespace** for your session — all secret browsing, mount
listing, and child-namespace discovery are scoped to it. For example, if you log in with
namespace `admin`:

- The NS picker lists child namespaces as absolute paths: `admin/team-a`, `admin/team-b`.
- Switching into a child namespace sets the active namespace to its absolute path.
- The **↩ admin** button in the status bar returns you to `admin`, not the global root.

### Authentication Method

#### Token

1. Select **Token** as the auth method.
2. Paste your Vault token into the token field.
3. Click **Verify & Save** — the extension validates the token against Vault before saving.

To generate a token:

```bash
vault token create -policy=default -ttl=24h
```

#### OIDC

1. Select **OIDC** as the auth method.
2. Enter the OIDC **role name** configured in your Vault OIDC auth mount.
3. _(Optional)_ Set the **OIDC mount path** if it is not the default `oidc`.
4. Click **Login with OIDC** — a browser tab opens and handles the OAuth flow with your
   identity provider.
5. After successful authentication the token is saved automatically and the tab closes.

### Disconnect

Click **Disconnect** to revoke the current Vault token and clear all stored credentials.

---

## Secret Browser

Click the extension icon to open the popup.

### Namespace Picker

The status bar contains an **NS** dropdown showing the current namespace.

- While connected, the dropdown lists all child namespaces of the root namespace (the one set
  at login time). Selecting a child switches the active namespace to its absolute path
  (e.g. `admin/team-a`).
- When inside a child namespace, a **↩ \<root\>** button appears to return to the login-time
  root.
- The root option in the dropdown always represents the login-time namespace, not the global
  Vault root.

> Namespace switching requires Vault Enterprise with namespaces enabled. On open-source Vault
> the dropdown will be empty and the NS picker is a no-op.

### Selecting a Mount

After logging in the popup shows the **mount picker** — a list of all secret engine mounts
visible from the current namespace:

- 🗂 **KV** mounts (v1 or v2) — click to start browsing secrets.
- 🔑 **SSH** mounts — listed but not yet interactive _(coming soon)_.

The KV version (v1 or v2) is auto-detected from the mount configuration.

### Navigating Secrets

- **Folders** (keys ending in `/`) are shown with a folder icon — click to navigate into them.
- **Secrets** are shown with a document icon — click to view their contents.
- Use the **breadcrumb trail** at the top to navigate back up the path.

### Viewing a Secret

Click a secret to open the detail view:

- Click **Retrieve** to load the secret data from Vault.
- Values are **masked by default** — click the eye icon to reveal.
- Click the **copy** icon next to any value to copy it to your clipboard.
- The **Edit** button opens the secret in edit mode.
- The **Delete** button shows a confirmation prompt before permanently deleting the secret.

For **KV v2 secrets**, a **Metadata** tab shows and lets you edit the `custom_metadata` fields,
including the `url` field used for auto-fill matching.

### Creating a Secret

Click **+ New Secret** while browsing a mount. Enter the secret name (path), then add key-value
pairs using the inline editor. For KV v2 secrets you will also be prompted to add a `url` metadata
field (used for auto-fill).

---

## Auto-fill

Auto-fill requires a **KV v2** mount and a `url` field stored in the secret's **custom metadata**.

### How it works

1. When a page with a password field is loaded, the extension injects a small **Vault** button
   next to the password input.
2. Clicking the button searches all KV v2 mounts for secrets whose `url` metadata field matches
   the current page's hostname (exact match or subdomain match).
3. Matching secrets are shown in a dropdown.
4. Selecting a credential fills the username and password fields automatically, dispatching native
   `input` and `change` events so React/Vue/Angular forms update their state.

### Setting up a secret for auto-fill

1. Create a KV v2 secret with `username` and `password` as the data keys.
2. Open the secret's **Metadata** tab and set `url` to the site's URL, e.g. `https://github.com`.
3. The extension matches on the hostname (`github.com`) — subdomains like `gist.github.com`
   will also match.

---

## Auto-save

After submitting a login form that has no matching Vault secret, a save-credential banner appears
at the top of the page.

### How it works

1. The extension detects password field `submit` events.
2. If no matching secret is found for the current hostname, a banner asks:
   **"Save this password to Vault?"**
3. Clicking **Save** stores the credentials in the first available KV v2 mount at path
   `passwords/{hostname}`, e.g. `passwords/github.com`. The `url` metadata field is also set.
4. Clicking **Dismiss** hides the banner without saving.

> **Note:** Auto-save is KV v2 only. Ensure you have at least one KV v2 mount available.

---

## Token Renewal

The extension automatically keeps your Vault session alive using a **TTL-driven renewal**
strategy — no user interaction is ever required.

### How it works

- After login (or on service worker startup with an existing token), the extension reads the
  token's `ttl` from Vault's `lookup-self` endpoint.
- A **one-shot alarm** is scheduled at `ttl × 2/3` seconds from now.
  - For **periodic tokens** (tokens with a `period`), the alarm fires at `period × 2/3`.
  - If `explicit_max_ttl` is set, the delay is capped so renewal happens before the hard ceiling.
- When the alarm fires, `renew-self` is called, the alarm is rescheduled with the new TTL, and
  the popup countdown **resets automatically**.
- If the token is **not renewable** or renewal fails, no further alarm is scheduled and a warning
  is shown in the UI.

### TTL Status Badge

The popup status bar shows the remaining TTL with colour coding:

| Colour | Meaning |
|---|---|
| 🟢 Green | TTL ≥ 30 minutes — healthy |
| 🟡 Amber | TTL between 5 and 30 minutes — renewal imminent |
| 🔴 Red | TTL < 5 minutes — renewal overdue or token not renewable |

### Token Limits

- If `explicit_max_ttl` is set on the token, it **cannot be renewed past that hard ceiling** —
  the UI will warn you when the ceiling is approaching.
- Tokens with TTL < 90 seconds are too short-lived for Chrome's alarm minimum (1 minute) — a
  warning is shown immediately and no renewal is scheduled.

---

## Tools Menu

Click the **🔧** button in the status bar to open the Tools menu.

### Token Info

Displays the full response from `GET /v1/auth/token/lookup-self`:

| Field | Description |
|---|---|
| Display name | Human-readable name attached to the token |
| Token type | `service`, `batch`, etc. |
| Accessor | Token accessor (non-sensitive handle) |
| Entity ID | Vault identity entity ID associated with the token |
| Policies | Comma-separated list of attached policies |
| TTL | Remaining TTL in seconds |
| Creation TTL | TTL at creation time |
| Expire time | Hard expiry timestamp (if set) |
| Renewable | Whether the token can be renewed |
| Orphan | Whether the token has no parent |
| Num uses | Remaining uses (0 = unlimited) |
| Path | Auth path used to create the token |
| Issue time | When the token was issued |

### Generate Password

Lists all Vault password policies (`sys/policies/password`) and generates a random password
from the selected policy. The generated password is copied to the clipboard automatically.

---

## Development

```bash
# Watch build (rebuilds on file changes)
npm run dev

# Run tests (34 tests, no Vault instance required)
npm test

# Run tests in watch mode
npm run test:watch

# Generate coverage report
npm run test:coverage

# Lint
npm run lint

# Format
npm run format
```

### Project Structure

```
vault-chrome-extension/
├── manifest.json               # Manifest V3 extension manifest
├── src/
│   ├── api/
│   │   ├── vaultClient.ts      # Vault HTTP client (all API calls)
│   │   ├── vaultClient.test.ts
│   │   └── auth.ts             # Token and OIDC login flows
│   ├── background/
│   │   ├── index.ts            # Service worker — message bridge + auto-renewal alarm
│   │   └── renewalScheduler.ts # TTL-driven alarm scheduling
│   ├── content/
│   │   ├── index.ts            # Content script entry point
│   │   ├── formDetector.ts     # Login form detection
│   │   ├── fillOverlay.ts      # Vault button + credentials dropdown (Shadow DOM)
│   │   ├── savePrompt.ts       # Save-credential banner (Shadow DOM)
│   │   └── messaging.ts        # Typed sendMessage wrappers
│   ├── hooks/
│   │   ├── useSettings.ts      # chrome.storage read/write hook; exposes rootNamespace
│   │   ├── useVaultClient.ts   # VaultClient instantiation hook
│   │   └── useTokenStatus.ts   # Token TTL hook; reacts to background auto-renewals
│   ├── options/
│   │   ├── index.html
│   │   ├── main.tsx
│   │   └── Options.tsx         # Settings / options page
│   ├── popup/
│   │   ├── index.html
│   │   ├── main.tsx
│   │   ├── Popup.tsx           # Root popup component
│   │   └── components/
│   │       ├── StatusBar.tsx   # Header + NS picker + TTL badge + Tools menu
│   │       ├── MountPicker.tsx # Mount selection screen (KV + SSH)
│   │       ├── MountSelector.tsx
│   │       ├── SecretList.tsx
│   │       ├── SecretDetail.tsx
│   │       ├── SecretForm.tsx
│   │       └── MetadataPanel.tsx
│   ├── styles/
│   │   ├── tokens.css          # CSS design tokens (+ dark mode)
│   │   ├── global.css          # Base reset + utility classes
│   │   └── content.css         # Shadow DOM styles for content scripts
│   ├── test/
│   │   └── setup.ts            # MSW server + chrome mock setup
│   ├── types/
│   │   ├── vault.ts            # Vault API response types
│   │   ├── settings.ts         # Settings and AuthMethod types
│   │   └── messages.ts         # Background worker message types
│   └── utils/
│       ├── urlMatcher.ts       # Hostname extraction and matching
│       └── urlMatcher.test.ts
└── vite.config.ts
```

---

## Security Notes

- The Vault token is stored in `chrome.storage.session` — it is held **in memory only** and is
  cleared when the browser is closed. It is never written to disk or synced across profiles.
- Settings (Vault URL, namespace, auth method) are stored in `chrome.storage.local` and are
  **not synced** across Chrome profiles or devices.
- Token is revoked server-side when you click **Disconnect**.
- All Vault API calls are made from the background service worker, which avoids CORS issues and
  keeps the token out of the content script context.
- Content script UI (Vault button, save banner) is rendered inside a **Shadow DOM** to prevent
  style injection attacks from host pages.
# vault-chrome-extension
