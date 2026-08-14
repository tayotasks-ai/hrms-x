import crypto from 'crypto';

// AES-256-GCM at-rest encryption for secrets we have to store (Paystack
// secret keys, and separately, employee PII — see below). The env var name
// is a parameter so different data classes can use different keys: rotating
// the payment key shouldn't force-touch PII, and vice versa. Each key can be
// any string — we hash it to a fixed 32-byte key so the operator doesn't
// have to generate exact-length hex themselves. Losing/rotating an env var
// makes previously-encrypted values under that key unrecoverable, same as
// any at-rest encryption key.
const getKey = (envVar) => {
  const secret = process.env[envVar];
  if (!secret) throw new Error(`${envVar} is not set. Cannot encrypt/decrypt this data.`);
  return crypto.createHash('sha256').update(secret).digest();
};

// Returns "iv:authTag:ciphertext" (all hex), safe to store as a single string.
export const encryptSecret = (plaintext, envVar = 'PAYMENT_ENCRYPTION_KEY') => {
  const iv = crypto.randomBytes(12); // GCM standard IV size
  const cipher = crypto.createCipheriv('aes-256-gcm', getKey(envVar), iv);
  const encrypted = Buffer.concat([cipher.update(String(plaintext), 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return [iv.toString('hex'), authTag.toString('hex'), encrypted.toString('hex')].join(':');
};

export const decryptSecret = (payload, envVar = 'PAYMENT_ENCRYPTION_KEY') => {
  const [ivHex, authTagHex, dataHex] = String(payload).split(':');
  if (!ivHex || !authTagHex || !dataHex) throw new Error('Malformed encrypted payload.');
  const decipher = crypto.createDecipheriv('aes-256-gcm', getKey(envVar), Buffer.from(ivHex, 'hex'));
  decipher.setAuthTag(Buffer.from(authTagHex, 'hex'));
  const decrypted = Buffer.concat([decipher.update(Buffer.from(dataHex, 'hex')), decipher.final()]);
  return decrypted.toString('utf8');
};

// ── PII-specific helpers ─────────────────────────────────────────────────
// Regulatory IDs (BVN, NIN, TIN, NHF, RSA/PFA) and bank account numbers use
// their own key (PII_ENCRYPTION_KEY) so a payment-key rotation never touches
// employee PII and vice versa.
export const encryptPii = (plaintext) => encryptSecret(plaintext, 'PII_ENCRYPTION_KEY');
export const decryptPii = (payload) => decryptSecret(payload, 'PII_ENCRYPTION_KEY');

// Encrypted values look like "iv:authTag:ciphertext" — three hex groups
// joined by colons. Used to tell "already encrypted" apart from a plain
// legacy value during migration/defensive reads.
export const looksEncrypted = (value) =>
  typeof value === 'string' && /^[0-9a-f]+:[0-9a-f]+:[0-9a-f]+$/i.test(value);

// Masks a plaintext identifier to its last N characters (default 4), e.g.
// "22345678901" -> "•••••••8901". Never called on encrypted ciphertext —
// callers must decrypt first.
export const maskLast = (plaintext, keep = 4) => {
  if (!plaintext) return '';
  const str = String(plaintext);
  if (str.length <= keep) return str;
  return '•'.repeat(str.length - keep) + str.slice(-keep);
};
