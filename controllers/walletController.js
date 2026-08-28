import Tenant from '../models/Tenant.js';
import WalletTransaction from '../models/WalletTransaction.js';
import { getPlatformSecretKey, createCustomer, createDedicatedAccount, updateCustomerPhone, checkAvailableBalance, getPendingSettlements, PaystackError } from '../utils/paystack.js';
import { recordAudit } from '../utils/auditLog.js';

// GET /api/wallet — HR only. Balance, dedicated account (if set up), and
// the payroll schedule/dual-approval settings, all in one call so the
// Wallet tab can render in a single request.
export const getWallet = async (req, res) => {
  try {
    const tenant = await Tenant.findById(req.tenantId).select('wallet payrollSchedule name isTestAccount');
    const ledgerBalance = tenant?.wallet?.balance || 0;

    // Best-effort live check against Paystack's REAL available balance —
    // this can legitimately read lower than the ledger above. A dedicated
    // virtual account deposit credits ledgerBalance the instant our
    // webhook fires, but Paystack doesn't release that money for outbound
    // Transfers until it settles (typically same-day to next business
    // day), so a freshly-funded wallet can show a balance here that isn't
    // actually payable yet — see utils/paystack.js checkAvailableBalance.
    //
    // confirmedAvailable is capped at this tenant's own ledgerBalance, not
    // the raw platform figure — Paystack balance is one shared pool across
    // every tenant, and we never want to expose the platform's total
    // treasury size to an individual tenant's HR admin. nextSettlementDate
    // is just a date (no amount) from the platform's nearest pending
    // settlement, as a rough "check back around then" hint.
    //
    // Both calls fail soft: if the platform key isn't configured or
    // Paystack is unreachable, we just omit these fields rather than break
    // the Wallet tab over a nice-to-have status readout.
    let confirmedAvailable = null;
    let nextSettlementDate = null;
    try {
      const secretKey = getPlatformSecretKey();
      const [platformAvailable, pending] = await Promise.all([
        checkAvailableBalance(secretKey),
        getPendingSettlements(secretKey),
      ]);
      confirmedAvailable = Math.max(0, Math.min(ledgerBalance, platformAvailable));
      if (pending.length > 0) {
        nextSettlementDate = pending.map(s => s.settlementDate).sort()[0];
      }
    } catch {
      // non-fatal — the Wallet tab just won't show the live-availability hint
    }

    res.json({
      success: true,
      data: {
        balance: ledgerBalance,
        confirmedAvailable,
        nextSettlementDate,
        dedicatedAccount: tenant?.wallet?.dedicatedAccount?.active ? tenant.wallet.dedicatedAccount : null,
        requireDualApproval: !!tenant?.wallet?.requireDualApproval,
        payrollSchedule: tenant?.payrollSchedule || { dayOfMonth: 25, useLastDayOfMonth: false, active: false },
        isTestAccount: !!tenant?.isTestAccount,
      },
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// POST /api/wallet/setup — HR only. Creates the tenant's Paystack customer
// (first time only) and their dedicated virtual account. Idempotent: if a
// dedicated account already exists and is active, just returns it — Pay­
// stack doesn't allow a second NUBAN to be created for the same customer
// without deactivating the first, and there's no reason to.
export const setupWallet = async (req, res) => {
  try {
    const tid = req.tenantId;
    const tenant = await Tenant.findById(tid).select('name wallet');
    if (!tenant) return res.status(404).json({ success: false, message: 'Tenant not found.' });

    if (tenant.wallet?.dedicatedAccount?.active) {
      return res.json({ success: true, message: 'Wallet is already set up.', data: { dedicatedAccount: tenant.wallet.dedicatedAccount } });
    }

    let secretKey;
    try { secretKey = getPlatformSecretKey(); }
    catch (err) { return res.status(503).json({ success: false, message: err.message }); }

    const actorEmail = req.user.email;
    if (!actorEmail) return res.status(400).json({ success: false, message: 'The HR admin setting this up needs an email address on file.' });

    // Paystack requires a phone number to issue a Dedicated NUBAN — the
    // User model has no phone field, so this has to be collected here,
    // one-time, from whoever sets the wallet up.
    const phone = (req.body?.phone || '').trim();
    if (!phone) return res.status(400).json({ success: false, message: 'A phone number is required to set up the payroll wallet (Paystack needs it to issue the dedicated account).' });

    const nameParts = String(tenant.name || 'Company').trim().split(/\s+/);
    const firstName = nameParts[0] || 'Company';
    const lastName = nameParts.slice(1).join(' ') || tenant.name || 'Wallet';

    try {
      let customerCode = tenant.wallet?.paystackCustomerCode;
      if (!customerCode) {
        const customer = await createCustomer(secretKey, { email: actorEmail, firstName, lastName, phone });
        customerCode = customer.customerCode;
      } else {
        // Customer already existed (e.g. from an earlier attempt before
        // phone was collected) — patch it directly too, though the belt-
        // and-suspenders fix is passing these into createDedicatedAccount
        // below, which is what Paystack's docs actually recommend.
        await updateCustomerPhone(secretKey, { customerCode, phone }).catch(err => console.error('Customer phone update failed:', err.message));
      }

      const preferredBank = process.env.PAYSTACK_DVA_PREFERRED_BANK || 'wema-bank';
      const account = await createDedicatedAccount(secretKey, { customerCode, preferredBank, firstName, lastName, phone });

      const updated = await Tenant.findByIdAndUpdate(
        tid,
        {
          'wallet.paystackCustomerCode': customerCode,
          'wallet.dedicatedAccount': {
            accountNumber: account.accountNumber,
            accountName: account.accountName,
            bankName: account.bankName,
            bankId: account.bankId,
            active: account.active,
          },
        },
        { new: true }
      ).select('wallet.dedicatedAccount');

      recordAudit({
        tenantId: tid,
        actor: { id: req.user._id, name: req.user.name, model: 'User' },
        targetType: 'Wallet',
        targetId: tid,
        targetName: 'Payroll wallet',
        changes: [{ field: 'dedicatedAccount', from: 'none', to: account.accountNumber }],
      });

      res.json({ success: true, message: 'Wallet set up.', data: { dedicatedAccount: updated.wallet.dedicatedAccount } });
    } catch (err) {
      if (err instanceof PaystackError)
        return res.status(502).json({ success: false, message: `Paystack could not create a dedicated account: ${err.message}` });
      throw err;
    }
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// PUT /api/wallet/dual-approval — HR only. Body: { enabled }. Same
// maker-checker toggle as before, now stored under wallet instead of
// paystack.
export const setWalletDualApproval = async (req, res) => {
  try {
    const enabled = !!req.body.enabled;
    const tenant = await Tenant.findByIdAndUpdate(
      req.tenantId,
      { 'wallet.requireDualApproval': enabled },
      { new: true }
    ).select('wallet.requireDualApproval');

    recordAudit({
      tenantId: req.tenantId,
      actor: { id: req.user._id, name: req.user.name, model: req.userRole === 'Employee' ? 'Employee' : 'User' },
      targetType: 'PaymentSettings',
      targetId: req.tenantId,
      targetName: 'Payroll dual approval',
      changes: [{ field: 'requireDualApproval', from: String(!enabled), to: String(enabled) }],
    });

    res.json({ success: true, message: `Dual approval ${enabled ? 'enabled' : 'disabled'}.`, data: { requireDualApproval: tenant.wallet.requireDualApproval } });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// PUT /api/wallet/schedule — HR only. Body: { dayOfMonth, useLastDayOfMonth, active }.
// Checked once a day by jobs/payrollScheduler.js.
export const setPayrollSchedule = async (req, res) => {
  try {
    const { dayOfMonth, useLastDayOfMonth, active } = req.body;
    const update = {};
    if (dayOfMonth !== undefined) {
      const day = Number(dayOfMonth);
      if (!Number.isInteger(day) || day < 1 || day > 31)
        return res.status(400).json({ success: false, message: 'dayOfMonth must be an integer between 1 and 31.' });
      update['payrollSchedule.dayOfMonth'] = day;
    }
    if (useLastDayOfMonth !== undefined) update['payrollSchedule.useLastDayOfMonth'] = !!useLastDayOfMonth;
    if (active !== undefined) update['payrollSchedule.active'] = !!active;

    const tenant = await Tenant.findByIdAndUpdate(req.tenantId, update, { new: true }).select('payrollSchedule');

    recordAudit({
      tenantId: req.tenantId,
      actor: { id: req.user._id, name: req.user.name, model: 'User' },
      targetType: 'PaymentSettings',
      targetId: req.tenantId,
      targetName: 'Payroll schedule',
      changes: Object.entries(update).map(([field, to]) => ({ field, to: String(to) })),
    });

    res.json({ success: true, message: 'Payroll schedule updated.', data: { payrollSchedule: tenant.payrollSchedule } });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// GET /api/wallet/transactions — HR only. Most recent 50 ledger entries.
export const getWalletTransactions = async (req, res) => {
  try {
    const transactions = await WalletTransaction.find({ tenantId: req.tenantId })
      .sort({ createdAt: -1 })
      .limit(50)
      .populate({ path: 'relatedPayslip', select: 'period employeeId', populate: { path: 'employeeId', select: 'name' } });
    res.json({ success: true, data: transactions });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};
