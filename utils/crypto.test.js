import { describe, it, expect, beforeAll } from 'vitest';
import { encryptSecret, decryptSecret } from './crypto.js';

beforeAll(() => {
  process.env.PAYMENT_ENCRYPTION_KEY = 'test-key-for-unit-tests-only';
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
