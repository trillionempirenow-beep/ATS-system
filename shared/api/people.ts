import { z } from 'zod';
import { ATTENDANCE_STATUSES, EMPLOYEE_STATUSES, type AttendanceStatus, type EmployeeStatus } from '../domain/people.js';

export interface EmployeeDto {
  id: number;
  employeeNumber: string | null;
  name: string | null;
  jobTitle: string | null;
  appliedPosition: string | null;
  department: string | null;
  departmentId: number | null;
  startDate: string | null;
  status: EmployeeStatus;
  applicationId: number | null;
  user: { id: number; name: string; email: string } | null;
  fromPipeline: boolean;
}

export interface EmployeesDto {
  employees: EmployeeDto[];
  departments: Array<{ id: number; name: string }>;
  linkableUsers: Array<{ id: number; name: string; email: string; roleLabel: string }>;
  fromPipelineCount: number;
}

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a valid date.');

export const createEmployeeSchema = z.object({
  employeeNumber: z.string().trim().min(1, 'Employee number is required.').max(40),
  jobTitle: z.string().trim().min(1, 'Job title is required.').max(180),
  departmentId: z.number().int().positive().nullable().optional(),
  startDate: date.or(z.literal('')).optional().default(''),
  status: z.enum(EMPLOYEE_STATUSES).default('active'),
  userId: z.number().int().positive().nullable().optional(),
});
export type CreateEmployeeInput = z.input<typeof createEmployeeSchema>;

export const updateEmployeeSchema = z.object({
  jobTitle: z.string().trim().min(1).max(180).optional(),
  departmentId: z.number().int().positive().nullable().optional(),
  startDate: date.nullable().optional(),
  status: z.enum(EMPLOYEE_STATUSES).optional(),
  userId: z.number().int().positive().nullable().optional(),
});

export interface AttendanceRecordDto {
  id: number;
  workDate: string;
  clockIn: string | null;
  clockOut: string | null;
  workedMinutes: number | null;
  status: AttendanceStatus;
  notes: string | null;
}

export interface MyAttendanceDto {
  linked: boolean;
  employee: { id: number; name: string; employeeNumber: string | null; jobTitle: string | null } | null;
  today: string;
  todayRecord: AttendanceRecordDto | null;
  history: AttendanceRecordDto[];
  timezone: string;
  canReview: boolean;
  canLinkProfiles: boolean;
}

export const attendanceReviewQuerySchema = z.object({ from: date.optional(), to: date.optional() });

export interface AttendanceReviewDto {
  from: string;
  to: string;
  rows: Array<AttendanceRecordDto & { employeeId: number; employeeName: string | null; employeeNumber: string | null; jobTitle: string | null; approvedBy: string | null }>;
  summary: Partial<Record<AttendanceStatus, number>>;
}

export const attendanceStatusSchema = z.object({ status: z.enum(ATTENDANCE_STATUSES), notes: z.string().trim().max(500).optional() });
