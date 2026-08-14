import Employee from '../models/Employee.js';
import Tenant from '../models/Tenant.js';
import Onboarding from '../models/Onboarding.js';
import Department from '../models/Department.js';
import { sendEmail } from '../utils/email.js';
import { employeeCreated } from '../utils/emailTemplates.js';
import { recordAudit } from '../utils/auditLog.js';
import { encryptPii } from '../utils/crypto.js';
import { PII_SELECT, maskEmployeePii, encryptRegulatoryFields } from '../utils/piiDisplay.js';

// Fields sensitive enough to warrant an audit trail entry when HR changes them.
const AUDITED_FIELDS = ['salary', 'status', 'role', 'departmentId', 'managerId'];
const AUDIT_LABELS = { salary: 'Salary', status: 'Status', role: 'Role', departmentId: 'Department', managerId: 'Manager' };

const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Ensures an employee marked 'Onboarding' has a matching Onboarding record,
// so they actually show up in the Onboarding menu.
const ensureOnboardingRecord = async (employeeId, tenantId) => {
  const existing = await Onboarding.findOne({ employeeId, tenantId });
  if (existing) return;
  await Onboarding.create({ employeeId, tenantId, stage: 'Pre-boarding', tasks: [] });
};

// GET /api/employees/directory-lite
// Non-sensitive name/role/department for every active employee, company-wide.
// Used for pickers (e.g. Shoutouts) where the full privacy-scoped employee
// record from getEmployees is unnecessary and too restrictive.
export const getDirectoryLite = async (req, res) => {
  try {
    const employees = await Employee.find({ tenantId: req.tenantId, status: { $ne: 'Offboarded' } })
      .select('name role departmentId')
      .populate('departmentId', 'name')
      .sort({ name: 1 });
    res.json({ success: true, data: employees });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// GET /api/employees
export const getEmployees = async (req, res) => {
  try {
    const tid = req.tenantId;
    const query = { tenantId: tid };

    if (req.userRole === 'Employee') {
      // Employees can only see their own department's organogram
      query.departmentId = req.user.departmentId;
    }

    const employees = await Employee.find(query)
      .select(`-password ${PII_SELECT}`)
      .populate('departmentId', 'name description')
      .populate('managerId', 'name role departmentId')
      .populate('positionId', 'title department')
      .sort({ name: 1 });

    if (req.userRole === 'Employee') {
      const sanitizedEmployees = employees.map(emp => {
        const isSelf = emp._id.toString() === req.user._id.toString();
        const isDirectReport = emp.managerId &&
          (emp.managerId._id ? emp.managerId._id.toString() : emp.managerId.toString()) === req.user._id.toString();

        if (isSelf || isDirectReport) {
          return maskEmployeePii(emp.toObject());
        }

        // Return only public directory info
        return {
          _id: emp._id,
          name: emp.name,
          email: emp.email,
          role: emp.role,
          departmentId: emp.departmentId,
          managerId: emp.managerId,
          positionId: emp.positionId,
          status: emp.status
        };
      });
      return res.json({ success: true, data: sanitizedEmployees });
    }

    res.json({ success: true, data: employees.map(e => maskEmployeePii(e.toObject())) });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// GET /api/employees/:id  – employee can only get themselves
export const getEmployee = async (req, res) => {
  try {
    const tid = req.tenantId;
    const targetId = req.userRole === 'Employee' ? req.user._id : req.params.id;

    const emp = await Employee.findOne({ _id: targetId, tenantId: tid })
      .select(`-password ${PII_SELECT}`)
      .populate('departmentId', 'name description')
      .populate('managerId', 'name role departmentId')
      .populate('positionId', 'title department');

    if (!emp) return res.status(404).json({ success: false, message: 'Employee not found.' });
    res.json({ success: true, data: maskEmployeePii(emp.toObject()) });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// POST /api/employees  – HR only
export const createEmployee = async (req, res) => {
  try {
    const tid = req.tenantId;
    const { email } = req.body;

    const exists = await Employee.findOne({ email: email?.toLowerCase(), tenantId: tid });
    if (exists)
      return res.status(409).json({ success: false, message: 'An employee with this email already exists.' });

    // If no password is provided in the payload, generate a secure default so they can login.
    const rawPassword = req.body.password || 'Welcome123!';

    const empData = { ...req.body, tenantId: tid, password: rawPassword };
    if (empData.regulatory) empData.regulatory = { ...empData.regulatory, ...encryptRegulatoryFields(empData.regulatory) };
    if (empData.bankDetails?.accountNumber) {
      empData.bankDetails = { ...empData.bankDetails, accountNumber: encryptPii(String(empData.bankDetails.accountNumber).trim()) };
    }

    const emp = await Employee.create(empData);

    if (emp.status === 'Onboarding') {
      await ensureOnboardingRecord(emp._id, tid);
    }

    const result = maskEmployeePii(emp.toObject());
    delete result.password;

    // Fire-and-forget welcome email with credentials
    if (rawPassword && emp.email) {
      const tenant = await Tenant.findById(tid).select('name').lean();
      const tpl = employeeCreated({
        employeeName: emp.name,
        email: emp.email,
        defaultPassword: rawPassword,
        orgName: tenant?.name || 'Your Organisation',
      });
      sendEmail({ to: emp.email, ...tpl }).catch(err => console.error('Email failed:', err.message));
    }

    res.status(201).json({ success: true, message: 'Employee created.', data: result });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// POST /api/employees/bulk  – HR only. CSV-driven bulk import.
// Body: { employees: [{ name, email, role, department|departmentId, salary, status?, joinDate?, birthDate }] }
// Rows are processed independently — one bad row doesn't fail the batch.
// `department` (a name) is resolved case-insensitively, creating the
// department if it doesn't exist yet, matching the inline-create pattern
// already used on the single-employee Register form.
export const bulkCreateEmployees = async (req, res) => {
  try {
    const tid = req.tenantId;
    const rows = Array.isArray(req.body.employees) ? req.body.employees : [];
    if (rows.length === 0)
      return res.status(400).json({ success: false, message: 'No employee rows provided.' });
    if (rows.length > 500)
      return res.status(400).json({ success: false, message: 'Bulk import is limited to 500 rows per upload.' });

    const tenant = await Tenant.findById(tid).select('name').lean();
    const deptCache = new Map(); // lowercased name -> departmentId, to avoid re-querying per row
    const created = [];
    const failed = [];

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i] || {};
      try {
        const email = (row.email || '').toLowerCase().trim();
        if (!email || !row.name?.trim() || !row.role?.trim() || row.salary === undefined || row.salary === '' || !row.birthDate) {
          throw new Error('Missing required field(s): name, email, role, salary, birthDate.');
        }
        if (isNaN(Number(row.salary))) throw new Error('Salary must be a number.');

        const exists = await Employee.findOne({ email, tenantId: tid });
        if (exists) throw new Error('An employee with this email already exists.');

        // Resolve department: explicit id wins, otherwise resolve/create by name
        let departmentId = row.departmentId || null;
        if (!departmentId && row.department?.trim()) {
          const deptName = row.department.trim();
          const cacheKey = deptName.toLowerCase();
          if (deptCache.has(cacheKey)) {
            departmentId = deptCache.get(cacheKey);
          } else {
            let dept = await Department.findOne({ tenantId: tid, name: new RegExp(`^${escapeRegex(deptName)}$`, 'i') });
            if (!dept) dept = await Department.create({ tenantId: tid, name: deptName });
            departmentId = dept._id;
            deptCache.set(cacheKey, departmentId);
          }
        }
        if (!departmentId) throw new Error('Department (name or departmentId) is required.');

        const rawPassword = row.password || 'Welcome123!';
        const emp = await Employee.create({
          name: row.name.trim(),
          email,
          role: row.role.trim(),
          departmentId,
          salary: Number(row.salary),
          status: ['Active', 'Onboarding', 'Offboarded'].includes(row.status) ? row.status : 'Active',
          joinDate: row.joinDate ? new Date(row.joinDate) : new Date(),
          birthDate: new Date(row.birthDate),
          tenantId: tid,
          password: rawPassword,
        });

        if (emp.status === 'Onboarding') await ensureOnboardingRecord(emp._id, tid);

        if (emp.email) {
          const tpl = employeeCreated({
            employeeName: emp.name, email: emp.email,
            defaultPassword: rawPassword, orgName: tenant?.name || 'Your Organisation',
          });
          sendEmail({ to: emp.email, ...tpl }).catch(err => console.error('Email failed:', err.message));
        }

        created.push({ row: i, name: emp.name, email: emp.email, _id: emp._id });
      } catch (err) {
        failed.push({ row: i, email: row.email || '', name: row.name || '', message: err.message });
      }
    }

    res.status(created.length > 0 ? 201 : 400).json({
      success: created.length > 0,
      message: `${created.length} employee(s) created, ${failed.length} failed.`,
      data: { created, failed },
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// PUT /api/employees/:id
// HR can edit everything; employees can only edit their own non-regulatory fields
export const updateEmployee = async (req, res) => {
  try {
    const tid = req.tenantId;
    const isEmployee = req.userRole === 'Employee';
    const targetId = isEmployee ? req.user._id : req.params.id;

    // Loads the encrypted regulatory/bank fields too (select: false by
    // default) so the merges below can preserve whichever ones this
    // request doesn't explicitly touch, without ever decrypting them.
    const emp = await Employee.findOne({ _id: targetId, tenantId: tid }).select(PII_SELECT);
    if (!emp) return res.status(404).json({ success: false, message: 'Employee not found.' });

    // Strip regulatory fields for employee self-edit
    const updates = { ...req.body };
    if (isEmployee) {
      delete updates.regulatory;
      delete updates.salary;
      delete updates.role;
      delete updates.departmentId;
      delete updates.status;
      delete updates.tenantId;
      delete updates.managerId;
      delete updates.positionId;
      delete updates.password;
    }

    // Regulatory IDs are encrypted at rest. The client only ever sends a
    // field when the user actually typed a new value (see
    // EmployeeProfile.vue — inputs start blank, not pre-filled with the
    // masked value) so a present non-empty string always means "encrypt and
    // replace." Anything omitted/blank keeps whatever was already stored,
    // rather than being wiped by this being a full nested-object
    // replacement under the hood.
    if (updates.regulatory) {
      const prevReg = emp.regulatory || {};
      updates.regulatory = {
        lgaOfOrigin: updates.regulatory.lgaOfOrigin ?? prevReg.lgaOfOrigin,
        bvn: prevReg.bvn, nin: prevReg.nin, tin: prevReg.tin,
        nhf: prevReg.nhf, rsa: prevReg.rsa, pfa: prevReg.pfa,
        ...encryptRegulatoryFields(updates.regulatory),
      };
    }

    // Bank verification state is server-controlled — only the
    // verify-bank-account endpoint (which actually calls Paystack) is
    // allowed to set these. If the bank fields change here, drop any
    // client-supplied verification claims so a stale/forged "verified: true"
    // can never slip in, and reset verification since the account changed.
    // accountNumber is encrypted at rest — a non-empty incoming value is
    // always treated as a real change (this path is never Paystack-verified
    // anyway), otherwise the existing encrypted value is preserved as-is.
    if (updates.bankDetails) {
      const prev = emp.bankDetails || {};
      const rawAccountNumber = updates.bankDetails.accountNumber;
      const hasNewAccountNumber = typeof rawAccountNumber === 'string' && rawAccountNumber.trim() !== '';
      const accountChanged = hasNewAccountNumber || (updates.bankDetails.bankCode && updates.bankDetails.bankCode !== prev.bankCode);
      updates.bankDetails = {
        bankName: updates.bankDetails.bankName ?? prev.bankName,
        bankCode: updates.bankDetails.bankCode ?? prev.bankCode,
        accountNumber: hasNewAccountNumber ? encryptPii(rawAccountNumber.trim()) : prev.accountNumber,
        accountName: accountChanged ? undefined : prev.accountName,
        verified: accountChanged ? false : prev.verified,
        verifiedAt: accountChanged ? undefined : prev.verifiedAt,
        paystackRecipientCode: accountChanged ? undefined : prev.paystackRecipientCode,
      };
    }

    // Track the offboarding date automatically — it drives the retention
    // window in retentionController.js. Cleared on re-activation so a
    // re-hired employee doesn't inherit a stale offboarding date.
    if (updates.status && updates.status !== emp.status) {
      if (updates.status === 'Offboarded') updates.offboardedAt = new Date();
      else if (emp.status === 'Offboarded') updates.offboardedAt = null;
    }

    // Snapshot the audited fields before applying updates so we can diff after save.
    const before = {};
    for (const f of AUDITED_FIELDS) before[f] = emp[f];

    Object.assign(emp, updates);
    await emp.save();

    if (emp.status === 'Onboarding') {
      await ensureOnboardingRecord(emp._id, tid);
    }

    // Build the audit diff. Employee self-edits never reach salary/status/
    // role/departmentId/managerId (stripped above), so this only fires for
    // HR-driven changes, but the check is harmless either way.
    const rawChanges = AUDITED_FIELDS
      .filter((f) => (before[f]?.toString?.() ?? before[f]) !== (emp[f]?.toString?.() ?? emp[f]))
      .map((f) => ({ field: f, from: before[f], to: emp[f] }));

    if (rawChanges.length > 0) {
      const resolved = await Promise.all(rawChanges.map(async (c) => {
        if (c.field === 'departmentId') {
          const [fromDept, toDept] = await Promise.all([
            c.from ? Department.findById(c.from).select('name').lean() : null,
            c.to ? Department.findById(c.to).select('name').lean() : null,
          ]);
          return { field: AUDIT_LABELS.departmentId, from: fromDept?.name || '—', to: toDept?.name || '—' };
        }
        if (c.field === 'managerId') {
          const [fromMgr, toMgr] = await Promise.all([
            c.from ? Employee.findById(c.from).select('name').lean() : null,
            c.to ? Employee.findById(c.to).select('name').lean() : null,
          ]);
          return { field: AUDIT_LABELS.managerId, from: fromMgr?.name || 'None', to: toMgr?.name || 'None' };
        }
        return { field: AUDIT_LABELS[c.field] || c.field, from: c.from ?? '—', to: c.to ?? '—' };
      }));

      recordAudit({
        tenantId: tid,
        actor: { id: req.user._id, name: req.user.name, model: isEmployee ? 'Employee' : 'User' },
        targetType: 'Employee',
        targetId: emp._id,
        targetName: emp.name,
        changes: resolved,
      });
    }

    const populatedEmp = await Employee.findById(emp._id)
      .select(PII_SELECT)
      .populate('departmentId', 'name description')
      .populate('managerId', 'name role departmentId')
      .populate('positionId', 'title department');

    const result = maskEmployeePii(populatedEmp.toObject());
    delete result.password;
    res.json({ success: true, message: 'Employee updated.', data: result });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// GET /api/employees/me  – ESS shorthand
export const getMe = async (req, res) => {
  try {
    const emp = await Employee.findById(req.user._id)
      .select(`-password ${PII_SELECT}`)
      .populate('departmentId', 'name description')
      .populate('managerId', 'name role departmentId')
      .populate('positionId', 'title department');
    if (!emp) return res.status(404).json({ success: false, message: 'Profile not found.' });
    res.json({ success: true, data: maskEmployeePii(emp.toObject()) });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// PUT /api/employees/:id/manager – Specific endpoint for organogram drag and drop
export const updateEmployeeManager = async (req, res) => {
  try {
    const tid = req.tenantId;
    const { managerId } = req.body;
    
    // Check against circular references (deep check)
    if (managerId === req.params.id) {
      return res.status(400).json({ success: false, message: 'Employee cannot report to themselves.' });
    }

    if (managerId) {
      let currentManagerId = managerId;
      const visited = new Set();
      
      while (currentManagerId) {
        if (currentManagerId.toString() === req.params.id) {
          return res.status(400).json({ success: false, message: 'Circular reporting line detected.' });
        }
        if (visited.has(currentManagerId.toString())) break;
        visited.add(currentManagerId.toString());
        
        const mgr = await Employee.findById(currentManagerId);
        currentManagerId = mgr?.managerId ? mgr.managerId.toString() : null;
      }
    }

    const emp = await Employee.findOneAndUpdate(
      { _id: req.params.id, tenantId: tid },
      { managerId: managerId || null },
      { new: true }
    );
    
    if (!emp) return res.status(404).json({ success: false, message: 'Employee not found.' });
    res.json({ success: true, message: 'Reporting line updated.', data: emp });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};
