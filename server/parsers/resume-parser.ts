import type { ExperienceLevel } from '../../shared/domain/pipeline.js';

/** Suggested values for the Add candidate form. The recruiter confirms every one. */
export interface ParsedResumeFields {
  full_name?: string;
  email?: string;
  phone?: string;
  current_title?: string;
  experience_level?: ExperienceLevel;
  skills?: string;
  education?: string;
}

const ACRONYMS = /^(it|hr|qa|ux|ui|ai|bpo|crm|sap|seo|pm|va)$/u;
const SMALL_WORDS = new Set(['a', 'an', 'and', 'of', 'the', 'for', 'to', 'in', 'at', 'on', 'or']);

/** ALL-CAPS CV headings are title-cased; mixed case is left as written. */
export function tidyCase(value: string): string {
  const v = value.replace(/\s+/gu, ' ').trim();
  if (v === '' || v !== v.toUpperCase()) return v;
  return v
    .toLowerCase()
    .split(' ')
    .map((w, i) => {
      const bare = w.replace(/[^\p{L}]/gu, '');
      if (bare.length <= 3 && ACRONYMS.test(bare)) return w.toUpperCase();
      if (i > 0 && SMALL_WORDS.has(bare)) return w;
      return w.charAt(0).toUpperCase() + w.slice(1);
    })
    .join(' ');
}

const VOCABULARY = ['php', 'laravel', 'symfony', 'javascript', 'typescript', 'react', 'vue', 'angular', 'node.js', 'node',
  'python', 'django', 'flask', 'java', 'spring', 'kotlin', 'swift', 'objective-c', 'c#', '.net', 'go', 'golang', 'rust',
  'ruby', 'rails', 'html', 'css', 'sass', 'tailwind', 'bootstrap', 'mysql', 'postgresql', 'mongodb', 'redis', 'sqlite',
  'graphql', 'rest', 'api', 'docker', 'kubernetes', 'aws', 'azure', 'gcp', 'terraform', 'jenkins', 'git', 'github',
  'gitlab', 'ci/cd', 'linux', 'figma', 'photoshop', 'illustrator', 'excel', 'power bi', 'tableau', 'sql', 'nosql',
  'agile', 'scrum', 'kanban', 'jira', 'salesforce', 'sap', 'seo', 'copywriting', 'recruitment', 'onboarding', 'payroll'];

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Port of parse-cv.php's heuristics, rule for rule. */
export function parseResumeText(text: string): ParsedResumeFields {
  const fields: ParsedResumeFields = {};

  const email = /[\w.+-]+@[\w-]+\.[\w.-]{2,}/u.exec(text)?.[0];
  if (email) {
    const e = email.replace(/\.$/, '').toLowerCase();
    if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) fields.email = e;
  }

  // The first run of 7 to 15 digits that is not a year or a year range ("2008-2012", "2019 - 2021").
  // The part after an area code may be as short as 7 digits: "(0917) 8772327".
  for (const m of text.matchAll(/(?:\+?\d{1,3}[\s.-]?)?(?:\(\d{1,4}\)[\s.-]?)?\d[\d\s.-]{4,}\d/gu)) {
    const candidate = m[0].trim();
    if (/^(?:19|20)\d{2}(?:\s*[-–.]\s*(?:(?:19|20)\d{2}|\d{2}))?$/u.test(candidate)) continue;
    const digits = candidate.replace(/\D/g, '');
    if (digits.length < 7 || digits.length > 15) continue;
    fields.phone = candidate;
    break;
  }

  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);

  let nameLineIndex = -1;
  for (const [i, line] of lines.slice(0, 8).entries()) {
    if (line.length > 48 || line.length < 4) continue;
    if (/[@\d]|https?:|www\./u.test(line)) continue;
    if (/^(curriculum vitae|resume|r[ée]sum[ée]|profile|contact|personal details|about me|work experience|education(al background)?|skills|software|software\s*\/\s*tools|references)$/iu.test(line)) continue;
    const words = line.split(/\s+/u);
    if (words.length < 2 || words.length > 4) continue;
    if (!/^\p{Lu}[\p{L}'’.-]*(\s+\p{Lu}[\p{L}'’.-]*){1,3}$/u.test(line)) continue;
    fields.full_name = tidyCase(line);
    nameLineIndex = i;
    break;
  }

  const found: string[] = [];
  const haystack = ` ${text.toLowerCase()} `;
  for (const skill of VOCABULARY) {
    if (new RegExp(`(?<![\\w.+#-])${escapeRe(skill)}(?![\\w+#-])`, 'u').test(haystack)) found.push(skill);
  }
  const skillsBlock =
    /^\s*(?:technical\s+)?skills?\s*:?\s*$([\s\S]{0,400}?)^\s*(?:[A-Z][A-Za-z ]{2,30}:?\s*)$/mu.exec(text) ??
    /^\s*(?:technical\s+)?skills?\s*:\s*(.{0,300})$/imu.exec(text);
  if (skillsBlock?.[1]) {
    for (const chunk of skillsBlock[1].split(/[,;|\n•·]+/u)) {
      const c = chunk.replace(/^[\s.\-–—•·]+|[\s.\-–—•·]+$/gu, '');
      if (c && c.length <= 28 && !/\d{4}/.test(c)) found.push(c.toLowerCase());
    }
  }
  const unique = [...new Set(found.filter(Boolean))];
  if (unique.length) fields.skills = unique.slice(0, 14).join(', ');

  const eduAfterHeading = /^\s*education.*$\r?\n+(.{0,180}?)$/imu.exec(text)?.[1];
  if (eduAfterHeading) {
    const edu = eduAfterHeading.replace(/\s+/gu, ' ').trim();
    if (edu.length > 5) fields.education = edu.slice(0, 200);
  }
  if (!fields.education) {
    const degree = /((?:bachelor|master|b\.?sc|m\.?sc|b\.?a\b|m\.?a\b|mba|ph\.?d|diploma|degree)[^\n,]{0,90})/iu.exec(text)?.[1];
    if (degree) fields.education = degree.replace(/\s+/gu, ' ').trim();
  }

  // The largest stated figure wins; "over", "more than" or "+" nudge it up one.
  let best = 0;
  for (const m of text.matchAll(/(over|more than|about|approx\.?|nearly)?\s*(\d{1,2})\s*(\+)?\s*(?:years?|yrs?)\b/giu)) {
    let n = Number(m[2]);
    if (n > 40) continue;
    if (m[1] || m[3]) n++;
    best = Math.max(best, n);
  }
  if (best > 0) fields.experience_level = best <= 2 ? 'entry' : best <= 5 ? 'mid' : best <= 9 ? 'senior' : 'lead';

  const labelled = /^\s*(?:current\s+)?(?:role|position|title)\s*:\s*(.{3,80})$/imu.exec(text)?.[1];
  if (labelled) {
    fields.current_title = tidyCase(labelled);
  } else if (nameLineIndex >= 0) {
    const next = lines[nameLineIndex + 1];
    if (next && next.length >= 4 && next.length <= 60 && !/[@\d]|https?:/u.test(next)) fields.current_title = tidyCase(next);
  }

  return fields;
}
