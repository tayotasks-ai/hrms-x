import Department from '../models/Department.js';

// GET /api/departments
export const getDepartments = async (req, res) => {
  try {
    const departments = await Department.find({ tenantId: req.tenantId })
      .populate('headOfDepartmentId', 'name role email')
      .populate('parentDepartmentId', 'name');
    
    res.json({ success: true, data: departments });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// POST /api/departments
export const createDepartment = async (req, res) => {
  try {
    const { name, description, headOfDepartmentId, parentDepartmentId, budgetCode } = req.body;
    
    if (!name) {
      return res.status(400).json({ success: false, message: 'Department name is required' });
    }

    const deptExists = await Department.findOne({ name, tenantId: req.tenantId });
    if (deptExists) {
      return res.status(400).json({ success: false, message: 'Department already exists' });
    }

    const department = await Department.create({
      name,
      description,
      headOfDepartmentId: headOfDepartmentId || null,
      parentDepartmentId: parentDepartmentId || null,
      budgetCode,
      tenantId: req.tenantId
    });

    const populated = await Department.findById(department._id)
      .populate('headOfDepartmentId', 'name role')
      .populate('parentDepartmentId', 'name');

    res.status(201).json({ success: true, data: populated });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// PUT /api/departments/:id
export const updateDepartment = async (req, res) => {
  try {
    const { name, description, headOfDepartmentId, parentDepartmentId, budgetCode, status } = req.body;
    
    // Prevent setting self as parent
    if (parentDepartmentId && parentDepartmentId === req.params.id) {
      return res.status(400).json({ success: false, message: 'Department cannot be its own parent.' });
    }

    const department = await Department.findOneAndUpdate(
      { _id: req.params.id, tenantId: req.tenantId },
      { name, description, headOfDepartmentId, parentDepartmentId, budgetCode, status },
      { new: true, runValidators: true }
    )
      .populate('headOfDepartmentId', 'name role')
      .populate('parentDepartmentId', 'name');

    if (!department) {
      return res.status(404).json({ success: false, message: 'Department not found' });
    }

    res.json({ success: true, data: department });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// DELETE /api/departments/:id
export const deleteDepartment = async (req, res) => {
  try {
    const department = await Department.findOneAndDelete({ _id: req.params.id, tenantId: req.tenantId });
    if (!department) {
      return res.status(404).json({ success: false, message: 'Department not found' });
    }

    // Unset parentDepartmentId for any child departments
    await Department.updateMany(
      { parentDepartmentId: req.params.id },
      { parentDepartmentId: null }
    );

    res.json({ success: true, message: 'Department deleted successfully' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};
