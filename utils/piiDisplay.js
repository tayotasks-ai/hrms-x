import { encryptPii, decryptPii, looksEncrypted, maskLast } from './crypto.js';

// Regulatory ID fields that get encrypted at rest. lgaOfOrigin is excluded —
// it's not an identifier on its own and stays plain, same as before.
const REG_FIELDS = ['bvn', 'nin', 'tin', 'nhf', 'rsa', 'pfa'];

// Mongoose select() fragment to force-include the encrypted fields, which
// are `select: false` on the schema by default. Append this to any query
// that legitimately needs to decrypt or mask them (never expose the raw
// select result directly to a client — always run it through
// maskEmployeePii, or decryptRegulatoryField for the one legitimate
// full-decrypt case, statutory remittance filing).
export const PII_SELECT = REG_FIELDS.map((f) => `+regulatory.${f}`).join(' ') + ' +bankDetails.accountNumber';

// Decrypts a stored value, tolerating legacy plaintext left over from
// before encryption was added (returns it unchanged rather than throwing),
// so the migration script can run without a hard cutover.
const safeDecrypt = (value) => {
  if (!value) return null;
  if (!looksEncrypted(value)) return value; // legacy plaintext
  try { return decryptPii(value); } catch { return null; } // corrupt/undecryptable — fail closed
};

const safeMask = (value) => {
  const plain = safeDecrypt(value);
  return plain ? maskLast(plain) : null;
};

// Strips raw/encrypted PII off a plain employee object (already run through
// .toObject()/.lean()) and replaces it with masked (last-4) display values
// under `<field>Masked` keys. The real field names never appear in the
// output, whether encrypted or not.
export const maskEmployeePii = (empObj) => {
  if (!empObj) return empObj;
  const out = { ...empObj };
  if (out.regulatory) {
    const reg = { ...out.regulatory };
    for (const f of REG_FIELDS) {
      reg[f + 'Masked'] = safeMask(reg[f]);
      delete reg[f];
    }
    out.regulatory = reg;
  }
  if (out.bankDetails) {
    const bd = { ...out.bankDetails };
    bd.accountNumberMasked = safeMask(bd.accountNumber);
    delete bd.accountNumber;
    out.bankDetails = bd;
  }
  return out;
};

// Encrypts whichever of the 6 regulatory fields are present as non-empty
// strings in `input`; fields that are empty/omitted are left out of the
// result entirely, so callers can spread this over an existing (already
// select()-loaded) regulatory object without clobbering fields the caller
// didn't intend to touch.
export const encryptRegulatoryFields = (input = {}) => {
  const out = {};
  for (const f of REG_FIELDS) {
    const val = input[f];
    if (typeof val === 'string' && val.trim() !== '') out[f] = encryptPii(val.trim());
  }
  return out;
};

// Full decrypt (not masked) for the one legitimate case that needs the real
// number: statutory remittance filing (PAYE/Pension/NHF CSV export to
// FIRS/PenCom/NHF). HR-only, never sent back for general display.
export const decryptRegulatoryField = (value) => safeDecrypt(value) || '';

export { REG_FIELDS };
