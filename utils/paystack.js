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

// The platform's own Paystack secret key — used for every wallet-model call
// (customer/DVA creation, all payroll transfers, webhook verification).
// Never a tenant's key; tenants no longer hold Paystack credentials.
export const getPlatformSecretKey = () => {
  const key = process.env.PAYSTACK_SECRET_KEY;
  if (!key) throw new Error('Payroll is not configured on the server yet (missing PAYSTACK_SECRET_KEY).');
  return key;
};

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

// ── Payroll wallet: platform-key helpers ────────────────────────────────────
// Everything below is called with the PLATFORM's own Paystack secret key
// (process.env.PAYSTACK_SECRET_KEY), never a tenant's — tenants no longer
// hold their own Paystack credentials under the wallet model. See
// controllers/walletController.js.

// A dedicated virtual account must be attached to a Paystack customer.
// One customer per tenant, created once the first time a wallet is set up.
export const createCustomer = async (secretKey, { email, firstName, lastName, phone }) => {
  const res = await request(secretKey, 'POST', '/customer', {
    email,
    first_name: firstName,
    last_name: lastName,
    phone,
  });
  return { customerCode: res.data.customer_code, customerId: res.data.id };
};

// Creates the actual NUBAN. preferredBank is a provider slug (e.g.
// 'wema-bank', 'titan-paystack') — see listDvaProviders. Requires the
// platform's Paystack integration to have Dedicated NUBAN enabled; if it
// isn't, Paystack returns an error here that the caller should surface
// as-is rather than retry.
export const createDedicatedAccount = async (secretKey, { customerCode, preferredBank }) => {
  const res = await request(secretKey, 'POST', '/dedicated_account', {
    customer: customerCode,
    preferred_bank: preferredBank,
  });
  return {
    accountNumber: res.data.account_number,
    accountName: res.data.account_name,
    bankName: res.data.bank?.name,
    bankId: res.data.bank?.id,
    active: !!res.data.active,
  };
};

// Attaches/updates a phone number on an existing customer. Needed because
// customer creation itself doesn't require a phone, but Paystack rejects
// dedicated-account creation for a customer that doesn't have one — so a
// customer created before a phone was collected (or before this field
// existed at all) needs to be patched before retrying /dedicated_account.
export const updateCustomerPhone = async (secretKey, { customerCode, phone }) => {
  const res = await request(secretKey, 'PUT', `/customer/${customerCode}`, { phone });
  return { customerCode: res.data.customer_code };
};

// Which banks can currently issue a dedicated virtual account on this
// integration — used to pick/validate PAYSTACK_DVA_PREFERRED_BANK.
export const listDvaProviders = async (secretKey) => {
  const res = await request(secretKey, 'GET', '/dedicated_account/available_providers');
  return (res.data || []).map(p => ({ slug: p.provider_slug, bankId: p.bank_id, bankName: p.bank_name }));
};

// Paystack's own NGN transfer fee tiers (support.paystack.com/en/articles/2132866,
// checked August 2026): ₦10 at/under ₦5,000, ₦25 up to ₦50,000, ₦50 above
// that. Separately, a ₦50 flat stamp duty applies to transfers of ₦10,000+
// UNLESS the merchant is registered with Paystack as a "Registered Payroll"
// merchant (which this platform should apply for, since payroll disbursement
// is its primary use of Transfers) — stampDutyApplies defaults to true
// (the conservative assumption) until that registration is confirmed; flip
// PAYSTACK_STAMP_DUTY_EXEMPT=true once it's approved.
export const computeTransferFee = (amountNaira, { stampDutyApplies = true } = {}) => {
  const amount = Number(amountNaira) || 0;
  const paystackFee = amount <= 5000 ? 10 : amount <= 50000 ? 25 : 50;
  const stampDuty = stampDutyApplies && amount >= 10000 ? 50 : 0;
  const markup = 500; // our flat charge per transfer, per the founders' pricing decision
  return { paystackFee, stampDuty, markup, total: paystackFee + stampDuty + markup };
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
