import DisciplinaryCase from '../models/DisciplinaryCase.js';
import Employee from '../models/Employee.js';
import { sendEmail } from '../utils/email.js';
import { disciplinaryQueryIssued } from '../utils/emailTemplates.js';

export const getCases = async (req, res) => {
  try {
    const cases = await DisciplinaryCase.find({ tenantId: req.tenantId })
      .populate('reportedEmployee', 'name role department email status')
      .populate('reporter', 'name role')
      .populate('investigatingOfficer', 'name role')
      .populate('panelMembers', 'name role')
      .populate('history.performedBy', 'name role')
      .sort({ createdAt: -1 });
    res.json({ success: true, data: cases });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Server Error: ' + error.message });
  }
};

export const createCase = async (req, res) => {
  try {
    const { caseType, title, description, reportedEmployee, reporter } = req.body;
    
    const newCase = new DisciplinaryCase({
      tenantId: req.tenantId,
      caseType,
      title,
      description,
      reportedEmployee,
      reporter,
      history: [{
        actionType: 'Case Logged',
        performedBy: req.user._id,
        notes: `New ${caseType} logged.`
      }]
    });

    const saved = await newCase.save();
    
    const populated = await DisciplinaryCase.findById(saved._id)
      .populate('reportedEmployee', 'name role department')
      .populate('reporter', 'name')
      .populate('history.performedBy', 'name');
      
    res.status(201).json({ success: true, data: populated });
  } catch (error) {
    res.status(400).json({ success: false, message: 'Bad Request: ' + error.message });
  }
};

export const addAction = async (req, res) => {
  try {
    const { id } = req.params;
    const { actionType, notes, updateStatus, investigatingOfficer, panelMembers, outcome } = req.body;

    const caseRecord = await DisciplinaryCase.findOne({ _id: id, tenantId: req.tenantId });
    if (!caseRecord) return res.status(404).json({ success: false, message: 'Case not found' });

    // Handle Query specific actions
    if (actionType === 'Query Issued') {
      const deadline = new Date();
      deadline.setDate(deadline.getDate() + 2); // 48 hour SLA
      caseRecord.queryDetails = {
        issuedDate: new Date(),
        deadlineDate: deadline,
        responseReceived: false
      };
      caseRecord.status = 'Awaiting Response';

      // Fire-and-forget – notify the reported employee
      Employee.findById(caseRecord.reportedEmployee).select('name email').lean()
        .then(emp => {
          if (emp?.email) {
            const tpl = disciplinaryQueryIssued({
              employeeName: emp.name,
              caseTitle: caseRecord.title,
              deadlineDate: deadline.toLocaleDateString('en-NG', { day: 'numeric', month: 'short', year: 'numeric' }),
            });
            sendEmail({ to: emp.email, ...tpl }).catch(err => console.error('Email failed:', err.message));
          }
        })
        .catch(err => console.error('Email lookup failed:', err.message));
    }

    if (actionType === 'Response Received') {
      if (caseRecord.queryDetails) {
        caseRecord.queryDetails.responseReceived = true;
        caseRecord.queryDetails.responseText = notes;
      }
      caseRecord.status = 'Under Investigation';
    }

    if (updateStatus) caseRecord.status = updateStatus;
    if (investigatingOfficer) caseRecord.investigatingOfficer = investigatingOfficer;
    if (panelMembers) caseRecord.panelMembers = panelMembers;
    if (outcome) {
      caseRecord.outcome = outcome;
      caseRecord.status = 'Closed';
    }

    caseRecord.history.push({
      actionType,
      notes,
      performedBy: req.user._id
    });

    await caseRecord.save();
    
    const populated = await DisciplinaryCase.findById(caseRecord._id)
      .populate('reportedEmployee', 'name role department email status')
      .populate('reporter', 'name role')
      .populate('investigatingOfficer', 'name role')
      .populate('panelMembers', 'name role')
      .populate('history.performedBy', 'name role');

    res.json({ success: true, data: populated });
  } catch (error) {
    res.status(400).json({ success: false, message: 'Bad Request: ' + error.message });
  }
};
