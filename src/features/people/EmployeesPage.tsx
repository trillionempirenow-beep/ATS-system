import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { EmployeeDto, EmployeesDto } from '@shared/api/people';
import { EMPLOYEE_STATUS_LABELS, EMPLOYEE_STATUSES, type EmployeeStatus } from '@shared/domain/people';
import { Icon } from '@/components/icon/Icon';
import { Button } from '@/components/ui/Button';
import { Avatar, Badge, StatusBadge } from '@/components/ui/Display';
import { Field, Select, TextInput, formStyles } from '@/components/ui/Form';
import { EmptyState, Notice } from '@/components/ui/Feedback';
import { Drawer } from '@/components/ui/Overlay';
import { Card, CardHeader, DataTable, PageHeader, type Column } from '@/components/ui/Surface';
import { useToast } from '@/components/ui/Toast';
import { QueryErrorPage } from '@/app/system/StatusPages';
import { ApiError, api, errorMessage } from '@/lib/api';
import { formatDate } from '@/lib/format';
import w from '../workspace.module.css';
import s from './People.module.css';

const KEY = ['employees'] as const;

interface FormState { employeeNumber: string; jobTitle: string; departmentId: string; startDate: string; status: EmployeeStatus; userId: string }
const BLANK: FormState = { employeeNumber: '', jobTitle: '', departmentId: '', startDate: '', status: 'active', userId: '' };

/** One drawer for both "Add employee manually" and editing an existing record. */
function EmployeeDrawer({ open, employee, data, onClose }: { open: boolean; employee: EmployeeDto | null; data: EmployeesDto; onClose: () => void }) {
  const toast = useToast();
  const qc = useQueryClient();
  const [f, setF] = useState<FormState>(BLANK);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  useEffect(() => {
    if (!open) return;
    setErrors({});
    setFormError(null);
    setF(employee ? {
      employeeNumber: employee.employeeNumber ?? '', jobTitle: employee.jobTitle ?? '', departmentId: employee.departmentId ? String(employee.departmentId) : '',
      startDate: employee.startDate ?? '', status: employee.status, userId: employee.user ? String(employee.user.id) : '',
    } : BLANK);
  }, [open, employee]);
  const set = <K extends keyof FormState>(k: K, v: FormState[K]) => setF((cur) => ({ ...cur, [k]: v }));

  const save = useMutation({
    mutationFn: () => {
      const common = { jobTitle: f.jobTitle.trim(), departmentId: f.departmentId ? Number(f.departmentId) : null, status: f.status, userId: f.userId ? Number(f.userId) : null };
      return employee
        ? api.patch(`/employees/${employee.id}`, { ...common, startDate: f.startDate || null })
        : api.post('/employees', { ...common, employeeNumber: f.employeeNumber.trim(), startDate: f.startDate });
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: KEY });
      void qc.invalidateQueries({ queryKey: ['attendance'] });
      toast.success(employee ? 'Employee record updated.' : 'Employee added.');
      onClose();
    },
    onError: (e) => {
      if (e instanceof ApiError && Object.keys(e.fields).length) setErrors(e.fields);
      else setFormError(errorMessage(e));
    },
  });

  const submit = () => {
    const next: Record<string, string> = {};
    if (!employee && !f.employeeNumber.trim()) next.employeeNumber = 'Employee number is required.';
    if (!f.jobTitle.trim()) next.jobTitle = 'Job title is required.';
    setErrors(next);
    if (!Object.keys(next).length) save.mutate();
  };

  const linkable = [
    ...(employee?.user ? [{ id: employee.user.id, name: employee.user.name, email: employee.user.email, roleLabel: 'Linked' }] : []),
    ...data.linkableUsers,
  ];

  return (
    <Drawer open={open} onClose={onClose} title={employee ? 'Edit employee' : 'Add employee manually'}
      subtitle={employee ? (employee.name ?? employee.employeeNumber ?? undefined) : 'For hires not tracked through the pipeline. To convert a hired candidate with their full recruitment history, use “Add to employees” on their candidate profile instead.'}
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button onClick={submit} loading={save.isPending}>{employee ? 'Save changes' : 'Add employee'}</Button></>}>
      <div className={formStyles.stack}>
        {formError ? <Notice tone="danger">{formError}</Notice> : null}
        {!employee ? (
          <Field label="Employee number" required error={errors.employeeNumber}><TextInput value={f.employeeNumber} onChange={(e) => set('employeeNumber', e.target.value)} maxLength={40} /></Field>
        ) : null}
        <Field label="Job title" required error={errors.jobTitle}><TextInput value={f.jobTitle} onChange={(e) => set('jobTitle', e.target.value)} maxLength={180} /></Field>
        <div className={formStyles.grid2}>
          <Field label="Department" error={errors.departmentId}>
            <Select value={f.departmentId} onChange={(e) => set('departmentId', e.target.value)} placeholder="Unassigned" options={data.departments.map((d) => ({ value: d.id, label: d.name }))} />
          </Field>
          <Field label="Start date" error={errors.startDate}><TextInput type="date" value={f.startDate} onChange={(e) => set('startDate', e.target.value)} /></Field>
        </div>
        <Field label="Status"><Select value={f.status} onChange={(e) => set('status', e.target.value as EmployeeStatus)} options={EMPLOYEE_STATUSES.map((st) => ({ value: st, label: EMPLOYEE_STATUS_LABELS[st] }))} /></Field>
        <Field label="Linked user account" optional hint="Links attendance to this record. Each account can be linked to one employee." error={errors.userId}>
          <Select value={f.userId} onChange={(e) => set('userId', e.target.value)} placeholder="Not linked" options={linkable.map((u) => ({ value: u.id, label: `${u.name} · ${u.email}` }))} />
        </Field>
      </div>
    </Drawer>
  );
}

export function EmployeesPage() {
  const q = useQuery({ queryKey: KEY, queryFn: () => api.get<EmployeesDto>('/employees') });
  const [drawer, setDrawer] = useState<{ open: boolean; employee: EmployeeDto | null }>({ open: false, employee: null });
  useEffect(() => { document.title = 'Employees · Acme People'; }, []);
  if (q.isError) return <QueryErrorPage error={q.error} onRetry={() => void q.refetch()} />;
  const d = q.data;

  const columns: Column<EmployeeDto>[] = [
    { key: 'num', header: 'Number', cell: (e) => <span className={`mono ${s.nowrap}`}>{e.employeeNumber ?? '—'}</span>, label: 'Number' },
    {
      key: 'name', header: 'Employee', primary: true,
      cell: (e) => (
        <span className={w.person}>
          <Avatar name={e.name ?? e.employeeNumber ?? '?'} size={30} />
          <span className={w.personText}><span className={w.personName}>{e.name ?? 'Unnamed record'}</span>{e.user ? <span className={w.personSub}>{e.user.email}</span> : null}</span>
        </span>
      ),
    },
    { key: 'hired', header: 'Hired position', cell: (e) => e.jobTitle ?? '—', label: 'Hired position' },
    { key: 'applied', header: 'Applied position', cell: (e) => e.appliedPosition ?? '—', label: 'Applied position' },
    { key: 'dept', header: 'Department', cell: (e) => e.department ?? 'Unassigned', label: 'Department' },
    { key: 'start', header: 'Start date', cell: (e) => formatDate(e.startDate), label: 'Start date' },
    { key: 'status', header: 'Status', cell: (e) => <StatusBadge kind="employee" value={e.status} size="sm" />, label: 'Status' },
    {
      key: 'origin', header: <span className="sr-only">Source</span>, align: 'right',
      cell: (e) => e.fromPipeline && e.applicationId
        ? <Link className={w.link} to={`/app/candidates/${e.applicationId}?tab=activity`} onClick={(ev) => ev.stopPropagation()}>History</Link>
        : <Badge tone="neutral" size="sm">Manual</Badge>,
    },
  ];

  return (
    <div className={w.page}>
      <PageHeader title="Employees" description="Directory of everyone hired, with the recruitment history behind each hire."
        crumbs={[{ label: 'People' }, { label: 'Employees' }]}
        actions={<Button icon="plus" onClick={() => setDrawer({ open: true, employee: null })} disabled={!d}>Add employee manually</Button>} />
      <Card>
        <CardHeader title="HR checklist" subtitle="Track onboarding, documents, equipment and probation reviews for every new hire." />
        <ul className={s.checklist}>
          <li><Icon name="doc" size={16} />Employment agreement</li>
          <li><Icon name="key" size={16} />Access and equipment provisioning</li>
          <li><Icon name="calendar" size={16} />30 / 60 / 90 day reviews</li>
        </ul>
      </Card>
      <Card padding={0}>
        <div className={s.tableHead}>
          <CardHeader title="Employee directory" subtitle={d ? `${d.employees.length} record${d.employees.length === 1 ? '' : 's'}${d.fromPipelineCount ? ` · ${d.fromPipelineCount} hired through the pipeline` : ''}` : undefined} />
        </div>
        <DataTable columns={columns} rows={d?.employees ?? []} rowKey={(e) => e.id} loading={!d} caption="Employee directory"
          onRowClick={(e) => setDrawer({ open: true, employee: e })}
          empty={<EmptyState compact icon="employees" title="No employees yet" text="Hired candidates appear here when you use “Add to employees” on their profile. You can also add someone manually."
            actions={<Button icon="plus" onClick={() => setDrawer({ open: true, employee: null })}>Add employee manually</Button>} />} />
      </Card>
      {d ? <EmployeeDrawer open={drawer.open} employee={drawer.employee} data={d} onClose={() => setDrawer({ open: false, employee: null })} /> : null}
    </div>
  );
}
