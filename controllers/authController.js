import jwt from 'jsonwebtoken';
import User from '../models/User.js';
import Employee from '../models/Employee.js';

const generateToken = (id) =>
  jwt.sign({ id }, process.env.JWT_SECRET, { expiresIn: '7d' });

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
