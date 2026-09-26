/**
 * One-time move of the legacy PHP/MySQL ATS into the new Postgres database,
 * including resumes, photos and job PDFs from the PHP folder.
 *
 *   npm run db:import-mysql -- --mysql mysql://user:pass@host:3306/acme_ats --files /path/to/ATS-system-main [--dry-run]
 *
 * Safety rules:
 *   - The target must be migrated (npm run db:migrate) and hold no users, jobs or
 *     candidates yet. Nothing that already exists is overwritten or deleted,
 *     apart from the default reference rows the migrations insert (settings,
 *     departments, work schedules), which the legacy values replace.
 *   - All rows go in one transaction: an error leaves the target exactly as it was.
 *   - --dry-run reads and converts everything and reports, but writes nothing.
 *
 * Passwords keep working: PHP bcrypt hashes are accepted by the new sign-in.
 * Approved password reset links keep working: the token is stored as its SHA-256.
 */
import 'dotenv/config';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from 'node:util';
import mysql, { type RowDataPacket } from 'mysql2/promise';
import type postgres from 'postgres';
import { connectTarget } from './lib/target-db.js';

const { values: args } = parseArgs({
  options: {
    mysql: { type: 'string' },
    files: { type: 'string' },
    timezone: { type: 'string' },
    'dry-run': { type: 'boolean', default: false },
  },
});

if (!args.mysql) {
  console.error('Usage: npm run db:import-mysql -- --mysql mysql://user:pass@host:3306/acme_ats --files /path/to/ATS-system-main [--dry-run]');
  process.exit(1);
}
const dryRun = args['dry-run'] ?? false;
const timeZone = args.timezone ?? process.env.APP_TIMEZONE ?? 'Asia/Manila';
const filesRoot = args.files ? path.resolve(args.files) : null;

/** Tables in foreign-key order. Payroll and leave were removed from the PHP app (its migration 017) and are not carried over. */
const TABLES = [
  'users', 'user_permissions', 'account_requests', 'password_reset_requests', 'departments', 'jobs', 'job_approvals',
  'candidates', 'applications', 'candidate_documents', 'candidate_notes', 'candidate_feedback', 'candidate_role_suggestions',
  'candidate_ai_analysis', 'stage_reviews', 'offers', 'referrals', 'interviews', 'interview_signals', 'employees',
  'work_schedules', 'employee_schedules', 'holidays', 'attendance_records', 'attendance_breaks', 'attendance_corrections',
  'notifications', 'audit_logs', 'settings',
] as const;
type Table = (typeof TABLES)[number];

/** Legacy columns with no place in the new schema: live-room state, raw SDP and plaintext tokens (converted below). */
const DROPPED: Partial<Record<Table, string[]>> = {
  interviews: ['room_status', 'room_last_ping'],
  interview_signals: ['offer_sdp', 'answer_sdp', 'offer_updated_at', 'answer_updated_at'],
  candidate_documents: ['stored_name', 'upload_token'],
  password_reset_requests: ['reset_token'],
};

/** Rows the migrations insert as defaults; the legacy workspace's own values replace them. */
const REFERENCE_TABLES: Table[] = ['settings', 'departments', 'work_schedules'];

interface ColumnInfo { name: string; type: string }
type Row = Record<string, unknown>;

const report: Array<{ table: string; read: number; written: number }> = [];
const warnings = new Map<string, number>();
const warn = (message: string) => warnings.set(message, (warnings.get(message) ?? 0) + 1);

// --- files ------------------------------------------------------------------

interface PendingUpload { bucket: 'resumes' | 'photos' | 'job-documents'; objectPath: string; source: string; contentType: string }
const uploads: PendingUpload[] = [];
const CONTENT_TYPES: Record<string, string> = {
  pdf: 'application/pdf', doc: 'application/msword', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp',
};
const ext = (name: string) => path.extname(name).slice(1).toLowerCase();

async function fileExists(p: string): Promise<boolean> {
  try { await readFile(p); return true; } catch { return false; }
}

/** Finds a legacy file on disk and queues it for upload; returns the new object path, or null when it is missing. */
async function queueFile(bucket: PendingUpload['bucket'], legacyPath: string | null | undefined, candidates: string[]): Promise<string | null> {
  if (!legacyPath) return null;
  if (!filesRoot) { warn('files were not copied: pass --files with the PHP folder to bring resumes, photos and job PDFs across'); return null; }
  const base = path.basename(legacyPath);
  for (const rel of candidates) {
    const source = path.join(filesRoot, rel);
    if (await fileExists(source)) {
      const objectPath = `legacy/${path.basename(path.dirname(rel))}/${base}`;
      uploads.push({ bucket, objectPath, source, contentType: CONTENT_TYPES[ext(base)] ?? 'application/octet-stream' });
      return objectPath;
    }
  }
  warn(`file not found in the PHP folder: ${legacyPath}`);
  return null;
}

// --- conversion -------------------------------------------------------------

function convert(value: unknown, type: string): unknown {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string' && /^0000-00-00/.test(value)) return null;
  switch (type) {
    case 'boolean':
      return typeof value === 'boolean' ? value : Number(value) !== 0;
    case 'json':
    case 'jsonb':
      if (typeof value !== 'string') return value;
      try { return JSON.parse(value) as unknown; } catch { return value; }
    case 'integer':
    case 'bigint':
    case 'smallint':
      return typeof value === 'bigint' ? Number(value) : value;
    default:
      return Buffer.isBuffer(value) ? value.toString('utf8') : value;
  }
}

/** Plain values go through as they are; arrays and objects (JSON columns) are sent as JSON. */
function toParam(tx: postgres.TransactionSql, v: unknown): postgres.ParameterOrJSON<never> {
  if (v === null || v === undefined) return null;
  if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean' || v instanceof Date || Buffer.isBuffer(v)) return v;
  return tx.json(v as postgres.JSONValue);
}

const sha256 = (v: string) => createHash('sha256').update(v).digest('hex');

/** Per-table fixes on top of the column-by-column copy. */
async function transform(table: Table, row: Row): Promise<Row> {
  switch (table) {
    case 'users':
    case 'candidates': {
      if (typeof row.profile_image === 'string' && row.profile_image) {
        row.profile_image = await queueFile('photos', row.profile_image, [row.profile_image, `assets/uploads/profile-images/${path.basename(row.profile_image)}`]);
      }
      return row;
    }
    case 'jobs': {
      if (typeof row.source_pdf === 'string' && row.source_pdf) {
        row.source_pdf = await queueFile('job-documents', row.source_pdf, [row.source_pdf, `assets/uploads/job-descriptions/${path.basename(row.source_pdf)}`]);
      }
      return row;
    }
    case 'candidate_documents': {
      const stored = String(row.stored_name ?? '');
      const moved = await queueFile('resumes', stored, [`storage/resumes/${stored}`, `assets/uploads/resumes/${stored}`]);
      row.storage_path = moved ?? `legacy/resumes/${stored}`;
      return row;
    }
    case 'password_reset_requests': {
      row.reset_token_hash = typeof row.reset_token === 'string' && row.reset_token ? sha256(row.reset_token) : null;
      return row;
    }
    default:
      return row;
  }
}

// --- main -------------------------------------------------------------------

const legacy = await mysql.createConnection({ uri: args.mysql, dateStrings: true, supportBigNumbers: true, bigNumberStrings: false });
// PHP pinned the MySQL session to the app's UTC offset; read with the same offset so wall-clock times match.
const zoneName = new Intl.DateTimeFormat('en-US', { timeZone, timeZoneName: 'longOffset' }).formatToParts(new Date()).find((p) => p.type === 'timeZoneName')?.value ?? 'GMT';
const offset = zoneName === 'GMT' ? '+00:00' : zoneName.replace('GMT', '');
await legacy.query(`SET time_zone = '${offset}'`);
const { sql, host } = connectTarget({ timeZone });

async function legacyTables(): Promise<Set<string>> {
  const [rows] = await legacy.query<RowDataPacket[]>('SHOW TABLES');
  return new Set(rows.map((r) => String(Object.values(r)[0])));
}

async function targetColumns(table: string): Promise<ColumnInfo[]> {
  return sql<ColumnInfo[]>`
    select column_name as name, data_type as type from information_schema.columns
    where table_schema = 'public' and table_name = ${table} and is_generated = 'NEVER'
    order by ordinal_position`;
}

async function assertEmptyTarget(): Promise<void> {
  const [counts] = await sql<{ users: number; jobs: number; candidates: number }[]>`
    select (select count(*) from users)::int as users, (select count(*) from jobs)::int as jobs, (select count(*) from candidates)::int as candidates`;
  if (counts && (counts.users || counts.jobs || counts.candidates)) {
    throw new Error(`The target (${host}) already has data (${counts.users} users, ${counts.jobs} jobs, ${counts.candidates} candidates). The importer only runs into an empty, migrated database.`);
  }
}

async function copyTable(tx: postgres.TransactionSql, table: Table, available: Set<string>): Promise<void> {
  if (!available.has(table)) { report.push({ table, read: 0, written: 0 }); return; }
  const columns = await targetColumns(table);
  const typeOf = new Map(columns.map((c) => [c.name, c.type]));
  const dropped = new Set(DROPPED[table] ?? []);
  const [rows] = await legacy.query<RowDataPacket[]>(`SELECT * FROM \`${table}\``);
  const out: Row[] = [];
  for (const raw of rows) {
    const row = await transform(table, { ...raw });
    const mapped: Row = {};
    for (const [key, value] of Object.entries(row)) {
      const type = typeOf.get(key);
      if (type) mapped[key] = convert(value, type);
      else if (!dropped.has(key)) warn(`${table}.${key} has no column in the new schema and was not copied`);
    }
    out.push(mapped);
  }
  if (!dryRun && out.length) {
    if (REFERENCE_TABLES.includes(table)) await tx.unsafe(`delete from ${table}`);
    const keys = [...new Set(out.flatMap((r) => Object.keys(r)))];
    const normalised = out.map((r) => Object.fromEntries(keys.map((k) => [k, r[k] ?? null])));
    for (let i = 0; i < normalised.length; i += 500) {
      const batch = normalised.slice(i, i + 500).map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, toParam(tx, v)])));
      await tx`insert into ${tx(table)} ${tx(batch, keys)}`;
    }
    if (typeOf.has('id')) {
      await tx.unsafe(`select setval(pg_get_serial_sequence('${table}', 'id'), greatest(coalesce((select max(id) from ${table}), 0), 1))`);
    }
  }
  report.push({ table, read: rows.length, written: dryRun ? 0 : out.length });
}

/** Very old candidates only have candidates.resume_path. Turn those files into proper document rows. */
async function adoptLegacyResumes(tx: postgres.TransactionSql): Promise<number> {
  const rows = await tx<{ id: number; resume_path: string; created_at: Date }[]>`
    select c.id, c.resume_path, c.created_at from candidates c
    where c.resume_path is not null and c.resume_path <> ''
      and not exists (select 1 from candidate_documents d where d.candidate_id = c.id)`;
  let adopted = 0;
  for (const r of rows) {
    const extension = ext(r.resume_path);
    if (!['pdf', 'doc', 'docx'].includes(extension)) { warn(`legacy resume skipped (not PDF/DOC/DOCX): ${r.resume_path}`); continue; }
    const objectPath = await queueFile('resumes', r.resume_path, [r.resume_path, `assets/uploads/resumes/${path.basename(r.resume_path)}`]);
    if (!objectPath) continue;
    if (!dryRun) {
      await tx`insert into candidate_documents (candidate_id, storage_path, original_name, extension, mime_type, is_primary, created_at)
               values (${r.id}, ${objectPath}, ${path.basename(r.resume_path)}, ${extension}, ${CONTENT_TYPES[extension] ?? null}, true, ${r.created_at})
               on conflict (storage_path) do nothing`;
    }
    adopted++;
  }
  return adopted;
}

let committed = false;
try {
  console.log(`[import] legacy MySQL → ${host}${dryRun ? ' (dry run: nothing will be written)' : ''}`);
  console.log(`[import] legacy times are read as ${timeZone} (${offset})`);
  await assertEmptyTarget();
  const available = await legacyTables();
  let adopted = 0;
  await sql.begin(async (tx) => {
    for (const table of TABLES) {
      await copyTable(tx, table, available);
      if (table === 'candidate_documents') adopted = await adoptLegacyResumes(tx);
    }
    // Links approved in PHP but already past their expiry are closed off here rather than left dangling.
    if (!dryRun) await tx`update password_reset_requests set status = 'expired', reset_token_hash = null where status = 'approved' and token_expires_at < now()`;
  });
  committed = !dryRun;

  if (!dryRun && uploads.length) {
    // Uploads happen after the rows commit; the storage driver comes from the same env as the app (STORAGE_DRIVER).
    const { storage } = await import('../server/storage/storage.js');
    let done = 0;
    for (const u of uploads) {
      await storage.upload(u.bucket, u.objectPath, await readFile(u.source), u.contentType);
      done++;
      if (done % 50 === 0) console.log(`[import] uploaded ${done}/${uploads.length} files`);
    }
  }

  console.table(report);
  console.log(`[import] files ${dryRun ? 'found' : 'uploaded'}: ${uploads.length}${adopted ? ` (including ${adopted} legacy resume(s) turned into documents)` : ''}`);
  for (const [message, count] of warnings) console.warn(`[import] warning: ${message}${count > 1 ? ` (${count}×)` : ''}`);
  console.log(dryRun ? '[import] dry run finished. Run again without --dry-run to import.' : '[import] done. Sign in with the legacy accounts and their existing passwords.');
} catch (e) {
  console.error('[import] stopped:', e instanceof Error ? e.message : e);
  console.error(committed
    ? '[import] the database rows were imported, but copying files did not finish. Fix the storage settings and copy the remaining files from the PHP folder.'
    : '[import] nothing was written to the database.');
  process.exitCode = 1;
} finally {
  await legacy.end();
  await sql.end();
}
