import { EMPLOYMENT_TYPES, type EmploymentType } from '../../shared/domain/jobs.js';
import { env } from '../config/env.js';
import { describeError } from './resume-ai.js';
import type { ParsedJobFields } from './jd-parser.js';

/**
 * Reads a job description of any layout through the "Read the job description"
 * flow of the ATS-system n8n workflow (POST { text, departments } with the
 * shared secret, answer { fields }). Null when the flow is not configured; the
 * caller then uses the rule-based parser. The posting still goes through the
 * normal submit and approval steps: this only fills in the form.
 */
const TIMEOUT_MS = 40_000;

export type AiJobResult = { fields: ParsedJobFields; error?: undefined } | { fields: null; error: string };

export const jdAiEnabled = (): boolean => Boolean(env.JD_N8N_WEBHOOK_URL);

const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '');
/** Lists arrive as arrays (or, from a loose model answer, as one string); the form wants one item per line. */
const lines = (v: unknown): string => {
  const items = Array.isArray(v) ? v : typeof v === 'string' ? v.split(/\r?\n/) : [];
  return items
    // Strip bullets and list numbering ("1)", "2.", "(3)"), never the text itself: "3+ years", "24/7".
    .map((i) => str(i).replace(/^(?:[•●▪·*\-–—]+\s*|\(?\d{1,2}[.)]\s+)/u, '').trim())
    .filter(Boolean)
    .join('\n');
};

export async function parseJobWithAi(text: string, departments: string[]): Promise<AiJobResult | null> {
  if (!env.JD_N8N_WEBHOOK_URL || text.trim().length < 20) return null;
  const secret = env.CV_N8N_SECRET ?? env.EMAIL_N8N_SECRET;
  const started = Date.now();
  try {
    const res = await fetch(env.JD_N8N_WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(secret ? { 'X-ATS-Secret': secret } : {}) },
      body: JSON.stringify({ text: text.slice(0, 60_000), departments }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const raw = await res.text();
    if (!res.ok) {
      const e = new Error(raw || res.statusText) as Error & { status: number };
      e.status = res.status;
      throw e;
    }
    let body: unknown;
    try { body = JSON.parse(raw); } catch { throw new Error('the workflow did not answer with JSON'); }
    const o = ((body as { fields?: unknown })?.fields ?? body) as Record<string, unknown> | null;
    if (!o || typeof o !== 'object') throw new Error('the workflow\'s answer did not contain fields');

    const type = str(o.employment_type).toLowerCase().replace(/[\s-]+/g, '_');
    const benefits = lines(o.benefits);
    const description = [str(o.description), benefits ? `Benefits:\n${benefits}` : ''].filter(Boolean).join('\n\n');
    const fields: ParsedJobFields = {
      title: str(o.title).slice(0, 180),
      department: str(o.department),
      location: str(o.location).slice(0, 160),
      employment_type: (EMPLOYMENT_TYPES as readonly string[]).includes(type) ? (type as EmploymentType) : '',
      salary: str(o.salary).slice(0, 255),
      description,
      responsibilities: lines(o.responsibilities),
      qualifications: lines(o.qualifications),
      skills: lines(o.required_skills ?? o.skills),
      preferred_skills: lines(o.preferred_skills),
      experience: str(o.experience).slice(0, 255),
      education: str(o.education).slice(0, 255),
      benefits,
    };
    if (!fields.title && !fields.description && !fields.responsibilities) throw new Error('the workflow found nothing to fill in');
    console.info(`[jd-ai] n8n read the job description in ${Date.now() - started}ms`);
    return { fields };
  } catch (e) {
    const error = `n8n: ${describeError(e)}`;
    console.warn(`[jd-ai] ${error} (after ${Date.now() - started}ms); using the rule-based parser`);
    return { fields: null, error };
  }
}
