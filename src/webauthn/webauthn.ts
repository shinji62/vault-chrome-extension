/**
 * Minimal WebAuthn client (CTAP2-level) for a software authenticator.
 * Implements registration (create) and authentication (get) responses that
 * a relying party will accept, using the Web Crypto API.
 *
 * Only ES256 (ECDSA P-256, COSE alg -7) is currently supported; key material
 * is imported/exported as JWK. All binary values crossing the module boundary
 * are base64url strings so the results are JSON-serializable for messaging.
 */
import {
  base64UrlToBytes,
  bytesToBase64Url,
  concatBytes,
} from './base64';
import { cborEncode } from './cbor';

export const COSE_ES256 = -7;

/** WebAuthn authenticator data flag bits (WebAuthn L2 §6.1). */
const FLAG_UP = 0x01; // User Present
const FLAG_UV = 0x04; // User Verified
const FLAG_AT = 0x40; // Attested credential data included

/**
 * This is a *software* authenticator with no PIN, biometric or presence check,
 * so it must never claim User Verification. Setting UV without verifying the
 * user misrepresents the assertion to relying parties that require it.
 */
const USER_VERIFIED = false;

function baseFlags(): number {
  return FLAG_UP | (USER_VERIFIED ? FLAG_UV : 0);
}

export interface WebAuthnRegisterRequest {
  rp: { id: string; name?: string };
  user: { id: string; name: string; displayName?: string };
  challenge: string; // base64url
  pubKeyCredParams: Array<{ type: string; alg: number }>;
  origin: string;
  /** RP's UV requirement. "required" is rejected: we cannot verify a user. */
  userVerification?: 'required' | 'preferred' | 'discouraged';
}

export interface WebAuthnRegisterResult {
  id: string; // base64url credentialId
  rawId: string;
  type: 'public-key';
  response: {
    clientDataJSON: string; // base64url
    attestationObject: string; // base64url
  };
  // Key material + metadata for persisting the new passkey.
  secret: {
    credentialId: string;
    rpId: string;
    userHandle: string; // base64url
    userName: string;
    algorithm: number;
    counter: number;
    privateJwk: JsonWebKey;
  };
}

export interface WebAuthnGetRequest {
  rpId: string;
  challenge: string; // base64url
  origin: string;
  userHandle: string; // base64url
  credentialId: string; // base64url
  privateJwk: JsonWebKey;
  signCount: number;
  /** RP's UV requirement. "required" is rejected: we cannot verify a user. */
  userVerification?: 'required' | 'preferred' | 'discouraged';
}

export interface WebAuthnGetResult {
  id: string;
  rawId: string;
  type: 'public-key';
  response: {
    clientDataJSON: string; // base64url
    authenticatorData: string; // base64url
    signature: string; // base64url of DER ECDSA signature
    userHandle: string; // base64url
  };
  newSignCount: number;
}

const subtle = crypto.subtle;

async function sha256(data: Uint8Array): Promise<Uint8Array> {
  return new Uint8Array(await subtle.digest('SHA-256', data as BufferSource));
}

// Derives a credential id by hashing deterministic inputs so the same passkey
// always yields the same id, which is what we persist and reference.
async function deriveCredentialId(keyParts: Uint8Array): Promise<Uint8Array> {
  return sha256(concatBytes(new TextEncoder().encode('vault-passkey'), keyParts));
}

function authenticateData(
  rpIdHash: Uint8Array,
  flags: number,
  signCount: number,
  attestedCredentialData?: Uint8Array,
): Uint8Array {
  const out = new Uint8Array(37 + (attestedCredentialData ? attestedCredentialData.length : 0));
  out.set(rpIdHash, 0);
  out[32] = flags;
  out[33] = (signCount >>> 24) & 0xff;
  out[34] = (signCount >>> 16) & 0xff;
  out[35] = (signCount >>> 8) & 0xff;
  out[36] = signCount & 0xff;
  if (attestedCredentialData) out.set(attestedCredentialData, 37);
  return out;
}

/** COSE_Key (RFC 8152 §13) for an EC2 P-256 / ES256 public key, as CBOR. */
function cosePublicKeyEs256(jwk: JsonWebKey): Record<string, unknown> {
  return {
    '1': 2, // kty: EC2
    '3': COSE_ES256, // alg: ES256
    '-1': 1, // crv: P-256
    '-2': base64UrlToBytes(jwk.x as string),
    '-3': base64UrlToBytes(jwk.y as string),
  };
}

function intToDer(intBytes: Uint8Array): Uint8Array {
  let i = 0;
  while (i < intBytes.length && intBytes[i] === 0) i++;
  let body = intBytes.slice(i);
  if (body.length === 0) body = new Uint8Array([0]);
  if (body[0] & 0x80) {
    const padded = new Uint8Array(body.length + 1);
    padded[0] = 0;
    padded.set(body, 1);
    body = padded;
  }
  return body;
}

/** Converts a signature to DER (WebCrypto may return raw P1363 in some runtimes). */
function sigToDer(sig: Uint8Array): Uint8Array {
  if (sig.byteLength !== 64) return sig; // already DER
  const r = sig.slice(0, 32);
  const s = sig.slice(32, 64);
  const rDer = intToDer(r);
  const sDer = intToDer(s);
  const seqLen = 2 + rDer.length + 2 + sDer.length;
  const out = new Uint8Array(2 + seqLen);
  out[0] = 0x30;
  out[1] = seqLen;
  out[2] = 0x02;
  out[3] = rDer.length;
  out.set(rDer, 4);
  const o = 4 + rDer.length;
  out[o] = 0x02;
  out[o + 1] = sDer.length;
  out.set(sDer, o + 2);
  return out;
}

async function signDer(privateKey: CryptoKey, data: Uint8Array): Promise<Uint8Array> {
  const raw = new Uint8Array(
    await subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, privateKey, data as BufferSource),
  );
  return sigToDer(raw);
}

function clientDataJson(
  type: 'webauthn.create' | 'webauthn.get',
  challenge: Uint8Array,
  origin: string,
): Uint8Array {
  return new TextEncoder().encode(
    JSON.stringify({
      type,
      challenge: bytesToBase64Url(challenge),
      origin,
      crossOrigin: false,
    }),
  );
}

/**
 * A missing rpId would silently hash the empty string, producing an
 * rpIdHash no relying party can match, so fail loudly instead.
 */
function requireRpId(rpId: string | undefined): string {
  const id = rpId?.trim();
  if (!id) {
    throw new Error('WebAuthn: rpId is missing — cannot compute rpIdHash.');
  }
  return id;
}

/**
 * Whether this authenticator can honestly satisfy the RP's UV requirement.
 * Exposed so a request can be declined *before* the user is prompted, rather
 * than after they have already consented to something that cannot proceed.
 */
export function isUserVerificationSatisfiable(
  userVerification: 'required' | 'preferred' | 'discouraged' | undefined,
): boolean {
  return !(userVerification === 'required' && !USER_VERIFIED);
}

/**
 * Refuses requests demanding user verification. This authenticator performs
 * none, so servicing them would require setting the UV flag dishonestly;
 * callers fall back to the native authenticator instead.
 */
function assertUserVerificationSatisfiable(
  userVerification: 'required' | 'preferred' | 'discouraged' | undefined,
): void {
  if (!isUserVerificationSatisfiable(userVerification)) {
    throw new Error(
      'WebAuthn: userVerification="required" is not supported by this software authenticator.',
    );
  }
}

/**
 * Builds the KV leaf name for a passkey. Includes the username and a short
 * credential-id fragment so registering a second passkey for the same site (or
 * for a second account) does not overwrite an existing one.
 *
 * Characters outside `[A-Za-z0-9._-]` are replaced, since "/" in a label would
 * silently create nested KV paths.
 */
export function passkeyLabel(
  rpId: string,
  username: string | undefined,
  credentialId: string,
): string {
  const user = username?.trim() ? sanitiseLabelPart(username.trim()) : 'default';
  return `${sanitiseLabelPart(rpId)}-${user}-${credentialIdSuffix(credentialId)}`;
}

function sanitiseLabelPart(value: string): string {
  return value.replace(/[^A-Za-z0-9._-]/g, '_');
}

function credentialIdSuffix(credentialId: string): string {
  return credentialId.replace(/[^A-Za-z0-9]/g, '').slice(0, 8);
}

/**
 * Turns a name the user typed into a KV leaf name.
 *
 * The credential-id suffix is appended even though the user named this one,
 * because two registrations for the same account would otherwise collide and
 * the second would overwrite the first passkey's key material.
 */
export function passkeyLabelFromUserName(name: string, credentialId: string): string {
  const base = sanitiseLabelPart(name.trim()) || 'passkey';
  return `${base}-${credentialIdSuffix(credentialId)}`;
}

/** The subset of stored passkey metadata needed to offer a credential choice. */
export interface PasskeyCandidate {
  label: string;
  rpId?: string;
  username?: string;
  credentialId?: string;
}

/**
 * Narrows stored passkeys to those usable for one `get()` call: the rpId must
 * match and, when the relying party supplied `allowCredentials`, the credential
 * must be one it listed.
 *
 * Returns *every* match rather than a single credential — picking one is the
 * user's decision, not the authenticator's.
 */
export function selectPasskeyCandidates<T extends PasskeyCandidate>(
  rows: T[],
  rpId: string,
  allowCredentials?: Array<{ id: string }>,
): T[] {
  const allowed = allowCredentials?.length
    ? new Set(allowCredentials.map((c) => c.id))
    : null;
  return rows.filter(
    (row) =>
      !!row.credentialId &&
      row.rpId === rpId &&
      (!allowed || allowed.has(row.credentialId)),
  );
}

function pickAlgorithm(params: Array<{ type: string; alg: number }>): number {
  for (const p of params) {
    if (p.type === 'public-key' && p.alg === COSE_ES256) return COSE_ES256;
  }
  throw new Error(
    `No supported algorithm requested (support: ES256/-7). Got: ${params.map((p) => p.alg).join(', ')}`,
  );
}

export async function webAuthnCreate(req: WebAuthnRegisterRequest): Promise<WebAuthnRegisterResult> {
  const rpId = requireRpId(req.rp.id);
  assertUserVerificationSatisfiable(req.userVerification);
  const alg = pickAlgorithm(req.pubKeyCredParams);
  const keyPair = await subtle.generateKey(
    { name: 'ECDSA', namedCurve: 'P-256' },
    true,
    ['sign', 'verify'],
  ) as CryptoKeyPair;
  const privateJwk = (await subtle.exportKey('jwk', keyPair.privateKey)) as JsonWebKey;
  const publicJwk = (await subtle.exportKey('jwk', keyPair.publicKey)) as JsonWebKey;

  const credentialId = await deriveCredentialId(
    concatBytes(base64UrlToBytes(req.user.id), base64UrlToBytes(publicJwk.x as string)),
  );

  const rpIdHash = await sha256(new TextEncoder().encode(rpId));
  const clientDataJSON = clientDataJson('webauthn.create', base64UrlToBytes(req.challenge), req.origin);

  // Attested credential data: AAGUID(16 zero) + credIdLen(2) + credId + COSE key.
  const coseKey = cborEncode(cosePublicKeyEs256(publicJwk));
  const attestedCredentialData = concatBytes(
    new Uint8Array(16),
    new Uint8Array([0, credentialId.length]),
    credentialId,
    coseKey,
  );

  const flags = baseFlags() | FLAG_AT;
  const signCount = 0;
  const authData = authenticateData(rpIdHash, flags, signCount, attestedCredentialData);

  // "none" attestation format — self-attested, no AAGUID anchoring.
  const attestationObject = cborEncode({
    fmt: 'none',
    attStmt: {},
    authData,
  });

  return {
    id: bytesToBase64Url(credentialId),
    rawId: bytesToBase64Url(credentialId),
    type: 'public-key',
    response: {
      clientDataJSON: bytesToBase64Url(clientDataJSON),
      attestationObject: bytesToBase64Url(attestationObject),
    },
    secret: {
      credentialId: bytesToBase64Url(credentialId),
      rpId,
      userHandle: req.user.id,
      userName: req.user.name,
      algorithm: alg,
      counter: signCount,
      privateJwk,
    },
  };
}

export async function webAuthnGet(req: WebAuthnGetRequest): Promise<WebAuthnGetResult> {
  const rpId = requireRpId(req.rpId);
  assertUserVerificationSatisfiable(req.userVerification);
  const privateKey = await subtle.importKey(
    'jwk',
    req.privateJwk,
    { name: 'ECDSA', namedCurve: 'P-256' },
    true,
    ['sign'],
  );

  const rpIdHash = await sha256(new TextEncoder().encode(rpId));
  const clientDataJSON = clientDataJson('webauthn.get', base64UrlToBytes(req.challenge), req.origin);
  const clientDataHash = await sha256(clientDataJSON);

  const newSignCount = req.signCount + 1;
  const authData = authenticateData(rpIdHash, baseFlags(), newSignCount);

  const signature = await signDer(privateKey, concatBytes(authData, clientDataHash));

  return {
    id: req.credentialId,
    rawId: req.credentialId,
    type: 'public-key',
    response: {
      clientDataJSON: bytesToBase64Url(clientDataJSON),
      authenticatorData: bytesToBase64Url(authData),
      signature: bytesToBase64Url(signature),
      userHandle: req.userHandle,
    },
    newSignCount,
  };
}
