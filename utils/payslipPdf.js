import PDFDocument from 'pdfkit';

// Streams a one-page payslip PDF directly to an Express response.
// Uses "NGN" instead of the ₦ glyph — pdfkit's built-in Helvetica font
// (WinAnsi encoding) doesn't include the Naira sign, so ₦ renders as a
// missing-glyph box if used directly.
const fmt = (n) => Number(n || 0).toLocaleString('en-NG', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export const streamPayslipPdf = (res, payslip, tenantName) => {
  const doc = new PDFDocument({ size: 'A4', margin: 50 });

  const safeName = (payslip.employeeId?.name || 'Employee').replace(/[^\w\-]+/g, '-');
  const safePeriod = (payslip.period || 'payslip').replace(/[^\w\-]+/g, '-');
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="Payslip-${safeName}-${safePeriod}.pdf"`);
  doc.pipe(res);

  // ── Header ──────────────────────────────────────────────────────────────
  doc.font('Helvetica-Bold').fontSize(18).fillColor('#111').text(tenantName || 'Company');
  doc.font('Helvetica').fontSize(9).fillColor('#666').text('Multi-Tenant SaaS HRMS');
  doc.moveDown(0.3);
  doc.font('Helvetica-Bold').fontSize(14).fillColor('#111').text('PAYSLIP');
  doc.font('Helvetica').fontSize(9).fillColor('#666').text(`Reference: SLIP-${String(payslip._id).slice(-8).toUpperCase()}`);
  doc.moveDown(1);

  // ── Employee / cycle info ──────────────────────────────────────────────
  const infoTop = doc.y;
  doc.font('Helvetica').fontSize(9).fillColor('#666').text('EMPLOYEE', 50, infoTop);
  doc.font('Helvetica-Bold').fontSize(11).fillColor('#111').text(payslip.employeeId?.name || 'Deleted Employee', 50, infoTop + 12);
  doc.font('Helvetica').fontSize(9).fillColor('#444')
    .text(payslip.employeeId?.role || '', 50, infoTop + 28)
    .text(payslip.employeeId?.departmentId?.name ? `${payslip.employeeId.departmentId.name} Department` : '', 50, infoTop + 41)
    .text(payslip.employeeId?.email || '', 50, infoTop + 54);

  doc.font('Helvetica').fontSize(9).fillColor('#666').text('PAYROLL CYCLE', 350, infoTop, { width: 195, align: 'right' });
  doc.font('Helvetica-Bold').fontSize(11).fillColor('#111').text(payslip.period, 350, infoTop + 12, { width: 195, align: 'right' });
  doc.font('Helvetica').fontSize(9).fillColor('#444')
    .text(`Status: ${payslip.status}`, 350, infoTop + 28, { width: 195, align: 'right' })
    .text(`Generated: ${new Date(payslip.createdAt || Date.now()).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}`, 350, infoTop + 41, { width: 195, align: 'right' });

  doc.y = infoTop + 80;
  doc.moveTo(50, doc.y).lineTo(545, doc.y).strokeColor('#ddd').stroke();
  doc.moveDown(1);

  // ── Earnings / deductions table ─────────────────────────────────────────
  let y = doc.y;
  const rowHeight = 20;
  const row = (label, value, opts = {}) => {
    doc.font(opts.bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(10).fillColor(opts.color || '#222');
    doc.text(label, 50, y, { width: 300 });
    doc.text(value, 345, y, { width: 200, align: 'right' });
    y += rowHeight;
  };

  row('Description', 'Amount (NGN)', { bold: true, color: '#666' });
  y += 4;
  doc.moveTo(50, y).lineTo(545, y).strokeColor('#eee').stroke();
  y += 10;

  row('Basic Salary', fmt(payslip.basicSalary));
  if (payslip.allowances) row('Allowances & Bonuses', `+${fmt(payslip.allowances)}`, { color: '#15803d' });

  y += 4;
  doc.moveTo(50, y).lineTo(545, y).strokeColor('#eee').stroke();
  y += 10;

  const d = payslip.deductions;
  if (d && typeof d === 'object') {
    if (d.paye) row('PAYE Tax', `-${fmt(d.paye)}`, { color: '#b91c1c' });
    if (d.pension) row('Pension (8%)', `-${fmt(d.pension)}`, { color: '#b91c1c' });
    if (d.nhf) row('NHF (2.5%)', `-${fmt(d.nhf)}`, { color: '#b91c1c' });
    if (d.other) row('Other Deductions', `-${fmt(d.other)}`, { color: '#b91c1c' });
  } else if (d) {
    row('Deductions', `-${fmt(d)}`, { color: '#b91c1c' });
  }

  y += 4;
  doc.moveTo(50, y).lineTo(545, y).strokeColor('#111').lineWidth(1).stroke();
  y += 14;

  doc.font('Helvetica-Bold').fontSize(13).fillColor('#3f6212');
  doc.text('NET PAY', 50, y, { width: 300 });
  doc.text(`NGN ${fmt(payslip.netPay)}`, 345, y, { width: 200, align: 'right' });
  y += 30;

  doc.font('Helvetica').fontSize(8).fillColor('#999')
    .text('This is a system-generated document and requires no physical signature.', 50, y, { width: 495, align: 'center' });

  doc.end();
};
