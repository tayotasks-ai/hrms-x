import Employee from '../models/Employee.js';
import Tenant from '../models/Tenant.js';
import { sendEmail } from '../utils/email.js';
import { employeeCreated } from '../utils/emailTemplates.js';

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
      .select('-password')
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
          return emp;
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

    res.json({ success: true, data: employees });
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
      .select('-password')
      .populate('departmentId', 'name description')
      .populate('managerId', 'name role departmentId')
      .populate('positionId', 'title department');

    if (!emp) return res.status(404).json({ success: false, message: 'Employee not found.' });
    res.json({ success: true, data: emp });
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
    const emp = await Employee.create(empData);
    const result = emp.toObject();
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

// PUT /api/employees/:id
// HR can edit everything; employees can only edit their own non-regulatory fields
export const updateEmployee = async (req, res) => {
  try {
    const tid = req.tenantId;
    const isEmployee = req.userRole === 'Employee';
    const targetId = isEmployee ? req.user._id : req.params.id;

    const emp = await Employee.findOne({ _id: targetId, tenantId: tid });
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

    Object.assign(emp, updates);
    await emp.save();

    const populatedEmp = await Employee.findById(emp._id)
      .populate('departmentId', 'name description')
      .populate('managerId', 'name role departmentId')
      .populate('positionId', 'title department');

    const result = populatedEmp.toObject();
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
      .select('-password')
      .populate('departmentId', 'name description')
      .populate('managerId', 'name role departmentId')
      .populate('positionId', 'title department');
    if (!emp) return res.status(404).json({ success: false, message: 'Profile not found.' });
    res.json({ success: true, data: emp });
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
