import { describe, it, expect } from 'vitest';
import { cborEncode, cborDecode } from './cbor';
import { base64UrlToBytes, bytesToBase64Url, bytesToHex } from './base64';

describe('base64url', () => {
  it('round-trips bytes', () => {
    const bytes = new Uint8Array([0, 1, 2, 250, 251, 252, 253]);
    expect(base64UrlToBytes(bytesToBase64Url(bytes))).toEqual(bytes);
  });

  it('produces unpadded, url-safe output for a known vector', () => {
    const bytes = new TextEncoder().encode('hello');
    expect(bytesToBase64Url(bytes)).toBe('aGVsbG8');
  });
});

describe('cbor', () => {
  it('round-trips a COSE key map', () => {
    const map = {
      '1': 2,
      '3': -7,
      '-1': 1,
      '-2': new Uint8Array([1, 2, 3]),
      '-3': new Uint8Array([4, 5, 6]),
    };
    const decoded = cborDecode(cborEncode(map)) as Record<string, unknown>;
    expect(decoded['1']).toBe(2);
    expect(decoded['3']).toBe(-7);
    expect(decoded['-1']).toBe(1);
    expect(decoded['-2']).toEqual(new Uint8Array([1, 2, 3]));
    expect(decoded['-3']).toEqual(new Uint8Array([4, 5, 6]));
  });

  it('round-trips arrays, booleans, null and strings', () => {
    const value = { fmt: 'none', attStmt: {}, authData: new Uint8Array([9, 8, 7]), ok: true };
    const decoded = cborDecode(cborEncode(value)) as Record<string, unknown>;
    expect(decoded['fmt']).toBe('none');
    expect(decoded['ok']).toBe(true);
    expect(decoded['authData']).toEqual(new Uint8Array([9, 8, 7]));
  });

  it('encodes the whole uint32 range for signCount-sized integers', () => {
    for (const n of [0, 1, 23, 24, 255, 256, 65535, 65536, 0xffffffff]) {
      const decoded = cborDecode(cborEncode(n));
      expect(decoded).toBe(n);
    }
  });

  it('encodes a byte string of length >= 24 with the two-byte head', () => {
    // major 2, info 24 (0x58) then length byte (0x19 = 25)
    const enc = cborEncode(new Uint8Array(25));
    expect(enc[0]).toBe(0x58);
    expect(enc[1]).toBe(25);
    expect(enc.length).toBe(27);
  });

  // A round-trip through our own decoder cannot catch a symmetric encoding bug,
  // so these assert the exact bytes a relying party will parse.
  it('encodes canonical integer map keys as CBOR integers, not text', () => {
    // {1: 2, 3: -7} => a2 01 02 03 26  (NOT a2 6131 02 6133 26)
    expect(bytesToHex(cborEncode({ '1': 2, '3': -7 }))).toBe('a201020326');
  });

  it('encodes negative integer map keys as CBOR negative integers', () => {
    // {-1: 1} => a1 20 01
    expect(bytesToHex(cborEncode({ '-1': 1 }))).toBe('a12001');
  });

  it('keeps non-integer and non-canonical keys as text strings', () => {
    // "fmt" stays text: a1 63"fmt" 64"none"
    expect(bytesToHex(cborEncode({ fmt: 'none' }))).toBe('a163666d74646e6f6e65');
    // "01" is not canonical (String(Number("01")) !== "01") so it stays text.
    expect(bytesToHex(cborEncode({ '01': 0 }))).toBe('a162303100');
    // "-0" and floats likewise stay text.
    expect(bytesToHex(cborEncode({ '-0': 0 }))).toBe('a1622d3000');
    expect(bytesToHex(cborEncode({ '1.5': 0 }))).toBe('a163312e3500');
  });

  it('encodes an EC2/ES256 COSE_Key with integer labels', () => {
    const enc = cborEncode({
      '1': 2, // kty: EC2
      '3': -7, // alg: ES256
      '-1': 1, // crv: P-256
      '-2': new Uint8Array([0xaa]), // x
      '-3': new Uint8Array([0xbb]), // y
    });
    const expected = [
      'a5', // map(5)
      '0102', // 1: 2
      '0326', // 3: -7
      '2001', // -1: 1
      '2141aa', // -2: h'aa'
      '2241bb', // -3: h'bb'
    ].join('');
    expect(bytesToHex(enc)).toBe(expected);
  });
});

describe('helper', () => {
  it('bytesToHex matches expected', () => {
    expect(bytesToHex(new Uint8Array([0xab, 0xcd, 0x01]))).toBe('abcd01');
  });
  it('base64UrlToBytes decodes paddingless input', () => {
    // base64url("aGVsbG8=") -> "aGVsbG8"
    const bytes = base64UrlToBytes('aGVsbG8');
    expect(new TextDecoder().decode(bytes)).toBe('hello');
  });
});
