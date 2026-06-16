import Kpi from '../models/Kpi.js';
import Employee from '../models/Employee.js';
import PerformanceCycle from '../models/PerformanceCycle.js';

// GET /api/kpis
export const getKpis = async (req, res) => {
  try {
    const tid = req.tenantId;
    let query = { tenantId: tid };
    
    if (req.userRole === 'Employee') {
      // Find direct reports
      const directReports = await Employee.find({ managerId: req.user._id, tenantId: tid }).select('_id');
      const directReportIds = directReports.map(emp => emp._id);
      
      query.employeeId = { $in: [req.user._id, ...directReportIds] };
    }

    const kpis = await Kpi.find(query)
      .populate('employeeId', 'name role department')
      .populate('cycleId', 'name status')
      .sort({ createdAt: -1 });

    res.json({ success: true, data: kpis });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// POST /api/kpis
export const createKpi = async (req, res) => {
  try {
    const tid = req.tenantId;
    let { employeeId, cycleId } = req.body;
    
    if (!cycleId) {
      return res.status(400).json({ success: false, message: 'Performance Cycle is required.' });
    }

    const cycle = await PerformanceCycle.findOne({ _id: cycleId, tenantId: tid });
    if (!cycle) {
      return res.status(404).json({ success: false, message: 'Performance Cycle not found.' });
    }
    if (cycle.status !== 'Open') {
      return res.status(400).json({ success: false, message: 'KPIs can only be assigned during an Open Performance Cycle.' });
    }
    
    if (req.userRole === 'Employee' && employeeId !== req.user._id.toString()) {
      // Allow if the target employee reports to this user
      const targetEmp = await Employee.findOne({ _id: employeeId, tenantId: tid });
      if (!targetEmp || targetEmp.managerId?.toString() !== req.user._id.toString()) {
        return res.status(403).json({ success: false, message: 'Not authorized to assign KPIs to this employee.' });
      }
    } else if (req.userRole === 'Employee') {
      employeeId = req.user._id;
    }

    const emp = await Employee.findOne({ _id: employeeId, tenantId: tid });
    if (!emp) return res.status(404).json({ success: false, message: 'Employee not found.' });

    const kpi = await Kpi.create({ ...req.body, employeeId, tenantId: tid });
    const populated = await Kpi.findById(kpi._id)
      .populate('employeeId', 'name role department')
      .populate('cycleId', 'name status');
    res.status(201).json({ success: true, message: 'KPI created.', data: populated });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// PUT /api/kpis/:id  – update self-rating or manager rating
export const updateKpi = async (req, res) => {
  try {
    const tid = req.tenantId;
    let query = { _id: req.params.id, tenantId: tid };
    
    if (req.userRole === 'Employee') {
      const directReports = await Employee.find({ managerId: req.user._id, tenantId: tid }).select('_id');
      const directReportIds = directReports.map(emp => emp._id);
      query.employeeId = { $in: [req.user._id, ...directReportIds] };
    }

    const kpi = await Kpi.findOneAndUpdate(query, req.body, { new: true })
      .populate('employeeId', 'name role department');
    if (!kpi) return res.status(404).json({ success: false, message: 'KPI not found or unauthorized.' });
    res.json({ success: true, message: 'KPI updated.', data: kpi });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};
