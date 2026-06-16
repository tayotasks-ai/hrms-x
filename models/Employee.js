import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';

const employeeSchema = new mongoose.Schema({
  // Base details
  name: { type: String, required: true, trim: true },
  email: { type: String, required: true, trim: true, lowercase: true },
  role: { type: String, required: true, trim: true },
  departmentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Department', required: true },
  salary: { type: Number, required: true, min: 0 },
  status: { type: String, enum: ['Active', 'Onboarding', 'Offboarded'], default: 'Active' },
  joinDate: { type: Date, required: true, default: Date.now },
  birthDate: { type: Date, required: true },
  
  // Bio Data
  gender: { type: String, enum: ['Male', 'Female', 'Other', 'Prefer not to say'] },
  nationality: { type: String },
  maritalStatus: { type: String, enum: ['Single', 'Married', 'Divorced', 'Widowed'] },
  phone: { type: String },
  
  // Address
  address: {
    street: String,
    lga: String,
    state: String,
    country: String
  },
  
  // Dependants & Family
  dependants: [{
    name: String,
    relationship: String,
    birthDate: Date
  }],
  emergencyContacts: [{
    name: String,
    relationship: String,
    phone: String
  }],
  
  // Experience & Education
  education: [{
    institution: String,
    qualification: String,
    graduationYear: Number
  }],
  experience: [{
    company: String,
    role: String,
    startDate: Date,
    endDate: Date
  }],
  
  // Account Details
  positionId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Position'
  },
  bankDetails: {
    bankName: String,
    accountNumber: String,
    accountName: String
  },
  
  // Regulatory IDs
  regulatory: {
    bvn: String,
    nin: String,
    nhf: String,
    rsa: String,
    pfa: String,
    tin: String,
    lgaOfOrigin: String
  },

  tenantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant', required: true },
  managerId: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee', default: null },
  
  // Authentication
  password: { type: String },
  isDefaultPassword: { type: Boolean, default: true },
  
  createdAt: { type: Date, default: Date.now }
});

// An employee email should be unique per tenant
employeeSchema.index({ email: 1, tenantId: 1 }, { unique: true });

// Match user entered password to hashed password in database
employeeSchema.methods.matchPassword = async function (enteredPassword) {
  if (!this.password) return false;
  return await bcrypt.compare(enteredPassword, this.password);
};

// Encrypt password using bcrypt before saving
employeeSchema.pre('save', async function (next) {
  if (!this.isModified('password') || !this.password) {
    return next();
  }

  const salt = await bcrypt.genSalt(10);
  // Re-check just in case
  if(this.password && !this.password.startsWith('$2a$') && !this.password.startsWith('$2b$')) {
    this.password = await bcrypt.hash(this.password, salt);
  }
});

const Employee = mongoose.model('Employee', employeeSchema);
export default Employee;
