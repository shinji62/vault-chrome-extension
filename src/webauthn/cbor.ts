/**
 * Minimal CBOR encoder/decoder sufficient for WebAuthn:
 * attestationObject, COSE_Key maps, authenticator responses.
 * Supports: unsigned/negative integers, byte strings, text strings,
 * arrays, maps, booleans, null. Maps are represented as plain objects.
 *
 * Because JS object keys are always strings, keys that are canonical integers
 * ("1", "3", "-1") are encoded as CBOR *integer* labels — required by COSE_Key
 * (RFC 8152 §7). Non-integer keys ("fmt", "authData") encode as text strings.
 */

export type CborValue =
  | null
  | boolean
  | number
  | bigint
  | string
  | Uint8Array
  | unknown[]
  | Record<string, unknown>;

// ---------------------------------------------------------------------------
// Encoding
// ---------------------------------------------------------------------------

/**
 * Matches only *canonical* integer strings — those that survive
 * `String(Number(k)) === k` — so map keys round-trip losslessly.
 * "1"/"-3" encode as CBOR integers; "01", "-0", "1.0" and "1e3" stay text.
 */
const CANONICAL_INT_KEY = /^(0|-?[1-9]\d*)$/;

function encodeHead(major: number, value: number): number[] {
  const out: number[] = [];
  if (value < 24) {
    out.push((major << 5) | value);
  } else if (value <= 0xff) {
    out.push((major << 5) | 24, value);
  } else if (value <= 0xffff) {
    out.push((major << 5) | 25, (value >> 8) & 0xff, value & 0xff);
  } else if (value <= 0xffffffff) {
    out.push(
      (major << 5) | 26,
      (value >>> 24) & 0xff,
      (value >>> 16) & 0xff,
      (value >>> 8) & 0xff,
      value & 0xff,
    );
  } else {
    const big = BigInt(value);
    const bytes: number[] = [];
    for (let i = 7; i >= 0; i--) {
      bytes.push(Number((big >> BigInt(i * 8)) & 0xffn));
    }
    out.push((major << 5) | 27, ...bytes);
  }
  return out;
}

export function cborEncode(value: CborValue): Uint8Array {
  const bytes: number[] = [];

  function write(v: CborValue): void {
    if (v === null) {
      bytes.push(0xf6);
    } else if (typeof v === 'boolean') {
      bytes.push(v ? 0xf5 : 0xf4);
    } else if (typeof v === 'bigint') {
      if (v >= 0n) {
        pushNumber(0, v);
      } else {
        pushNumber(1, -v - 1n);
      }
    } else if (typeof v === 'number') {
      if (Number.isInteger(v) && v >= 0) {
        pushNumber(0, BigInt(v));
      } else if (Number.isInteger(v) && v < 0) {
        pushNumber(1, BigInt(-v - 1));
      } else {
        // float64 — used rarely; emit as major 7 (0xfb)
        const buf = new DataView(new ArrayBuffer(8));
        buf.setFloat64(0, v, false);
        bytes.push(0xfb);
        for (let i = 0; i < 8; i++) bytes.push(buf.getUint8(i));
      }
    } else if (typeof v === 'string') {
      const utf8 = new TextEncoder().encode(v);
      bytes.push(...encodeHead(3, utf8.length), ...utf8);
    } else if (v instanceof Uint8Array) {
      bytes.push(...encodeHead(2, v.length), ...v);
    } else if (Array.isArray(v)) {
      bytes.push(...encodeHead(4, v.length));
      for (const item of v) write(item as CborValue);
    } else if (typeof v === 'object') {
      const boxed = v as Record<string, unknown>;
      const keys = Object.keys(boxed);
      bytes.push(...encodeHead(5, keys.length));
      for (const key of keys) {
        // COSE_Key (RFC 8152) requires *integer* labels, but JS object keys are
        // always strings, so canonical integer strings are written as CBOR ints.
        if (CANONICAL_INT_KEY.test(key)) {
          write(Number(key));
        } else {
          write(key);
        }
        write(boxed[key] as CborValue);
      }
    } else {
      throw new Error(`Cannot CBOR-encode value of type ${typeof v}`);
    }
  }

  function pushNumber(major: 0 | 1, value: bigint): void {
    if (value < 0x18n) {
      bytes.push((major << 5) | Number(value));
    } else if (value <= 0xffn) {
      bytes.push((major << 5) | 24, Number(value));
    } else if (value <= 0xffffn) {
      bytes.push((major << 5) | 25, Number((value >> 8n) & 0xffn), Number(value & 0xffn));
    } else if (value <= 0xffffffffn) {
      bytes.push(
        (major << 5) | 26,
        Number((value >> 24n) & 0xffn),
        Number((value >> 16n) & 0xffn),
        Number((value >> 8n) & 0xffn),
        Number(value & 0xffn),
      );
    } else {
      bytes.push((major << 5) | 27);
      for (let i = 7; i >= 0; i--) {
        bytes.push(Number((value >> BigInt(i * 8)) & 0xffn));
      }
    }
  }

  write(value);
  return new Uint8Array(bytes);
}

// ---------------------------------------------------------------------------
// Decoding
// ---------------------------------------------------------------------------

export function cborDecode(bytes: Uint8Array): unknown {
  let offset = 0;

  function readHead(): { major: number; info: number; value: number } {
    const first = bytes[offset++];
    const major = first >> 5;
    const info = first & 0x1f;
    let value = info;
    if (info === 24) {
      value = bytes[offset++];
    } else if (info === 25) {
      value = (bytes[offset] << 8) | bytes[offset + 1];
      offset += 2;
    } else if (info === 26) {
      value =
        bytes[offset] * 0x1000000 +
        bytes[offset + 1] * 0x10000 +
        bytes[offset + 2] * 0x100 +
        bytes[offset + 3];
      offset += 4;
    } else if (info === 27) {
      let valueBig = 0n;
      for (let i = 0; i < 8; i++) {
        valueBig = (valueBig << 8n) | BigInt(bytes[offset++]);
      }
      if (valueBig > BigInt(Number.MAX_SAFE_INTEGER)) {
        throw new Error('CBOR integer too large');
      }
      value = Number(valueBig);
    }
    return { major, info, value };
  }

  function read(): unknown {
    const { major, info, value } = readHead();
    switch (major) {
      case 0:
        return value;
      case 1:
        return -1 - value;
      case 2: {
        const out = bytes.slice(offset, offset + value);
        offset += value;
        return out;
      }
      case 3: {
        const out = bytes.slice(offset, offset + value);
        offset += value;
        return new TextDecoder().decode(out);
      }
      case 4: {
        const out: unknown[] = [];
        for (let i = 0; i < value; i++) out.push(read());
        return out;
      }
      case 5: {
        const out: Record<string, unknown> = {};
        for (let i = 0; i < value; i++) {
          const key = read() as string | number;
          out[String(key)] = read();
        }
        return out;
      }
      case 7: {
        if (info === 20) return false;
        if (info === 21) return true;
        if (info === 22 || info === 23) return null;
        if (info === 25) {
          const val = (bytes[offset] << 8) | bytes[offset + 1];
          offset += 2;
          return val;
        }
        if (info === 26) {
          const val =
            (bytes[offset] << 24) |
            (bytes[offset + 1] << 16) |
            (bytes[offset + 2] << 8) |
            bytes[offset + 3];
          offset += 4;
          return val;
        }
        throw new Error('Unsupported CBOR major type 7');
      }
      default:
        throw new Error(`Unsupported CBOR major type ${major}`);
    }
  }

  const result = read();
  if (offset !== bytes.length) {
    throw new Error('CBOR: trailing bytes after value');
  }
  return result;
}
