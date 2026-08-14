import Tenant from '../models/Tenant.js';
import { encryptSecret, decryptSecret } from '../utils/crypto.js';
import { validateSecretKey, PaystackError } from '../utils/paystack.js';
import { recordAudit } from '../utils/auditLog.js';

// Shared helper used by any controller that needs to call Paystack on a
// tenant's behalf (bank verification, payment initiation, etc). Throws a
// plain Error with a user-facing message if Paystack isn't connected yet.
export const getDecryptedPaystackKey = async (tenantId) => {
  const tenant = await Tenant.findById(tenantId).select('+paystack.secretKeyEncrypted paystack.connected');
  if (!tenant?.paystack?.connected || !tenant.paystack.secretKeyEncrypted)
    throw new Error('Paystack is not connected for this company yet. Connect it under Payment Settings first.');
  return decryptSecret(tenant.paystack.secretKeyEncrypted);
};

// GET /api/payment-settings  – HR only. Never returns the key itself, only
// connection status, so the frontend can show "Connected" / "Not connected".
export const getPaymentSettings = async (req, res) => {
  try {
    const tenant = await Tenant.findById(req.tenantId).select('paystack.connected paystack.connectedAt paystack.requireDualApproval');
    res.json({
      success: true,
      data: {
        paystack: {
          connected: !!tenant?.paystack?.connected,
          connectedAt: tenant?.paystack?.connectedAt || null,
          requireDualApproval: !!tenant?.paystack?.requireDualApproval,
        },
      },
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// PUT /api/payment-settings/dual-approval  – HR only. Body: { enabled }.
// Toggles maker-checker for payroll disbursement (see Tenant.js).
export const setDualApproval = async (req, res) => {
  try {
    const enabled = !!req.body.enabled;
    const tenant = await Tenant.findByIdAndUpdate(
      req.tenantId,
      { 'paystack.requireDualApproval': enabled },
      { new: true }
    ).select('paystack.requireDualApproval');

    recordAudit({
      tenantId: req.tenantId,
      actor: { id: req.user._id, name: req.user.name, model: req.userRole === 'Employee' ? 'Employee' : 'User' },
      targetType: 'PaymentSettings',
      targetId: req.tenantId,
      targetName: 'Payroll dual approval',
      changes: [{ field: 'requireDualApproval', from: String(!enabled), to: String(enabled) }],
    });

    res.json({ success: true, message: `Dual approval ${enabled ? 'enabled' : 'disabled'}.`, data: { requireDualApproval: tenant.paystack.requireDualApproval } });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// POST /api/payment-settings/paystack/connect  – HR only.
// Body: { secretKey }. We validate the key against Paystack's own API
// before persisting anything — if it's not a real, working secret key we
// reject it rather than store garbage. The key is encrypted at rest and
// never echoed back in any response.
export const connectPaystack = async (req, res) => {
  try {
    const { secretKey } = req.body;
    if (!secretKey || typeof secretKey !== 'string' || !secretKey.trim())
      return res.status(400).json({ success: false, message: 'secretKey is required.' });

    const trimmed = secretKey.trim();
    if (!trimmed.startsWith('sk_'))
      return res.status(400).json({ success: false, message: 'That does not look like a Paystack secret key (should start with "sk_test_" or "sk_live_").' });

    try {
      await validateSecretKey(trimmed);
    } catch (err) {
      if (err instanceof PaystackError)
        return res.status(400).json({ success: false, message: `Paystack rejected this key: ${err.message}` });
      // Network/other failure talking to Paystack — surface distinctly so it's
      // not confused with an invalid key.
      return res.status(502).json({ success: false, message: `Could not reach Paystack to verify the key: ${err.message}` });
    }

    const encrypted = encryptSecret(trimmed);
    // Dot-notation update — a wholesale `{ paystack: {...} }` replace would
    // clobber sibling fields like requireDualApproval every time the key is
    // (re)connected.
    const tenant = await Tenant.findByIdAndUpdate(
      req.tenantId,
      { 'paystack.secretKeyEncrypted': encrypted, 'paystack.connected': true, 'paystack.connectedAt': new Date() },
      { new: true }
    ).select('paystack.connected paystack.connectedAt');

    recordAudit({
      tenantId: req.tenantId,
      actor: { id: req.user._id, name: req.user.name, model: req.userRole === 'Employee' ? 'Employee' : 'User' },
      targetType: 'PaymentSettings',
      targetId: req.tenantId,
      targetName: 'Paystack integration',
      changes: [{ field: 'connected', from: 'false', to: 'true' }],
    });

    res.json({ success: true, message: 'Paystack connected.', data: { paystack: tenant.paystack } });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// DELETE /api/payment-settings/paystack  – HR only. Wipes the stored key.
export const disconnectPaystack = async (req, res) => {
  try {
    await Tenant.findByIdAndUpdate(req.tenantId, {
      $unset: { 'paystack.secretKeyEncrypted': '', 'paystack.connectedAt': '' },
      $set: { 'paystack.connected': false },
    });

    recordAudit({
      tenantId: req.tenantId,
      actor: { id: req.user._id, name: req.user.name, model: req.userRole === 'Employee' ? 'Employee' : 'User' },
      targetType: 'PaymentSettings',
      targetId: req.tenantId,
      targetName: 'Paystack integration',
      changes: [{ field: 'connected', from: 'true', to: 'false' }],
    });

    res.json({ success: true, message: 'Paystack disconnected.' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};
