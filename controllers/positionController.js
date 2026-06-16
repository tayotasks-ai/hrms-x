import { Position } from '../models/Position.js';

export const getPositions = async (req, res) => {
  try {
    const positions = await Position.find({ tenantId: req.tenantId })
      .populate('jobRoleId', 'title band payGrade')
      .populate('reportsToPositionId', 'title positionId')
      .populate('currentHeadcount'); // Virtual field
      
    res.json({ success: true, data: positions });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Server Error: ' + error.message });
  }
};

export const createPosition = async (req, res) => {
  try {
    const { title, department, jobRoleId, reportsToPositionId, headcountBudgeted } = req.body;
    
    // Generate unique positionId
    const randomNum = Math.floor(1000 + Math.random() * 9000);
    const positionId = `POS-${department.substring(0,3).toUpperCase()}-${randomNum}`;

    const newPosition = new Position({
      positionId,
      title,
      tenantId: req.tenantId,
      department,
      jobRoleId,
      reportsToPositionId,
      headcountBudgeted
    });

    const saved = await newPosition.save();
    
    const populated = await Position.findById(saved._id)
      .populate('jobRoleId', 'title band payGrade')
      .populate('reportsToPositionId', 'title positionId')
      .populate('currentHeadcount');

    res.status(201).json({ success: true, data: populated });
  } catch (error) {
    res.status(400).json({ success: false, message: 'Bad Request: ' + error.message });
  }
};

export const updatePosition = async (req, res) => {
  try {
    const { id } = req.params;
    const { status, headcountBudgeted } = req.body;

    const updated = await Position.findOneAndUpdate(
      { _id: id, tenantId: req.tenantId },
      { status, headcountBudgeted },
      { new: true, runValidators: true }
    )
    .populate('jobRoleId', 'title band payGrade')
    .populate('reportsToPositionId', 'title positionId')
    .populate('currentHeadcount');

    if (!updated) return res.status(404).json({ success: false, message: 'Position not found' });

    res.json({ success: true, data: updated });
  } catch (error) {
    res.status(400).json({ success: false, message: 'Bad Request: ' + error.message });
  }
};
