import { describe, expect, it } from 'vitest';
import { repairLigatures } from '../../server/parsers/text-extract.js';
import { parseResumeText } from '../../server/parsers/resume-parser.js';

// The top of a real CV saved from Word, as its PDF text layer reads.
const damaged = `Robi Chris*an S. Guzman
Quezon City - (0917) 8772327 - guzmanrecruitment@gmail.com
Talent Acquisi*on - Sales
Handles daily opera;ons for Sales Execu;ve hiring. So\\ware: Workday
University of Santo Tomas 2008-2012`;

describe('repairLigatures', () => {
  it('puts back the "ti" and "ft" ligatures a broken font map drops', () => {
    const text = repairLigatures(damaged);
    expect(text).toContain('Robi Christian S. Guzman');
    expect(text).toContain('Talent Acquisition');
    expect(text).toContain('daily operations for Sales Executive');
    expect(text).toContain('Software: Workday');
  });

  it('leaves ordinary punctuation alone', () => {
    const plain = 'Skills: SQL; Python; Excel. Rating: 5*star. a;b';
    expect(repairLigatures(plain)).toBe(plain);
  });
});

describe('parseResumeText', () => {
  it('reads the name and a 7-digit number after an area code, not a year range', () => {
    const fields = parseResumeText(repairLigatures(damaged));
    expect(fields.full_name).toBe('Robi Christian S. Guzman');
    expect(fields.phone).toBe('(0917) 8772327');
    expect(fields.email).toBe('guzmanrecruitment@gmail.com');
  });

  it('skips year ranges when looking for a phone', () => {
    expect(parseResumeText('Jane Cruz\nACME Corp 2019 - 2021\n+63 917 555 0142').phone).toBe('+63 917 555 0142');
    expect(parseResumeText('Jane Cruz\nACME Corp 2008-2012').phone).toBeUndefined();
  });
});
