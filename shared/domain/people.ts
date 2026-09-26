import type { Tone } from './pipeline.js';

export const EMPLOYEE_STATUSES = ['active', 'on_leave', 'terminated'] as const;
export type EmployeeStatus = (typeof EMPLOYEE_STATUSES)[number];
export const EMPLOYEE_STATUS_LABELS: Record<EmployeeStatus, string> = {
  active: 'Active',
  on_leave: 'On leave',
  terminated: 'Terminated',
};
export const EMPLOYEE_STATUS_TONES: Record<EmployeeStatus, Tone> = { active: 'success', on_leave: 'warning', terminated: 'neutral' };

export const ATTENDANCE_STATUSES = ['present', 'late', 'absent', 'half_day', 'on_leave', 'holiday', 'incomplete'] as const;
export type AttendanceStatus = (typeof ATTENDANCE_STATUSES)[number];
export const ATTENDANCE_STATUS_LABELS: Record<AttendanceStatus, string> = {
  present: 'Present',
  late: 'Late',
  absent: 'Absent',
  half_day: 'Half day',
  on_leave: 'On leave',
  holiday: 'Holiday',
  incomplete: 'Incomplete',
};
export const ATTENDANCE_STATUS_TONES: Record<AttendanceStatus, Tone> = {
  present: 'success',
  late: 'warning',
  absent: 'danger',
  half_day: 'purple',
  on_leave: 'info',
  holiday: 'teal',
  incomplete: 'neutral',
};

/** Under four hours worked marks the day as a half day (PHP clock-out rule). */
export const HALF_DAY_THRESHOLD_MINUTES = 240;

export const NOTIFICATION_CATEGORIES = ['application', 'interview', 'message', 'system'] as const;
export type NotificationCategory = (typeof NOTIFICATION_CATEGORIES)[number];
export const NOTIFICATION_PRIORITIES = ['low', 'medium', 'high', 'urgent'] as const;
export type NotificationPriority = (typeof NOTIFICATION_PRIORITIES)[number];

/** Notification filter tabs from notifications.php, keyed to the types they include. */
export const NOTIFICATION_FILTERS = {
  unread: { label: 'Unread', types: null },
  accounts: {
    label: 'Accounts',
    types: ['account_suspended', 'account_disabled', 'reactivation_request', 'reactivation_approved', 'reactivation_rejected', 'account_approval', 'account', 'password_reset'],
  },
  jobs: { label: 'Jobs', types: ['job_approval', 'job_decision'] },
  hiring: { label: 'Hiring', types: ['application_received', 'interview_scheduled', 'candidate_waiting', 'interview_reminder', 'stage_moved'] },
  access: { label: 'Permissions & seats', types: ['permissions', 'seat_limit'] },
} as const;
export type NotificationFilter = keyof typeof NOTIFICATION_FILTERS;

export interface NotificationTypeInfo {
  category: NotificationCategory;
  priority: NotificationPriority;
  icon: string;
}

export const NOTIFICATION_TYPES: Record<string, NotificationTypeInfo> = {
  account_suspended: { category: 'system', priority: 'high', icon: 'signout' },
  account_disabled: { category: 'system', priority: 'high', icon: 'signout' },
  reactivation_request: { category: 'system', priority: 'high', icon: 'bell' },
  reactivation_approved: { category: 'system', priority: 'low', icon: 'check' },
  reactivation_rejected: { category: 'system', priority: 'low', icon: 'xcircle' },
  account_approval: { category: 'system', priority: 'medium', icon: 'users' },
  account: { category: 'system', priority: 'low', icon: 'user' },
  password_reset: { category: 'system', priority: 'high', icon: 'key' },
  job_approval: { category: 'application', priority: 'high', icon: 'briefcase' },
  job_decision: { category: 'application', priority: 'medium', icon: 'checkcircle' },
  permissions: { category: 'system', priority: 'medium', icon: 'shield' },
  seat_limit: { category: 'system', priority: 'medium', icon: 'limit' },
  application_received: { category: 'application', priority: 'medium', icon: 'doc' },
  stage_moved: { category: 'application', priority: 'low', icon: 'pipeline' },
  interview_scheduled: { category: 'interview', priority: 'medium', icon: 'calendar' },
  interview_reminder: { category: 'interview', priority: 'high', icon: 'clock' },
  candidate_waiting: { category: 'interview', priority: 'urgent', icon: 'video' },
  general: { category: 'system', priority: 'low', icon: 'bell' },
};

export function notificationTypeInfo(type: string): NotificationTypeInfo {
  return NOTIFICATION_TYPES[type] ?? { category: 'system', priority: 'low', icon: 'bell' };
}

export const RANGE_KEYS = ['today', 'week', 'month', 'quarter', 'all', 'custom'] as const;
export type RangeKey = (typeof RANGE_KEYS)[number];
export const RANGE_LABELS: Record<RangeKey, string> = {
  today: 'Today',
  week: 'This week',
  month: 'This month',
  quarter: 'Last 3 months',
  all: 'All time',
  custom: 'Custom range',
};
