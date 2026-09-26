import type { RouteObject } from 'react-router-dom';
import { STAFF_ROLES } from '@shared/domain/access';
import { page } from './lazyPage';
import {
  RequireAdminLevel, RequireAnyPermission, RequireCanPublish, RequirePermission, RequireRoles, RequireSuperAdmin, RoleLanding,
} from './guards';

const staff = [...STAFF_ROLES];

/** Everything inside the signed-in shell. Guards mirror the server; the API re-checks every call. */
export const appRoutes: RouteObject[] = [
  { index: true, element: <RoleLanding>{page(() => import('@/features/dashboard/DashboardPage'), 'DashboardPage')}</RoleLanding> },
  { path: 'notifications', element: page(() => import('@/features/me/NotificationsPage'), 'NotificationsPage') },
  { path: 'profile', element: page(() => import('@/features/me/ProfilePage'), 'ProfilePage') },
  { path: 'attendance', element: page(() => import('@/features/people/AttendancePage'), 'AttendancePage') },
  {
    element: <RequireRoles roles={staff} />,
    children: [
      { path: 'pipeline', element: page(() => import('@/features/pipeline/PipelinePage'), 'PipelinePage') },
      { path: 'candidates', element: page(() => import('@/features/candidates/CandidatesPage'), 'CandidatesPage') },
      { path: 'candidates/new', element: page(() => import('@/features/candidates/add/AddCandidatePage'), 'AddCandidatePage') },
      { path: 'candidates/:id', element: page(() => import('@/features/candidates/profile/CandidateProfilePage'), 'CandidateProfilePage') },
      { path: 'interviews', element: page(() => import('@/features/interviews/InterviewsPage'), 'InterviewsPage') },
      { path: 'interviews/:id/room', element: page(() => import('@/features/room/StaffRoomPage'), 'StaffRoomPage') },
      { path: 'interviews/:id/review', element: page(() => import('@/features/interviews/InterviewReviewPage'), 'InterviewReviewPage') },
      { path: 'analytics', element: page(() => import('@/features/insights/AnalyticsPage'), 'AnalyticsPage') },
      { path: 'analytics/report', element: <RequireAdminLevel>{page(() => import('@/features/insights/ReportPage'), 'ReportPage')}</RequireAdminLevel> },
      { path: 'employees', element: page(() => import('@/features/people/EmployeesPage'), 'EmployeesPage') },
      {
        path: 'jobs',
        children: [
          { index: true, element: <RequireRoles roles={['admin']}><RequirePermission permission="job_management">{page(() => import('@/features/jobs/JobsPage'), 'JobsPage')}</RequirePermission></RequireRoles> },
          { path: 'mine', element: <RequirePermission permission="job_management">{page(() => import('@/features/jobs/MyJobsPage'), 'MyJobsPage')}</RequirePermission> },
          { path: 'new', element: <RequirePermission permission="job_posting">{page(() => import('@/features/jobs/JobEditorPage'), 'JobEditorPage')}</RequirePermission> },
          { path: ':id/edit', element: <RequireAnyPermission permissions={['job_posting', 'job_management']}>{page(() => import('@/features/jobs/JobEditorPage'), 'JobEditorPage')}</RequireAnyPermission> },
          {
            path: 'approvals',
            element: <RequireCanPublish />,
            children: [
              { index: true, element: page(() => import('@/features/jobs/ApprovalsPage'), 'ApprovalsPage') },
              { path: ':id', element: page(() => import('@/features/jobs/ApprovalReviewPage'), 'ApprovalReviewPage') },
            ],
          },
        ],
      },
    ],
  },
  {
    path: 'admin',
    children: [
      { path: 'admins', element: <RequireSuperAdmin>{page(() => import('@/features/admin/AdminsPage'), 'AdminsPage')}</RequireSuperAdmin> },
      { path: 'users', element: <RequirePermission permission="manage_accounts">{page(() => import('@/features/admin/AccountsPage'), 'AccountsPage')}</RequirePermission> },
      { path: 'password-resets', element: <RequireSuperAdmin>{page(() => import('@/features/admin/PasswordResetsPage'), 'PasswordResetsPage')}</RequireSuperAdmin> },
      { path: 'applicant-portal', element: <RequirePermission permission="applicant_portal">{page(() => import('@/features/admin/ApplicantPortalPage'), 'ApplicantPortalPage')}</RequirePermission> },
      { path: 'audit', element: <RequirePermission permission="audit_trail">{page(() => import('@/features/admin/AuditPage'), 'AuditPage')}</RequirePermission> },
      { path: 'settings', element: <RequireAdminLevel>{page(() => import('@/features/admin/SettingsPage'), 'SettingsPage')}</RequireAdminLevel> },
    ],
  },
];
