// One-off migration: encrypts any plaintext BVN/NIN/TIN/NHF/RSA/PFA or bank
// account number left over from before at-rest encryption was added.
// Safe to run more than once — already-encrypted values are left alone.
//
// Requires PII_ENCRYPTION_KEY to be set in the environment (same as the
// running app). Run manually, it is NOT invoked automatically:
//   cd backend && node scripts/migratePiiEncryption.js
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import mongoose from 'mongoose';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '..', '.env') });

const { encryptPii, looksEncrypted } = await import('../utils/crypto.js');
const { default: Employee } = await import('../models/Employee.js');

const REG_FIELDS = ['bvn', 'nin', 'tin', 'nhf', 'rsa', 'pfa'];

const run = async () => {
  if (!process.env.PII_ENCRYPTION_KEY) {
    console.error('PII_ENCRYPTION_KEY is not set — aborting. Set it in backend/.env first.');
    process.exit(1);
  }

  await mongoose.connect(process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/antigravity_hrms');
  console.log('Connected. Scanning employees for plaintext PII...');

  const select = REG_FIELDS.map((f) => `+regulatory.${f}`).join(' ') + ' +bankDetails.accountNumber';
  const employees = await Employee.find({}).select(select);

  let touched = 0;
  for (const emp of employees) {
    let changed = false;

    for (const f of REG_FIELDS) {
      const val = emp.regulatory?.[f];
      if (val && !looksEncrypted(val)) {
        emp.regulatory[f] = encryptPii(val);
        changed = true;
      }
    }

    const acct = emp.bankDetails?.accountNumber;
    if (acct && !looksEncrypted(acct)) {
      emp.bankDetails.accountNumber = encryptPii(acct);
      changed = true;
    }

    if (changed) {
      await emp.save();
      touched++;
      console.log(`  encrypted: ${emp.name} (${emp._id})`);
    }
  }

  console.log(`Done. ${touched} of ${employees.length} employee record(s) updated.`);
  await mongoose.disconnect();
};

run().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
