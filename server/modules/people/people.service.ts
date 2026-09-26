import type { z } from 'zod';
import { ROLE_LABELS, isStaffRole, roleAllowed, type Role } from '../../../shared/domain/access.js';
import { HALF_DAY_THRESHOLD_MINUTES, type AttendanceStatus, type EmployeeStatus } from '../../../shared/domain/people.js';
import type {
  AttendanceRecordDto, AttendanceReviewDto, EmployeesDto, MyAttendanceDto,
  attendanceStatusSchema, createEmployeeSchema, updateEmployeeSchema,
} from '../../../shared/api/people.js';
import { env } from '../../config/env.js';
import { sql } from '../../db/client.js';
import { audit } from '../../core/audit.js';
import { getSettings, intSetting } from '../../core/settings.js';
import type { CurrentUser } from '../../http/context.js';
import { conflict, isUniqueViolation, notFound, validationFailed } from '../../http/errors.js';
import { iso, todayInZone } from '../../lib/format.js';

type Ctx = { user: CurrentUser; ip: string | null };

export async function employees(): Promise<EmployeesDto> {
  const [rows, departments, users] = await Promise.all([
    sql<{ id: number; employee_number: string | null; job_title: string | null; applied_position: string | null; department: string | null; department_id: number | null; start_date: string | null; status: EmployeeStatus; application_id: number | null; user_id: number | null; user_name: string | null; user_email: string | null; cand_first: string | null; cand_last: string | null }[]>`
      select e.id, e.employee_number, e.job_title, e.applied_position, d.name as department, e.department_id,
             to_char(e.start_date, 'YYYY-MM-DD') as start_date, e.status, e.application_id, e.user_id,
             u.name as user_name, u.email::text as user_email, c.first_name as cand_first, c.last_name as cand_last
      from employees e left join departments d on d.id = e.department_id left join users u on u.id = e.user_id
      left join candidates c on c.id = e.candidate_id
      order by e.start_date desc nulls last, e.id desc`,
    sql<{ id: number; name: string }[]>`select id, name from departments order by name`,
    sql<{ id: number; name: string; email: string; role: Role }[]>`
      select u.id, u.name, u.email::text, u.role from users u
      where u.active and not exists (select 1 from employees e where e.user_id = u.id) order by u.name`,
  ]);
  return {
    employees: rows.map((r) => ({
      id: r.id,
      employeeNumber: r.employee_number,
      name: r.user_name ?? ([r.cand_first, r.cand_last].filter(Boolean).join(' ') || null),
      jobTitle: r.job_title,
      appliedPosition: r.applied_position,
      department: r.department,
      departmentId: r.department_id,
      startDate: r.start_date,
      status: r.status,
      applicationId: r.application_id,
      user: r.user_id ? { id: r.user_id, name: r.user_name ?? '', email: r.user_email ?? '' } : null,
      fromPipeline: r.application_id !== null,
    })),
    departments,
    linkableUsers: users.map((u) => ({ id: u.id, name: u.name, email: u.email, roleLabel: ROLE_LABELS[u.role] })),
    fromPipelineCount: rows.filter((r) => r.application_id !== null).length,
  };
}

export async function createEmployee(input: z.infer<typeof createEmployeeSchema>, ctx: Ctx): Promise<{ id: number }> {
  try {
    const [e] = await sql<{ id: number }[]>`
      insert into employees (employee_number, job_title, department_id, start_date, status, user_id)
      values (${input.employeeNumber}, ${input.jobTitle}, ${input.departmentId ?? null}, ${input.startDate || null}, ${input.status}, ${input.userId ?? null})
      returning id`;
    await audit({ userId: ctx.user.id, action: 'employee_create', entityType: 'employee', entityId: e!.id, details: { number: input.employeeNumber }, ip: ctx.ip });
    return { id: e!.id };
  } catch (err) {
    if (isUniqueViolation(err)) throw validationFailed({ employeeNumber: 'That employee number or account is already in use.' });
    throw err;
  }
}

export async function updateEmployee(id: number, input: z.infer<typeof updateEmployeeSchema>, ctx: Ctx): Promise<void> {
  const [e] = await sql<{ id: number; job_title: string | null; department_id: number | null; start_date: string | null; status: EmployeeStatus; user_id: number | null }[]>`
    select id, job_title, department_id, to_char(start_date, 'YYYY-MM-DD') as start_date, status, user_id from employees where id = ${id}`;
  if (!e) throw notFound('That employee record no longer exists.');
  try {
    await sql`update employees set job_title = ${input.jobTitle ?? e.job_title},
                department_id = ${input.departmentId === undefined ? e.department_id : input.departmentId},
                start_date = ${input.startDate === undefined ? e.start_date : input.startDate},
                status = ${input.status ?? e.status}, user_id = ${input.userId === undefined ? e.user_id : input.userId}
              where id = ${id}`;
  } catch (err) {
    if (isUniqueViolation(err)) throw conflict('That account is already linked to another employee record.');
    throw err;
  }
  await audit({ userId: ctx.user.id, action: 'employee_update', entityType: 'employee', entityId: id, details: {
    status: input.status ?? '', linked_account: input.userId === undefined ? '' : input.userId === null ? 'unlinked' : `user #${input.userId}`,
  }, ip: ctx.ip });
}

// ---------------------------------------------------------------------------
// Attendance
// ---------------------------------------------------------------------------

interface RecordRow { id: number; work_date: string; clock_in: Date | null; clock_out: Date | null; worked_minutes: number | null; status: AttendanceStatus; notes: string | null }
const toRecord = (r: RecordRow): AttendanceRecordDto => ({
  id: r.id, workDate: r.work_date, clockIn: iso(r.clock_in), clockOut: iso(r.clock_out), workedMinutes: r.worked_minutes, status: r.status, notes: r.notes,
});

async function employeeFor(userId: number) {
  const [e] = await sql<{ id: number; name: string; employee_number: string | null; job_title: string | null }[]>`
    select e.id, u.name, e.employee_number, e.job_title from employees e join users u on u.id = e.user_id where e.user_id = ${userId}`;
  return e ?? null;
}

export async function myAttendance(user: CurrentUser): Promise<MyAttendanceDto> {
  const s = await getSettings();
  const tz = s.attendance_timezone || env.APP_TIMEZONE;
  const today = todayInZone(tz);
  const employee = await employeeFor(user.id);
  const canReview = roleAllowed(user, ['admin', 'hiring_manager']);
  const base = { today, timezone: tz, canReview, canLinkProfiles: isStaffRole(user.role) || user.role === 'super_admin' };
  if (!employee) return { ...base, linked: false, employee: null, todayRecord: null, history: [] };
  const history = await sql<RecordRow[]>`
    select id, to_char(work_date, 'YYYY-MM-DD') as work_date, clock_in, clock_out, worked_minutes, status, notes
    from attendance_records where employee_id = ${employee.id} order by work_date desc limit 31`;
  return {
    ...base,
    linked: true,
    employee: { id: employee.id, name: employee.name, employeeNumber: employee.employee_number, jobTitle: employee.job_title },
    todayRecord: history.find((h) => h.work_date === today) ? toRecord(history.find((h) => h.work_date === today)!) : null,
    history: history.map(toRecord),
  };
}

/** Late when clocking in after the schedule's start time plus its grace period (company timezone). */
async function lateStatus(employeeId: number, tz: string): Promise<AttendanceStatus> {
  const [sched] = await sql<{ start_time: string; grace_minutes: number }[]>`
    select coalesce(ws.start_time, dflt.start_time)::text as start_time, coalesce(ws.grace_minutes, dflt.grace_minutes) as grace_minutes
    from (select start_time, grace_minutes from work_schedules where active order by id limit 1) dflt
    left join employee_schedules es on es.employee_id = ${employeeId} and es.effective_from <= current_date and (es.effective_to is null or es.effective_to >= current_date)
    left join work_schedules ws on ws.id = es.schedule_id`;
  if (!sched) return 'present';
  const s = await getSettings();
  const grace = sched.grace_minutes ?? intSetting(s.attendance_grace_minutes, 10);
  const [h, m] = sched.start_time.split(':').map(Number);
  const nowParts = new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date()).split(':').map(Number);
  const nowMinutes = (nowParts[0] ?? 0) * 60 + (nowParts[1] ?? 0);
  return nowMinutes > (h ?? 9) * 60 + (m ?? 0) + grace ? 'late' : 'present';
}

export async function clockIn(ctx: Ctx): Promise<void> {
  const employee = await employeeFor(ctx.user.id);
  if (!employee) throw conflict('Your account is not linked to an employee profile yet.');
  const s = await getSettings();
  const tz = s.attendance_timezone || env.APP_TIMEZONE;
  const today = todayInZone(tz);
  const status = await lateStatus(employee.id, tz);
  const [row] = await sql<{ id: number }[]>`
    insert into attendance_records (employee_id, work_date, clock_in, status) values (${employee.id}, ${today}, now(), ${status})
    on conflict (employee_id, work_date) do nothing returning id`;
  if (!row) throw conflict('You have already clocked in today.');
  await audit({ userId: ctx.user.id, action: 'clock_in', entityType: 'attendance', entityId: row.id, ip: ctx.ip });
}

export async function clockOut(ctx: Ctx): Promise<void> {
  const employee = await employeeFor(ctx.user.id);
  if (!employee) throw conflict('Your account is not linked to an employee profile yet.');
  const s = await getSettings();
  const today = todayInZone(s.attendance_timezone || env.APP_TIMEZONE);
  const [row] = await sql<{ id: number }[]>`
    update attendance_records set clock_out = now(),
      worked_minutes = greatest(0, floor(extract(epoch from (now() - clock_in)) / 60)::int - break_minutes),
      status = case when floor(extract(epoch from (now() - clock_in)) / 60) < ${HALF_DAY_THRESHOLD_MINUTES} then 'half_day' else status end,
      updated_at = now()
    where employee_id = ${employee.id} and work_date = ${today} and clock_out is null and clock_in is not null
    returning id`;
  if (!row) throw conflict('There is no open clock-in for today.');
  await audit({ userId: ctx.user.id, action: 'clock_out', entityType: 'attendance', entityId: row.id, ip: ctx.ip });
}

export async function review(from: string | undefined, to: string | undefined): Promise<AttendanceReviewDto> {
  const today = todayInZone();
  const f = from ?? `${today.slice(0, 8)}01`;
  const t = to ?? today;
  const [a, b] = f <= t ? [f, t] : [t, f];
  const rows = await sql<(RecordRow & { employee_id: number; employee_name: string | null; employee_number: string | null; job_title: string | null; approved_by_name: string | null })[]>`
    select r.id, to_char(r.work_date, 'YYYY-MM-DD') as work_date, r.clock_in, r.clock_out, r.worked_minutes, r.status, r.notes,
           e.id as employee_id, u.name as employee_name, e.employee_number, e.job_title, ap.name as approved_by_name
    from attendance_records r join employees e on e.id = r.employee_id left join users u on u.id = e.user_id left join users ap on ap.id = r.approved_by
    where r.work_date between ${a} and ${b} order by r.work_date desc, u.name`;
  const summary: AttendanceReviewDto['summary'] = {};
  for (const r of rows) summary[r.status] = (summary[r.status] ?? 0) + 1;
  return {
    from: a, to: b, summary,
    rows: rows.map((r) => ({ ...toRecord(r), employeeId: r.employee_id, employeeName: r.employee_name, employeeNumber: r.employee_number, jobTitle: r.job_title, approvedBy: r.approved_by_name })),
  };
}

export async function setAttendanceStatus(id: number, input: z.infer<typeof attendanceStatusSchema>, ctx: Ctx): Promise<void> {
  const [row] = await sql<{ id: number }[]>`
    update attendance_records set status = ${input.status}, notes = coalesce(${input.notes ?? null}, notes), approved_by = ${ctx.user.id},
      approved_at = now(), source = 'admin', updated_at = now() where id = ${id} returning id`;
  if (!row) throw notFound('That attendance record no longer exists.');
  await audit({ userId: ctx.user.id, action: 'attendance_update', entityType: 'attendance', entityId: id, details: { status: input.status }, ip: ctx.ip });
}

const csvCell = (v: unknown) => {
  const s = v === null || v === undefined ? '' : String(v);
  return /[",\n]/.test(s) || /^[=+\-@]/.test(s) ? `"${s.replace(/"/g, '""').replace(/^([=+\-@])/, "'$1")}"` : s;
};

export async function exportCsv(scope: 'me' | 'team', user: CurrentUser, from?: string, to?: string): Promise<string> {
  const header = ['Employee', 'Employee number', 'Job title', 'Date', 'Clock in', 'Clock out', 'Worked minutes', 'Status'];
  const rows = scope === 'me'
    ? await sql<Record<string, unknown>[]>`
        select u.name, e.employee_number, e.job_title, to_char(a.work_date, 'YYYY-MM-DD') as work_date, a.clock_in, a.clock_out, a.worked_minutes, a.status
        from attendance_records a join employees e on e.id = a.employee_id join users u on u.id = e.user_id
        where e.user_id = ${user.id} order by a.work_date desc`
    : (await review(from, to)).rows.map((r) => ({ name: r.employeeName, employee_number: r.employeeNumber, job_title: r.jobTitle, work_date: r.workDate, clock_in: r.clockIn, clock_out: r.clockOut, worked_minutes: r.workedMinutes, status: r.status }));
  const fmt = (d: unknown) => (d instanceof Date ? d.toISOString() : d);
  return [header, ...rows.map((r) => [r.name, r.employee_number, r.job_title, r.work_date, fmt(r.clock_in), fmt(r.clock_out), r.worked_minutes, r.status])]
    .map((line) => line.map(csvCell).join(','))
    .join('\r\n');
}
