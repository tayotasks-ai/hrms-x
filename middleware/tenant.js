import mongoose from 'mongoose';

// Paths that bypass tenant scoping (public endpoints)
const BYPASS = new Set(['/api/health', '/api/tenants', '/api/auth/login', '/api/auth/forgot-password', '/api/auth/reset-password', '/api/auth/verify-otp', '/api/webhooks/paystack']);

const tenantMiddleware = (req, res, next) => {
  if (BYPASS.has(req.path)) return next();

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
