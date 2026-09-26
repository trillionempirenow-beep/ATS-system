import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { env } from '../config/env.js';
import { hmac, safeEqual } from '../lib/crypto.js';

export const BUCKETS = { resumes: 'resumes', photos: 'photos', jobDocuments: 'job-documents' } as const;
export type Bucket = (typeof BUCKETS)[keyof typeof BUCKETS];

export interface SignedUpload {
  url: string;
  method: 'PUT';
  headers: Record<string, string>;
}

export interface StorageDriver {
  signedUpload(bucket: Bucket, objectPath: string, contentType: string): Promise<SignedUpload>;
  download(bucket: Bucket, objectPath: string): Promise<Buffer | null>;
  upload(bucket: Bucket, objectPath: string, data: Buffer, contentType: string): Promise<void>;
  move(bucket: Bucket, from: string, to: string): Promise<void>;
  remove(bucket: Bucket, objectPaths: string[]): Promise<void>;
  signedUrl(bucket: Bucket, objectPath: string, opts: { expiresIn: number; downloadName?: string }): Promise<string>;
}

let supabase: SupabaseClient | null = null;
const client = () =>
  (supabase ??= createClient(env.SUPABASE_URL ?? '', env.SUPABASE_SERVICE_ROLE_KEY ?? '', {
    auth: { persistSession: false, autoRefreshToken: false },
  }));

const supabaseDriver: StorageDriver = {
  async signedUpload(bucket, objectPath, contentType) {
    const { data, error } = await client().storage.from(bucket).createSignedUploadUrl(objectPath);
    if (error || !data) throw new Error(`Storage: could not sign upload (${error?.message})`);
    return { url: data.signedUrl, method: 'PUT', headers: { 'Content-Type': contentType, 'x-upsert': 'false' } };
  },
  async download(bucket, objectPath) {
    const { data, error } = await client().storage.from(bucket).download(objectPath);
    if (error || !data) return null;
    return Buffer.from(await data.arrayBuffer());
  },
  async upload(bucket, objectPath, data, contentType) {
    const { error } = await client().storage.from(bucket).upload(objectPath, data, { contentType, upsert: true });
    if (error) throw new Error(`Storage: upload failed (${error.message})`);
  },
  async move(bucket, from, to) {
    const { error } = await client().storage.from(bucket).move(from, to);
    if (error) throw new Error(`Storage: move failed (${error.message})`);
  },
  async remove(bucket, objectPaths) {
    if (objectPaths.length) await client().storage.from(bucket).remove(objectPaths);
  },
  async signedUrl(bucket, objectPath, opts) {
    const { data, error } = await client().storage.from(bucket)
      .createSignedUrl(objectPath, opts.expiresIn, opts.downloadName ? { download: opts.downloadName } : undefined);
    if (error || !data) throw new Error(`Storage: could not sign URL (${error?.message})`);
    return data.signedUrl;
  },
};

// ---------------------------------------------------------------------------
// Development-only driver: files under LOCAL_STORAGE_DIR, URLs signed with the
// session secret and served by /api/v1/uploads/local (see uploads.routes.ts).
// env.ts refuses to start with this driver in production.
// ---------------------------------------------------------------------------
const root = () => path.resolve(env.LOCAL_STORAGE_DIR);
function localPath(bucket: Bucket, objectPath: string): string {
  const full = path.resolve(root(), bucket, objectPath);
  if (!full.startsWith(path.resolve(root(), bucket) + path.sep)) throw new Error('Storage: invalid path');
  return full;
}

export interface LocalGrant { b: Bucket; p: string; m: 'put' | 'get'; e: number; n?: string }
export function signLocalGrant(g: LocalGrant): string {
  const payload = Buffer.from(JSON.stringify(g)).toString('base64url');
  return `${payload}.${hmac(`local-storage:${payload}`)}`;
}
export function verifyLocalGrant(token: string, mode: 'put' | 'get'): LocalGrant | null {
  const [payload, sig] = token.split('.');
  if (!payload || !sig || !safeEqual(sig, hmac(`local-storage:${payload}`))) return null;
  const g = JSON.parse(Buffer.from(payload, 'base64url').toString()) as LocalGrant;
  return g.m === mode && g.e > Date.now() ? g : null;
}

const apiBase = () => `${env.APP_URL.replace(/\/$/, '')}/api/v1/uploads/local`;

const localDriver: StorageDriver = {
  async signedUpload(bucket, objectPath, contentType) {
    const t = signLocalGrant({ b: bucket, p: objectPath, m: 'put', e: Date.now() + 3_600_000 });
    return { url: `${apiBase()}/${t}`, method: 'PUT', headers: { 'Content-Type': contentType } };
  },
  async download(bucket, objectPath) {
    try { return await readFile(localPath(bucket, objectPath)); } catch { return null; }
  },
  async upload(bucket, objectPath, data) {
    const full = localPath(bucket, objectPath);
    await mkdir(path.dirname(full), { recursive: true });
    await writeFile(full, data);
  },
  async move(bucket, from, to) {
    const dest = localPath(bucket, to);
    await mkdir(path.dirname(dest), { recursive: true });
    await rename(localPath(bucket, from), dest);
  },
  async remove(bucket, objectPaths) {
    for (const p of objectPaths) await rm(localPath(bucket, p), { force: true });
  },
  async signedUrl(bucket, objectPath, opts) {
    const t = signLocalGrant({ b: bucket, p: objectPath, m: 'get', e: Date.now() + opts.expiresIn * 1000, n: opts.downloadName });
    return `${apiBase()}/${t}`;
  },
};

export const storage: StorageDriver = env.STORAGE_DRIVER === 'local' ? localDriver : supabaseDriver;
export const localStorageFile = (bucket: Bucket, objectPath: string) => localPath(bucket, objectPath);
