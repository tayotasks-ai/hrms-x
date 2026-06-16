import Compliance from '../models/Compliance.js';

const NIGERIAN_DEFAULTS = [
  { title: 'PENCOM Remittance', category: 'Pension', frequency: 'Monthly', dueDay: 7, regulator: 'National Pension Commission', notes: 'Due by 7th of following month' },
  { title: 'PAYE/FIRS Remittance', category: 'Tax', frequency: 'Monthly', dueDay: 10, regulator: 'Federal Inland Revenue Service', notes: 'Due by 10th of following month' },
  { title: 'National Housing Fund (NHF)', category: 'Housing', frequency: 'Monthly', dueDay: 15, regulator: 'Federal Mortgage Bank of Nigeria', notes: 'Monthly deduction and remittance' },
  { title: 'ITF Levy', category: 'Training', frequency: 'Annual', regulator: 'Industrial Training Fund', notes: '1% of total annual payroll. Due 1 April.' },
  { title: 'Annual Returns (FIRS)', category: 'Tax', frequency: 'Annual', regulator: 'Federal Inland Revenue Service', notes: 'Due 31 March.' },
  { title: 'Group Life Insurance Renewal', category: 'Insurance', frequency: 'Annual', regulator: 'NAICOM / Insurer', notes: 'Per policy anniversary date.' },
  { title: 'HMO Renewal', category: 'Health', frequency: 'Annual', regulator: 'Provider', notes: 'Per contract renewal date.' },
];

// GET /api/compliance
export const getCompliances = async (req, res) => {
  try {
    const records = await Compliance.find({ tenantId: req.tenantId }).sort({ dueDate: 1 });
    res.json({ success: true, data: records });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// POST /api/compliance  – HR adds custom deadline
export const createCompliance = async (req, res) => {
  try {
    const record = await Compliance.create({ ...req.body, tenantId: req.tenantId });
    res.status(201).json({ success: true, message: 'Compliance obligation added.', data: record });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// POST /api/compliance/seed-defaults  – seed Nigerian defaults for new tenant
export const seedDefaults = async (req, res) => {
  try {
    const tid = req.tenantId;
    const existing = await Compliance.countDocuments({ tenantId: tid });
    if (existing > 0)
      return res.status(409).json({ success: false, message: 'Defaults already seeded for this tenant.' });

    const now = new Date();
    const records = NIGERIAN_DEFAULTS.map(d => ({
      ...d, tenantId: tid,
      status: 'Pending',
      dueDate: new Date(now.getFullYear(), now.getMonth() + 1, d.dueDay || 1),
    }));

    await Compliance.insertMany(records);
    res.status(201).json({ success: true, message: `${records.length} default compliance obligations seeded.` });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// PUT /api/compliance/:id  – mark as completed or edit
export const updateCompliance = async (req, res) => {
  try {
    const record = await Compliance.findOneAndUpdate(
      { _id: req.params.id, tenantId: req.tenantId },
      req.body,
      { new: true }
    );
    if (!record) return res.status(404).json({ success: false, message: 'Record not found.' });
    res.json({ success: true, message: 'Compliance record updated.', data: record });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};
