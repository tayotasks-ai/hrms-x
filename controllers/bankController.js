import Employee from '../models/Employee.js';
import { listBanks, resolveAccountNumber, createTransferRecipient, getPlatformSecretKey, PaystackError } from '../utils/paystack.js';
import { recordAudit } from '../utils/auditLog.js';
import { encryptPii } from '../utils/crypto.js';
import { maskEmployeePii } from '../utils/piiDisplay.js';

// GET /api/banks – any authenticated user (employees need this to fill in
// their own bank details). Uses the platform's own Paystack key — bank
// listing/verification isn't tenant-specific under the wallet model.
export const getBanks = async (req, res) => {
  try {
    const secretKey = getPlatformSecretKey();
    const banks = await listBanks(secretKey);
    res.json({ success: true, data: banks });
  } catch (err) {
    if (err instanceof PaystackError)
      return res.status(502).json({ success: false, message: `Paystack error: ${err.message}` });
    res.status(400).json({ success: false, message: err.message });
  }
};

// POST /api/employees/:id/verify-bank-account – self or HR.
// Body: { accountNumber, bankCode, bankName }
// Resolves the account name via Paystack, saves it alongside a cached
// transfer recipient so payslip payments don't need to re-create one every
// time, and marks the account verified. This is the ONLY place
// bankDetails.verified is ever set to true.
export const verifyBankAccount = async (req, res) => {
  try {
    const tid = req.tenantId;
    const isEmployee = req.userRole === 'Employee';
    const targetId = isEmployee ? req.user._id : req.params.id;

    const emp = await Employee.findOne({ _id: targetId, tenantId: tid });
    if (!emp) return res.status(404).json({ success: false, message: 'Employee not found.' });

    const { accountNumber, bankCode, bankName } = req.body;
    if (!accountNumber || !bankCode)
      return res.status(400).json({ success: false, message: 'accountNumber and bankCode are required.' });

    const secretKey = getPlatformSecretKey();

    const resolved = await resolveAccountNumber(secretKey, accountNumber, bankCode);
    const recipient = await createTransferRecipient(secretKey, {
      name: resolved.accountName,
      accountNumber: resolved.accountNumber,
      bankCode,
    });

    emp.bankDetails = {
      bankName: bankName || emp.bankDetails?.bankName,
      bankCode,
      accountNumber: encryptPii(resolved.accountNumber),
      accountName: resolved.accountName,
      verified: true,
      verifiedAt: new Date(),
      paystackRecipientCode: recipient.recipientCode,
    };
    await emp.save();

    recordAudit({
      tenantId: tid,
      actor: { id: req.user._id, name: req.user.name, model: isEmployee ? 'Employee' : 'User' },
      targetType: 'Employee',
      targetId: emp._id,
      targetName: emp.name,
      changes: [{ field: 'Bank Account', from: 'Unverified', to: `Verified — ${resolved.accountName}` }],
    });

    res.json({ success: true, message: 'Bank account verified.', data: maskEmployeePii({ bankDetails: emp.toObject().bankDetails }).bankDetails });
  } catch (err) {
    if (err instanceof PaystackError)
      return res.status(400).json({ success: false, message: `Could not verify account: ${err.message}` });
    res.status(400).json({ success: false, message: err.message });
  }
};
