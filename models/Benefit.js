import mongoose from 'mongoose';

const dependentSchema = new mongoose.Schema({
  name: { type: String, required: true },
  relationship: { type: String, required: true },
  dateOfBirth: { type: Date, required: true },
  gender: { type: String }
});

const benefitSchema = new mongoose.Schema({
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
  // HMO details
  hmoPlan: {
    provider: String,
    planTier: {
      type: String,
      enum: ['Standard', 'Premium', 'Executive', 'None'],
      default: 'None'
    },
    hmoIdNumber: String,
    dependents: [dependentSchema]
  },
  // Other insurances
  groupLifeInsurance: {
    provider: String,
    coverageAmount: Number,
    beneficiaries: [dependentSchema] // Reusing dependent schema for beneficiaries
  },
  pension: {
    pfaName: String, // Pension Fund Administrator
    rsaPin: String, // Retirement Savings Account PIN
    voluntaryContributionPercentage: {
      type: Number,
      default: 0
    }
  },
  // Fixed allowances (can be integrated with payroll later)
  allowances: {
    housing: Number,
    transport: Number,
    wardrobe: Number
  },
  enrollmentStatus: {
    type: String,
    enum: ['Pending Enrollment', 'Active', 'Suspended'],
    default: 'Pending Enrollment'
  },
  lastUpdated: {
    type: Date,
    default: Date.now
  }
});

const Benefit = mongoose.model('Benefit', benefitSchema);
export default Benefit;
