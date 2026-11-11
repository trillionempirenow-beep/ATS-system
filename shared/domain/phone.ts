/** Countries offered by the phone selector on the application form: [ISO code, name, dialing code]. */
export const PHONE_COUNTRIES: ReadonlyArray<readonly [string, string, string]> = [
  ['PH', 'Philippines', '63'],
  ['US', 'United States', '1'],
  ['CA', 'Canada', '1'],
  ['GB', 'United Kingdom', '44'],
  ['JP', 'Japan', '81'],
  ['KR', 'South Korea', '82'],
  ['SG', 'Singapore', '65'],
  ['AU', 'Australia', '61'],
  ['DE', 'Germany', '49'],
  ['FR', 'France', '33'],
  ['IN', 'India', '91'],
  ['CN', 'China', '86'],
  ['ID', 'Indonesia', '62'],
  ['MY', 'Malaysia', '60'],
  ['TH', 'Thailand', '66'],
  ['VN', 'Vietnam', '84'],
  ['NZ', 'New Zealand', '64'],
  ['IE', 'Ireland', '353'],
  ['NL', 'Netherlands', '31'],
  ['ES', 'Spain', '34'],
  ['IT', 'Italy', '39'],
  ['PT', 'Portugal', '351'],
  ['CH', 'Switzerland', '41'],
  ['SE', 'Sweden', '46'],
  ['NO', 'Norway', '47'],
  ['DK', 'Denmark', '45'],
  ['FI', 'Finland', '358'],
  ['PL', 'Poland', '48'],
  ['AT', 'Austria', '43'],
  ['BE', 'Belgium', '32'],
  ['BR', 'Brazil', '55'],
  ['MX', 'Mexico', '52'],
  ['AR', 'Argentina', '54'],
  ['CL', 'Chile', '56'],
  ['CO', 'Colombia', '57'],
  ['ZA', 'South Africa', '27'],
  ['NG', 'Nigeria', '234'],
  ['KE', 'Kenya', '254'],
  ['EG', 'Egypt', '20'],
  ['AE', 'United Arab Emirates', '971'],
  ['SA', 'Saudi Arabia', '966'],
  ['IL', 'Israel', '972'],
  ['TR', 'Turkey', '90'],
  ['RU', 'Russia', '7'],
  ['UA', 'Ukraine', '380'],
  ['GR', 'Greece', '30'],
  ['CZ', 'Czech Republic', '420'],
  ['HU', 'Hungary', '36'],
  ['RO', 'Romania', '40'],
  ['HK', 'Hong Kong', '852'],
  ['TW', 'Taiwan', '886'],
  ['PK', 'Pakistan', '92'],
  ['BD', 'Bangladesh', '880'],
  ['LK', 'Sri Lanka', '94'],
  ['NP', 'Nepal', '977'],
  ['QA', 'Qatar', '974'],
  ['KW', 'Kuwait', '965'],
  ['OM', 'Oman', '968'],
  ['BH', 'Bahrain', '973'],
  ['JO', 'Jordan', '962'],
  ['LB', 'Lebanon', '961'],
  ['MA', 'Morocco', '212'],
  ['GH', 'Ghana', '233'],
];

export function dialCodeFor(iso: string): string {
  return PHONE_COUNTRIES.find(([code]) => code === iso)?.[2] ?? '63';
}

/** Flag emoji from the ISO code's regional indicator symbols. */
export function countryFlag(iso: string): string {
  return [...iso.toUpperCase()].map((c) => String.fromCodePoint(0x1f1e6 + c.charCodeAt(0) - 65)).join('');
}

/**
 * How many digits a national number has (after the dialing code, without a leading trunk 0),
 * for the countries applicants pick most. Others fall back to the international limit:
 * at most 15 digits including the dialing code (E.164).
 */
const NATIONAL_DIGITS: Readonly<Record<string, readonly [number, number]>> = {
  PH: [9, 10], US: [10, 10], CA: [10, 10], GB: [9, 10], SG: [8, 8], AU: [9, 9], NZ: [8, 10],
  JP: [9, 10], KR: [9, 10], CN: [11, 11], HK: [8, 8], TW: [9, 9], IN: [10, 10], ID: [9, 12],
  MY: [9, 10], TH: [9, 9], VN: [9, 10], AE: [9, 9], SA: [9, 9], DE: [7, 11], FR: [9, 9],
};

/** Characters a phone number may contain: digits and the usual separators. */
export const PHONE_CHARS = /[\d\s().-]/;

export function phoneDigitRange(iso: string): readonly [number, number] {
  return NATIONAL_DIGITS[iso] ?? [6, 15 - dialCodeFor(iso).length];
}

/** Drops anything that is not a digit or a separator, as the applicant types. */
export function cleanPhoneInput(raw: string): string {
  return [...raw].filter((c) => PHONE_CHARS.test(c)).join('');
}

/** Null when the number is fine (or empty: the field is optional), otherwise what to fix. */
export function phoneNumberError(iso: string, raw: string): string | null {
  const value = raw.trim();
  if (!value) return null;
  if (![...value].every((c) => PHONE_CHARS.test(c))) return 'Use numbers only. Spaces, dashes and brackets are fine.';
  // A leading trunk 0 (0917… in the Philippines) is how people write it at home; it is dropped when dialing in.
  const digits = value.replace(/\D/g, '').replace(/^0/, '');
  const [min, max] = phoneDigitRange(iso);
  if (digits.length >= min && digits.length <= max) return null;
  const name = PHONE_COUNTRIES.find(([code]) => code === iso)?.[1];
  // "the Philippines", "the United States", "the Netherlands"; plain "Singapore".
  const country = !name ? 'this country' : /^(United |Philippines$|Netherlands$|Czech Republic$)/.test(name) ? `the ${name}` : name;
  const count = min === max ? `${min} digits` : `${min} to ${max} digits`;
  return `Numbers in ${country} have ${count} after +${dialCodeFor(iso)}.`;
}

/**
 * What the phone field keeps as the applicant types: digits and separators only, and no more
 * digits than the chosen country's longest number (one more when it starts with a 0, written
 * the local way, e.g. 0917… in the Philippines). Extra digits are not accepted.
 */
export function limitPhoneInput(iso: string, raw: string): string {
  const clean = cleanPhoneInput(raw);
  const firstDigit = clean.match(/\d/)?.[0];
  const allowed = phoneDigitRange(iso)[1] + (firstDigit === '0' ? 1 : 0);
  let digits = 0;
  let out = '';
  for (const c of clean) {
    if (/\d/.test(c)) {
      if (digits >= allowed) continue;
      digits++;
    }
    out += c;
  }
  return out;
}
