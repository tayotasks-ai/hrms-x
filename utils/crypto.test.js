import { describe, it, expect, beforeAll } from 'vitest';
import { encryptSecret, decryptSecret, encryptPii, decryptPii, looksEncrypted, maskLast } from './crypto.js';

beforeAll(() => {
  process.env.PAYMENT_ENCRYPTION_KEY = 'test-key-for-unit-tests-only';
  process.env.PII_ENCRYPTION_KEY = 'test-pii-key-for-unit-tests-only';
});

describe('encryptSecret / decryptSecret', () => {
  it('round-trips a plaintext secret', () => {
    const plaintext = 'sk_test_abc123XYZ';
    const encrypted = encryptSecret(plaintext);
    expect(decryptSecret(encrypted)).toBe(plaintext);
  });

  it('produces a different ciphertext each time (random IV)', () => {
    const a = encryptSecret('same-secret');
    const b = encryptSecret('same-secret');
    expect(a).not.toBe(b);
  });

  it('stores iv:authTag:ciphertext as three hex segments', () => {
    const encrypted = encryptSecret('sk_live_whatever');
    const parts = encrypted.split(':');
    expect(parts).toHaveLength(3);
    parts.forEach(p => expect(p).toMatch(/^[0-9a-f]+$/));
  });

  it('throws on a tampered ciphertext (auth tag mismatch)', () => {
    const encrypted = encryptSecret('sk_test_tamperme');
    const [iv, authTag, data] = encrypted.split(':');
    const tampered = [iv, authTag, data.slice(0, -2) + (data.slice(-2) === '00' ? '11' : '00')].join(':');
    expect(() => decryptSecret(tampered)).toThrow();
  });

  it('throws on a malformed payload', () => {
    expect(() => decryptSecret('not-a-valid-payload')).toThrow('Malformed encrypted payload.');
  });
});

describe('encryptPii / decryptPii', () => {
  it('round-trips under a separate key from encryptSecret', () => {
    const plaintext = '22345678901';
    const encrypted = encryptPii(plaintext);
    expect(decryptPii(encrypted)).toBe(plaintext);
  });

  it('a value encrypted with PII key cannot be decrypted with the payment key', () => {
    const encrypted = encryptPii('sensitive-bvn');
    expect(() => decryptSecret(encrypted)).toThrow();
  });
});

describe('looksEncrypted', () => {
  it('recognizes an iv:authTag:ciphertext payload', () => {
    expect(looksEncrypted(encryptPii('12345678901'))).toBe(true);
  });

  it('rejects plain values', () => {
    expect(looksEncrypted('22345678901')).toBe(false);
    expect(looksEncrypted('')).toBe(false);
    expect(looksEncrypted(undefined)).toBe(false);
    expect(looksEncrypted(null)).toBe(false);
  });
});

describe('maskLast', () => {
  it('masks all but the last 4 characters by default', () => {
    expect(maskLast('22345678901')).toBe('•••••••8901');
  });

  it('returns short values unmasked', () => {
    expect(maskLast('123')).toBe('123');
    expect(maskLast('1234')).toBe('1234');
  });

  it('returns an empty string for falsy input', () => {
    expect(maskLast('')).toBe('');
    expect(maskLast(null)).toBe('');
  });
});
