import { useEffect, useState, type ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { AttendanceRecordDto, AttendanceReviewDto, MyAttendanceDto } from '@shared/api/people';
import { ATTENDANCE_STATUS_LABELS, ATTENDANCE_STATUSES, type AttendanceStatus } from '@shared/domain/people';
import { Button, ButtonLink } from '@/components/ui/Button';
import { Avatar, Badge, StatusBadge } from '@/components/ui/Display';
import { Field, Select, TextInput } from '@/components/ui/Form';
import { EmptyState, Notice, Skeleton } from '@/components/ui/Feedback';
import { Card, CardHeader, DataTable, PageHeader, PillTabs, type Column } from '@/components/ui/Surface';
import { useToast } from '@/components/ui/Toast';
import { QueryErrorPage } from '@/app/system/StatusPages';
import { useAuth } from '@/app/providers/AuthProvider';
import { api, errorMessage, qs } from '@/lib/api';
import { formatHours, formatTime, formatWeekday } from '@/lib/format';
import w from '../workspace.module.css';
import s from './People.module.css';

const ME_KEY = ['attendance', 'me'] as const;

const hours = (r: Pick<AttendanceRecordDto, 'workedMinutes'>) => (r.workedMinutes !== null ? formatHours(r.workedMinutes) : '—');

export function AttendancePage() {
  const { can } = useAuth();
  const [params, setParams] = useSearchParams();
  const reviewer = can.roles('admin', 'hiring_manager');
  const view = reviewer && params.get('view') === 'review' ? 'review' : 'mine';
  useEffect(() => { document.title = `${view === 'review' ? 'Attendance review' : 'Attendance'} · Acme People`; }, [view]);
  const tabs = reviewer ? (
    <PillTabs label="Attendance view" value={view} onChange={(k) => setParams(k === 'review' ? { view: 'review' } : {}, { replace: true })}
      items={[{ key: 'mine', label: 'My attendance' }, { key: 'review', label: 'Team review' }]} />
  ) : null;
  return view === 'review' ? <ReviewView tabs={tabs} /> : <MyView tabs={tabs} onReview={() => setParams({ view: 'review' })} />;
}

function MyView({ tabs, onReview }: { tabs: ReactNode; onReview: () => void }) {
  const toast = useToast();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ME_KEY, queryFn: () => api.get<MyAttendanceDto>('/attendance/me') });
  const clock = useMutation({
    mutationFn: (dir: 'in' | 'out') => api.post(`/attendance/clock-${dir}`),
    onSuccess: (_d, dir) => { void qc.invalidateQueries({ queryKey: ['attendance'] }); toast.success(dir === 'in' ? 'You are clocked in.' : 'You are clocked out. Have a good evening.'); },
    onError: (e) => toast.error(errorMessage(e)),
  });
  if (q.isError) return <QueryErrorPage error={q.error} onRetry={() => void q.refetch()} />;
  const d = q.data;
  const header = <PageHeader title="Attendance" description="Clock in, clock out, and keep your workday records accurate." crumbs={[{ label: 'My work' }, { label: 'Attendance' }]} actions={tabs} />;

  if (!d) return <div className={w.page}>{header}<Skeleton height={160} /><Skeleton height={280} /></div>;

  if (!d.linked) {
    return (
      <div className={w.page}>
        {header}
        <Card>
          <EmptyState icon="user" title="No employee profile linked yet"
            text="Attendance is tracked per employee record. Your account is not linked to an employee profile yet. Ask an admin to link your account to an employee profile."
            actions={<>
              {d.canLinkProfiles ? <ButtonLink to="/app/employees">Link a profile in Employees</ButtonLink> : null}
              {d.canReview ? <Button variant="secondary" onClick={onReview}>View team attendance instead</Button> : null}
            </>} />
        </Card>
      </div>
    );
  }

  const t = d.todayRecord;
  const state = !t?.clockIn ? 'start' : !t.clockOut ? 'working' : 'done';
  const columns: Column<AttendanceRecordDto>[] = [
    { key: 'date', header: 'Date', cell: (r) => formatWeekday(r.workDate), primary: true },
    { key: 'in', header: 'Clock in', cell: (r) => (r.clockIn ? formatTime(r.clockIn) : '—'), label: 'Clock in' },
    { key: 'out', header: 'Clock out', cell: (r) => (r.clockOut ? formatTime(r.clockOut) : '—'), label: 'Clock out' },
    { key: 'hours', header: 'Hours', cell: hours, label: 'Hours', align: 'right' },
    { key: 'status', header: 'Status', cell: (r) => <StatusBadge kind="attendance" value={r.status} size="sm" />, label: 'Status' },
  ];

  return (
    <div className={w.page}>
      {header}
      <Card>
        <div className={s.today}>
          <div className={s.todayDate}><strong>{formatWeekday(d.today)}</strong><span>Today</span></div>
          <div className={s.todayStat}><strong className="num">{t?.clockIn ? formatTime(t.clockIn) : '—'}</strong><span>Clock in</span></div>
          <div className={s.todayStat}><strong className="num">{t?.clockOut ? formatTime(t.clockOut) : '—'}</strong><span>Clock out</span></div>
          <div className={s.todayControls}>
            <span className={w.overline}>Workday controls</span>
            <strong>{state === 'start' ? 'Start your workday' : state === 'working' ? 'You are currently working' : 'Your workday is complete'}</strong>
            <span className={w.faint}>Your attendance is recorded against {d.employee?.name ?? 'your employee profile'}.</span>
          </div>
          <div className={s.todayAction}>
            {state === 'start' ? <Button size="lg" icon="clock" loading={clock.isPending} onClick={() => clock.mutate('in')}>Clock in</Button> : null}
            {state === 'working' ? <Button size="lg" variant="secondary" icon="signout" loading={clock.isPending} onClick={() => clock.mutate('out')}>Clock out</Button> : null}
            {state === 'done' ? <Badge tone="success" icon="checkcircle">Completed{t ? ` · ${hours(t)}` : ''}</Badge> : null}
          </div>
        </div>
      </Card>
      <Card padding={0}>
        <div className={s.tableHead}>
          <CardHeader title="Recent attendance" subtitle={`Times shown in ${d.timezone}`}
            actions={<ButtonLink size="sm" variant="secondary" icon="download" to="/api/v1/attendance/export?scope=me" reloadDocument>Export CSV</ButtonLink>} />
        </div>
        <DataTable columns={columns} rows={d.history} rowKey={(r) => r.id} caption="Recent attendance"
          empty={<EmptyState compact icon="attendance" title="No attendance yet" text="Your clock-ins will be listed here." />} />
      </Card>
    </div>
  );
}

type ReviewRow = AttendanceReviewDto['rows'][number];

function StatusSaver({ row }: { row: ReviewRow }) {
  const toast = useToast();
  const qc = useQueryClient();
  const [value, setValue] = useState<AttendanceStatus>(row.status);
  useEffect(() => setValue(row.status), [row.status]);
  const save = useMutation({
    mutationFn: () => api.patch(`/attendance/${row.id}`, { status: value }),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['attendance'] }); toast.success(`Status saved for ${row.employeeName ?? 'this record'}.`); },
    onError: (e) => { toast.error(errorMessage(e)); setValue(row.status); },
  });
  return (
    <div className={s.saver}>
      <Select inputSize="sm" aria-label="Attendance status" value={value} onChange={(e) => setValue(e.target.value as AttendanceStatus)}
        options={ATTENDANCE_STATUSES.map((st) => ({ value: st, label: ATTENDANCE_STATUS_LABELS[st] }))} />
      <Button size="sm" variant={value !== row.status ? 'primary' : 'secondary'} disabled={value === row.status} loading={save.isPending} onClick={() => save.mutate()}>Save</Button>
    </div>
  );
}

function ReviewView({ tabs }: { tabs: ReactNode }) {
  const [range, setRange] = useState<{ from: string; to: string } | null>(null);
  const [draft, setDraft] = useState<{ from: string; to: string }>({ from: '', to: '' });
  const q = useQuery({
    queryKey: ['attendance', 'review', range],
    queryFn: () => api.get<AttendanceReviewDto>(`/attendance${qs(range ?? {})}`),
    placeholderData: (prev) => prev,
  });
  useEffect(() => { if (q.data && !draft.from) setDraft({ from: q.data.from, to: q.data.to }); }, [q.data, draft.from]);
  if (q.isError) return <QueryErrorPage error={q.error} onRetry={() => void q.refetch()} />;
  const d = q.data;
  const invalid = Boolean(draft.from && draft.to && draft.from > draft.to);

  const columns: Column<ReviewRow>[] = [
    {
      key: 'emp', header: 'Employee', primary: true,
      cell: (r) => (
        <span className={w.person}>
          <Avatar name={r.employeeName ?? '?'} size={30} />
          <span className={w.personText}><span className={w.personName}>{r.employeeName ?? 'Unnamed record'}</span><span className={w.personSub}>{r.employeeNumber ?? ''}</span></span>
        </span>
      ),
    },
    { key: 'date', header: 'Date', cell: (r) => formatWeekday(r.workDate), label: 'Date' },
    { key: 'in', header: 'Clock in', cell: (r) => (r.clockIn ? formatTime(r.clockIn) : '—'), label: 'Clock in' },
    { key: 'out', header: 'Clock out', cell: (r) => (r.clockOut ? formatTime(r.clockOut) : '—'), label: 'Clock out' },
    { key: 'hours', header: 'Hours', cell: hours, label: 'Hours', align: 'right' },
    { key: 'status', header: 'Status', cell: (r) => <StatusSaver row={r} />, label: 'Status' },
  ];

  return (
    <div className={w.page}>
      <PageHeader title="Attendance review" description="Review clock records, correct statuses, and approve exceptions." crumbs={[{ label: 'People' }, { label: 'Attendance review' }]} actions={tabs} />
      <Card>
        <form className={s.rangeBar} onSubmit={(e) => { e.preventDefault(); if (!invalid) setRange({ ...draft }); }}>
          <Field label="From"><TextInput type="date" value={draft.from} onChange={(e) => setDraft((r) => ({ ...r, from: e.target.value }))} /></Field>
          <Field label="To"><TextInput type="date" value={draft.to} onChange={(e) => setDraft((r) => ({ ...r, to: e.target.value }))} /></Field>
          <Button type="submit" disabled={invalid} loading={q.isFetching && Boolean(range)}>Review</Button>
          <ButtonLink variant="secondary" icon="download" reloadDocument to={`/api/v1/attendance/export${qs({ scope: 'team', from: d?.from, to: d?.to })}`}>Export CSV</ButtonLink>
        </form>
        {invalid ? <Notice tone="warning" className={w.mt12}>The start date must be on or before the end date.</Notice> : null}
        {d && Object.keys(d.summary).length ? (
          <div className={s.summary}>
            {Object.entries(d.summary).map(([k, n]) => <Badge key={k} tone="neutral" size="sm">{ATTENDANCE_STATUS_LABELS[k as AttendanceStatus]} · {n}</Badge>)}
          </div>
        ) : null}
      </Card>
      <Card padding={0}>
        <DataTable columns={columns} rows={d?.rows ?? []} rowKey={(r) => r.id} loading={!d} caption="Attendance records"
          empty={<EmptyState compact icon="attendance" title="No attendance records in this range" text="Try a wider date range." />} />
      </Card>
    </div>
  );
}
