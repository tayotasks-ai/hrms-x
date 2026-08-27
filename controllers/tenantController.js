import Tenant from '../models/Tenant.js';
import User from '../models/User.js';
import Employee from '../models/Employee.js';
import { sendEmail } from '../utils/email.js';
import { welcomeTenant } from '../utils/emailTemplates.js';
import { recordAudit } from '../utils/auditLog.js';

// Paid-tier price, per non-offboarded employee, per month. Platform-wide —
// not tenant-configurable — so it lives here as a constant rather than on
// the Tenant document. Update this single value if pricing ever changes.
export const PLAN_PRICE_PER_EMPLOYEE = 1500;

// GET /api/tenants  – public (for landing page demo list)
export const getTenants = async (req, res) => {
  try {
    const tenants = await Tenant.find({}).sort({ name: 1 }).select('name slug createdAt');
    res.json({ success: true, data: tenants });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// POST /api/tenants  – register new organisation + HR admin
export const createTenant = async (req, res) => {
  try {
    const { name, slug, adminName, adminEmail, adminPassword } = req.body;
    const missing = [];
    if (!name) missing.push('Company Name');
    if (!slug) missing.push('Slug');
    if (!adminName) missing.push('Admin Name');
    if (!adminEmail) missing.push('Admin Email');
    if (!adminPassword) missing.push('Admin Password');
    if (missing.length)
      return res.status(400).json({ success: false, message: `Please provide: ${missing.join(', ')}.` });

    const existing = await Tenant.findOne({ slug: slug.toLowerCase().trim() });
    if (existing)
      return res.status(409).json({ success: false, message: 'Slug already taken. Choose another.' });

    const tenant = await Tenant.create({ name: name.trim(), slug: slug.toLowerCase().trim() });

    const admin = await User.create({
      name: adminName.trim(),
      email: adminEmail.toLowerCase().trim(),
      password: adminPassword,
      role: 'HR_Admin',
      tenantId: tenant._id,
    });

    // Fire-and-forget welcome email
    const tpl = welcomeTenant({ orgName: tenant.name, adminName: admin.name, adminEmail: admin.email });
    sendEmail({ to: admin.email, ...tpl }).catch(err => console.error('Email failed:', err.message));

    res.status(201).json({
      success: true,
      message: 'Organisation registered.',
      data: { tenant, admin: { _id: admin._id, name: admin.name, email: admin.email } },
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// GET /api/tenant/plan – HR only. Current plan tier, the free-tier cap, and
// how many seats are currently in use, so the frontend can render a
// "3/5 employees used" style banner without a second round trip.
export const getTenantPlan = async (req, res) => {
  try {
    const tid = req.tenantId;
    const [tenant, employeeCount] = await Promise.all([
      Tenant.findById(tid).select('plan'),
      Employee.countDocuments({ tenantId: tid, status: { $ne: 'Offboarded' } }),
    ]);
    res.json({
      success: true,
      data: {
        tier: tenant?.plan?.tier || 'Free',
        freeEmployeeLimit: tenant?.plan?.freeEmployeeLimit ?? 5,
        employeeCount,
        upgradedAt: tenant?.plan?.upgradedAt || null,
        pricePerEmployee: PLAN_PRICE_PER_EMPLOYEE,
        estimatedMonthlyCost: employeeCount * PLAN_PRICE_PER_EMPLOYEE,
      },
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// POST /api/tenant/plan/upgrade – HR only.
// Price is set (₦1,500/employee/month, see PLAN_PRICE_PER_EMPLOYEE above)
// but there is still no recurring-billing mechanism wired up — this remains
// a no-payment, self-serve stub that just lifts the free-tier employee cap.
// Replace with a real Paystack Subscription (or equivalent recurring charge)
// before relying on this for actual revenue collection — see the comment on
// Tenant.plan in models/Tenant.js.
export const upgradeTenantPlan = async (req, res) => {
  try {
    const tid = req.tenantId;
    const tenant = await Tenant.findByIdAndUpdate(
      tid,
      { 'plan.tier': 'Paid', 'plan.upgradedAt': new Date() },
      { new: true }
    ).select('plan');

    recordAudit({
      tenantId: tid,
      actor: { id: req.user._id, name: req.user.name, model: req.userRole === 'Employee' ? 'Employee' : 'User' },
      targetType: 'TenantPlan',
      targetId: tid,
      targetName: 'Subscription plan',
      changes: [{ field: 'tier', from: 'Free', to: 'Paid' }],
    });

    res.json({
      success: true,
      message: `Upgraded — the 5-employee limit no longer applies. Billing at ₦${PLAN_PRICE_PER_EMPLOYEE.toLocaleString()}/employee/month is not yet collected automatically.`,
      data: tenant.plan,
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

