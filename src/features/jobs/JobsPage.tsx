import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import type { JobRowDto } from '@shared/api/jobs';
import { JOB_STATUSES, type JobStatus } from '@shared/domain/jobs';
import { Button, ButtonLink } from '@/components/ui/Button';
import { StatusBadge } from '@/components/ui/Display';
import { Checkbox, Field, Select, TextInput, Textarea, formStyles } from '@/components/ui/Form';
import { EmptyState, Notice } from '@/components/ui/Feedback';
import { Drawer, Modal } from '@/components/ui/Overlay';
import { Card, CardHeader, DataTable, PageHeader, StatCard, StatGrid, type Column } from '@/components/ui/Surface';
import { useToast } from '@/components/ui/Toast';
import { QueryErrorPage } from '@/app/system/StatusPages';
import { ApiError, errorMessage } from '@/lib/api';
import { formatDate } from '@/lib/format';
import { useCreateDepartment, useJobStatus, useJobsOverview, useQuickEdit } from './api';
import { ApplicantsCell, CreatorCell, RoleCell } from './JobCells';
import w from '../workspace.module.css';
import s from './Jobs.module.css';

const STATUS_LABELS: Record<JobStatus, string> = { draft: 'Draft', open: 'Open', paused: 'Paused', closed: 'Closed' };

function StatusEditor({ job }: { job: JobRowDto }) {
  const toast = useToast();
  const mutation = useJobStatus();
  const [value, setValue] = useState<JobStatus>(job.status);
  useEffect(() => setValue(job.status), [job.status]);
  const dirty = value !== job.status;
  return (
    <div className={s.statusEdit} onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
      <Select inputSize="sm" aria-label={`Status of ${job.title}`} value={value} onChange={(e) => setValue(e.target.value as JobStatus)}
        options={JOB_STATUSES.map((st) => ({ value: st, label: STATUS_LABELS[st] }))} />
      <Button size="sm" variant={dirty ? 'primary' : 'secondary'} disabled={!dirty} loading={mutation.isPending}
        onClick={() => mutation.mutate({ id: job.id, status: value }, {
          onSuccess: () => toast.success(`${job.title} is now ${STATUS_LABELS[value].toLowerCase()}.`),
          onError: (e) => { toast.error(errorMessage(e)); setValue(job.status); },
        })}>Save</Button>
    </div>
  );
}

function QuickEdit({ job, onClose }: { job: JobRowDto | null; onClose: () => void }) {
  const toast = useToast();
  const mutation = useQuickEdit(job?.id ?? 0);
  const [tags, setTags] = useState('');
  const [limit, setLimit] = useState('');
  const [urgent, setUrgent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!job) return;
    setTags(job.tags.join(', '));
    setLimit(job.applicantLimit ? String(job.applicantLimit) : '');
    setUrgent(job.isUrgent);
    setError(null);
  }, [job]);
  if (!job) return null;
  const save = () => {
    const n = limit.trim() ? Number(limit) : null;
    if (n !== null && (!Number.isInteger(n) || n < 0)) return setError('The applicant limit must be a whole number, or blank for unlimited.');
    mutation.mutate({ tags, applicantLimit: n, isUrgent: urgent }, {
      onSuccess: () => { toast.success('Listing updated.'); onClose(); },
      onError: (e) => setError(errorMessage(e)),
    });
  };
  return (
    <Drawer open onClose={onClose} title="Quick edit" subtitle={job.title}
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button onClick={save} loading={mutation.isPending}>Save changes</Button></>}>
      <div className={formStyles.stack}>
        {error ? <Notice tone="danger">{error}</Notice> : null}
        <Field label="Tags" hint="Comma-separated, max 6"><TextInput value={tags} onChange={(e) => setTags(e.target.value)} /></Field>
        <Field label="Applicant limit" optional hint="Leave blank for unlimited. The listing closes to new applicants when it is reached.">
          <TextInput type="number" min={0} value={limit} onChange={(e) => setLimit(e.target.value)} />
        </Field>
        <Checkbox checked={urgent} onChange={(e) => setUrgent(e.target.checked)} label="Mark as Urgent Hiring" description="Featured at the top of the public careers site" />
        <p className={w.faint}>To change the description or requirements, <Link className={w.link} to={`/app/jobs/${job.id}/edit`}>open the full editor</Link>.</p>
      </div>
    </Drawer>
  );
}

function AddDepartment({ open, onClose }: { open: boolean; onClose: () => void }) {
  const toast = useToast();
  const mutation = useCreateDepartment();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { if (open) { setName(''); setDescription(''); setError(null); } }, [open]);
  const save = () => {
    if (!name.trim()) return setError('Name the department.');
    mutation.mutate({ name: name.trim(), description: description.trim() }, {
      onSuccess: () => { toast.success(`${name.trim()} was added.`); onClose(); },
      onError: (e) => setError(e instanceof ApiError && e.fields.name ? e.fields.name : errorMessage(e)),
    });
  };
  return (
    <Modal open={open} onClose={onClose} title="Add department" subtitle="Departments group job postings and employees."
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button onClick={save} loading={mutation.isPending}>Add department</Button></>}>
      <div className={formStyles.stack}>
        <Field label="Name" required error={error ?? undefined}><TextInput value={name} onChange={(e) => setName(e.target.value)} autoFocus /></Field>
        <Field label="Description" optional><Textarea rows={3} maxLength={500} value={description} onChange={(e) => setDescription(e.target.value)} /></Field>
      </div>
    </Modal>
  );
}

export function JobsPage() {
  const q = useJobsOverview();
  const [editing, setEditing] = useState<JobRowDto | null>(null);
  const [addDept, setAddDept] = useState(false);
  const navigate = useNavigate();
  useEffect(() => { document.title = 'Job management · Acme People'; }, []);
  if (q.isError) return <QueryErrorPage error={q.error} onRetry={() => void q.refetch()} />;
  const d = q.data;

  const columns: Column<JobRowDto>[] = [
    { key: 'role', header: 'Role', cell: (j) => <RoleCell job={j} />, primary: true },
    { key: 'dept', header: 'Department', cell: (j) => j.department ?? '—', label: 'Department' },
    { key: 'apps', header: 'Applicants', cell: (j) => <ApplicantsCell job={j} />, label: 'Applicants' },
    { key: 'creator', header: 'Created by', cell: (j) => <CreatorCell job={j} />, label: 'Created by' },
    { key: 'posted', header: 'Posted', cell: (j) => formatDate(j.publishedAt ?? j.createdAt, { month: 'short', day: 'numeric' }), label: 'Posted' },
    {
      key: 'status', header: 'Status', label: 'Status',
      cell: (j) => j.state === 'pending' ? <StatusBadge kind="job" value="pending" size="sm" /> : <StatusEditor job={j} />,
    },
    {
      key: 'actions', header: 'Actions', align: 'right',
      cell: (j) => (
        <div className={s.rowActions} onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
          <Button size="sm" variant="ghost" onClick={() => setEditing(j)}>Quick edit</Button>
          {j.state === 'published' ? <ButtonLink size="sm" variant="ghost" icon="external" to={`/jobs/${j.slug}`} target="_blank" rel="noopener noreferrer" aria-label={`View ${j.title} on the careers site`} /> : null}
        </div>
      ),
    },
  ];

  return (
    <div className={w.page}>
      <PageHeader title="Job management" description="Every listing, its applicants and its status in one place." crumbs={[{ label: 'Jobs' }, { label: 'Job management' }]}
        actions={<>
          <ButtonLink variant="secondary" to="/app/admin/audit">Audit trail</ButtonLink>
          <ButtonLink variant="secondary" to="/app/admin/settings">Workspace settings</ButtonLink>
        </>} />
      <StatGrid>
        <StatCard icon="briefcase" label="Job listings" value={d?.jobs.length ?? 0} loading={!d} />
        <StatCard icon="candidates" label="Total applications" value={d?.counts.applications ?? 0} loading={!d} />
        <StatCard icon="interviews" label="Upcoming interviews" value={d?.counts.upcomingInterviews ?? 0} loading={!d} />
        <StatCard icon="building" label="Departments" value={d?.departments.length ?? 0} loading={!d} />
      </StatGrid>
      {d && d.counts.pendingApprovals > 0 && d.canPublish ? (
        <Notice tone="warning" title={`${d.counts.pendingApprovals} job posting${d.counts.pendingApprovals === 1 ? ' is' : 's are'} waiting for approval`}
          action={<ButtonLink size="sm" to="/app/jobs/approvals">Open the approval queue</ButtonLink>}>
          Nothing an HR / Recruiter writes reaches the careers site until it is approved.
        </Notice>
      ) : null}
      <Card padding={0}>
        <div className={s.tableHead}>
          <CardHeader title="Job listings" subtitle="Auto-dated on creation · applicant counts update live"
            actions={<>
              <Button size="sm" variant="secondary" icon="building" onClick={() => setAddDept(true)}>Add department</Button>
              <ButtonLink size="sm" icon="plus" to="/app/jobs/new">Create job posting</ButtonLink>
            </>} />
        </div>
        <DataTable columns={columns} rows={d?.jobs ?? []} rowKey={(j) => j.id} loading={!d} caption="Job listings" onRowClick={(j) => navigate(`/app/jobs/${j.id}`)}
          empty={<EmptyState compact icon="briefcase" title="No job listings yet" text="Create the first posting, or add departments to organise them." actions={<ButtonLink icon="plus" to="/app/jobs/new">Create job posting</ButtonLink>} />} />
      </Card>
      {d && d.departments.length ? (
        <Card>
          <CardHeader title="Departments" subtitle={`${d.departments.length} in the workspace`} />
          <ul className={s.deptList}>
            {d.departments.map((dep) => (
              <li key={dep.id}><strong>{dep.name}</strong><span>{dep.jobCount} job{dep.jobCount === 1 ? '' : 's'}{dep.description ? ` · ${dep.description}` : ''}</span></li>
            ))}
          </ul>
        </Card>
      ) : null}
      <QuickEdit job={editing} onClose={() => setEditing(null)} />
      <AddDepartment open={addDept} onClose={() => setAddDept(false)} />
    </div>
  );
}
