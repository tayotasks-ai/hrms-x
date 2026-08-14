import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import User from '../models/User.js';
import Employee from '../models/Employee.js';
import { sendEmail } from '../utils/email.js';
import { passwordResetRequested, loginOtpCode } from '../utils/emailTemplates.js';

const generateToken = (id) =>
  jwt.sign({ id }, process.env.JWT_SECRET, { expiresIn: '7d' });

const hashToken = (raw) => crypto.createHash('sha256').update(raw).digest('hex');
const RESET_TOKEN_TTL_MS = 30 * 60 * 1000; // 30 minutes

// ── Email OTP 2FA (opt-in) ───────────────────────────────────────────────────
// Off by default per account — toggled via PUT /api/auth/2fa. When enabled,
// a successful password check doesn't issue a real JWT yet; instead it
// issues a short-lived "pending" token the client must exchange, along with
// the emailed code, at POST /api/auth/verify-otp.
const OTP_TTL_MS = 10 * 60 * 1000; // 10 minutes
const generateOtp = () => String(Math.floor(100000 + Math.random() * 900000));
const issuePendingToken = (id) => jwt.sign({ id, pending2fa: true }, process.env.JWT_SECRET, { expiresIn: '10m' });

const startOtpChallenge = async (account) => {
  const code = generateOtp();
  account.twoFactorOtpHash = hashToken(code);
  account.twoFactorOtpExpires = new Date(Date.now() + OTP_TTL_MS);
  await account.save();
  if (account.email) {
    const tpl = loginOtpCode({ name: account.name, code });
    sendEmail({ to: account.email, ...tpl }).catch(err => console.error('Email failed:', err.message));
  }
  return { requiresOtp: true, pendingToken: issuePendingToken(account._id), email: account.email };
};

// ── Brute-force lockout ──────────────────────────────────────────────────────
// Shared by both User and Employee logins. Locks an account for
// LOCKOUT_DURATION_MS after LOCKOUT_THRESHOLD consecutive failed attempts.
// Layered under the IP-based express-rate-limit in middleware/rateLimiter.js.
const LOCKOUT_THRESHOLD = 5;
const LOCKOUT_DURATION_MS = 15 * 60 * 1000; // 15 minutes

const attemptLogin = async (account, password) => {
  if (account.lockUntil && account.lockUntil > new Date()) {
    return { locked: true, matched: false, lockUntil: account.lockUntil };
  }

  const matched = await account.matchPassword(password);

  if (matched) {
    if (account.failedLoginAttempts || account.lockUntil) {
      account.failedLoginAttempts = 0;
      account.lockUntil = undefined;
      await account.save();
    }
    return { locked: false, matched: true };
  }

  account.failedLoginAttempts = (account.failedLoginAttempts || 0) + 1;
  let justLocked = false;
  if (account.failedLoginAttempts >= LOCKOUT_THRESHOLD) {
    account.lockUntil = new Date(Date.now() + LOCKOUT_DURATION_MS);
    account.failedLoginAttempts = 0; // fresh counter for the window after unlock
    justLocked = true;
  }
  await account.save();
  return { locked: justLocked, matched: false, lockUntil: account.lockUntil };
};

const lockMessage = (lockUntil) =>
  `Too many failed attempts. This account is locked until ${lockUntil.toLocaleTimeString('en-NG', { hour: '2-digit', minute: '2-digit' })}.`;

// POST /api/auth/login
export const loginUser = async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password)
      return res.status(400).json({ success: false, message: 'Email and password are required.' });

    const normalised = email.toLowerCase().trim();

    // 1 – Try HR Admin
    const admin = await User.findOne({ email: normalised })
      .select('+failedLoginAttempts +lockUntil +twoFactorOtpHash +twoFactorOtpExpires').populate('tenantId');
    if (admin) {
      const result = await attemptLogin(admin, password);
      if (result.locked) return res.status(423).json({ success: false, message: lockMessage(result.lockUntil) });
      if (result.matched) {
        if (admin.twoFactorEnabled) {
          return res.json({ success: true, data: await startOtpChallenge(admin) });
        }
        return res.json({
          success: true,
          data: {
            _id: admin._id,
            name: admin.name,
            email: admin.email,
            role: admin.role,
            twoFactorEnabled: admin.twoFactorEnabled,
            tenant: admin.tenantId,
            token: generateToken(admin._id),
          },
        });
      }
    }

    // 2 – Try Employee
    const emp = await Employee.findOne({ email: normalised })
      .select('+failedLoginAttempts +lockUntil +twoFactorOtpHash +twoFactorOtpExpires').populate('tenantId');
    if (emp && emp.password) {
      const result = await attemptLogin(emp, password);
      if (result.locked) return res.status(423).json({ success: false, message: lockMessage(result.lockUntil) });
      if (result.matched) {
        if (emp.twoFactorEnabled) {
          return res.json({ success: true, data: await startOtpChallenge(emp) });
        }
        return res.json({
          success: true,
          data: {
            _id: emp._id,
            name: emp.name,
            email: emp.email,
            role: 'Employee',
            department: emp.department,
            isDefaultPassword: emp.isDefaultPassword,
            twoFactorEnabled: emp.twoFactorEnabled,
            tenant: emp.tenantId,
            token: generateToken(emp._id),
          },
        });
      }
    }

    return res.status(401).json({ success: false, message: 'Invalid email or password.' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// POST /api/auth/verify-otp – completes a login that required 2FA.
export const verifyLoginOtp = async (req, res) => {
  try {
    const { pendingToken, code } = req.body;
    if (!pendingToken || !code)
      return res.status(400).json({ success: false, message: 'pendingToken and code are required.' });

    let decoded;
    try {
      decoded = jwt.verify(pendingToken, process.env.JWT_SECRET);
    } catch {
      return res.status(401).json({ success: false, message: 'This login session has expired. Please log in again.' });
    }
    if (!decoded.pending2fa)
      return res.status(400).json({ success: false, message: 'Invalid verification token.' });

    const query = { _id: decoded.id, twoFactorOtpHash: hashToken(String(code).trim()), twoFactorOtpExpires: { $gt: new Date() } };

    let admin = await User.findOne(query).select('+twoFactorOtpHash +twoFactorOtpExpires').populate('tenantId');
    let emp = null;
    if (!admin) emp = await Employee.findOne(query).select('+twoFactorOtpHash +twoFactorOtpExpires').populate('tenantId');

    const account = admin || emp;
    if (!account)
      return res.status(400).json({ success: false, message: 'Invalid or expired code.' });

    account.twoFactorOtpHash = undefined;
    account.twoFactorOtpExpires = undefined;
    await account.save();

    if (admin) {
      return res.json({
        success: true,
        data: { _id: admin._id, name: admin.name, email: admin.email, role: admin.role, twoFactorEnabled: admin.twoFactorEnabled, tenant: admin.tenantId, token: generateToken(admin._id) },
      });
    }
    res.json({
      success: true,
      data: {
        _id: emp._id, name: emp.name, email: emp.email, role: 'Employee',
        department: emp.department, isDefaultPassword: emp.isDefaultPassword, twoFactorEnabled: emp.twoFactorEnabled,
        tenant: emp.tenantId, token: generateToken(emp._id),
      },
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// PUT /api/auth/2fa – authenticated. Body: { enabled: boolean }. Opt-in
// email OTP 2FA toggle for the logged-in account.
export const setTwoFactor = async (req, res) => {
  try {
    const { enabled } = req.body;
    const Model = req.userRole === 'Employee' ? Employee : User;
    const account = await Model.findById(req.user._id);
    if (!account) return res.status(404).json({ success: false, message: 'Account not found.' });

    account.twoFactorEnabled = !!enabled;
    await account.save();
    res.json({ success: true, message: `Email OTP 2FA ${enabled ? 'enabled' : 'disabled'}.`, data: { twoFactorEnabled: account.twoFactorEnabled } });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// PUT /api/auth/change-password  – authenticated (Employee or User)
export const changePassword = async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;
    if (!currentPassword || !newPassword)
      return res.status(400).json({ success: false, message: 'Current and new password are required.' });
    if (newPassword.length < 8)
      return res.status(400).json({ success: false, message: 'New password must be at least 8 characters.' });

    const Model = req.userRole === 'Employee' ? Employee : User;
    const account = await Model.findById(req.user._id);
    if (!account) return res.status(404).json({ success: false, message: 'Account not found.' });

    const matches = await account.matchPassword(currentPassword);
    if (!matches) return res.status(401).json({ success: false, message: 'Current password is incorrect.' });

    account.password = newPassword; // re-hashed by the model's pre-save hook
    if (req.userRole === 'Employee') account.isDefaultPassword = false;
    await account.save();

    res.json({ success: true, message: 'Password updated.' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// POST /api/auth/forgot-password  – public. Always responds generically to
// avoid leaking which emails exist. Mirrors loginUser's lookup order
// (User/HR Admin first, then Employee) since email isn't guaranteed unique
// across tenants for employees.
export const forgotPassword = async (req, res) => {
  const genericResponse = { success: true, message: 'If that email is registered, a reset link has been sent.' };
  try {
    const email = (req.body.email || '').toLowerCase().trim();
    if (!email) return res.status(400).json(genericResponse);

    const admin = await User.findOne({ email });
    const account = admin || await Employee.findOne({ email });
    if (!account) return res.json(genericResponse); // don't reveal non-existence

    const rawToken = crypto.randomBytes(32).toString('hex');
    account.resetPasswordToken = hashToken(rawToken);
    account.resetPasswordExpires = new Date(Date.now() + RESET_TOKEN_TTL_MS);
    await account.save();

    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
    const resetUrl = `${frontendUrl}/reset-password?token=${rawToken}&email=${encodeURIComponent(email)}`;
    const tpl = passwordResetRequested({ name: account.name, resetUrl });
    sendEmail({ to: account.email, ...tpl }).catch(err => console.error('Email failed:', err.message));

    res.json(genericResponse);
  } catch (err) {
    // Still respond generically — don't leak internals via the reset flow
    console.error('forgotPassword error:', err.message);
    res.json(genericResponse);
  }
};

// POST /api/auth/reset-password  – public, consumes the emailed token
export const resetPassword = async (req, res) => {
  try {
    const { token, email, newPassword } = req.body;
    if (!token || !email || !newPassword)
      return res.status(400).json({ success: false, message: 'Token, email, and new password are required.' });
    if (newPassword.length < 8)
      return res.status(400).json({ success: false, message: 'New password must be at least 8 characters.' });

    const normalisedEmail = email.toLowerCase().trim();
    const hashed = hashToken(token);
    const query = { email: normalisedEmail, resetPasswordToken: hashed, resetPasswordExpires: { $gt: new Date() } };

    const admin = await User.findOne(query).select('+resetPasswordToken +resetPasswordExpires');
    const account = admin || await Employee.findOne(query).select('+resetPasswordToken +resetPasswordExpires');
    if (!account)
      return res.status(400).json({ success: false, message: 'This reset link is invalid or has expired.' });

    account.password = newPassword;
    account.resetPasswordToken = undefined;
    account.resetPasswordExpires = undefined;
    if (!admin) account.isDefaultPassword = false;
    await account.save();

    res.json({ success: true, message: 'Password has been reset. You can now log in.' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};
