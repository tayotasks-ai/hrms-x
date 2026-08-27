import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';

// Platform-owner accounts — a small, fixed set (Jakin + co-founder), created
// only via scripts/seedPlatformAdmin.js, never through a public signup route.
// Deliberately NOT tied to any tenantId: this is the one collection in the
// whole system that sits outside the per-tenant isolation model, which is
// exactly why there's no self-serve way to create one. See
// middleware/platformAuth.js (protectPlatform) and
// controllers/platformController.js for how this is used — cross-tenant
// monitoring plus tenant-support impersonation (see ImpersonationLog).
const platformAdminSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  email: { type: String, required: true, unique: true, trim: true, lowercase: true },
  password: { type: String, required: true },
  lastLoginAt: { type: Date },
  createdAt: { type: Date, default: Date.now },
});

platformAdminSchema.pre('save', async function (next) {
  if (!this.isModified('password')) return next();
  const salt = await bcrypt.genSalt(10);
  this.password = await bcrypt.hash(this.password, salt);
  next();
});

platformAdminSchema.methods.matchPassword = async function (enteredPassword) {
  return await bcrypt.compare(enteredPassword, this.password);
};

const PlatformAdmin = mongoose.model('PlatformAdmin', platformAdminSchema);
export default PlatformAdmin;
