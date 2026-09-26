import { z } from 'zod';
import type { AccountStatus, PermissionKey, Role } from '../domain/access.js';

export const loginSchema = z.object({
  email: z.string().trim().min(1, 'Please enter your email address.').email('That does not look like a valid email address.').transform((v) => v.toLowerCase()),
  password: z.string().min(1, 'Please enter your password.'),
  remember: z.boolean().optional().default(false),
});
export type LoginInput = z.input<typeof loginSchema>;

export const forgotPasswordSchema = z.object({
  email: z.string().trim().email('Please enter a valid email address.').transform((v) => v.toLowerCase()),
  reason: z.string().trim().max(500, 'Keep the reason under 500 characters.').optional().default(''),
});
export type ForgotPasswordInput = z.input<typeof forgotPasswordSchema>;

export const newPasswordFields = {
  password: z.string().min(1, 'Enter a new password.'),
  confirm: z.string().min(1, 'Confirm the new password.'),
};

export const resetPasswordSchema = z.object({
  token: z.string().regex(/^[a-f0-9]{64}$/i, 'This link is not valid.'),
  ...newPasswordFields,
});
export type ResetPasswordInput = z.input<typeof resetPasswordSchema>;

export interface MeDto {
  id: number;
  name: string;
  email: string;
  role: Role;
  roleLabel: string;
  accountStatus: AccountStatus;
  permissions: PermissionKey[];
  jobTitle: string | null;
  avatarUrl: string | null;
  csrfToken: string;
  landingPath: string;
  realtime: { driver: 'supabase' | 'local'; userChannel: string };
}

export interface ResetTokenCheckDto {
  valid: boolean;
  name?: string;
  email?: string;
}
