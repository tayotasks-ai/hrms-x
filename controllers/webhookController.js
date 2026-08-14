import mongoose from 'mongoose';
import Tenant from '../models/Tenant.js';
import Payslip from '../models/Payslip.js';
import Employee from '../models/Employee.js';
import { decryptSecret } from '../utils/crypto.js';
import { verifyWebhookSignature } from '../utils/paystack.js';
import { sendEmail } from '../utils/email.js';
import { payslipAvailable } from '../utils/emailTemplates.js';

// POST /api/webhooks/paystack – PUBLIC, no tenant header, no auth.
// This is the one place in the API that deliberately sits outside the
// tenant-scoping model: Paystack calls it directly with no way to attach
// our X-Tenant-ID header. Instead, the tenant is recovered from the
// transfer `reference` itself, which we generate as
// `hrms_<tenantId>_<payslipId>_<random>` (see payslipPaymentController.js).
// The signature is then verified against THAT tenant's own Paystack secret
// key — this is also what stops one tenant's traffic from being able to
// forge events for another tenant's payslips, since the signature can only
// be produced by someone holding that specific tenant's key.
export const handlePaystackWebhook = async (req, res) => {
  try {
    const reference = req.body?.data?.reference;
    if (!reference || typeof reference !== 'string' || !reference.startsWith('hrms_')) {
      // Not one of our references (or a malformed payload) — ack and ignore.
      return res.sendStatus(200);
    }

    const parts = reference.split('_');
    const tenantId = parts[1];
    if (!mongoose.Types.ObjectId.isValid(tenantId)) return res.sendStatus(200);

    const tenant = await Tenant.findById(tenantId).select('+paystack.secretKeyEncrypted paystack.connected');
    if (!tenant?.paystack?.connected || !tenant.paystack.secretKeyEncrypted) return res.sendStatus(200);

    const secretKey = decryptSecret(tenant.paystack.secretKeyEncrypted);
    const signature = req.headers['x-paystack-signature'];
    const valid = verifyWebhookSignature(req.rawBody, signature, secretKey);
    if (!valid) {
      console.error(`Paystack webhook: invalid signature for tenant ${tenantId}`);
      return res.sendStatus(400);
    }

    const event = req.body.event;
    const payslip = await Payslip.findOne({ tenantId, 'payment.reference': reference });
    if (!payslip) return res.sendStatus(200);

    if (event === 'transfer.success') {
      payslip.payment.status = 'Paid';
      payslip.payment.paidAt = new Date();
      await payslip.save();

      const emp = await Employee.findById(payslip.employeeId);
      if (emp?.email) {
        const tpl = payslipAvailable({ employeeName: emp.name, period: payslip.period, netPay: payslip.netPay });
        sendEmail({ to: emp.email, ...tpl }).catch(err => console.error('Email failed:', err.message));
      }
    } else if (event === 'transfer.failed' || event === 'transfer.reversed') {
      payslip.payment.status = 'Failed';
      payslip.payment.failureReason = req.body?.data?.reason || event;
      await payslip.save();
    }
    // Other events (e.g. transfer.otp_pending) — no state change needed, already 'Pending_OTP'.

    res.sendStatus(200);
  } catch (err) {
    console.error('Paystack webhook handling error:', err.message);
    // Still 200 so Paystack doesn't hammer retries over our own bug; the
    // payslip will show as stuck and can be reconciled manually/re-paid.
    res.sendStatus(200);
  }
};
