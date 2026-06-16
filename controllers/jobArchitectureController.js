import { JobFamily, JobRole } from '../models/JobArchitecture.js';

export const getJobArchitecture = async (req, res) => {
  try {
    const families = await JobFamily.find({ tenantId: req.tenantId });
    const roles = await JobRole.find({ tenantId: req.tenantId }).populate('familyId', 'name');
    
    res.json({ success: true, data: { families, roles } });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Server Error: ' + error.message });
  }
};

export const createJobFamily = async (req, res) => {
  try {
    const { name, description } = req.body;
    
    const newFamily = new JobFamily({
      tenantId: req.tenantId,
      name,
      description
    });

    await newFamily.save();
    res.status(201).json({ success: true, data: newFamily });
  } catch (error) {
    res.status(400).json({ success: false, message: 'Bad Request: ' + error.message });
  }
};

export const createJobRole = async (req, res) => {
  try {
    const { title, familyId, band, payGrade, competencies } = req.body;
    
    const newRole = new JobRole({
      tenantId: req.tenantId,
      title,
      familyId,
      band,
      payGrade,
      competencies
    });

    const saved = await newRole.save();
    const populated = await JobRole.findById(saved._id).populate('familyId', 'name');

    res.status(201).json({ success: true, data: populated });
  } catch (error) {
    res.status(400).json({ success: false, message: 'Bad Request: ' + error.message });
  }
};
