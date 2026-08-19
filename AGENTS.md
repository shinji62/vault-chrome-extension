# Vault Chrome Extension — agent notes

Chrome MV3 extension: HashiCorp Vault password manager (KV v2 only) plus a
software WebAuthn/passkey authenticator backed by Vault Transit.

## Commands

```bash
npm run typecheck        # tsc --noEmit
npm run lint             # eslint src --max-warnings 0
npm test                 # vitest run
npm run build            # emits dist/ (load unpacked)
npm run test:integration # disposable vault -dev container on :8210 (needs Docker/Podman)
npm run screenshots      # re-captures docs/screenshots/ from .preview/
```

The first four must pass, and they are exactly what the `ci` job runs. Lint runs with
`--max-warnings 0`. A clean tree is `150 passed | 16 skipped`, **zero errors**, exit 0 — the run
must be clean, not merely "all tests passed".

- Do **not** run `prettier --write` as a drive-by fix. `.prettierrc` sets
  `singleQuote: false` while the codebase is uniformly single-quoted, so 66 files are already
  "unformatted" and reformatting one rewrites most of it as unrelated churn. Prettier is not a
  CI step; match the surrounding style instead.
- `npm test` and `npm run test:integration` are separate CI jobs, so a Vault/container hiccup
  cannot be mistaken for a lint, unit-test or build regression.

### Vitest exits 1 while every test passes

`vitest` fails the run on an unhandled rejection even when all assertions hold, reporting
`Errors  N errors` under a green test list — so "150 passed" is not proof of a green build.
This bit the OIDC tab-flow suite: a timeout-driven rejection was only subscribed to *after*
`await vi.advanceTimersByTimeAsync(...)`, but that call fires the timer **and** drains the
microtask queue in the same turn, so the rejection was briefly unhandled and got recorded. With
fake timers, subscribe first, advance second:

```ts
const settled = expect(flow).rejects.toThrow(/…/);  // subscribe
await vi.advanceTimersByTimeAsync(1500);            // then fire the timer
await settled;
```

## Architecture

- `src/background/index.ts` — service worker; owns the `VaultClient`, handles all
  messages, runs the OIDC flow. Single `switch` on message type.
- `src/api/vaultClient.ts` — all Vault HTTP. `request()` centrally percent-encodes
  path segments, so **call sites must not** `encodeURIComponent` again.
- `src/webauthn/` — pure, dependency-free crypto/encoding; the best place for
  logic that deserves unit tests.
- `src/content/webauthnMain.ts` runs in the **MAIN** world and patches
  `navigator.credentials`. `webauthnBridge.ts` is the isolated-world half: not a
  plain relay — it *orchestrates* consent (`webauthnPrompt.ts`) before it
  messages the background. `webauthnPrompt.ts` renders both dialogs in a Shadow
  DOM host, styled from `styles/content.css` (`.vault-wa-*`, reusing the
  `.vault-save-*` card chrome).

A passkey request therefore takes four hops, and the order is load-bearing:

```
create: MAIN → bridge → [consent dialog] → WEB_AUTHN_CREATE  → savePasskey
get:    MAIN → bridge → WEB_AUTHN_LIST → [chooser] → WEB_AUTHN_GET → assertion
```

`WEB_AUTHN_LIST` returns metadata only. Nothing that produces or persists key
material runs until the user has answered.

## Gotchas learned the hard way

- **A login "form" is not always a `<form>`.** Many sites (e.g.
  `practicetestautomation.com/practice-test-login/`) render a `<div id="form">`
  of inputs plus a `<button id="submit">` whose `click` handler sets
  `window.location.href` — no `<form>` element, so **no `submit` event ever
  fires**. Relying solely on `submit` silently drops those logins (Chrome's own
  manager works because it doesn't need `submit`). The content script captures
  clicks on submit-looking controls and Enter in the password field via
  document-level *capture-phase* listeners (`isSubmitControl()` +
  `findRelatedLoginForm()` in `formDetector.ts`), running **before** the page's
  handler clears the fields. A `<button>` outside a form also defaults to
  `type="submit"`, which means nothing without a `<form>` — name hints
  ("Submit", "Log in", "Sign in"…) are what identify it. Only offer to save a
  same-page login if the form actually left the layout (a still-rendered
  password field ⇒ the login failed, don't prompt).
- **CBOR integer keys.** COSE_Key maps use integer labels (`1`, `3`, `-1`…).
  Encoding them as text strings produces `a2613102613326` instead of
  `a201020326`, and every relying party rejects the credential. `cbor.ts`
  deliberately keeps *non-canonical* numeric strings (`"01"`, `"1.5"`, `"-0"`)
  as text so decode(encode(x)) round-trips.
- **`rpId` is optional in the WebAuthn API** and defaults to the caller's
  effective domain. Forwarding it as `undefined` hashes `""`, silently yielding
  an rpIdHash nothing can match. `requireRpId()` now throws instead.
- **Never set the UV flag.** There is no PIN/biometric here, so authenticator
  data is UP-only and `userVerification: "required"` is refused (the page then
  falls back to the native authenticator). Check it with
  `isUserVerificationSatisfiable()` *before* prompting — `webAuthnGet()` also
  throws, but by then the user has already picked a passkey that can never be
  used. Reject early, prompt late.
- **Intercepting `navigator.credentials` also suppresses the browser's consent
  UI.** Chrome's authenticator dialog never appears once `create`/`get` are
  patched, so *the extension is the only thing that can ask*. Consent lives in
  `content/webauthnPrompt.ts` and is collected by the bridge **before** the
  background is messaged, so declining leaves no key material in Vault. An
  authenticator that never prompts is the bug, not a convenience.
- **`get()` must not choose an identity.** Picking `matches[0]` silently signs
  in as whichever passkey Vault happened to list first. The bridge asks
  `WEB_AUTHN_LIST` (metadata only, no private keys) to populate a chooser, then
  sends the user's `label` to `WEB_AUTHN_GET`. The label arrives from the page's
  process, so the background **re-filters it against the candidate set** — never
  trust it as a KV path.
- **Cancelling is an answer, not a capability gap.** `fallback()` exists for "we
  can't service this", but routing a dismissal there re-triggers the platform
  authenticator and re-prompts the user with the OS dialog they just declined.
  The bridge signals `vault-webauthn:cancelled`, which the MAIN world converts
  to a spec `NotAllowedError`.
- **A fixed message timeout cannot wrap a human decision.** The old flat 5 s
  deadline would abort while the dialog was still open. The bridge now `ack`s
  immediately (proving the extension is present) and the MAIN world then swaps
  the 5 s ack timer for a long interaction timer. Keep both bounds: an
  un-acked request must still fail fast.
- **The MAIN-world hook is attacker-reachable.** A page can forge bridge
  messages, so the background validates `sender.origin` against the claimed
  origin *and* the requested `rpId` (`src/webauthn/origin.ts`, registrable-suffix
  rule — `notexample.com` must not match rpId `example.com`).
- **Passkey labels must be unique per credential**, otherwise re-registering
  overwrites the KV entry — silently destroying the old private key. Both
  builders end in a credential-id suffix for this reason: `passkeyLabel()`
  (derived) and `passkeyLabelFromUserName()` (what the user typed in the consent
  dialog). A user-chosen name is *not* exempt. Labels are also sanitised because
  `/` would create nested KV paths.
- **Deletion arrives through the Signal API, not `create`/`get`.** Removing a
  passkey on a website only deletes the *server's* copy; the site tells
  authenticators to drop theirs via the static
  `PublicKeyCredential.signalUnknownCredential()` /
  `signalAllAcceptedCredentials()` (WebAuthn L3 §5.1.5–5.1.7). Patching
  `navigator.credentials` alone therefore leaks storage forever — deleted
  passkeys accumulate in Vault. `webauthnMain.ts` patches both signals and
  `src/webauthn/signal.ts` decides what they condemn.
- **Signals are a broadcast, not a request to service.** Unlike `create`/`get`,
  where exactly one authenticator answers and `fallback()` defers to the native
  one, a signal must reach *every* authenticator: the MAIN world calls the native
  implementation **and** forwards to the extension, so Chrome can still prune its
  own credentials. Both legs resolve void — the spec forbids revealing whether
  anything matched, so nothing is surfaced to the page.
- **`signalAllAcceptedCredentials` must stay scoped to `userHandle`.** It only
  enumerates one user's credentials, so filtering by `rpId` alone would delete
  every other account stored for that site. An empty
  `allAcceptedCredentialIds` is a legitimate "this user has none left" and *is*
  honoured — which is exactly why the user scope is the only thing preventing a
  site-wide erase. `selectSignalledRevokedCredentials()` returns `[]` without a
  user handle rather than falling back to a broader match.
- **Compare signalled ids canonically.** Credential ids cross a process boundary
  from the page, so padding and the base64 alphabet cannot be assumed to match
  what `savePasskey` stored. A raw string compare silently matches nothing and
  leaves the passkey in Vault — the failure looks identical to "no such
  credential". Use `canonicaliseB64Url()`.
- **A signal that cannot reach Vault must not report success.** "Store
  unavailable" and "nothing to delete" are indistinguishable to the caller, so
  `requirePasskeyStore()` throws when the PM client, entity id or Transit is
  missing instead of returning an empty list.
- **Don't log request/response bodies** in `vaultClient` — they contain
  passwords, private JWKs and Transit plaintext.
- Mode A (`searchSecretsByUrl`) discovers secrets by walking KV, one metadata
  read per secret. Keep the depth/count caps and bounded concurrency, and match
  on `custom_metadata.url` *before* reading secret data.

## OIDC login is a three-way lifetime problem

`Options` renders *inside the popup* (`Popup.tsx`); there is no `options_page`.
Chrome destroys a popup as soon as it loses focus, which
`chrome.identity.launchWebAuthFlow` always causes. Consequences:

- The `sendMessage` response for `OIDC_LOGIN` is normally **never delivered**.
  A rejection there means "popup closed", not "login failed" — treating it as an
  error shows a spurious message after a successful login.
- MV3 reaps an idle service worker after ~30s, and a pending
  `launchWebAuthFlow` callback does **not** reset that timer. Since nothing was
  persisted until the flow returned, a slow login (MFA, typing) silently lost
  the token. Wrap the flow in `withKeepAlive` (`background/keepAlive.ts`).
  Symptom of this bug: first login appears to do nothing, second login succeeds
  *without showing a window* (IdP cookie makes it instant, so the worker
  survives). "Works on the second try" ⇒ suspect worker lifetime, not logic.
- UI state must be recovered from session storage (`OIDC_STATUS_KEY`) on mount,
  since the component that started the flow no longer exists to receive it.
- Write `vaultToken` (session) **before** `vaultSettings` (local):
  `chrome.storage.local.onChanged` triggers `rebuildClient()`, which nulls the
  client if the token half is not yet present.

## Testing notes

- **Never verify encoder output with our own decoder.** A symmetric bug cancels
  out. This is not hypothetical: an integration test that read the COSE key back
  via `cborDecode` still passed with the integer-key fix reverted. Assert raw
  bytes (`a5010203262001215820…`, 77 bytes for EC2/ES256) and import with
  `node:crypto` `createPublicKey`, then `verify()` the DER signature.
- Unit tests stub Vault with msw (`onUnhandledRequest: 'error'`).
- `npm run test:integration` runs `scripts/integration-test.sh`: a disposable
  `hashicorp/vault` dev container on port 8210, transit enabled, torn down
  afterwards. It needs Docker or Podman (auto-detected, override with
  `VAULT_TEST_ENGINE`) rather than a local `vault` binary, so CI and a developer
  machine run the same path. Transit and the password policy are provisioned over
  the HTTP API for that reason — don't reintroduce `vault` CLI calls.
- The suite self-skips unless `VAULT_TEST_ADDR` is set, which the script exports.
  That makes a *silent pass* the failure mode to guard against: if the server
  never came up, the tests would skip and the job would still be green. The
  script therefore hard-fails on a missing engine, unreachable daemon or an
  unhealthy server instead of letting vitest report "16 skipped".
- The integration file needs `@vitest-environment node`; the default happy-dom
  enforces browser CORS and blocks requests the extension makes legitimately via
  `host_permissions`.
- **`webAuthnCreate().secret` uses `userName`; `savePasskey()` takes
  `username`.** Spreading one into the other silently drops it, and TypeScript
  won't flag it (spreads skip excess-property checks). Map fields explicitly, as
  `background/index.ts` does.
- **Consent logic is testable; the dialogs are not (yet).** Keep decisions in
  pure helpers in `src/webauthn/` — `selectPasskeyCandidates()`,
  `passkeyLabelFromUserName()`, `isUserVerificationSatisfiable()` are unit-tested
  there. The DOM in `webauthnPrompt.ts` and the postMessage choreography in
  `webauthnBridge.ts` / `webauthnMain.ts` have **no automated coverage**, so
  changes to the prompt/ack/cancel flow need a manual pass: register a passkey,
  cancel a registration, sign in with two passkeys stored, and dismiss the
  chooser (the page must see `NotAllowedError`, *not* the OS dialog). Add
  "delete the passkey on the site and confirm it disappears from Vault" to that
  pass — the Signal API path is only covered up to the message boundary.
  A throwaway way to check the MAIN-world half without Chrome: `win.eval()` the
  built `dist/src/content/webauthnMain.js` in a happy-dom `Window` with a fake
  bridge listener. Note that happy-dom's `navigator.credentials` is a read-only
  `null`, so it needs `Object.defineProperty` — a plain assignment is dropped and
  the script bails out at its `if (!cred) return`, which looks exactly like the
  patch not working.
- **`selectPasskeyCandidates` is where an authorisation bug would hide.** Its
  tests deliberately cover the empty `allowCredentials` array (must not exclude
  everything) and cross-rpId isolation, because both failure modes are silent —
  one breaks login, the other leaks the wrong credential.
