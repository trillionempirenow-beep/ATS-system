export const ROLES = ['super_admin', 'admin', 'recruiter', 'hiring_manager', 'employee'] as const;
export type Role = (typeof ROLES)[number];

export const STAFF_ROLES = ['admin', 'recruiter', 'hiring_manager'] as const satisfies readonly Role[];

export const ROLE_LABELS: Record<Role, string> = {
  super_admin: 'Super Admin',
  admin: 'Admin',
  recruiter: 'HR / Recruiter',
  hiring_manager: 'Hiring Manager',
  employee: 'Employee',
};

export const PERMISSIONS = ['manage_accounts', 'job_management', 'job_posting', 'audit_trail', 'applicant_portal', 'library'] as const;
export type PermissionKey = (typeof PERMISSIONS)[number];

export interface PermissionInfo {
  label: string;
  description: string;
}

/** What a Super Admin may grant to an Admin. */
export const ADMIN_PERMISSION_CATALOG: Record<PermissionKey, PermissionInfo> = {
  manage_accounts: {
    label: 'Manage HR/Recruiter accounts',
    description: 'Create HR/Recruiter accounts up to the assigned limit, and set what those accounts can do.',
  },
  job_management: { label: 'Job management', description: 'Open Job Management, edit job records, and manage drafts.' },
  job_posting: {
    label: 'Job posting',
    description: 'Create job postings and act on the approval queue — approve, reject, or request changes.',
  },
  audit_trail: { label: 'Audit trail', description: 'Open the audit trail and review recorded system activity.' },
  applicant_portal: {
    label: 'Applicant portal management',
    description: 'Oversee applicant registrations, applications, and portal settings.',
  },
  library: {
    label: 'Library',
    description: 'Open every applicant\'s file (CV, details, notes, interview summaries and recordings) and share a view-only copy by email.',
  },
};

/**
 * What a Super Admin may grant an Admin. Creating HR/Recruiter accounts
 * (manage_accounts) is the Super Admin's alone and is never granted.
 */
export const ADMIN_GRANTABLE_PERMISSIONS = PERMISSIONS.filter((p) => p !== 'manage_accounts');

/** The subset an Admin may pass on to an HR/Recruiter. */
export const RECRUITER_PERMISSION_KEYS = ['job_management', 'job_posting', 'audit_trail', 'library'] as const satisfies readonly PermissionKey[];

export type RecruiterPermissionKey = (typeof RECRUITER_PERMISSION_KEYS)[number];
export const isRecruiterPermission = (p: PermissionKey): p is RecruiterPermissionKey => (RECRUITER_PERMISSION_KEYS as readonly PermissionKey[]).includes(p);

export const RECRUITER_PERMISSION_CATALOG: Record<RecruiterPermissionKey, PermissionInfo> = {
  job_management: { label: 'Job management', description: 'View and edit their own job records and drafts.' },
  job_posting: {
    label: 'Job posting',
    description: 'Create job posting drafts and submit them for Admin approval. Does not grant publishing.',
  },
  audit_trail: { label: 'Audit trail', description: 'Read the audit trail (their own recorded activity).' },
  library: { label: 'Library', description: 'Open applicant files in the Library and share a view-only copy by email.' },
};

export const ACCOUNT_STATUSES = ['pending', 'active', 'rejected', 'suspended', 'disabled', 'pending_reactivation'] as const;
export type AccountStatus = (typeof ACCOUNT_STATUSES)[number];

export const ACCOUNT_STATUS_LABELS: Record<AccountStatus, string> = {
  pending: 'Awaiting approval',
  active: 'Active',
  rejected: 'Rejected',
  suspended: 'Suspended',
  disabled: 'Disabled',
  pending_reactivation: 'Reactivation requested',
};

/** Sign-in messages for accounts that exist and gave the right password but may not sign in. */
export const BLOCKED_SIGN_IN_MESSAGES: Record<Exclude<AccountStatus, 'active'>, string> = {
  pending: 'This account is waiting for Super Admin approval. You will be able to sign in once it is approved.',
  rejected: 'This account was not approved. Please contact your Admin.',
  suspended: 'This account is suspended. Please contact your Admin.',
  disabled: 'This account has been disabled. Please contact your Admin.',
  pending_reactivation: 'This account is waiting for a Super Admin to approve its reactivation.',
};

/** States that occupy an HR/Recruiter seat. Rejected accounts never did any work, so they do not. */
export const SEAT_HOLDING_STATUSES: readonly AccountStatus[] = ['pending', 'active', 'suspended', 'disabled', 'pending_reactivation'];

export interface AccessSubject {
  id: number;
  role: Role;
  permissions: readonly PermissionKey[];
}

export const isSuperAdmin = (u: Pick<AccessSubject, 'role'>): boolean => u.role === 'super_admin';
export const isAdminLevel = (u: Pick<AccessSubject, 'role'>): boolean => u.role === 'admin' || u.role === 'super_admin';
export const isStaffRole = (role: Role): boolean => (STAFF_ROLES as readonly Role[]).includes(role);

export function hasPermission(u: AccessSubject, permission: PermissionKey): boolean {
  if (u.role === 'super_admin') return true;
  return u.permissions.includes(permission);
}

/** Publishing is deliberately not grantable: Admin-level plus Job posting. */
export function canPublishJobs(u: AccessSubject): boolean {
  return isAdminLevel(u) && hasPermission(u, 'job_posting');
}

/**
 * Role gates in the PHP app let a Super Admin through every require_login([...])
 * check, even though their sidebar only shows administration.
 */
export function roleAllowed(u: Pick<AccessSubject, 'role'>, roles: readonly Role[]): boolean {
  return u.role === 'super_admin' || roles.includes(u.role);
}

/** Landing page after sign in, by role. */
export function landingPathFor(role: Role): string {
  if (role === 'super_admin') return '/app/admin/admins';
  if (role === 'employee') return '/app/attendance';
  return '/app';
}

export const PASSWORD_MIN_LENGTH = 12;
export const PASSWORD_RULES_HINT = `At least ${PASSWORD_MIN_LENGTH} characters, with a letter and a number. Not a common password.`;

/** Words at the heart of the passwords people guess first ("Password2024!", "qwerty123456", "Welcome12345"). */
const COMMON_WORDS = new Set([
  'password', 'passw0rd', 'pass', 'qwerty', 'qwertyuiop', 'asdf', 'asdfgh', 'zxcvbn', 'letmein', 'welcome', 'admin', 'administrator',
  'root', 'login', 'user', 'test', 'guest', 'changeme', 'secret', 'iloveyou', 'monkey', 'dragon', 'sunshine', 'princess', 'football',
  'baseball', 'superman', 'batman', 'master', 'hello', 'freedom', 'whatever', 'abc', 'abcd', 'abcdef', 'abcdefg', 'qazwsx',
  'summer', 'winter', 'spring', 'autumn', 'january', 'december', 'company', 'recruiter', 'interview', 'strtm', 'acme', 'manila',
]);

/** True for very common passwords and their obvious variants: a word above with digits or symbols around it, or one repeated character. */
export function isCommonPassword(password: string): boolean {
  const lower = password.toLowerCase();
  if (/^(.)\1+$/.test(lower)) return true;
  const core = lower.replace(/[^a-z0-9]/g, '').replace(/^\d+/, '').replace(/\d+$/, '');
  return COMMON_WORDS.has(core) || COMMON_WORDS.has(core.replace(/(.+?)\1+$/, '$1'));
}

export function passwordProblems(password: string, confirm: string): string[] {
  const problems: string[] = [];
  if (password.length < PASSWORD_MIN_LENGTH) problems.push(`be at least ${PASSWORD_MIN_LENGTH} characters long`);
  if (!/[A-Za-z]/.test(password)) problems.push('contain at least one letter');
  if (!/\d/.test(password)) problems.push('contain at least one number');
  if (password && isCommonPassword(password)) problems.push('not be a common password');
  if (password !== confirm) problems.push('match the confirmation field');
  return problems;
}

/** The same rules for a temporary password an admin sets on a new account. Null when it is fine. */
export function temporaryPasswordProblem(password: string): string | null {
  const problems = passwordProblems(password, password);
  return problems.length ? `The temporary password must ${problems.join(', ')}.` : null;
}

export function passwordRulesSentence(problems: string[]): string {
  return `Your new password must ${problems.join(', ')}.`;
}
