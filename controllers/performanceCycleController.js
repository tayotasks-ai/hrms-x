import PerformanceCycle from '../models/PerformanceCycle.js';

// GET /api/performance-cycles
export const getPerformanceCycles = async (req, res) => {
  try {
    const cycles = await PerformanceCycle.find({ tenantId: req.tenantId }).sort({ createdAt: -1 });
    res.json({ success: true, data: cycles });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// POST /api/performance-cycles
export const createPerformanceCycle = async (req, res) => {
  try {
    const { name, startDate, endDate, status } = req.body;
    
    // Only HR Admin should call this, verified by hrOnly middleware
    const newCycle = await PerformanceCycle.create({
      tenantId: req.tenantId,
      name,
      startDate,
      endDate,
      status: status || 'Draft'
    });

    res.status(201).json({ success: true, data: newCycle });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
};

// PUT /api/performance-cycles/:id
export const updatePerformanceCycle = async (req, res) => {
  try {
    const cycle = await PerformanceCycle.findOne({ _id: req.params.id, tenantId: req.tenantId });
    if (!cycle) return res.status(404).json({ success: false, message: 'Performance cycle not found.' });

    const { name, startDate, endDate, status } = req.body;
    
    // If opening a new cycle, we might want to ensure others are closed, but we'll allow multiple open for now or trust HR
    if (name) cycle.name = name;
    if (startDate) cycle.startDate = startDate;
    if (endDate) cycle.endDate = endDate;
    if (status) cycle.status = status;

    await cycle.save();
    
    res.json({ success: true, data: cycle });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
};
