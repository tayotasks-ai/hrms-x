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
//
// firstName/lastName/phone are optional but important: Paystack's own docs
// (docs/api/dedicated-virtual-account #create) say to pass them here
// directly when the customer record doesn't already have them — this is
// the documented fix for "Customer phone number is required", and is more
// reliable than relying solely on a separate customer-update call landing
// before this request.
export const createDedicatedAccount = async (secretKey, { customerCode, preferredBank, firstName, lastName, phone }) => {
  const res = await request(secretKey, 'POST', '/dedicated_account', {
    customer: customerCode,
    preferred_bank: preferredBank,
    ...(firstName ? { first_name: firstName } : {}),
    ...(lastName ? { last_name: lastName } : {}),
    ...(phone ? { phone } : {}),
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

// What we charge a tenant's wallet per payroll transfer, on top of net pay.
// Flat and amount-independent, per the founders' pricing decision — a
// simple, predictable number regardless of what Paystack's own tiered fee
// (₦10–₦50) plus stamp duty (₦50 on transfers ₦10,000+, unless the platform
// has "Registered Payroll" stamp-duty exemption) actually costs us; the
// platform absorbs the difference either way. amountNaira is accepted but
// unused — kept so call sites don't need to change if this ever becomes
// tiered again.
export const TRANSFER_FEE = 250;
export const computeTransferFee = (_amountNaira) => ({ fee: TRANSFER_FEE, total: TRANSFER_FEE });

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

// Asks Paystack directly what a transfer's CURRENT real status is, keyed by
// the reference we generated. Used to safely resolve a payslip stuck on
// Pending_OTP: rather than trust that a transfer has gone stale, we check
// Paystack's own record before ever resetting payment status or refunding
// the wallet — see controllers/payslipPaymentController.js resetStuckPayment.
export const verifyTransfer = async (secretKey, reference) => {
  const res = await request(secretKey, 'GET', `/transfer/verify/${encodeURIComponent(reference)}`);
  return res.data; // { status, ... } — status is one of pending/success/reversed/failed/otp/abandoned/blocked/rejected/received
};

// The REAL, spendable Paystack balance right now (kobo -> naira) — separate
// from Tenant.wallet.balance, which is just our own internal ledger. A
// dedicated-virtual-account deposit credits the ledger the instant our
// webhook fires, but Paystack doesn't make that money available for
// outbound Transfers until it settles (see getPendingSettlements below) —
// so this can legitimately read lower than the sum of tenant ledgers for a
// while. Used to show HR "why did my payment fail" before they hit Pay,
// not after. Returns 0 (not an error) if NGN isn't in the response, which
// shouldn't happen on a live NGN integration but is safer than throwing.
export const checkAvailableBalance = async (secretKey) => {
  const res = await request(secretKey, 'GET', '/balance');
  const ngn = (res.data || []).find(b => b.currency === 'NGN');
  return (ngn?.balance || 0) / 100;
};

// Settlements still in flight — i.e. money Paystack has collected on our
// behalf (including DVA deposits) but hasn't yet paid into our bank account
// / made available for Transfers. Each entry's `settlementDate` is when
// Paystack expects to release it. Used to tell HR "₦X becomes available on
// DATE" instead of a bare failed-payment error. Returns [] rather than
// throwing on any API hiccup — this is a nice-to-have status readout, not
// something that should ever block the Wallet tab from loading.
export const getPendingSettlements = async (secretKey) => {
  try {
    const res = await request(secretKey, 'GET', '/settlement?status=pending&perPage=5');
    return (res.data || [])
      .filter(s => s.currency === 'NGN')
      .map(s => ({ amount: (s.total_amount || 0) / 100, settlementDate: s.settlement_date }));
  } catch {
    return [];
  }
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
