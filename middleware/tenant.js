import mongoose from 'mongoose';

// Paths that bypass tenant scoping (public endpoints)
const BYPASS = new Set(['/api/health', '/api/tenants', '/api/auth/login', '/api/auth/forgot-password', '/api/auth/reset-password', '/api/auth/verify-otp', '/api/webhooks/paystack']);

const tenantMiddleware = (req, res, next) => {
  if (BYPASS.has(req.path)) return next();
  // Platform-admin routes are inherently cross-tenant (list/monitor every
  // tenant) — they authenticate via protectPlatform, not the per-tenant
  // X-Tenant-ID + protect combo, so there's no single tenant to require here.
  if (req.path.startsWith('/api/platform')) return next();

  const tenantId = req.headers['x-tenant-id'];
  if (!tenantId) {
    return res.status(400).json({ success: false, message: 'X-Tenant-ID header is required.' });
  }
  if (!mongoose.Types.ObjectId.isValid(tenantId)) {
    return res.status(400).json({ success: false, message: 'X-Tenant-ID is not a valid ObjectId.' });
  }

  // Normalise: both req.tenantId and req.tenant._id point to the same ObjectId
  req.tenantId = new mongoose.Types.ObjectId(tenantId);
  req.tenant = { _id: req.tenantId };
  next();
};

export default tenantMiddleware;
