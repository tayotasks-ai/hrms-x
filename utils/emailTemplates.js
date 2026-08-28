/**
 * Centralised email templates for WorkDesk
 * Each function returns { subject, html } ready for sendEmail()
 */

// ─── Shared Layout Wrapper ──────────────────────────────────────────────────
const wrap = (body) => `
<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:#f4f5f2;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f5f2;padding:32px 0;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.06);">
        <!-- Header -->
        <tr>
          <td style="background:#0a0a0a;padding:24px 32px;">
            <table cellpadding="0" cellspacing="0" border="0"><tr>
              <td style="background:#84cc16;width:32px;height:32px;min-width:32px;border-radius:8px;text-align:center;vertical-align:middle;font-family:Arial,Helvetica,sans-serif;font-weight:800;font-size:13px;color:#0a0a0a;">WD</td>
              <td style="padding-left:10px;color:#ffffff;font-size:18px;font-weight:700;letter-spacing:1px;text-transform:uppercase;font-family:Arial,Helvetica,sans-serif;">WorkDesk</td>
            </tr></table>
          </td>
        </tr>
        <!-- Body -->
        <tr>
          <td style="padding:32px;">
            ${body}
          </td>
        </tr>
        <!-- Footer -->
        <tr>
          <td style="padding:20px 32px;background:#fafafa;border-top:1px solid #e5e7eb;">
            <p style="margin:0;font-size:12px;color:#9ca3af;text-align:center;">
              This is an automated notification from WorkDesk. Please do not reply to this email.
            </p>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;

// ─── Helper ─────────────────────────────────────────────────────────────────
const btn = (label, url) =>
  `<a href="${url}" style="display:inline-block;margin-top:16px;padding:12px 28px;background:#84cc16;color:#0a0a0a;text-decoration:none;border-radius:8px;font-weight:700;font-size:14px;">${label}</a>`;

const heading = (text) =>
  `<h2 style="margin:0 0 16px;font-size:20px;color:#1f2937;">${text}</h2>`;

const para = (text) =>
  `<p style="margin:0 0 12px;font-size:15px;color:#4b5563;line-height:1.6;">${text}</p>`;

const badge = (text, color = '#65a30d') =>
  `<span style="display:inline-block;padding:4px 12px;background:${color}15;color:${color};border-radius:6px;font-size:13px;font-weight:600;">${text}</span>`;

const divider = () =>
  `<hr style="border:none;border-top:1px solid #e5e7eb;margin:20px 0;">`;

// ─── 1. Welcome Tenant ─────────────────────────────────────────────────────
export const welcomeTenant = ({ orgName, adminName, adminEmail, loginUrl }) => ({
  subject: `Welcome to WorkDesk – ${orgName} is set up!`,
  html: wrap(`
    ${heading('Welcome to WorkDesk! 🎉')}
    ${para(`Hi <strong>${adminName}</strong>,`)}
    ${para(`Your organisation <strong>${orgName}</strong> has been successfully registered on WorkDesk.`)}
    ${para('You can now log in to your HR Admin dashboard to start adding employees, configuring departments, and managing your workforce.')}
    ${divider()}
    ${para(`<strong>Login Email:</strong> ${adminEmail}`)}
    ${para('Use the password you set during registration to sign in.')}
    ${loginUrl ? btn('Log in to WorkDesk', loginUrl) : ''}
  `)
});

// ─── 2. Employee Created ───────────────────────────────────────────────────
export const employeeCreated = ({ employeeName, email, defaultPassword, orgName, loginUrl }) => ({
  subject: `Your WorkDesk account has been created – ${orgName}`,
  html: wrap(`
    ${heading('Welcome aboard! 👋')}
    ${para(`Hi <strong>${employeeName}</strong>,`)}
    ${para(`Your employee account at <strong>${orgName}</strong> has been created on WorkDesk.`)}
    ${divider()}
    ${para(`<strong>Email:</strong> ${email}`)}
    ${para(`<strong>Temporary Password:</strong> <code style="background:#f3f4f6;padding:4px 8px;border-radius:4px;font-size:14px;">${defaultPassword}</code>`)}
    ${divider()}
    ${para('Please log in and change your password as soon as possible.')}
    ${loginUrl ? btn('Log in to WorkDesk', loginUrl) : ''}
  `)
});

// ─── 3. Leave Requested (sent to HR) ───────────────────────────────────────
export const leaveRequested = ({ employeeName, leaveType, startDate, endDate, workingDays, reason }) => ({
  subject: `New Leave Request – ${employeeName}`,
  html: wrap(`
    ${heading('New Leave Request 📋')}
    ${para(`<strong>${employeeName}</strong> has submitted a leave request.`)}
    ${divider()}
    <table style="width:100%;font-size:14px;color:#4b5563;">
      <tr><td style="padding:6px 0;font-weight:600;">Type</td><td>${leaveType}</td></tr>
      <tr><td style="padding:6px 0;font-weight:600;">Dates</td><td>${startDate} → ${endDate}</td></tr>
      <tr><td style="padding:6px 0;font-weight:600;">Working Days</td><td>${workingDays}</td></tr>
      <tr><td style="padding:6px 0;font-weight:600;">Reason</td><td>${reason || '—'}</td></tr>
    </table>
    ${divider()}
    ${para('Please log in to review and approve or reject this request.')}
  `)
});

// ─── 4. Leave Status Update (sent to employee) ─────────────────────────────
export const leaveStatusUpdate = ({ employeeName, leaveType, startDate, endDate, status }) => {
  const colorMap = {
    'Manager Approved': '#16a34a',
    'HR Approved': '#16a34a',
    'Rejected': '#dc2626',
    'Processed': '#2563eb',
  };
  return {
    subject: `Leave ${status} – ${leaveType}`,
    html: wrap(`
      ${heading('Leave Request Update')}
      ${para(`Hi <strong>${employeeName}</strong>,`)}
      ${para(`Your <strong>${leaveType}</strong> leave request from <strong>${startDate}</strong> to <strong>${endDate}</strong> has been updated.`)}
      <div style="text-align:center;margin:20px 0;">
        ${badge(status, colorMap[status] || '#65a30d')}
      </div>
    `)
  };
};

// ─── 5. Disciplinary Query Issued ───────────────────────────────────────────
export const disciplinaryQueryIssued = ({ employeeName, caseTitle, deadlineDate }) => ({
  subject: `Disciplinary Query – ${caseTitle}`,
  html: wrap(`
    ${heading('Disciplinary Query Issued ⚠️')}
    ${para(`Dear <strong>${employeeName}</strong>,`)}
    ${para(`A disciplinary query has been issued regarding: <strong>${caseTitle}</strong>.`)}
    ${para(`You are required to respond by <strong>${deadlineDate}</strong>.`)}
    ${divider()}
    ${para('Please log in to your WorkDesk portal to view the full details and submit your response.')}
  `)
});

// ─── 6. Onboarding Plan Created ─────────────────────────────────────────────
export const onboardingPlanCreated = ({ employeeName, taskCount }) => ({
  subject: `Your Onboarding Plan is Ready`,
  html: wrap(`
    ${heading('Onboarding Plan Created 🚀')}
    ${para(`Hi <strong>${employeeName}</strong>,`)}
    ${para(`Your onboarding plan has been set up with <strong>${taskCount} task${taskCount !== 1 ? 's' : ''}</strong>.`)}
    ${para('Log in to your WorkDesk portal to view your onboarding checklist and get started.')}
  `)
});

// ─── 7. Probation Outcome ───────────────────────────────────────────────────
export const probationOutcome = ({ employeeName, decision, reason, newEndDate }) => {
  const titles = { Confirm: 'Confirmed ✅', Extend: 'Extended 🔄', Terminate: 'Terminated' };
  const colors = { Confirm: '#16a34a', Extend: '#f59e0b', Terminate: '#dc2626' };
  let extra = '';
  if (decision === 'Extend' && newEndDate) {
    extra = para(`Your probation has been extended to <strong>${newEndDate}</strong>.`);
  }
  return {
    subject: `Probation ${decision}ed`,
    html: wrap(`
      ${heading(`Probation ${titles[decision] || decision}`)}
      ${para(`Dear <strong>${employeeName}</strong>,`)}
      <div style="text-align:center;margin:20px 0;">
        ${badge(decision, colors[decision] || '#65a30d')}
      </div>
      ${reason ? para(`<strong>Reason:</strong> ${reason}`) : ''}
      ${extra}
      ${para('Please log in to your WorkDesk portal for more details.')}
    `)
  };
};

// ─── 8. Exit Initiated ──────────────────────────────────────────────────────
export const exitInitiated = ({ employeeName, exitType, lastWorkingDay }) => ({
  subject: `Offboarding Process Initiated`,
  html: wrap(`
    ${heading('Offboarding Process Started')}
    ${para(`Dear <strong>${employeeName}</strong>,`)}
    ${para(`Your offboarding process has been initiated.`)}
    ${divider()}
    <table style="width:100%;font-size:14px;color:#4b5563;">
      <tr><td style="padding:6px 0;font-weight:600;">Exit Type</td><td>${exitType || '—'}</td></tr>
      <tr><td style="padding:6px 0;font-weight:600;">Last Working Day</td><td>${lastWorkingDay || '—'}</td></tr>
    </table>
    ${divider()}
    ${para('Please log in to complete your clearance checklist.')}
  `)
});

// ─── 9. Payslip Available ───────────────────────────────────────────────────
export const payslipAvailable = ({ employeeName, period, netPay }) => ({
  subject: `Payslip Available – ${period}`,
  html: wrap(`
    ${heading('Your Payslip is Ready 💰')}
    ${para(`Hi <strong>${employeeName}</strong>,`)}
    ${para(`Your payslip for <strong>${period}</strong> is now available.`)}
    ${divider()}
    ${para(`<strong>Net Pay:</strong> ₦${Number(netPay).toLocaleString('en-NG', { minimumFractionDigits: 2 })}`)}
    ${divider()}
    ${para('Log in to your WorkDesk portal to view the full breakdown.')}
  `)
});

// ─── 10. Redeployment Initiated ─────────────────────────────────────────────
export const redeploymentInitiated = ({ employeeName, fromDept, toDept, toRole, effectiveDate }) => ({
  subject: `Transfer / Redeployment Notice`,
  html: wrap(`
    ${heading('Transfer Notice 🔀')}
    ${para(`Dear <strong>${employeeName}</strong>,`)}
    ${para('A transfer / redeployment has been initiated for you.')}
    ${divider()}
    <table style="width:100%;font-size:14px;color:#4b5563;">
      <tr><td style="padding:6px 0;font-weight:600;">From Department</td><td>${fromDept}</td></tr>
      <tr><td style="padding:6px 0;font-weight:600;">To Department</td><td>${toDept}</td></tr>
      <tr><td style="padding:6px 0;font-weight:600;">New Role</td><td>${toRole}</td></tr>
      <tr><td style="padding:6px 0;font-weight:600;">Effective Date</td><td>${effectiveDate}</td></tr>
    </table>
  `)
});

// ─── 11. Redeployment Completed ─────────────────────────────────────────────
export const redeploymentCompleted = ({ employeeName, toDept, toRole }) => ({
  subject: `Transfer Completed`,
  html: wrap(`
    ${heading('Transfer Completed ✅')}
    ${para(`Dear <strong>${employeeName}</strong>,`)}
    ${para(`Your transfer has been completed. Your records have been updated.`)}
    ${divider()}
    ${para(`<strong>Department:</strong> ${toDept}`)}
    ${para(`<strong>Role:</strong> ${toRole}`)}
  `)
});

// ─── 12. Requisition Status Update ──────────────────────────────────────────
export const requisitionStatusUpdate = ({ employeeName, itemName, status }) => {
  const colorMap = { Approved: '#16a34a', Rejected: '#dc2626', Fulfilled: '#2563eb' };
  return {
    subject: `Requisition ${status} – ${itemName || 'Request'}`,
    html: wrap(`
      ${heading('Requisition Update')}
      ${para(`Hi <strong>${employeeName}</strong>,`)}
      ${para(`Your requisition${itemName ? ' for <strong>' + itemName + '</strong>' : ''} has been updated.`)}
      <div style="text-align:center;margin:20px 0;">
        ${badge(status, colorMap[status] || '#65a30d')}
      </div>
    `)
  };
};

// ─── 13. Ticket Reply ───────────────────────────────────────────────────────
export const ticketReply = ({ recipientName, ticketSubject, senderName, messageSnippet }) => ({
  subject: `New Reply on Ticket – ${ticketSubject}`,
  html: wrap(`
    ${heading('New Reply on Your Ticket 💬')}
    ${para(`Hi <strong>${recipientName}</strong>,`)}
    ${para(`<strong>${senderName}</strong> replied to ticket: <strong>${ticketSubject}</strong>.`)}
    ${divider()}
    <div style="background:#fafafa;padding:16px;border-radius:8px;border-left:4px solid #84cc16;">
      <p style="margin:0;font-size:14px;color:#4b5563;font-style:italic;">"${messageSnippet}"</p>
    </div>
    ${divider()}
    ${para('Log in to your WorkDesk portal to continue the conversation.')}
  `)
});

// ─── 14. Training Enrolled ──────────────────────────────────────────────────
export const trainingEnrolled = ({ employeeName, courseTitle, courseType, durationHours }) => ({
  subject: `Enrolled in Training – ${courseTitle}`,
  html: wrap(`
    ${heading('Training Enrollment 📚')}
    ${para(`Hi <strong>${employeeName}</strong>,`)}
    ${para(`You have been enrolled in the following training course:`)}
    ${divider()}
    <table style="width:100%;font-size:14px;color:#4b5563;">
      <tr><td style="padding:6px 0;font-weight:600;">Course</td><td>${courseTitle}</td></tr>
      <tr><td style="padding:6px 0;font-weight:600;">Type</td><td>${courseType || '—'}</td></tr>
      <tr><td style="padding:6px 0;font-weight:600;">Duration</td><td>${durationHours ? durationHours + ' hours' : '—'}</td></tr>
    </table>
  `)
});

// ─── 15. Password Reset Requested ───────────────────────────────────────────
export const passwordResetRequested = ({ name, resetUrl }) => ({
  subject: `Reset your WorkDesk password`,
  html: wrap(`
    ${heading('Reset Your Password 🔒')}
    ${para(`Hi <strong>${name}</strong>,`)}
    ${para('We received a request to reset your WorkDesk password. Click the button below to choose a new one. This link expires in 30 minutes.')}
    <div style="text-align:center;">
      ${btn('Reset Password', resetUrl)}
    </div>
    ${divider()}
    ${para("If you didn't request this, you can safely ignore this email — your password won't be changed.")}
  `)
});

// ─── 15b. Login OTP (email-based 2FA, opt-in) ──────────────────────────────
export const loginOtpCode = ({ name, code }) => ({
  subject: `Your WorkDesk login code: ${code}`,
  html: wrap(`
    ${heading('Your Login Code 🔑')}
    ${para(`Hi <strong>${name}</strong>,`)}
    ${para('Enter this code to finish signing in. It expires in 10 minutes.')}
    <div style="text-align:center;padding:16px 0;">
      <span style="display:inline-block;font-size:32px;font-weight:700;letter-spacing:8px;color:#111827;background:#f4f5f2;padding:12px 24px;border-radius:8px;">${code}</span>
    </div>
    ${divider()}
    ${para("If you didn't try to log in, you can ignore this email — your account is safe.")}
  `)
});

// ─── 16. KPI Self-Review Submitted (sent to manager) ───────────────────────
export const kpiSelfReviewSubmitted = ({ managerName, employeeName, kpiTitle, score }) => ({
  subject: `KPI Self-Review Submitted – ${employeeName}`,
  html: wrap(`
    ${heading('Manager Review Needed 📝')}
    ${para(`Hi <strong>${managerName}</strong>,`)}
    ${para(`<strong>${employeeName}</strong> submitted a self-review and it's waiting on your sign-off.`)}
    ${divider()}
    <table style="width:100%;font-size:14px;color:#4b5563;">
      <tr><td style="padding:6px 0;font-weight:600;">KPI</td><td>${kpiTitle}</td></tr>
      <tr><td style="padding:6px 0;font-weight:600;">Self-Rating</td><td>${score}/5</td></tr>
    </table>
    ${divider()}
    ${para('Log in to your WorkDesk portal to submit the manager review.')}
  `)
});

// ─── 17. KPI Manager Review Signed Off (sent to employee) ───────────────────
export const kpiSignedOff = ({ employeeName, kpiTitle, finalScore }) => ({
  subject: `KPI Signed Off – ${kpiTitle}`,
  html: wrap(`
    ${heading('KPI Signed Off ✅')}
    ${para(`Hi <strong>${employeeName}</strong>,`)}
    ${para(`Your manager has completed the review for <strong>${kpiTitle}</strong>.`)}
    <div style="text-align:center;margin:20px 0;">
      ${badge(`Final Score: ${finalScore}/5`, '#16a34a')}
    </div>
    ${para('Log in to your WorkDesk portal to see the full review.')}
  `)
});

// ─── 18. Platform Support Impersonation (sent to every HR Admin on the tenant) ───
// Real-time email counterpart to the in-app notification fired from the same
// call site — see platformController.js impersonateTenant. Not a gate on
// access (that would let a non-responsive admin block urgent support), just
// immediate transparency into the fact it happened, by whom, and why.
export const impersonationAccessed = ({ adminName, tenantName, platformAdminName, reason, expiresAt }) => ({
  subject: `Platform support accessed your WorkDesk account`,
  html: wrap(`
    ${heading('Platform Support Access ⚠️')}
    ${para(`Hi <strong>${adminName}</strong>,`)}
    ${para(`A WorkDesk platform support admin just logged into <strong>${tenantName}</strong>'s HR Admin account.`)}
    ${divider()}
    <table style="width:100%;font-size:14px;color:#4b5563;">
      <tr><td style="padding:6px 0;font-weight:600;">Support Admin</td><td>${platformAdminName}</td></tr>
      <tr><td style="padding:6px 0;font-weight:600;">Reason Given</td><td>${reason}</td></tr>
      <tr><td style="padding:6px 0;font-weight:600;">Session Expires</td><td>${expiresAt}</td></tr>
    </table>
    ${divider()}
    ${para("This is standard practice when you need help from support, but if you didn't expect this or have concerns, check the Audit Log in your WorkDesk dashboard for the full trail.")}
  `)
});
