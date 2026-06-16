import mongoose from 'mongoose';

const helpdeskTicketSchema = new mongoose.Schema({
  ticketId: {
    type: String,
    required: true,
    unique: true
  },
  tenantId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Tenant',
    required: true
  },
  employeeId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Employee',
    required: true
  },
  subject: {
    type: String,
    required: true
  },
  description: {
    type: String,
    required: true
  },
  category: {
    type: String,
    enum: ['Payroll', 'Benefits', 'Recruitment', 'Policy', 'General HR', 'IT Support'],
    required: true
  },
  priority: {
    type: String,
    enum: ['Low', 'Medium', 'High', 'Urgent'],
    default: 'Medium'
  },
  status: {
    type: String,
    enum: ['Open', 'In Progress', 'Waiting on Employee', 'Resolved', 'Closed'],
    default: 'Open'
  },
  assignedTo: {
    type: mongoose.Schema.Types.ObjectId, // HR Officer handling it
    ref: 'Employee'
  },
  messages: [{
    sender: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Employee'
    },
    message: String,
    timestamp: {
      type: Date,
      default: Date.now
    }
  }],
  slaDeadline: {
    type: Date
  },
  resolvedAt: {
    type: Date
  },
  createdAt: {
    type: Date,
    default: Date.now
  }
});

// Pre-save hook for ticketId and SLA
helpdeskTicketSchema.pre('save', async function(next) {
  if (!this.ticketId) {
    const randomNum = Math.floor(10000 + Math.random() * 90000);
    this.ticketId = `TKT-${randomNum}`;
  }

  // Basic SLA calculation based on Priority
  if (this.isNew && !this.slaDeadline) {
    const deadline = new Date();
    switch (this.priority) {
      case 'Urgent': deadline.setHours(deadline.getHours() + 4); break;
      case 'High': deadline.setDate(deadline.getDate() + 1); break;
      case 'Medium': deadline.setDate(deadline.getDate() + 3); break;
      case 'Low': deadline.setDate(deadline.getDate() + 5); break;
    }
    this.slaDeadline = deadline;
  }

  if ((this.status === 'Resolved' || this.status === 'Closed') && !this.resolvedAt) {
    this.resolvedAt = new Date();
  }

  next();
});

const HelpdeskTicket = mongoose.model('HelpdeskTicket', helpdeskTicketSchema);
export default HelpdeskTicket;
