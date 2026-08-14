import { describe, it, expect, beforeAll } from 'vitest';
import { encryptPii } from './crypto.js';
import { maskEmployeePii, encryptRegulatoryFields, decryptRegulatoryField } from './piiDisplay.js';

beforeAll(() => {
  process.env.PII_ENCRYPTION_KEY = 'test-pii-key-for-unit-tests-only';
});

describe('encryptRegulatoryFields', () => {
  it('encrypts only the non-empty fields present in the input', () => {
    const out = encryptRegulatoryFields({ bvn: '22345678901', nin: '', tin: undefined });
    expect(out.bvn).toBeDefined();
    expect(out.bvn).not.toBe('22345678901');
    expect(out.nin).toBeUndefined();
    expect(out.tin).toBeUndefined();
  });

  it('trims whitespace before encrypting', () => {
    const out = encryptRegulatoryFields({ bvn: '  22345678901  ' });
    expect(out.bvn).toBeDefined();
  });

  it('returns an empty object for no input', () => {
    expect(encryptRegulatoryFields()).toEqual({});
    expect(encryptRegulatoryFields({})).toEqual({});
  });
});

describe('maskEmployeePii', () => {
  it('replaces encrypted regulatory fields with masked last-4 values and strips the originals', () => {
    const emp = {
      name: 'Ada Obi',
      regulatory: { bvn: encryptPii('22345678901'), nin: encryptPii('98765432109'), lgaOfOrigin: 'Ikeja' },
    };
    const out = maskEmployeePii(emp);
    expect(out.regulatory.bvnMasked).toBe('•••••••8901');
    expect(out.regulatory.ninMasked).toBe('•••••••2109');
    expect(out.regulatory.bvn).toBeUndefined();
    expect(out.regulatory.nin).toBeUndefined();
    expect(out.regulatory.lgaOfOrigin).toBe('Ikeja'); // untouched, not sensitive
  });

  it('masks bank account number and strips the original', () => {
    const emp = { bankDetails: { bankName: 'GTBank', accountNumber: encryptPii('0123456789') } };
    const out = maskEmployeePii(emp);
    expect(out.bankDetails.accountNumberMasked).toBe('••••••6789');
    expect(out.bankDetails.accountNumber).toBeUndefined();
    expect(out.bankDetails.bankName).toBe('GTBank');
  });

  it('tolerates legacy plaintext values left over from before encryption (masks them directly)', () => {
    const emp = { regulatory: { bvn: '22345678901' } };
    const out = maskEmployeePii(emp);
    expect(out.regulatory.bvnMasked).toBe('•••••••8901');
  });

  it('returns null masked values for unset fields, not throwing', () => {
    const emp = { regulatory: {}, bankDetails: {} };
    const out = maskEmployeePii(emp);
    expect(out.regulatory.bvnMasked).toBeNull();
    expect(out.bankDetails.accountNumberMasked).toBeNull();
  });

  it('passes through an object with no regulatory/bankDetails unchanged', () => {
    const emp = { name: 'Bola' };
    expect(maskEmployeePii(emp)).toEqual({ name: 'Bola' });
  });

  it('handles null/undefined input', () => {
    expect(maskEmployeePii(null)).toBeNull();
    expect(maskEmployeePii(undefined)).toBeUndefined();
  });
});

describe('decryptRegulatoryField', () => {
  it('fully decrypts an encrypted value (for statutory filing, not display)', () => {
    const encrypted = encryptPii('22345678901');
    expect(decryptRegulatoryField(encrypted)).toBe('22345678901');
  });

  it('returns legacy plaintext unchanged', () => {
    expect(decryptRegulatoryField('22345678901')).toBe('22345678901');
  });

  it('returns an empty string for null/undefined', () => {
    expect(decryptRegulatoryField(null)).toBe('');
    expect(decryptRegulatoryField(undefined)).toBe('');
  });
});
