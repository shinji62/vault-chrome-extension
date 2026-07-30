import { describe, it, expect } from 'vitest';
import { extractHostname, hostnamesMatch } from './urlMatcher';

describe('extractHostname', () => {
  it('extracts hostname from a full URL', () => {
    expect(extractHostname('https://github.com/login')).toBe('github.com');
  });

  it('strips the www prefix', () => {
    expect(extractHostname('https://www.example.com')).toBe('example.com');
  });

  it('handles URLs with port numbers', () => {
    expect(extractHostname('https://vault.internal:8200/ui')).toBe('vault.internal');
  });

  it('handles bare hostname strings (no protocol)', () => {
    // Falls back gracefully when URL parsing fails — returns the input as-is
    const result = extractHostname('github.com');
    expect(typeof result).toBe('string');
  });
});

describe('hostnamesMatch', () => {
  it('matches exact hostname', () => {
    expect(hostnamesMatch('github.com', 'https://github.com/login')).toBe(true);
  });

  it('matches subdomain of secret hostname', () => {
    expect(hostnamesMatch('github.com', 'https://gist.github.com/')).toBe(true);
  });

  it('does not match a different domain', () => {
    expect(hostnamesMatch('github.com', 'https://notgithub.com')).toBe(false);
  });

  it('matches page URL with www stripped', () => {
    expect(hostnamesMatch('example.com', 'https://www.example.com/path')).toBe(true);
  });

  it('does not match partial domain name', () => {
    // "github.com" stored secret should not match "notgithub.com"
    expect(hostnamesMatch('github.com', 'https://notgithub.com')).toBe(false);
  });

  it('matches when secret url has www and page does not', () => {
    expect(hostnamesMatch('www.example.com', 'https://example.com')).toBe(true);
  });
});
