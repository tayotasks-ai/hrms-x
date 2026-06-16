import { InternalJob } from '../models/InternalJob.js';

export const getInternalJobs = async (req, res) => {
  try {
    const jobs = await InternalJob.find({ tenantId: req.tenantId })
      .populate('applications.employeeId', 'firstName lastName positionId')
      .populate('referrals.referrerId', 'firstName lastName');
      
    res.json({ success: true, data: jobs });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Server Error: ' + error.message });
  }
};

export const createInternalJob = async (req, res) => {
  try {
    const { title, department, location, description, requirements, closingDate, referralBonus } = req.body;
    
    const newJob = new InternalJob({
      tenantId: req.tenantId,
      title,
      department,
      location,
      description,
      requirements,
      closingDate,
      referralBonus
    });

    await newJob.save();
    res.status(201).json({ success: true, data: newJob });
  } catch (error) {
    res.status(400).json({ success: false, message: 'Bad Request: ' + error.message });
  }
};

export const applyForJob = async (req, res) => {
  try {
    const { id } = req.params;
    // Mocking an employee applying (in real app, this is from auth)
    const { employeeId } = req.body; 

    const job = await InternalJob.findOne({ _id: id, tenantId: req.tenantId });
    if (!job) return res.status(404).json({ success: false, message: 'Job not found' });
    
    const alreadyApplied = job.applications.some(a => a.employeeId.toString() === employeeId);
    if (alreadyApplied) return res.status(400).json({ success: false, message: 'Already applied' });

    job.applications.push({ employeeId });
    await job.save();

    res.json({ success: true, data: job });
  } catch (error) {
    res.status(400).json({ success: false, message: 'Bad Request: ' + error.message });
  }
};

export const referCandidate = async (req, res) => {
  try {
    const { id } = req.params;
    const { referrerId, candidateName, candidateEmail } = req.body;

    const job = await InternalJob.findOne({ _id: id, tenantId: req.tenantId });
    if (!job) return res.status(404).json({ success: false, message: 'Job not found' });

    job.referrals.push({
      referrerId,
      candidateName,
      candidateEmail
    });

    await job.save();
    res.json({ success: true, data: job });
  } catch (error) {
    res.status(400).json({ success: false, message: 'Bad Request: ' + error.message });
  }
};
