import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import bcrypt from 'bcryptjs';
import { env } from '../config/env.js';

export const randomToken = (bytes = 32): string => randomBytes(bytes).toString('base64url');
export const randomHex = (bytes: number): string => randomBytes(bytes).toString('hex');
export const sha256 = (value: string): string => createHash('sha256').update(value).digest('hex');

export function hmac(value: string, secret = env.SESSION_SECRET): string {
  return createHmac('sha256', secret).update(value).digest('base64url');
}

export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

/** PHP's password_hash() writes $2y$; bcryptjs reads the identical algorithm as $2a$/$2b$. */
export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  const normalized = hash.startsWith('$2y$') ? `$2b$${hash.slice(4)}` : hash;
  try {
    return await bcrypt.compare(password, normalized);
  } catch {
    return false;
  }
}

export const hashPassword = (password: string): Promise<string> => bcrypt.hash(password, 12);

/** Room codes like "ACM4F7K2": readable, no 0/O or 1/I confusion. */
export function roomCode(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = randomBytes(5);
  let out = 'ACM';
  for (const b of bytes) out += alphabet[b % alphabet.length];
  return out;
}
