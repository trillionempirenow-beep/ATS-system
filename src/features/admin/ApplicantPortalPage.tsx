import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { PortalOverviewDto } from '@shared/api/admin';
import { Button, ButtonLink } from '@/components/ui/Button';
import { Avatar, StatusBadge } from '@/components/ui/Display';
import { Field, Select, TextInput, Textarea, Toggle, formStyles } from '@/components/ui/Form';
import { EmptyState, Notice, Skeleton } from '@/components/ui/Feedback';
import { Card, CardHeader, DataTable, PageHeader, StatCard, StatGrid, type Column } from '@/components/ui/Surface';
import { useToast } from '@/components/ui/Toast';
import { QueryErrorPage } from '@/app/system/StatusPages';
import { ApiError, api, errorMessage } from '@/lib/api';
import { formatDate } from '@/lib/format';
import { adminKeys, useAdminMutation } from './api';
import w from '../workspace.module.css';
import s from './Admin.module.css';

type PortalJob = PortalOverviewDto['jobs'][number];
type PortalApp = PortalOverviewDto['recentApplications'][number];
type Visibility = 'open' | 'paused' | 'closed';
const VISIBILITY_LABELS: Record<Visibility, string> = { open: 'Visible', paused: 'Paused', closed: 'Closed' };

function PortalSettings({ settings }: { settings: PortalOverviewDto['settings'] }) {
  const toast = useToast();
  const [accepting, setAccepting] = useState(settings.acceptingApplications);
  const [closedMessage, setClosedMessage] = useState(settings.closedMessage);
  const [headline, setHeadline] = useState(settings.careersHeadline);
  const [limit, setLimit] = useState(settings.defaultApplicantLimit);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const save = useAdminMutation(() => api.put('/portal/settings', { acceptingApplications: accepting, closedMessage, careersHeadline: headline, defaultApplicantLimit: limit }));
  return (
    <Card>
      <CardHeader title="Portal settings" />
      <div className={formStyles.stack}>
        <Toggle checked={accepting} onChange={setAccepting} label="Open careers site" description={accepting ? 'Candidates can apply to visible roles.' : 'Applications are closed. Roles stay readable.'} />
        <Field label="Message shown when applications are closed" error={errors.closedMessage}><Textarea rows={3} maxLength={500} value={closedMessage} onChange={(e) => setClosedMessage(e.target.value)} /></Field>
        <Field label="Careers page headline" error={errors.careersHeadline}><TextInput value={headline} onChange={(e) => setHeadline(e.target.value)} maxLength={160} /></Field>
        <Field label="Default applicant limit for new roles" optional error={errors.defaultApplicantLimit}><TextInput inputMode="numeric" value={limit} onChange={(e) => setLimit(e.target.value)} /></Field>
        <div className={w.formActions}>
          <Button loading={save.isPending} onClick={() => {
            setErrors({});
            if (!/^\d*$/.test(limit.trim())) { setErrors({ defaultApplicantLimit: 'Use a whole number or leave blank.' }); return; }
            save.mutate(undefined, {
              onSuccess: () => toast.success('Portal settings saved.'),
              onError: (e) => { if (e instanceof ApiError && Object.keys(e.fields).length) setErrors(e.fields); else toast.error(errorMessage(e)); },
            });
          }}>Save portal settings</Button>
        </div>
      </div>
    </Card>
  );
}

function VisibilityEditor({ job, canPublish }: { job: PortalJob; canPublish: boolean }) {
  const toast = useToast();
  const initial: Visibility = job.status === 'open' || job.status === 'paused' || job.status === 'closed' ? job.status : 'closed';
  const [value, setValue] = useState<Visibility>(initial);
  const save = useAdminMutation(() => api.patch(`/portal/jobs/${job.id}`, { status: value }));
  const approved = job.state === 'published' || job.state === 'paused' || job.state === 'closed' || job.state === 'approved';
  if (!approved) return <span className={w.faint}>Needs approval first</span>;
  const options = (['open', 'paused', 'closed'] as const).filter((v) => v !== 'open' || canPublish || job.status === 'open');
  return (
    <span className={s.inlineEdit}>
      <Select inputSize="sm" aria-label={`Visibility of ${job.title}`} value={value} onChange={(e) => setValue(e.target.value as Visibility)} options={options.map((v) => ({ value: v, label: VISIBILITY_LABELS[v] }))} />
      <Button size="sm" variant={value !== initial ? 'primary' : 'secondary'} disabled={value === initial} loading={save.isPending}
        onClick={() => save.mutate(undefined, { onSuccess: () => toast.success(`${job.title} is now ${VISIBILITY_LABELS[value].toLowerCase()}.`), onError: (e) => { toast.error(errorMessage(e)); setValue(initial); } })}>Save</Button>
    </span>
  );
}

function AppStatus({ app }: { app: PortalApp }) {
  const toast = useToast();
  const next = app.status === 'active' ? 'withdrawn' : 'active';
  const save = useAdminMutation(() => api.patch(`/portal/applications/${app.id}`, { status: next }));
  return (
    <span className={s.inlineEdit}>
      <span className={w.faint}>{app.status === 'active' ? 'Active' : 'Withdrawn'}</span>
      <Button size="sm" variant="ghost" loading={save.isPending} onClick={() => save.mutate(undefined, {
        onSuccess: () => toast.success(next === 'withdrawn' ? `${app.candidateName}’s application was withdrawn.` : `${app.candidateName}’s application is active again.`),
        onError: (e) => toast.error(errorMessage(e)),
      })}>{app.status === 'active' ? 'Withdraw' : 'Restore'}</Button>
    </span>
  );
}

export function ApplicantPortalPage() {
  const q = useQuery({ queryKey: adminKeys.portal, queryFn: () => api.get<PortalOverviewDto>('/portal/overview') });
  useEffect(() => { document.title = 'Applicant portal · Acme People'; }, []);
  if (q.isError) return <QueryErrorPage error={q.error} onRetry={() => void q.refetch()} />;
  const d = q.data;

  const jobCols: Column<PortalJob>[] = [
    { key: 'role', header: 'Role', cell: (j) => j.title, primary: true },
    { key: 'dept', header: 'Department', cell: (j) => j.department ?? '—', label: 'Department' },
    { key: 'apps', header: 'Applicants', cell: (j) => (j.applicantLimit ? `${j.applications} / ${j.applicantLimit}` : j.applications), align: 'right', label: 'Applicants' },
    { key: 'state', header: 'State', cell: (j) => <StatusBadge kind="job" value={j.state} size="sm" />, label: 'State' },
    { key: 'vis', header: 'Visibility', cell: (j) => <VisibilityEditor job={j} canPublish={d?.canPublish ?? false} />, label: 'Visibility' },
  ];
  const appCols: Column<PortalApp>[] = [
    {
      key: 'who', header: 'Applicant', primary: true,
      cell: (a) => <span className={w.person}><Avatar name={a.candidateName} size={30} /><span className={w.personText}><span className={w.personName}>{a.candidateName}</span><span className={w.personSub}>{a.email}</span></span></span>,
    },
    { key: 'role', header: 'Role', cell: (a) => a.jobTitle, label: 'Role' },
    { key: 'stage', header: 'Stage', cell: (a) => <StatusBadge kind="stage" value={a.stage} size="sm" />, label: 'Stage' },
    { key: 'applied', header: 'Applied', cell: (a) => formatDate(a.appliedAt, { month: 'short', day: 'numeric' }), label: 'Applied' },
    { key: 'status', header: 'Status', cell: (a) => <AppStatus app={a} />, label: 'Status' },
  ];

  return (
    <div className={w.page}>
      <PageHeader title="Applicant portal" description="What candidates see on the public careers site, and who has registered."
        crumbs={[{ label: 'Administration' }, { label: 'Applicant portal' }]}
        actions={<ButtonLink variant="secondary" icon="external" to="/" target="_blank" rel="noopener noreferrer">Open careers site</ButtonLink>} />
      <StatGrid>
        <StatCard icon="candidates" label="Registered applicants" value={d?.stats.candidates ?? 0} loading={!d} />
        <StatCard icon="doc" label="Applications received" value={d?.stats.applications ?? 0} loading={!d} />
        <StatCard icon="checkcircle" label="Active applications" value={d?.stats.active ?? 0} loading={!d} />
        <StatCard icon="plus" label="New this week" value={d?.stats.newThisWeek ?? 0} loading={!d} />
      </StatGrid>
      {d && !d.settings.acceptingApplications ? <Notice tone="warning" title="The careers site is closed to applications">Candidates see: “{d.settings.closedMessage || 'Applications are closed.'}”</Notice> : null}
      <div className={w.cols12}>
        {d ? <PortalSettings key={JSON.stringify(d.settings)} settings={d.settings} /> : <Skeleton height={360} />}
        <Card padding={0}>
          <div className={s.tableHead}><CardHeader title="What applicants can see" subtitle="Only approved postings can be made visible." /></div>
          <DataTable columns={jobCols} rows={d?.jobs ?? []} rowKey={(j) => j.id} loading={!d} caption="Job visibility"
            empty={<EmptyState compact icon="briefcase" title="No roles yet" />} />
        </Card>
      </div>
      <Card padding={0}>
        <div className={s.tableHead}><CardHeader title="Latest applications" actions={<ButtonLink size="sm" variant="secondary" to="/app/pipeline">Open hiring pipeline</ButtonLink>} /></div>
        <DataTable columns={appCols} rows={d?.recentApplications ?? []} rowKey={(a) => a.id} loading={!d} caption="Latest applications"
          empty={<EmptyState compact icon="doc" title="No applications yet" text="Applications from the careers site appear here." />} />
      </Card>
      {d && d.registrations.length ? (
        <Card>
          <CardHeader title="Recent registrations" subtitle="Applicants who created a profile through the careers site" />
          <ul className={w.list}>
            {d.registrations.map((r) => (
              <li key={r.id} className={w.listItem}>
                <span className={w.person}><Avatar name={r.name} size={28} /><span className={w.personText}><span className={w.personName}>{r.name}</span><span className={w.personSub}>{r.email}</span></span></span>
                <span className={w.faint}>{r.applications} application{r.applications === 1 ? '' : 's'} · {formatDate(r.createdAt, { month: 'short', day: 'numeric' })}</span>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}
    </div>
  );
}
