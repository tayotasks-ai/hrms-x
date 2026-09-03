import crypto from 'crypto';
import { describe, it, expect, afterEach } from 'vitest';
import { verifyWebhookSignature, computeTransferFee, getPlatformSecretKey } from './paystack.js';

// These tests cover the pure, no-network parts of the Paystack wrapper —
// signature verification is security-critical and easy to get subtly wrong
// (e.g. comparing against JSON.stringify(parsedBody) instead of the raw
// bytes Paystack actually signed), so it's worth pinning down with tests
// even though we can't hit the live Paystack API from this environment.

const secretKey = 'sk_test_fake_secret_for_hmac_tests';

const sign = (bodyBuffer, key = secretKey) =>
  crypto.createHmac('sha512', key).update(bodyBuffer).digest('hex');

describe('verifyWebhookSignature', () => {
  it('accepts a correctly signed payload', () => {
    const body = Buffer.from(JSON.stringify({ event: 'transfer.success', data: { reference: 'hrms_x_y_z' } }));
    const signature = sign(body);
    expect(verifyWebhookSignature(body, signature, secretKey)).toBe(true);
  });

  it('rejects a payload signed with the wrong key (wrong tenant)', () => {
    const body = Buffer.from(JSON.stringify({ event: 'transfer.success' }));
    const signature = sign(body, 'sk_test_a_different_tenants_key');
    expect(verifyWebhookSignature(body, signature, secretKey)).toBe(false);
  });

  it('rejects when the body has been tampered with after signing', () => {
    const original = Buffer.from(JSON.stringify({ event: 'transfer.success', data: { amount: 100 } }));
    const signature = sign(original);
    const tampered = Buffer.from(JSON.stringify({ event: 'transfer.success', data: { amount: 100000 } }));
    expect(verifyWebhookSignature(tampered, signature, secretKey)).toBe(false);
  });

  it('rejects a re-serialized (key-order-changed) body even with matching content', () => {
    // This is exactly why we sign/verify over req.rawBody rather than
    // JSON.stringify(req.body) — re-serialization can change byte layout.
    const original = Buffer.from('{"a":1,"b":2}');
    const signature = sign(original);
    const reserialized = Buffer.from('{"b":2,"a":1}');
    expect(verifyWebhookSignature(reserialized, signature, secretKey)).toBe(false);
  });

  it('returns false for a missing signature header', () => {
    const body = Buffer.from('{}');
    expect(verifyWebhookSignature(body, undefined, secretKey)).toBe(false);
  });

  it('returns false for a missing body', () => {
    expect(verifyWebhookSignature(null, 'deadbeef', secretKey)).toBe(false);
  });

  it('does not throw on a non-hex signature header', () => {
    const body = Buffer.from('{}');
    expect(() => verifyWebhookSignature(body, 'not-hex-at-all!!', secretKey)).not.toThrow();
    expect(verifyWebhookSignature(body, 'not-hex-at-all!!', secretKey)).toBe(false);
  });
});

// computeTransferFee — the money math behind every wallet debit. Wrong here
// means either overcharging every tenant on every payslip, or the platform
// quietly eating losses on every transfer, so it's worth pinning exactly.
// Flat ₦250 per transfer, independent of amount — per the founders'
// pricing decision (replaced the previous tiered Paystack-fee + stamp-duty
// + markup breakdown).
describe('computeTransferFee', () => {
  it('always charges the flat ₦250 fee, regardless of amount', () => {
    expect(computeTransferFee(1)).toEqual({ fee: 250, total: 250 });
    expect(computeTransferFee(5000)).toEqual({ fee: 250, total: 250 });
    expect(computeTransferFee(50000)).toEqual({ fee: 250, total: 250 });
    expect(computeTransferFee(1000000)).toEqual({ fee: 250, total: 250 });
  });

  it('does not vary with a missing or non-numeric amount', () => {
    expect(computeTransferFee()).toEqual({ fee: 250, total: 250 });
    expect(computeTransferFee('not a number')).toEqual({ fee: 250, total: 250 });
  });
});

describe('getPlatformSecretKey', () => {
  const ORIGINAL = process.env.PAYSTACK_SECRET_KEY;
  afterEach(() => { process.env.PAYSTACK_SECRET_KEY = ORIGINAL; });

  it('returns the key when PAYSTACK_SECRET_KEY is set', () => {
    process.env.PAYSTACK_SECRET_KEY = 'sk_test_platform_key';
    expect(getPlatformSecretKey()).toBe('sk_test_platform_key');
  });

  it('throws a clear error when PAYSTACK_SECRET_KEY is missing', () => {
    delete process.env.PAYSTACK_SECRET_KEY;
    expect(() => getPlatformSecretKey()).toThrow(/PAYSTACK_SECRET_KEY/);
  });
});
