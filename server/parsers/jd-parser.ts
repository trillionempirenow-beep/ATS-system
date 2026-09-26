import type { EmploymentType } from '../../shared/domain/jobs.js';

/** Port of includes/pdf_extract.php's jd_* functions: raw job-description text → posting fields. */
export interface ParsedJobFields {
  title: string;
  department: string;
  location: string;
  employment_type: EmploymentType | '';
  salary: string;
  description: string;
  responsibilities: string;
  qualifications: string;
  skills: string;
  preferred_skills: string;
  experience: string;
  education: string;
  benefits: string;
}

type SectionField = 'description' | 'responsibilities' | 'qualifications' | 'skills' | 'preferred_skills' | 'experience' | 'education' | 'benefits';
type LabelField = 'title' | 'department' | 'location' | 'employment_type' | 'salary' | 'experience' | 'education';

const SECTIONS: Record<SectionField, string[]> = {
  description: ['job description', 'job summary', 'position summary', 'role summary', 'about the role', 'about this role', 'overview', 'job overview', 'summary', 'purpose of the role'],
  responsibilities: ['responsibilities', 'key responsibilities', 'main responsibilities', 'duties', 'duties and responsibilities', 'what you will do', "what you'll do", 'role responsibilities', 'essential functions', 'key duties'],
  qualifications: ['qualifications', 'requirements', 'minimum qualifications', 'basic qualifications', 'job requirements', 'who you are', 'what we are looking for', "what we're looking for", 'candidate profile'],
  skills: ['required skills', 'skills', 'technical skills', 'key skills', 'must have', 'must-have', 'core competencies', 'competencies'],
  preferred_skills: ['preferred skills', 'preferred qualifications', 'nice to have', 'nice-to-have', 'bonus points', 'desirable', 'good to have', 'plus'],
  experience: ['experience', 'work experience', 'experience required', 'years of experience', 'professional experience'],
  education: ['education', 'educational requirements', 'education requirements', 'academic requirements'],
  benefits: ['benefits', 'what we offer', 'perks', 'compensation and benefits'],
};

const LABELS: Record<LabelField, string[]> = {
  title: ['job title', 'position title', 'position', 'role', 'title', 'job position', 'vacancy'],
  department: ['department', 'dept', 'business unit', 'team', 'division', 'function'],
  location: ['location', 'work location', 'job location', 'place of work', 'based in', 'office'],
  employment_type: ['employment type', 'job type', 'employment status', 'work type', 'contract type', 'type'],
  salary: ['salary', 'salary range', 'compensation', 'pay range', 'rate', 'budget', 'salary package'],
  experience: ['experience', 'experience required', 'years of experience', 'minimum experience'],
  education: ['education', 'educational attainment', 'education level'],
};

const normaliseHeading = (line: string) =>
  line.toLowerCase().trim().replace(/^[\s\p{P}\p{S}]+|[\s\p{P}\p{S}]+$/gu, '').replace(/\s+/g, ' ');

function headingField(line: string): SectionField | null {
  const t = line.trim();
  if (!t || t.length > 60) return null;
  const key = normaliseHeading(t);
  if (!key) return null;
  for (const [field, synonyms] of Object.entries(SECTIONS) as Array<[SectionField, string[]]>) {
    if (synonyms.includes(key)) return field;
  }
  return null;
}

export function employmentTypeFrom(raw: string): EmploymentType | null {
  const v = raw.toLowerCase();
  if (/intern/.test(v)) return 'internship';
  if (/part[\s-]?time/.test(v)) return 'part_time';
  if (/contract|contractual|freelance|consultant|temporary|project[\s-]based/.test(v)) return 'contract';
  if (/full[\s-]?time|permanent|regular/.test(v)) return 'full_time';
  return null;
}

export function parseJobDescription(text: string): ParsedJobFields {
  const out: ParsedJobFields = {
    title: '', department: '', location: '', employment_type: '', salary: '', description: '', responsibilities: '',
    qualifications: '', skills: '', preferred_skills: '', experience: '', education: '', benefits: '',
  };
  const lines = text.split(/\r?\n/).map((l) => l.trim());
  const sections: Partial<Record<SectionField, string[]>> = {};
  let current: SectionField | null = null;
  let firstMeaningful: string | null = null;

  for (const line of lines) {
    if (line === '') { if (current) sections[current]!.push(''); continue; }
    const heading = headingField(line);
    if (heading) { current = heading; sections[current] ??= []; continue; }

    const m = /^\s*([A-Za-z][A-Za-z/ &'-]{1,34}?)\s*[:\u2013\u2014-]\s*(.+)$/u.exec(line);
    if (m) {
      const key = normaliseHeading(m[1]!);
      const value = m[2]!.trim();
      let matched = false;
      for (const [field, synonyms] of Object.entries(LABELS) as Array<[LabelField, string[]]>) {
        if (synonyms.includes(key) && value !== '' && out[field] === '') {
          (out as unknown as Record<string, string>)[field] = value;
          matched = true;
          break;
        }
      }
      if (matched) continue;
      const inline = headingField(m[1]!);
      if (inline) {
        current = inline;
        sections[current] ??= [];
        if (value) sections[current]!.push(value);
        continue;
      }
    }
    if (current) { sections[current]!.push(line); continue; }
    if (firstMeaningful === null && line.length <= 90) firstMeaningful = line;
  }

  for (const [name, body] of Object.entries(sections) as Array<[SectionField, string[]]>) {
    let joined = body.join('\n').replace(/\n{3,}/g, '\n\n').trim();
    joined = joined.replace(/^[\s]*[\u2022\u25CF\u25AA\u00B7\u2023\u2043o*\-\u2013\u2014]\s+/gmu, '');
    if (out[name] === '') out[name] = joined.trim();
  }

  if (!out.title && firstMeaningful) {
    const candidate = firstMeaningful.replace(/^[\s:\-–—]+|[\s:\-–—]+$/g, '');
    if (!/\b(corporation|corp|inc|incorporated|company|ltd|llc|gmbh|pte|holdings)\b/i.test(candidate)) out.title = candidate;
  }

  out.employment_type = (out.employment_type && employmentTypeFrom(out.employment_type)) || employmentTypeFrom(text) || '';

  if (!out.salary) {
    const s = /(?:salary|compensation|pay)[^\n]{0,20}?((?:php|usd|₱|\$|€|£)\s?[\d,.]+\s*(?:[-–—to]+\s*(?:php|usd|₱|\$|€|£)?\s?[\d,.]+)?[^\n]{0,24})/iu.exec(text);
    if (s?.[1]) out.salary = s[1].trim();
  }

  if (!out.description) {
    const lead: string[] = [];
    for (const line of lines) {
      if (line === '') { if (lead.length) break; continue; }
      if (headingField(line)) break;
      if (line === out.title) continue;
      if (/^\s*[A-Za-z][A-Za-z/ &'-]{1,34}?\s*:/u.test(line)) continue;
      lead.push(line);
      if (lead.length >= 8) break;
    }
    out.description = lead.join('\n').trim();
  }
  return out;
}

export function skillsToTags(skills: string): string {
  const parts = skills.split(/[,\n;/]+/u).map((p) => p.replace(/^[\s.\-–—•]+|[\s.\-–—•]+$/gu, '')).filter((p) => p && p.length <= 28);
  return [...new Set(parts)].slice(0, 6).join(', ');
}
