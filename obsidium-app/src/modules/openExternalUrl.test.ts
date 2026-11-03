import { describe, expect, it } from 'vitest';
import { normalizeExternalUrl, normalizeWebUrl } from './openExternalUrl';

describe('normalizeExternalUrl', () => {
  it('accepts http(s) and mailto links', () => {
    expect(normalizeExternalUrl('https://example.com')).toBe('https://example.com');
    expect(normalizeExternalUrl('<mailto:test@example.com>')).toBe('mailto:test@example.com');
  });

  it('rejects relative and empty values', () => {
    expect(normalizeExternalUrl('./note.md')).toBeNull();
    expect(normalizeExternalUrl('')).toBeNull();
  });

  it('normalizes only absolute HTTP and HTTPS URLs for in-app web tabs', () => {
    expect(normalizeWebUrl(' https://example.com/a ')).toBe('https://example.com/a');
    expect(normalizeWebUrl('http://localhost:8080')).toBe('http://localhost:8080/');
    expect(normalizeWebUrl('mailto:user@example.com')).toBeNull();
    expect(normalizeWebUrl('javascript:alert(1)')).toBeNull();
    expect(normalizeWebUrl('https://')).toBeNull();
  });
});
