import jwt from 'jsonwebtoken';
import PlatformAdmin from '../models/PlatformAdmin.js';

// ── protectPlatform ──────────────────────────────────────────────────────────
// Completely separate from protect/hrOnly (authMiddleware.js). Verifies a
// platform-admin JWT (marked with `type: 'platform'` so it can never be
// confused with — or forged from — a regular tenant User/Employee token) and
// attaches req.platformAdmin. Routes using this middleware must NOT also use
// tenantMiddleware's X-Tenant-ID requirement — see middleware/tenant.js,
// which bypasses that check for the /api/platform prefix, since a platform
// admin operates across all tenants, not inside one.
export const protectPlatform = async (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    return res.status(401).json({ success: false, message: 'Not authorized. No token provided.' });
  }

  const token = authHeader.split(' ')[1];
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    if (decoded.type !== 'platform') {
      return res.status(403).json({ success: false, message: 'Forbidden. Not a platform-admin token.' });
    }

    const admin = await PlatformAdmin.findById(decoded.id).select('-password');
    if (!admin) {
      return res.status(401).json({ success: false, message: 'Not authorized. Platform admin not found.' });
    }

    req.platformAdmin = admin;
    return next();
  } catch {
    return res.status(401).json({ success: false, message: 'Not authorized. Token invalid or expired.' });
  }
};
