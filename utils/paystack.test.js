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
describe('computeTransferFee', () => {
  it('charges the ₦10 Paystack tier at/under ₦5,000, no stamp duty below ₦10,000', () => {
    expect(computeTransferFee(5000, { stampDutyApplies: true })).toEqual({ paystackFee: 10, stampDuty: 0, markup: 500, total: 510 });
    expect(computeTransferFee(1, { stampDutyApplies: true })).toEqual({ paystackFee: 10, stampDuty: 0, markup: 500, total: 510 });
  });

  it('charges the ₦25 Paystack tier between ₦5,001 and ₦50,000', () => {
    expect(computeTransferFee(5001, { stampDutyApplies: false }).paystackFee).toBe(25);
    expect(computeTransferFee(50000, { stampDutyApplies: false }).paystackFee).toBe(25);
  });

  it('charges the ₦50 Paystack tier above ₦50,000', () => {
    expect(computeTransferFee(50001, { stampDutyApplies: false }).paystackFee).toBe(50);
    expect(computeTransferFee(500000, { stampDutyApplies: false }).paystackFee).toBe(50);
  });

  it('applies the ₦50 stamp duty at/above ₦10,000 when stampDutyApplies is true', () => {
    expect(computeTransferFee(9999, { stampDutyApplies: true }).stampDuty).toBe(0);
    expect(computeTransferFee(10000, { stampDutyApplies: true }).stampDuty).toBe(50);
    expect(computeTransferFee(500000, { stampDutyApplies: true }).stampDuty).toBe(50);
  });

  it('never applies stamp duty when stampDutyApplies is false, regardless of amount', () => {
    expect(computeTransferFee(1000000, { stampDutyApplies: false }).stampDuty).toBe(0);
  });

  it('always adds the flat ₦500 markup and sums the total correctly', () => {
    const fee = computeTransferFee(85000, { stampDutyApplies: true });
    expect(fee.markup).toBe(500);
    expect(fee.total).toBe(fee.paystackFee + fee.stampDuty + fee.markup);
    expect(fee.total).toBe(600); // 50 (>50k tier) + 50 (stamp duty) + 500
  });

  it('defaults stampDutyApplies to true (conservative) when not specified', () => {
    expect(computeTransferFee(20000).stampDuty).toBe(50);
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
