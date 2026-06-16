import jwt from 'jsonwebtoken';
import User from '../models/User.js';
import Employee from '../models/Employee.js';

// ── protect ──────────────────────────────────────────────────────────────────
// Verifies JWT, attaches req.user and req.userRole.
// Must run AFTER tenantMiddleware so req.tenantId is available.
export const protect = async (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    return res.status(401).json({ success: false, message: 'Not authorized. No token provided.' });
  }

  const token = authHeader.split(' ')[1];
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    // Try HR Admin / System Admin first
    let user = await User.findById(decoded.id).select('-password');
    if (user) {
      // Verify the admin belongs to the requesting tenant
      if (user.tenantId.toString() !== req.tenantId.toString()) {
        return res.status(403).json({ success: false, message: 'Forbidden. Token does not match tenant.' });
      }
      req.user = user;
      req.userRole = user.role; // 'HR_Admin' | 'System_Admin'
      return next();
    }

    // Try Employee
    let employee = await Employee.findById(decoded.id).select('-password');
    if (employee) {
      if (employee.tenantId.toString() !== req.tenantId.toString()) {
        return res.status(403).json({ success: false, message: 'Forbidden. Token does not match tenant.' });
      }
      req.user = employee;
      req.userRole = 'Employee';
      return next();
    }

    return res.status(401).json({ success: false, message: 'Not authorized. User not found.' });
  } catch {
    return res.status(401).json({ success: false, message: 'Not authorized. Token invalid or expired.' });
  }
};

// ── requireRole ───────────────────────────────────────────────────────────────
// Usage: requireRole('HR_Admin', 'System_Admin')
export const requireRole = (...roles) => (req, res, next) => {
  if (!roles.includes(req.userRole)) {
    return res.status(403).json({
      success: false,
      message: `Forbidden. Required role: ${roles.join(' or ')}.`
    });
  }
  next();
};

// ── HR-only shorthand ─────────────────────────────────────────────────────────
export const hrOnly = requireRole('HR_Admin', 'System_Admin');
