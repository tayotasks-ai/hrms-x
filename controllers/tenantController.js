import Tenant from '../models/Tenant.js';
import User from '../models/User.js';
import { sendEmail } from '../utils/email.js';
import { welcomeTenant } from '../utils/emailTemplates.js';

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
    if (!name || !slug || !adminName || !adminEmail || !adminPassword)
      return res.status(400).json({ success: false, message: 'All fields are required.' });

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

