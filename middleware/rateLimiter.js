import rateLimit from 'express-rate-limit';

// IP-based limiter for auth endpoints — a coarse first line of defense
// against brute-force/credential-stuffing. Layered on top of the
// per-account lockout in authController.js, which is the more precise
// control (an attacker spread across many IPs would sail past this but
// still get locked out per-account).
export const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  limit: 20, // 20 attempts per IP per window across login/forgot-password
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Too many attempts from this network. Please try again in a few minutes.' },
});
