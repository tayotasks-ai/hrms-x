// This Paystack account is shared with invoecr, a separate invoicing
// product. Paystack only supports one configured webhook URL per account,
// so every event — regardless of which product it actually belongs to —
// lands on this app's own webhook endpoint first (see
// controllers/webhookController.js). invoecr's own references are always
// prefixed `ivcr_`; anything else is ours.
export const isInvoecrReference = (reference) =>
  typeof reference === 'string' && reference.startsWith('ivcr_');

// 1 initial attempt + 3 retries, short exponential backoff. This all runs
// AFTER we've already acked Paystack's original request, so there's no
// pressure to hurry — but it also shouldn't hang around forever if invoecr
// is down.
const BACKOFF_MS = [500, 1500, 4500];

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Forwards a Paystack webhook to invoecr's own webhook endpoint, best-effort.
//
// Critical: this forwards the exact raw body BYTES Paystack sent us, not a
// re-serialized JSON object, and the ORIGINAL x-paystack-signature header
// value, untouched. invoecr verifies the signature by recomputing
// HMAC-SHA512 over the literal raw request body it receives, using the same
// shared Paystack secret key — JSON.parse() + JSON.stringify() would change
// the byte layout (key order, whitespace) and invoecr would reject the
// signature as invalid even though the data is identical.
//
// Never throws — a lost forward is logged, not fatal. invoecr can
// independently re-verify a transaction's status against Paystack's own API
// using the reference alone, so a dropped forward is recoverable, just not
// silent.
export const forwardToInvoecr = async (rawBody, signature, reference) => {
  const url = process.env.INVOECR_WEBHOOK_URL;
  if (!url) {
    console.error(`Invoecr webhook forward skipped for ${reference} — INVOECR_WEBHOOK_URL is not configured.`);
    return;
  }

  const maxAttempts = BACKOFF_MS.length + 1;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-paystack-signature': signature,
        },
        body: rawBody,
      });
      if (res.ok) return;
      throw new Error(`invoecr responded ${res.status}`);
    } catch (err) {
      const isLastAttempt = attempt === maxAttempts;
      if (isLastAttempt) {
        console.error(`Invoecr webhook forward failed for reference ${reference} after ${maxAttempts} attempt(s) — last error: ${err.message}`);
        return;
      }
      await sleep(BACKOFF_MS[attempt - 1]);
    }
  }
};
