import Document from '../models/Document.js';

// GET /api/documents  – all employees can read
export const getDocuments = async (req, res) => {
  try {
    const query = { tenantId: req.tenantId };
    // Filter by visibility: 'All' or specific department/grade
    if (req.userRole === 'Employee') {
      query.$or = [
        { visibility: 'All' },
        { visibility: req.user.department },
      ];
    }
    const docs = await Document.find(query)
      .populate('uploadedBy', 'name role')
      .sort({ createdAt: -1 });
    res.json({ success: true, data: docs });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// POST /api/documents  – HR only
export const createDocument = async (req, res) => {
  try {
    const doc = await Document.create({
      ...req.body,
      tenantId: req.tenantId,
      uploadedBy: req.user._id,
      version: req.body.version || '1.0',
    });
    res.status(201).json({ success: true, message: 'Document uploaded.', data: doc });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// PUT /api/documents/:id  – HR only (versioning / update)
export const updateDocument = async (req, res) => {
  try {
    const doc = await Document.findOneAndUpdate(
      { _id: req.params.id, tenantId: req.tenantId },
      { ...req.body, updatedAt: new Date() },
      { new: true }
    );
    if (!doc) return res.status(404).json({ success: false, message: 'Document not found.' });
    res.json({ success: true, message: 'Document updated.', data: doc });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};
