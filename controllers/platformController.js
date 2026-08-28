import jwt from 'jsonwebtoken';
import PlatformAdmin from '../models/PlatformAdmin.js';
import ImpersonationLog from '../models/ImpersonationLog.js';
import Tenant from '../models/Tenant.js';
import User from '../models/User.js';
import Employee from '../models/Employee.js';
import { PLAN_PRICE_PER_EMPLOYEE } from './tenantController.js';
import { notifyHrAdmins } from '../utils/notify.js';

const generatePlatformToken = (id) =>
  jwt.sign({ id, type: 'platform' }, process.env.JWT_SECRET, { expiresIn: '12h' });

// Impersonation sessions are deliberately much shorter-lived than a normal
// 7-day tenant login token — this is a support tool, not a standing session.
const IMPERSONATION_TTL = '45m';
const IMPERSONATION_TTL_MS = 45 * 60 * 1000;

// ── computeOnboardingProgress ────────────────────────────────────────────────
// Pure decision logic behind the "help them onboard" part of the root view:
// which setup milestones has a tenant hit? Separated from the DB-touching
// listTenants below so it's unit-testable without mocking Mongo (matches the
// pattern used elsewhere in this codebase, e.g. computeRemainingSeats in
// employeeController.js).
export const ONBOARDING_STEPS = ['employees_added', 'wallet_funded', 'payroll_run'];

export const computeOnboardingProgress = ({ employeeCount = 0, walletBalance = 0, hasRunPayroll = false } = {}) => {
  const steps = {
    employees_added: employeeCount > 0,
    wallet_funded: (walletBalance || 0) > 0,
    payroll_run: !!hasRunPayroll,
  };
  const completed = Object.values(steps).filter(Boolean).length;
  return {
    steps,
    completed,
    total: ONBOARDING_STEPS.length,
    percent: Math.round((completed / ONBOARDING_STEPS.length) * 100),
  };
};

// POST /api/platform/login – no tenant context, separate account space
// entirely (see models/PlatformAdmin.js). Reuses the same brute-force
// lockout pattern conceptually but kept intentionally simple/self-contained
// since there are only ever a couple of these accounts.
export const platformLogin = async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ success: false, message: 'Email and password are required.' });
    }
    const admin = await PlatformAdmin.findOne({ email: email.toLowerCase().trim() });
    if (!admin || !(await admin.matchPassword(password))) {
      return res.status(401).json({ success: false, message: 'Invalid email or password.' });
    }
    admin.lastLoginAt = new Date();
    await admin.save();
    res.json({
      success: true,
      data: { _id: admin._id, name: admin.name, email: admin.email, token: generatePlatformToken(admin._id) },
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// GET /api/platform/tenants – protectPlatform only. One row per tenant with
// enough at-a-glance signal to know who needs help: plan, headcount, wallet
// health, and onboarding progress.
export const listTenants = async (req, res) => {
  try {
    const tenants = await Tenant.find({}).sort({ createdAt: -1 });

    const rows = await Promise.all(
      tenants.map(async (t) => {
        const employeeCount = await Employee.countDocuments({ tenantId: t._id, status: { $ne: 'Offboarded' } });
        const hasRunPayroll = !!t.payrollSchedule?.lastRunAt;
        const onboarding = computeOnboardingProgress({
          employeeCount,
          walletBalance: t.wallet?.balance || 0,
          hasRunPayroll,
        });
        return {
          _id: t._id,
          name: t.name,
          slug: t.slug,
          createdAt: t.createdAt,
          planTier: t.plan?.tier || 'Free',
          isTestAccount: !!t.isTestAccount,
          employeeCount,
          pricePerEmployee: PLAN_PRICE_PER_EMPLOYEE,
          walletBalance: t.wallet?.balance || 0,
          walletActive: !!t.wallet?.dedicatedAccount?.active,
          payrollScheduleActive: !!t.payrollSchedule?.active,
          onboarding,
        };
      })
    );

    res.json({ success: true, data: rows });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// GET /api/platform/tenants/:id – protectPlatform only. Slightly deeper view
// of one tenant for support/troubleshooting.
export const getTenantDetail = async (req, res) => {
  try {
    const tenant = await Tenant.findById(req.params.id);
    if (!tenant) return res.status(404).json({ success: false, message: 'Tenant not found.' });

    const [employeeCount, admins] = await Promise.all([
      Employee.countDocuments({ tenantId: tenant._id, status: { $ne: 'Offboarded' } }),
      User.find({ tenantId: tenant._id }).select('name email role createdAt lastLoginAt').sort({ createdAt: 1 }),
    ]);

    const onboarding = computeOnboardingProgress({
      employeeCount,
      walletBalance: tenant.wallet?.balance || 0,
      hasRunPayroll: !!tenant.payrollSchedule?.lastRunAt,
    });

    res.json({
      success: true,
      data: {
        _id: tenant._id,
        name: tenant.name,
        slug: tenant.slug,
        createdAt: tenant.createdAt,
        plan: tenant.plan,
        isTestAccount: !!tenant.isTestAccount,
        pricePerEmployee: PLAN_PRICE_PER_EMPLOYEE,
        wallet: tenant.wallet,
        payrollSchedule: tenant.payrollSchedule,
        employeeCount,
        admins,
        onboarding,
      },
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// PATCH /api/platform/tenants/:id/test-account – protectPlatform only.
// Flips the isTestAccount flag (see models/Tenant.js) so a tenant helping us
// test the product is exempt from the free-tier seat cap regardless of
// plan.tier — see computeRemainingSeats in employeeController.js. There is
// no tenant-facing UI for this; it's a root-dashboard-only override.
export const setTenantTestAccount = async (req, res) => {
  try {
    const { isTestAccount } = req.body;
    const tenant = await Tenant.findByIdAndUpdate(
      req.params.id,
      { isTestAccount: !!isTestAccount },
      { new: true }
    ).select('name isTestAccount');
    if (!tenant) return res.status(404).json({ success: false, message: 'Tenant not found.' });

    res.json({ success: true, data: { _id: tenant._id, isTestAccount: tenant.isTestAccount } });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// POST /api/platform/tenants/:id/impersonate – protectPlatform only. Mints a
// short-lived, normal-shaped tenant session token for that tenant's earliest
// HR_Admin (the account created at signup — see tenantController.createTenant)
// so the platform admin can drop straight into the frontend's existing
// login/session mechanism (setAuthUser + setActiveTenant) exactly as if a
// real login had happened. Every call is written to ImpersonationLog — this
// bypasses the tenant-isolation model on purpose, so it needs to always be
// traceable to who did it, for which tenant, when, and why.
//
// Two NDPA-accountability requirements enforced here, not just logged:
//   1. `reason` is required — a timestamp alone doesn't show purpose.
//   2. The tenant's own HR_Admins are notified every time this happens (see
//      notifyHrAdmins below) — access to their data shouldn't be invisible
//      to them. See frontend PrivacyConsentModal.vue for the corresponding
//      disclosure shown to their employees.
export const impersonateTenant = async (req, res) => {
  try {
    const reason = (req.body?.reason || '').trim();
    if (!reason) {
      return res.status(400).json({ success: false, message: 'A reason is required to impersonate a tenant.' });
    }

    const tenant = await Tenant.findById(req.params.id);
    if (!tenant) return res.status(404).json({ success: false, message: 'Tenant not found.' });

    const admin = await User.findOne({ tenantId: tenant._id }).sort({ createdAt: 1 });
    if (!admin) {
      return res.status(404).json({ success: false, message: 'This tenant has no HR_Admin account to impersonate.' });
    }

    const token = jwt.sign({ id: admin._id }, process.env.JWT_SECRET, { expiresIn: IMPERSONATION_TTL });
    const expiresAt = new Date(Date.now() + IMPERSONATION_TTL_MS);

    await ImpersonationLog.create({
      platformAdminId: req.platformAdmin._id,
      platformAdminName: req.platformAdmin.name,
      tenantId: tenant._id,
      tenantName: tenant.name,
      impersonatedUserId: admin._id,
      impersonatedUserName: admin.name,
      impersonatedUserRole: admin.role,
      reason,
      expiresAt,
    });

    // Fire-and-forget — transparency to the tenant, not a gate on access.
    notifyHrAdmins(User, tenant._id, {
      type: 'platform_support',
      title: 'Platform support accessed your account',
      message: `${req.platformAdmin.name} (HRMS X platform support) logged in as your HR Admin account for support purposes. Reason given: "${reason}". This session expires in 45 minutes.`,
      link: 'audit-log',
    }).catch(err => console.error('Impersonation notification failed:', err.message));

    res.json({
      success: true,
      data: {
        _id: admin._id,
        name: admin.name,
        email: admin.email,
        role: admin.role,
        tenant,
        token,
        impersonation: { expiresAt, platformAdminName: req.platformAdmin.name },
      },
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};
