import { describe, expect, it } from 'vitest';
import { cleanPhoneInput, limitPhoneInput, phoneDigitRange, phoneNumberError } from '../../shared/domain/phone.js';
import { applySchema } from '../../shared/api/public.js';

describe('applicant phone numbers', () => {
  it('rejects letters, which used to pass because only digits were counted', () => {
    expect(phoneNumberError('PH', '9468293580d2e323')).toBe('Use numbers only. Spaces, dashes and brackets are fine.');
  });

  it('accepts Philippine mobiles with or without the leading 0, and with separators', () => {
    for (const n of ['9171234567', '0917 123 4567', '(0917) 123-4567', '917.123.4567']) expect(phoneNumberError('PH', n)).toBeNull();
  });

  it('checks the length for the chosen country', () => {
    expect(phoneNumberError('PH', '91712345')).toBe('Numbers in the Philippines have 9 to 10 digits after +63.');
    expect(phoneNumberError('PH', '917123456789')).not.toBeNull();
    expect(phoneNumberError('SG', '91234567')).toBeNull();
    expect(phoneNumberError('SG', '912345678')).toBe('Numbers in Singapore have 8 digits after +65.');
    expect(phoneNumberError('US', '415 555 0132')).toBeNull();
  });

  it('falls back to the international limit for other countries', () => {
    expect(phoneDigitRange('NG')).toEqual([6, 12]); // 15 digits minus the 3-digit +234
    expect(phoneNumberError('NG', '8031234567')).toBeNull();
  });

  it('leaves an empty number alone: the field is optional', () => {
    expect(phoneNumberError('PH', '')).toBeNull();
    expect(phoneNumberError('PH', '   ')).toBeNull();
  });

  it('drops letters and symbols as they are typed, keeping separators', () => {
    expect(cleanPhoneInput('9468293580d2e323')).toBe('94682935802323');
    expect(cleanPhoneInput('+63 (917) 123-4567 ext')).toBe('63 (917) 123-4567 ');
  });

  it('stops at the number length of the chosen country while typing', () => {
    expect(limitPhoneInput('PH', '9468293580232323')).toBe('9468293580');
    expect(limitPhoneInput('PH', '09468293580232')).toBe('09468293580'); // local 0 + 10 digits
    expect(limitPhoneInput('PH', '0917 123 4567 89')).toBe('0917 123 4567 ');
    expect(limitPhoneInput('SG', '9123456789')).toBe('91234567');
    expect(limitPhoneInput('US', '(415) 555-01329')).toBe('(415) 555-0132');
    expect(limitPhoneInput('PH', '9468293580d2e323')).toBe('9468293580');
  });

  it('is enforced by the application schema the API uses', () => {
    const base = {
      name: 'Ana Cruz', email: 'ana@example.com', phoneCountry: 'PH', coverLetter: 'Hi', whyUs: 'Because', source: 'linkedin',
      confirm: true, resumeUploadId: '00000000-0000-4000-8000-000000000000',
    };
    const bad = applySchema.safeParse({ ...base, phoneNumber: '9468293580d2e323' });
    expect(bad.success).toBe(false);
    expect(bad.error?.issues.find((i) => i.path[0] === 'phoneNumber')?.message).toMatch(/numbers only/);
    expect(applySchema.safeParse({ ...base, phoneNumber: '0917 123 4567' }).success).toBe(true);
  });
});
