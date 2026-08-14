import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import User from '../models/User.js';
import Employee from '../models/Employee.js';
import { sendEmail } from '../utils/email.js';
import { passwordResetRequested } from '../utils/emailTemplates.js';

const generateToken = (id) =>
  jwt.sign({ id }, process.env.JWT_SECRET, { expiresIn: '7d' });

const hashToken = (raw) => crypto.createHash('sha256').update(raw).digest('hex');
const RESET_TOKEN_TTL_MS = 30 * 60 * 1000; // 30 minutes

// POST /api/auth/login
export const loginUser = async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password)
      return res.status(400).json({ success: false, message: 'Email and password are required.' });

    const normalised = email.toLowerCase().trim();

    // 1 – Try HR Admin
    const admin = await User.findOne({ email: normalised }).populate('tenantId');
    if (admin && (await admin.matchPassword(password))) {
      return res.json({
        success: true,
        data: {
          _id: admin._id,
          name: admin.name,
          email: admin.email,
          role: admin.role,
          tenant: admin.tenantId,
          token: generateToken(admin._id),
        },
      });
    }

    // 2 – Try Employee
    const emp = await Employee.findOne({ email: normalised }).populate('tenantId');
    if (emp && emp.password && (await emp.matchPassword(password))) {
      return res.json({
        success: true,
        data: {
          _id: emp._id,
          name: emp.name,
          email: emp.email,
          role: 'Employee',
          department: emp.department,
          isDefaultPassword: emp.isDefaultPassword,
          tenant: emp.tenantId,
          token: generateToken(emp._id),
        },
      });
    }

    return res.status(401).json({ success: false, message: 'Invalid email or password.' });
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
