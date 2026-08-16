import { describe, it, expect } from 'vitest';
import { isScreenshotUploadAllowed } from './monitoringController.js';

describe('isScreenshotUploadAllowed', () => {
  it('denies when the tenant has not enabled screenshots at all', () => {
    expect(isScreenshotUploadAllowed(
      { screenshotsEnabled: false },
      { accepted: true }
    )).toBe(false);
  });

  it('denies when the tenant enabled it but the employee has not consented', () => {
    expect(isScreenshotUploadAllowed(
      { screenshotsEnabled: true },
      { accepted: false }
    )).toBe(false);
  });

  it('denies when the employee has consent but the tenant has never enabled it', () => {
    expect(isScreenshotUploadAllowed(
      { screenshotsEnabled: false },
      { accepted: true, acceptedAt: new Date() }
    )).toBe(false);
  });

  it('allows only when both the tenant setting AND employee consent are true', () => {
    expect(isScreenshotUploadAllowed(
      { screenshotsEnabled: true },
      { accepted: true }
    )).toBe(true);
  });

  it('denies gracefully when either input is missing/undefined', () => {
    expect(isScreenshotUploadAllowed(undefined, undefined)).toBe(false);
    expect(isScreenshotUploadAllowed(null, { accepted: true })).toBe(false);
    expect(isScreenshotUploadAllowed({ screenshotsEnabled: true }, null)).toBe(false);
  });
});
