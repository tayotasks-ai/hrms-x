import crypto from 'crypto';

// Thin wrapper around Paystack's REST API for payroll disbursement.
// Uses Node's built-in fetch — no SDK dependency. Every call takes the
// TENANT'S OWN secret key (decrypted just-in-time by the caller); this
// module never stores or caches a key itself.
//
// NOTE: this integration has not been exercised against Paystack's live API
// from within this environment (no outbound network access to
// api.paystack.co in this sandbox). Test it end-to-end with a Paystack TEST
// secret key (sk_test_...) before ever pointing it at a live key.

const BASE_URL = 'https://api.paystack.co';

class PaystackError extends Error {
  constructor(message, status, body) {
    super(message);
    this.name = 'PaystackError';
    this.status = status;
    this.body = body;
  }
}

const request = async (secretKey, method, path, body) => {
  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${secretKey}`,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  let json;
  try { json = await res.json(); }
  catch { json = null; }

  if (!res.ok || json?.status === false) {
    throw new PaystackError(json?.message || `Paystack request failed (${res.status})`, res.status, json);
  }
  return json;
};

// Validates a secret key by hitting a lightweight authenticated endpoint.
export const validateSecretKey = async (secretKey) => {
  await request(secretKey, 'GET', '/balance');
  return true;
};

// Nigerian banks, for the account-selection dropdown. { name, code, slug }[]
export const listBanks = async (secretKey) => {
  const res = await request(secretKey, 'GET', '/bank?country=nigeria&currency=NGN&perPage=200');
  return (res.data || []).map(b => ({ name: b.name, code: b.code, slug: b.slug }));
};

// Confirms an account number belongs to the name on file before we ever
// send money to it. Returns { accountNumber, accountName }.
export const resolveAccountNumber = async (secretKey, accountNumber, bankCode) => {
  const res = await request(secretKey, 'GET', `/bank/resolve?account_number=${encodeURIComponent(accountNumber)}&bank_code=${encodeURIComponent(bankCode)}`);
  return { accountNumber: res.data.account_number, accountName: res.data.account_name };
};

// Creates (or the caller can choose to reuse) a Paystack transfer recipient.
// Returns the recipient_code needed by initiateTransfer.
export const createTransferRecipient = async (secretKey, { name, accountNumber, bankCode }) => {
  const res = await request(secretKey, 'POST', '/transferrecipient', {
    type: 'nuban',
    name,
    account_number: accountNumber,
    bank_code: bankCode,
    currency: 'NGN',
  });
  return { recipientCode: res.data.recipient_code };
};

// amountNaira is a plain Naira figure (e.g. 454890.00) — Paystack wants kobo.
const toKobo = (amountNaira) => Math.round(Number(amountNaira) * 100);

// Initiates a single transfer. Paystack may respond with status 'success',
// 'pending', or — if the business account has OTP confirmation enabled —
// 'otp', in which case the caller must collect the OTP and call
// finalizeTransfer. Returns the raw Paystack transfer object.
export const initiateTransfer = async (secretKey, { amountNaira, recipientCode, reason, reference }) => {
  const res = await request(secretKey, 'POST', '/transfer', {
    source: 'balance',
    amount: toKobo(amountNaira),
    recipient: recipientCode,
    reason,
    reference,
  });
  return res.data; // { transfer_code, status, reference, ... }
};

// Up to 100 transfers in one call — used for "Pay Selected" batches.
export const initiateBulkTransfer = async (secretKey, transfers) => {
  const res = await request(secretKey, 'POST', '/transfer/bulk', {
    source: 'balance',
    currency: 'NGN',
    transfers: transfers.map(t => ({
      amount: toKobo(t.amountNaira),
      recipient: t.recipientCode,
      reason: t.reason,
      reference: t.reference,
    })),
  });
  return res.data; // array of per-transfer results
};

// Completes a transfer that came back with status 'otp'.
export const finalizeTransfer = async (secretKey, { transferCode, otp }) => {
  const res = await request(secretKey, 'POST', '/transfer/finalize_transfer', {
    transfer_code: transferCode,
    otp,
  });
  return res.data;
};

// Verifies the `x-paystack-signature` header on an incoming webhook using
// the RAW request body bytes (must be the exact bytes Paystack sent — a
// re-serialized JSON.stringify(parsedBody) will NOT match).
export const verifyWebhookSignature = (rawBodyBuffer, signatureHeader, secretKey) => {
  if (!signatureHeader || !rawBodyBuffer) return false;
  const expected = crypto.createHmac('sha512', secretKey).update(rawBodyBuffer).digest('hex');
  // Constant-time comparison
  const a = Buffer.from(expected, 'hex');
  const b = Buffer.from(String(signatureHeader), 'hex');
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
};

export { PaystackError };
