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
  // Set automatically when status transitions to 'Offboarded' (see
  // employeeController.updateEmployee) — drives the data retention window
  // in retentionController.js. Cleared if the employee is ever re-activated.
  offboardedAt: { type: Date },
  // Set once HR anonymizes this record under the retention policy. The
  // Employee doc's PII gets scrubbed at that point, but Payslip/Leave/Kpi
  // records referencing this _id are deliberately left alone — those carry
  // their own statutory retention requirements independent of the person's
  // erasure/anonymization.
  anonymizedAt: { type: Date },
  
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
    bankCode: String,          // Paystack bank code, needed to resolve/pay
    // Encrypted at rest (utils/crypto.js encryptPii/decryptPii). Payment
    // itself never needs to read this back — Paystack transfers use
    // paystackRecipientCode — so this is kept only for display/audit and is
    // select: false to avoid accidental exposure.
    accountNumber: { type: String, select: false },
    accountName: String,       // name Paystack resolved for this account
    verified: { type: Boolean, default: false },
    verifiedAt: Date,
    paystackRecipientCode: String, // cached Paystack transfer recipient, created on verify
  },
  
  // Regulatory IDs — encrypted at rest (utils/crypto.js encryptPii/decryptPii)
  // since BVN/NIN in particular are financial-identity-theft-grade data.
  // select: false so a plain Employee.find() never accidentally leaks
  // ciphertext (or worse, pre-migration plaintext) into an API response —
  // callers must explicitly .select('+regulatory.bvn') etc. and decrypt.
  // lgaOfOrigin is not sensitive in the same way and stays plain.
  regulatory: {
    bvn: { type: String, select: false },
    nin: { type: String, select: false },
    nhf: { type: String, select: false },
    rsa: { type: String, select: false },
    pfa: { type: String, select: false },
    tin: { type: String, select: false },
    lgaOfOrigin: String
  },

  tenantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant', required: true },
  managerId: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee', default: null },
  
  // Authentication
  password: { type: String },
  isDefaultPassword: { type: Boolean, default: true },
  resetPasswordToken: { type: String, select: false },
  resetPasswordExpires: { type: Date, select: false },
  // Brute-force login protection (see controllers/authController.js).
  failedLoginAttempts: { type: Number, default: 0, select: false },
  lockUntil: { type: Date, select: false },
  // Optional email OTP 2FA — off by default, user opts in from account settings.
  twoFactorEnabled: { type: Boolean, default: false },
  twoFactorOtpHash: { type: String, select: false },
  twoFactorOtpExpires: { type: Date, select: false },

  // NDPA privacy notice acceptance. Employees don't self-register (HR
  // creates their account), so the natural consent checkpoint is first
  // login rather than signup — see PrivacyConsentModal.vue, shown whenever
  // accepted is false. `version` lets a future re-issued notice force
  // re-acceptance by simply bumping the version string in the frontend.
  privacyConsent: {
    accepted: { type: Boolean, default: false },
    acceptedAt: Date,
    version: String,
  },

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
