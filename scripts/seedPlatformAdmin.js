// One-off CLI script to create or update a platform-owner ("root") account.
// There is deliberately no HTTP signup route for PlatformAdmin — this is the
// only way one gets created, and it's meant to be run by hand by whoever
// controls the server/database, not exposed to any tenant or the public app.
//
// Usage (from backend/):
//   node scripts/seedPlatformAdmin.js "Jakin" jakin@example.com "somePassword123"
//
// Running it again with the same email updates that account's name/password
// instead of creating a duplicate (email is unique).

import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import mongoose from 'mongoose';
import PlatformAdmin from '../models/PlatformAdmin.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../.env') });

const [, , name, email, password] = process.argv;

if (!name || !email || !password) {
  console.error('Usage: node scripts/seedPlatformAdmin.js "<name>" <email> <password>');
  process.exit(1);
}
if (password.length < 8) {
  console.error('Password must be at least 8 characters.');
  process.exit(1);
}

const run = async () => {
  await mongoose.connect(process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/antigravity_hrms');

  const normalisedEmail = email.toLowerCase().trim();
  let admin = await PlatformAdmin.findOne({ email: normalisedEmail });

  if (admin) {
    admin.name = name.trim();
    admin.password = password; // pre-save hook re-hashes since this field changed
    await admin.save();
    console.log(`Updated existing platform admin: ${admin.email}`);
  } else {
    admin = await PlatformAdmin.create({ name: name.trim(), email: normalisedEmail, password });
    console.log(`Created platform admin: ${admin.email}`);
  }

  await mongoose.disconnect();
  process.exit(0);
};

run().catch((err) => {
  console.error('Failed to seed platform admin:', err.message);
  process.exit(1);
});
