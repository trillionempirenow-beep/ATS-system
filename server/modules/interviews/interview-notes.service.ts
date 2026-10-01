import type { AiNoteDto, AiSummary } from '../../../shared/api/interviews.js';
import { env } from '../../config/env.js';
import { sql } from '../../db/client.js';
import { AppError, conflict, forbidden } from '../../http/errors.js';
import { inBackground } from '../matching/matching.service.js';
import * as repo from './interviews.repository.js';

/**
 * AI notes in the interview room, through the "Interview notes" flow of the
 * ATS-system n8n workflow (speech-to-text and Gemini on n8n's gateway credits).
 *
 * The interviewer's browser records the meeting's sound in pieces of about 30
 * seconds. Each piece is transcribed (Tagalog, English or Taglish) and turned
 * into short English notes; when the meeting ends, the whole transcript becomes
 * a summary for the review. Only the interviewer sees the live notes.
 */

const CHUNK_TIMEOUT_MS = 45_000;
const SUMMARY_TIMEOUT_MS = 55_000;

function notesUrl(): string | null {
  if (env.NOTES_N8N_WEBHOOK_URL) return env.NOTES_N8N_WEBHOOK_URL;
  if (!env.CV_N8N_WEBHOOK_URL) return null;
  try { return new URL('/webhook/ats-interview-notes', env.CV_N8N_WEBHOOK_URL).toString(); } catch { return null; }
}
export const notesConfigured = () => Boolean(notesUrl());

async function callNotes(body: object, timeoutMs: number): Promise<Record<string, unknown>> {
  const url = notesUrl();
  if (!url) throw new AppError(503, 'service_unavailable', 'AI notes are not connected yet. See SETUP.md, "Interview AI notes".');
  const secret = env.CV_N8N_SECRET ?? env.EMAIL_N8N_SECRET;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(secret ? { 'X-ATS-Secret': secret } : {}) },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const raw = await res.text();
  if (!res.ok) throw new Error(`n8n HTTP ${res.status}: ${raw.slice(0, 200)}`);
  const parsed = JSON.parse(raw) as { output?: Record<string, unknown> } & Record<string, unknown>;
  return parsed.output ?? parsed;
}

const str = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const strs = (v: unknown, n: number, max = 240) => (Array.isArray(v) ? v.map((x) => str(x, max)).filter(Boolean).slice(0, n) : []);

async function interviewerRow(id: number, userId: number) {
  const row = await repo.byId(id);
  if (!row) throw new AppError(404, 'not_found', 'Could not find that meeting.');
  if (row.interviewer_id !== userId) throw forbidden('Only the interviewer uses AI notes in this meeting.');
  return row;
}

export async function notesFor(interviewId: number): Promise<AiNoteDto[]> {
  const rows = await repo.assistantNotesFor(interviewId);
  return rows.map((n) => ({ atSecond: n.at_second, topic: n.topic, text: n.text }));
}

/** The interviewer turns AI notes on or off; everyone in the room is shown that it is on. */
export async function setEnabled(id: number, enabled: boolean, userId: number): Promise<{ enabled: boolean }> {
  const row = await interviewerRow(id, userId);
  if (enabled && !notesConfigured()) throw new AppError(503, 'service_unavailable', 'AI notes are not connected yet. See SETUP.md, "Interview AI notes".');
  if (enabled && row.meeting_state !== 'in_progress' && row.meeting_state !== 'ready' && row.meeting_state !== 'scheduled') {
    throw conflict('This meeting has ended.');
  }
  await sql`update interviews set assistant_enabled = ${enabled} where id = ${id}`;
  return { enabled };
}

/** One piece of the meeting: transcribe it, keep the words, add any new notes. */
export async function addChunk(id: number, input: { audio: string; audioMime: string; atSecond: number }, userId: number): Promise<{ notes: AiNoteDto[] }> {
  const row = await interviewerRow(id, userId);
  if (!row.assistant_enabled) throw conflict('AI notes are off for this meeting.');
  const [tail, recent] = await Promise.all([
    sql<{ text: string }[]>`select text from interview_transcripts where interview_id = ${id} order by at_second desc limit 4`,
    sql<{ text: string }[]>`select text from assistant_notes where interview_id = ${id} order by at_second desc limit 10`,
  ]);
  const out = await callNotes({
    mode: 'chunk',
    audio: input.audio,
    audioMime: input.audioMime,
    job: row.job_title,
    candidate: row.first_name,
    // Context, so the AI follows the conversation and does not repeat itself.
    before: tail.map((t) => t.text).reverse().join(' ').slice(-1500),
    noted: recent.map((n) => n.text).reverse(),
  }, CHUNK_TIMEOUT_MS);
  // Speech-to-text "hears" a word or two ("You", "Thank you") in silence: keep real speech only.
  const heard = str(out.transcript, 6000);
  const transcript = heard.split(/\s+/).filter(Boolean).length >= 3 ? heard : '';
  const notes = (Array.isArray(out.notes) ? out.notes : []).map((n) => {
    const r = n as Record<string, unknown>;
    return { topic: str(r.topic, 40) || null, text: str(r.text, 400) };
  }).filter((n) => n.text).slice(0, 4);
  if (transcript) await sql`insert into interview_transcripts (interview_id, at_second, text) values (${id}, ${input.atSecond}, ${transcript})`;
  for (const n of notes) {
    await sql`insert into assistant_notes (interview_id, at_second, topic, text) values (${id}, ${input.atSecond}, ${n.topic}, ${n.text})`;
  }
  return { notes: notes.map((n) => ({ atSecond: input.atSecond, ...n })) };
}

/** When the meeting ends: one summary from the whole transcript, for the review. */
export function summariseAfterMeeting(id: number): void {
  if (!notesConfigured()) return;
  inBackground(`interview ${id} summary`, async () => {
    const lines = await sql<{ at_second: number; text: string }[]>`
      select at_second, text from interview_transcripts where interview_id = ${id} order by at_second`;
    if (!lines.length) return;
    const row = await repo.byId(id);
    if (!row) return;
    const out = await callNotes({
      mode: 'summary', job: row.job_title, candidate: row.first_name,
      transcript: lines.map((l) => `[${Math.floor(l.at_second / 60)}:${String(l.at_second % 60).padStart(2, '0')}] ${l.text}`).join('\n').slice(-60_000),
    }, SUMMARY_TIMEOUT_MS);
    const summary: AiSummary = {
      summary: str(out.summary, 1500),
      keyAnswers: (Array.isArray(out.key_answers) ? out.key_answers : []).map((k) => {
        const r = k as Record<string, unknown>;
        return { label: str(r.label, 60), value: str(r.value, 300) };
      }).filter((k) => k.label && k.value).slice(0, 10),
      strengths: strs(out.strengths, 6),
      concerns: strs(out.concerns, 6),
      followUps: strs(out.follow_ups, 6),
    };
    if (!summary.summary) throw new Error(`no summary in the answer: ${JSON.stringify(out).slice(0, 200)}`);
    await sql`update interviews set ai_summary = ${sql.json(summary as unknown as Parameters<typeof sql.json>[0])}, ai_summary_at = now() where id = ${id}`;
  });
}

