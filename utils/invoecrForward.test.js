import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { isInvoecrReference, forwardToInvoecr } from './invoecrForward.js';
import { verifyWebhookSignature } from './paystack.js';
import crypto from 'crypto';

// isInvoecrReference — the pure routing decision: which events are ours vs
// invoecr's. Everything downstream (skip local handling vs forward) hinges
// on getting this right.
describe('isInvoecrReference', () => {
  it('identifies an invoecr invoice reference', () => {
    expect(isInvoecrReference('ivcr_invoice_a1b2c3')).toBe(true);
  });

  it('identifies an invoecr subscription reference', () => {
    expect(isInvoecrReference('ivcr_subscription_a1b2c3')).toBe(true);
  });

  it('does not misidentify our own hrms_ reference', () => {
    expect(isInvoecrReference('hrms_507f1f77bcf86cd799439011_abc_xyz')).toBe(false);
  });

  it('does not misidentify a reference that merely contains ivcr_ mid-string', () => {
    expect(isInvoecrReference('hrms_not_ivcr_prefixed')).toBe(false);
  });

  it('returns false for missing/non-string references', () => {
    expect(isInvoecrReference(undefined)).toBe(false);
    expect(isInvoecrReference(null)).toBe(false);
    expect(isInvoecrReference(12345)).toBe(false);
  });
});

// forwardToInvoecr — the actual forward. The whole point of this function is
// that invoecr's signature check on receipt succeeds, which only happens if
// the bytes and header we send are byte-identical/untouched from what
// Paystack originally sent us.
describe('forwardToInvoecr', () => {
  const secretKey = 'sk_test_shared_platform_secret';
  const originalEnv = process.env.INVOECR_WEBHOOK_URL;
  let fetchMock;

  beforeEach(() => {
    process.env.INVOECR_WEBHOOK_URL = 'https://invoicerbackend-xd26.onrender.com/api/v1/webhook';
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    process.env.INVOECR_WEBHOOK_URL = originalEnv;
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  // Builds a realistic raw webhook body + the signature Paystack would have
  // actually sent for it, exactly the way utils/paystack.js verifies it.
  const buildSignedPayload = () => {
    const rawBody = Buffer.from(JSON.stringify({
      event: 'charge.success',
      data: { reference: 'ivcr_invoice_a1b2c3', amount: 150000, customer: { customer_code: 'CUS_xyz' } },
    }));
    const signature = crypto.createHmac('sha512', secretKey).update(rawBody).digest('hex');
    return { rawBody, signature };
  };

  it('forwards the exact raw body bytes and the untouched signature header to INVOECR_WEBHOOK_URL', async () => {
    fetchMock.mockResolvedValueOnce({ ok: true, status: 200 });
    const { rawBody, signature } = buildSignedPayload();

    await forwardToInvoecr(rawBody, signature, 'ivcr_invoice_a1b2c3');

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toBe('https://invoicerbackend-xd26.onrender.com/api/v1/webhook');
    expect(options.method).toBe('POST');
    expect(options.headers['x-paystack-signature']).toBe(signature);
    expect(options.headers['Content-Type']).toBe('application/json');
    // Byte-identical, not just deep-equal — this is what a re-serialization
    // bug would silently break.
    expect(Buffer.isBuffer(options.body)).toBe(true);
    expect(Buffer.compare(options.body, rawBody)).toBe(0);
  });

  it('verification (c): recomputing HMAC-SHA512 over the forwarded raw body matches the forwarded signature header — exactly what invoecr does on receipt', async () => {
    fetchMock.mockResolvedValueOnce({ ok: true, status: 200 });
    const { rawBody, signature } = buildSignedPayload();

    await forwardToInvoecr(rawBody, signature, 'ivcr_invoice_a1b2c3');

    const [, options] = fetchMock.mock.calls[0];
    expect(verifyWebhookSignature(options.body, options.headers['x-paystack-signature'], secretKey)).toBe(true);
  });

  it('retries on failure and succeeds once invoecr responds ok', async () => {
    fetchMock
      .mockResolvedValueOnce({ ok: false, status: 503 })
      .mockResolvedValueOnce({ ok: false, status: 502 })
      .mockResolvedValueOnce({ ok: true, status: 200 });
    const { rawBody, signature } = buildSignedPayload();

    await forwardToInvoecr(rawBody, signature, 'ivcr_invoice_a1b2c3');

    expect(fetchMock).toHaveBeenCalledTimes(3);
  }, 10000);

  it('gives up after exhausting retries and does not throw', async () => {
    fetchMock.mockRejectedValue(new Error('ECONNREFUSED'));
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { rawBody, signature } = buildSignedPayload();

    await expect(forwardToInvoecr(rawBody, signature, 'ivcr_invoice_a1b2c3')).resolves.toBeUndefined();
    expect(fetchMock).toHaveBeenCalledTimes(4); // 1 initial + 3 retries
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('ivcr_invoice_a1b2c3'));
  }, 10000);

  it('does not call fetch and logs when INVOECR_WEBHOOK_URL is not configured', async () => {
    delete process.env.INVOECR_WEBHOOK_URL;
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { rawBody, signature } = buildSignedPayload();

    await forwardToInvoecr(rawBody, signature, 'ivcr_invoice_a1b2c3');

    expect(fetchMock).not.toHaveBeenCalled();
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('INVOECR_WEBHOOK_URL'));
  });
});
