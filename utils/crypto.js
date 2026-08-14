import crypto from 'crypto';

// AES-256-GCM at-rest encryption for secrets we have to store (Paystack
// secret keys). PAYMENT_ENCRYPTION_KEY can be any string — we hash it to a
// fixed 32-byte key so the operator doesn't have to generate exact-length
// hex themselves. Losing/rotating this env var makes previously-encrypted
// values unrecoverable, same as any at-rest encryption key.
const getKey = () => {
  const secret = process.env.PAYMENT_ENCRYPTION_KEY;
  if (!secret) throw new Error('PAYMENT_ENCRYPTION_KEY is not set. Cannot encrypt/decrypt payment credentials.');
  return crypto.createHash('sha256').update(secret).digest();
};

// Returns "iv:authTag:ciphertext" (all hex), safe to store as a single string.
export const encryptSecret = (plaintext) => {
  const iv = crypto.randomBytes(12); // GCM standard IV size
  const cipher = crypto.createCipheriv('aes-256-gcm', getKey(), iv);
  const encrypted = Buffer.concat([cipher.update(String(plaintext), 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return [iv.toString('hex'), authTag.toString('hex'), encrypted.toString('hex')].join(':');
};

export const decryptSecret = (payload) => {
  const [ivHex, authTagHex, dataHex] = String(payload).split(':');
  if (!ivHex || !authTagHex || !dataHex) throw new Error('Malformed encrypted payload.');
  const decipher = crypto.createDecipheriv('aes-256-gcm', getKey(), Buffer.from(ivHex, 'hex'));
  decipher.setAuthTag(Buffer.from(authTagHex, 'hex'));
  const decrypted = Buffer.concat([decipher.update(Buffer.from(dataHex, 'hex')), decipher.final()]);
  return decrypted.toString('utf8');
};
