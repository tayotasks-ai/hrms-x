import PlatformAdmin from '../models/PlatformAdmin.js';

// Runs once on every server start. Creates the platform (root) admin account
// from env vars if one doesn't already exist for that email — this is what
// lets a fresh deploy (e.g. Render, which has no interactive shell step in
// the normal deploy flow) end up with a working root login without anyone
// having to exec into the running dyno and run scripts/seedPlatformAdmin.js
// by hand.
//
// Deliberately conservative:
//   - No-ops entirely if PLATFORM_ADMIN_EMAIL / PLATFORM_ADMIN_PASSWORD
//     aren't set — nothing is created unless you opt in.
//   - Never overwrites an existing account's password. Once the account
//     exists, this becomes a no-op every subsequent deploy; to change the
//     password later use scripts/seedPlatformAdmin.js (or the account's own
//     future self-service change-password flow, if one gets built).
//   - Never logs the password.
export const autoSeedPlatformAdmin = async () => {
  const email = process.env.PLATFORM_ADMIN_EMAIL;
  const password = process.env.PLATFORM_ADMIN_PASSWORD;
  const name = process.env.PLATFORM_ADMIN_NAME || 'Platform Admin';

  if (!email || !password) return; // opt-in only

  const normalisedEmail = email.toLowerCase().trim();
  const existing = await PlatformAdmin.findOne({ email: normalisedEmail });
  if (existing) return; // already provisioned — never touch it again from here

  await PlatformAdmin.create({ name: name.trim(), email: normalisedEmail, password });
  console.log(`Platform admin auto-seeded: ${normalisedEmail}`);
};
