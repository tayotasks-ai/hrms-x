import mongoose from 'mongoose';

const shoutoutSchema = new mongoose.Schema({
  tenantId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Tenant',
    required: true
  },
  from: {
    id: { type: mongoose.Schema.Types.ObjectId, required: true },
    kind: { type: String, enum: ['Employee', 'User'], required: true },
    name: { type: String, required: true }
  },
  toEmployeeIds: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Employee',
    required: true
  }],
  message: {
    type: String,
    required: true,
    trim: true,
    maxlength: 240
  },
  tag: {
    type: String,
    enum: ['Great Work', 'Team Player', 'Went Above & Beyond', 'Lived Our Values'],
    default: null
  },
  reactions: [{
    reactorId: { type: mongoose.Schema.Types.ObjectId, required: true },
    emoji: { type: String, enum: ['👍', '🎉', '❤️'], required: true }
  }],
  createdAt: {
    type: Date,
    default: Date.now
  }
});

shoutoutSchema.index({ tenantId: 1, createdAt: -1 });

const Shoutout = mongoose.model('Shoutout', shoutoutSchema);
export default Shoutout;
