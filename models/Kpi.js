import mongoose from 'mongoose';

const kpiSchema = new mongoose.Schema({
  employeeId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Employee',
    required: true
  },
  tenantId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Tenant',
    required: true
  },
  title: {
    type: String,
    required: true,
    trim: true
  },
  description: {
    type: String,
    trim: true
  },
  cycleId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'PerformanceCycle',
    required: true
  },
  period: {
    type: String,
    trim: true
  },
  // Weight of this KPI within the employee's overall score for the cycle (%).
  // Optional — KPIs without a weight are treated as equally-weighted in rollups.
  weight: {
    type: Number,
    min: 0,
    max: 100,
    default: null
  },
  reviewStage: {
    type: String,
    enum: ['Pending Self-Review', 'Pending Manager-Review', 'Signed Off'],
    default: 'Pending Self-Review'
  },
  selfRating: {
    score: { type: Number, min: 1, max: 5 },
    comment: { type: String, trim: true },
    submittedAt: Date
  },
  managerRating: {
    score: { type: Number, min: 1, max: 5 },
    comment: { type: String, trim: true },
    submittedAt: Date,
    ratedBy: { type: mongoose.Schema.Types.ObjectId, refPath: 'managerRating.ratedByModel' },
    ratedByModel: { type: String, enum: ['Employee', 'User'] }
  },
  // Set when manager-review is submitted — the score of record for rollups.
  finalScore: {
    type: Number,
    min: 1,
    max: 5,
    default: null
  },
  createdAt: {
    type: Date,
    default: Date.now
  }
});

const Kpi = mongoose.model('Kpi', kpiSchema);
export default Kpi;
