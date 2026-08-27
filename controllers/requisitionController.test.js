import { describe, it, expect } from 'vitest';
import { canViewRequisitionAttachment } from './requisitionController.js';

// Pure permission check behind GET /requisitions/:id/attachments/:attachmentId/image
// — the requisition lookup itself is already tenant-scoped, but an Employee
// could still guess another employee's requisition/attachment id within the
// same tenant, so this needs its own ownership check.
describe('canViewRequisitionAttachment', () => {
  it('HR (or System_Admin) can view any attachment in their tenant', () => {
    expect(canViewRequisitionAttachment('HR_Admin', 'hr1', 'emp1')).toBe(true);
    expect(canViewRequisitionAttachment('System_Admin', 'hr1', 'emp2')).toBe(true);
  });

  it('an employee can view attachments on their own requisition', () => {
    expect(canViewRequisitionAttachment('Employee', 'emp1', 'emp1')).toBe(true);
  });

  it('an employee cannot view attachments on someone else\'s requisition', () => {
    expect(canViewRequisitionAttachment('Employee', 'emp1', 'emp2')).toBe(false);
  });

  it('compares ObjectId-like values by string, not reference', () => {
    const a = { toString: () => 'abc123' };
    const b = { toString: () => 'abc123' };
    expect(canViewRequisitionAttachment('Employee', a, b)).toBe(true);
  });

  it('denies gracefully when ids are missing', () => {
    expect(canViewRequisitionAttachment('Employee', null, 'emp1')).toBe(false);
    expect(canViewRequisitionAttachment('Employee', 'emp1', undefined)).toBe(false);
  });
});
