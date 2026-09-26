import { z } from 'zod';
import type { NotificationCategory, NotificationPriority } from '../domain/people.js';
import { NOTIFICATION_FILTERS } from '../domain/people.js';
import type { PermissionKey, Role } from '../domain/access.js';
import { newPasswordFields } from './auth.js';

export interface NotificationDto {
  id: number;
  type: string;
  category: NotificationCategory;
  priority: NotificationPriority;
  title: string;
  body: string | null;
  link: string | null;
  actionLabel: string | null;
  actorName: string | null;
  read: boolean;
  createdAt: string;
}

export const notificationsQuerySchema = z.object({
  filter: z.enum(Object.keys(NOTIFICATION_FILTERS) as [keyof typeof NOTIFICATION_FILTERS, ...Array<keyof typeof NOTIFICATION_FILTERS>]).optional(),
  limit: z.coerce.number().int().min(1).max(150).default(150),
});

export interface NotificationsDto {
  items: NotificationDto[];
  unread: number;
}

export const markReadSchema = z.object({ ids: z.array(z.number().int().positive()).max(200).optional(), all: z.boolean().optional() });

/** Everything the shell polls every 30 seconds: bell count and sidebar badges. */
export interface ShellSummaryDto {
  unread: number;
  badges: { pendingApprovals: number; accountRequests: number; passwordResets: number };
  liveMeeting: { interviewId: number; jobTitle: string; candidateName: string } | null;
}

export interface ProfileDto {
  id: number;
  name: string;
  email: string;
  jobTitle: string | null;
  role: Role;
  roleLabel: string;
  accountStatus: string;
  avatarUrl: string | null;
  permissions: Array<{ key: PermissionKey; label: string; description: string }>;
  createdAt: string;
  passwordChangedAt: string | null;
  createdByName: string | null;
  completeness: { percent: number; missing: string[] };
}

export const profileSchema = z.object({
  name: z.string().trim().min(1, 'Your name cannot be blank.').max(120, 'That name is too long.'),
  email: z.string().trim().email('That email address is not valid.').transform((v) => v.toLowerCase()),
  jobTitle: z.string().trim().max(120).default(''),
  photoUploadId: z.string().uuid().nullable().optional(),
  removePhoto: z.boolean().optional(),
});
export type ProfileInput = z.input<typeof profileSchema>;

export const changePasswordSchema = z.object({
  current: z.string().min(1, 'Enter your current password.'),
  ...newPasswordFields,
});
export type ChangePasswordInput = z.input<typeof changePasswordSchema>;
