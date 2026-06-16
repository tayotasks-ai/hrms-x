import mongoose from 'mongoose';

const cycleSchema = new mongoose.Schema({
  tenantId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Tenant',
    required: true
  },
  name: {
    type: String,
    required: true,
    trim: true
  },
  startDate: {
    type: Date,
    required: true
  },
  endDate: {
    type: Date,
    required: true
  },
  status: {
    type: String,
    enum: ['Draft', 'Open', 'Closed'],
    default: 'Draft'
  },
  createdAt: {
    type: Date,
    default: Date.now
  }
});

const PerformanceCycle = mongoose.model('PerformanceCycle', cycleSchema);
export default PerformanceCycle;
