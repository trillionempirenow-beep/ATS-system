import type { IconName } from '@/components/icon/Icon';
import type { MeDto } from '@shared/api/auth';
import { canPublishJobs, hasPermission, isAdminLevel } from '@shared/domain/access';

export interface NavItem {
  to: string;
  label: string;
  icon: IconName;
  /** Extra paths that should light this item up. */
  match?: string[];
  end?: boolean;
  badge?: 'approvals' | 'accounts' | 'resets';
}

export interface NavGroup {
  key: string;
  label: string;
  icon?: IconName;
  collapsible: boolean;
  items: NavItem[];
}

/** The sidebar per role (App shell → Sidebar · one per role), filtered by permissions. */
export function navFor(user: MeDto): NavGroup[] {
  const subject = { id: user.id, role: user.role, permissions: user.permissions };
  const perm = (p: Parameters<typeof hasPermission>[1]) => hasPermission(subject, p);
  const admin = isAdminLevel(subject);

  if (user.role === 'super_admin') {
    return [{
      key: 'administration', label: 'Administration', icon: 'settings', collapsible: true, items: [
        { to: '/app/admin/users', label: 'HR / Recruiters', icon: 'candidates', badge: 'accounts' },
        { to: '/app/admin/password-resets', label: 'Password resets', icon: 'key', badge: 'resets' },
        { to: '/app/admin/applicant-portal', label: 'Applicant portal', icon: 'public' },
        { to: '/app/admin/audit', label: 'Audit trail', icon: 'layers' },
        { to: '/app/admin/admins', label: 'Admins', icon: 'users' },
        { to: '/app/admin/settings', label: 'Settings', icon: 'settings' },
      ],
    }];
  }

  if (user.role === 'employee') {
    return [{ key: 'work', label: 'My work', collapsible: false, items: [{ to: '/app/attendance', label: 'Attendance', icon: 'attendance' }] }];
  }

  const groups: NavGroup[] = [{
    key: 'recruiting', label: 'Recruiting', collapsible: false, items: [
      { to: '/app', label: 'Overview', icon: 'overview', end: true },
      { to: '/app/pipeline', label: 'Hiring pipeline', icon: 'pipeline' },
      { to: '/app/candidates', label: 'Candidates', icon: 'candidates', end: true, match: ['/app/candidates/'] },
      { to: '/app/candidates/new', label: 'Add candidate', icon: 'plus', end: true },
      { to: '/app/interviews', label: 'Interviews', icon: 'interviews' },
      { to: '/app/analytics', label: 'Analytics', icon: 'analytics' },
    ],
  }];

  const jobs: NavItem[] = [];
  // Every staff member sees the job list; managing listings stays with the permission.
  jobs.push(user.role === 'admin' && perm('job_management')
    ? { to: '/app/jobs', label: 'Jobs', icon: 'briefcase', end: true }
    : { to: '/app/jobs/mine', label: 'Job postings', icon: 'briefcase' });
  if (perm('job_posting')) jobs.push({ to: '/app/jobs/new', label: 'Create job', icon: 'plus' });
  if (canPublishJobs(subject)) jobs.push({ to: '/app/jobs/approvals', label: 'Job approvals', icon: 'checkcircle', badge: 'approvals' });
  if (jobs.length) groups.push({ key: 'jobs', label: 'Jobs', icon: 'briefcase', collapsible: true, items: jobs });

  groups.push({
    key: 'people', label: 'People', icon: 'employees', collapsible: true, items: [
      { to: '/app/employees', label: 'Employees', icon: 'employees' },
      { to: '/app/attendance', label: 'Attendance', icon: 'attendance' },
    ],
  });

  const adminItems: NavItem[] = [];
  if (perm('manage_accounts')) adminItems.push({ to: '/app/admin/users', label: 'HR / Recruiters', icon: 'candidates' });
  if (perm('applicant_portal')) adminItems.push({ to: '/app/admin/applicant-portal', label: 'Applicant portal', icon: 'public' });
  if (perm('audit_trail')) adminItems.push({ to: '/app/admin/audit', label: 'Audit trail', icon: 'layers' });
  if (admin) adminItems.push({ to: '/app/admin/settings', label: 'Settings', icon: 'settings' });
  if (adminItems.length) groups.push({ key: 'administration', label: 'Administration', icon: 'settings', collapsible: true, items: adminItems });

  return groups;
}
