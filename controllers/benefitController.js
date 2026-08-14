import Benefit from '../models/Benefit.js';
import Employee from '../models/Employee.js';

export const getBenefits = async (req, res) => {
  try {
    const benefits = await Benefit.find({ tenantId: req.tenantId })
      .populate({ path: 'employeeId', select: 'name role departmentId email status', populate: { path: 'departmentId', select: 'name' } })
      .sort({ lastUpdated: -1 });
    res.json({ success: true, data: benefits });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Server Error: ' + error.message });
  }
};

export const initBenefitRecord = async (req, res) => {
  try {
    const { employeeId } = req.body;
    
    // Check if one already exists
    const existing = await Benefit.findOne({ employeeId, tenantId: req.tenantId });
    if (existing) {
      return res.status(400).json({ success: false, message: 'Benefit record already exists for this employee.' });
    }

    const newBenefit = new Benefit({
      employeeId,
      tenantId: req.tenantId
    });

    const saved = await newBenefit.save();
    
    const populated = await Benefit.findById(saved._id).populate({ path: 'employeeId', select: 'name role departmentId email status', populate: { path: 'departmentId', select: 'name' } });
      
    res.status(201).json({ success: true, data: populated });
  } catch (error) {
    res.status(400).json({ success: false, message: 'Bad Request: ' + error.message });
  }
};

export const updateBenefit = async (req, res) => {
  try {
    const { id } = req.params;
    
    const updated = await Benefit.findOneAndUpdate(
      { _id: id, tenantId: req.tenantId },
      { ...req.body, lastUpdated: new Date() },
      { new: true, runValidators: true }
    ).populate({ path: 'employeeId', select: 'name role departmentId email status', populate: { path: 'departmentId', select: 'name' } });

    if (!updated) return res.status(404).json({ success: false, message: 'Benefit record not found' });

    res.json({ success: true, data: updated });
  } catch (error) {
    res.status(400).json({ success: false, message: 'Bad Request: ' + error.message });
  }
};
