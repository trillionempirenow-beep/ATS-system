import { useEffect, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import type { AnalyticsDto, PersonalAnalyticsDto, TeamAnalyticsDto, TeamRow } from '@shared/api/insights';
import { ROLE_LABELS } from '@shared/domain/access';
import { BarSeries, ChartEmpty, LabeledBars, STAGE_CHART_COLORS } from '@/components/charts/Charts';
import { Button, ButtonLink } from '@/components/ui/Button';
import { Avatar } from '@/components/ui/Display';
import { Select } from '@/components/ui/Form';
import { EmptyState, Skeleton, Timeline } from '@/components/ui/Feedback';
import { Card, CardHeader, DataTable, PageHeader, StatCard, StatGrid, type Column } from '@/components/ui/Surface';
import { QueryErrorPage } from '@/app/system/StatusPages';
import { useAuth } from '@/app/providers/AuthProvider';
import { api, qs } from '@/lib/api';
import { formatDate } from '@/lib/format';
import { RangeBar, useRangeParams, type RangeParams } from './RangeBar';
import w from '../workspace.module.css';
import s from './Insights.module.css';

const exportHref = (p: RangeParams) => `/api/v1/analytics/report.csv${qs({ range: p.range, from: p.from, to: p.to, user: p.user })}`;

export function AnalyticsPage() {
  const [params, update] = useRangeParams();
  const { can } = useAuth();
  const q = useQuery({
    queryKey: ['analytics', params],
    queryFn: () => api.get<AnalyticsDto>(`/analytics${qs({ range: params.range, from: params.from, to: params.to, user: params.user, view: params.view })}`),
    placeholderData: (prev) => prev,
  });
  useEffect(() => { document.title = 'Analytics · Acme People'; }, []);
  if (q.isError) return <QueryErrorPage error={q.error} onRetry={() => void q.refetch()} />;
  const d = q.data;
  const exportBtn = can.adminLevel ? <ButtonLink variant="secondary" icon="download" to={exportHref(params)} reloadDocument>Export report</ButtonLink> : null;
  const bar = <Card><RangeBar value={params} onApply={(v) => update(v)} actions={exportBtn} /></Card>;

  if (!d) return <div className={w.page}><PageHeader title="Analytics" crumbs={[{ label: 'Recruiting' }, { label: 'Analytics' }]} />{bar}<Skeleton height={120} /><Skeleton height={320} /></div>;
  return d.mode === 'team'
    ? <TeamView d={d} bar={bar} params={params} update={update} />
    : <PersonalView d={d} bar={bar} update={update} />;
}

function PersonalView({ d, bar, update }: { d: PersonalAnalyticsDto; bar: ReactNode; update: (p: Partial<RangeParams>) => void }) {
  const { can } = useAuth();
  const i = d.interviews;
  const progressedPct = d.outcomes.progressed + d.outcomes.notProgressed > 0
    ? Math.round((d.outcomes.progressed / (d.outcomes.progressed + d.outcomes.notProgressed)) * 100) : null;
  const title = d.subject.isMe ? 'Analytics' : `Analytics · ${d.subject.name}`;
  return (
    <div className={w.page}>
      <PageHeader title={title} description={d.subject.isMe ? 'Your candidate and interview activity for the selected period.' : `${d.subject.name}’s candidate and interview activity for the selected period.`}
        crumbs={[{ label: 'Recruiting' }, { label: 'Analytics' }]}
        actions={can.adminLevel ? (
          <>
            {d.team.length ? (
              <Select inputSize="sm" aria-label="Whose analytics" value={d.subject.isMe ? '' : String(d.subject.id)}
                onChange={(e) => update({ user: e.target.value || undefined, view: e.target.value ? undefined : 'me' })}
                options={[{ value: '', label: 'My own analytics' }, ...d.team.map((m) => ({ value: m.id, label: m.name }))]} />
            ) : null}
            <Button variant="secondary" size="sm" onClick={() => update({ user: undefined, view: undefined })}>Team performance</Button>
          </>
        ) : null} />
      {bar}
      {!d.hasData ? (
        <Card>
          <EmptyState icon="analytics" title="No activity in this period" text={`No candidates or interviews recorded for ${d.range.label}. Try a wider date range.`}
            actions={<Button variant="secondary" onClick={() => update({ range: 'quarter' })}>Last 3 months</Button>} />
        </Card>
      ) : (
        <>
          <StatGrid>
            <StatCard icon="candidates" label="Total handled" value={d.candidates.assigned} />
            <StatCard icon="calendar" label="Upcoming" value={i.upcoming} />
            <StatCard icon="video" label="In progress" value={i.inProgress} />
            <StatCard icon="checkcircle" label="Completed" value={i.completed} />
            <StatCard icon="edit" label="Awaiting review" value={i.awaitingReview} />
            <StatCard icon="xcircle" label="Cancelled / no show" value={i.cancelled} />
            <StatCard icon="star" label="Average score" value={i.avgScore ?? '—'} hint={i.scored ? `${i.scored} of ${i.completed} scored` : undefined} />
            <StatCard icon="arrowr" label="Moved forward after interview" value={progressedPct !== null ? `${progressedPct}%` : '—'} />
          </StatGrid>
          <div className={w.cols11}>
            <Card>
              <CardHeader title="Candidate processing" subtitle="Cumulative: reached this stage or beyond" />
              <LabeledBars ariaLabel="Candidates reaching each stage" items={d.funnel.map((f, idx) => ({ label: f.label, value: f.count, color: STAGE_CHART_COLORS[idx % STAGE_CHART_COLORS.length] }))} />
              <div className={s.outcomes}>
                <span><b className="num">{d.outcomes.progressed}</b> moved forward</span>
                <span><b className="num">{d.outcomes.notProgressed}</b> not moved forward</span>
                {d.timeToHireDays !== null ? <span><b className="num">{d.timeToHireDays}</b> days to hire on average</span> : null}
                {d.offerAcceptance ? <span><b className="num">{d.offerAcceptance.rate}%</b> offer acceptance</span> : null}
              </div>
            </Card>
            <Card>
              <CardHeader title="Interviews completed over time" subtitle="In the selected period" />
              {d.timeline.some((t) => t.total > 0)
                ? <BarSeries ariaLabel="Interviews completed over time" unit="interviews" data={d.timeline.map((t) => ({ label: t.label, value: t.total }))} />
                : <ChartEmpty>No completed interviews in this period.</ChartEmpty>}
            </Card>
          </div>
          <Card>
            <CardHeader title="Activity timeline" subtitle="From the audit trail" />
            {d.activity.length
              ? <Timeline items={d.activity.map((a) => ({ key: a.id, title: a.text, sub: formatDate(a.createdAt), done: true }))} />
              : <p className={w.faint}>No recorded activity in this period.</p>}
          </Card>
        </>
      )}
    </div>
  );
}

function TeamView({ d, bar, params, update }: { d: TeamAnalyticsDto; bar: ReactNode; params: RangeParams; update: (p: Partial<RangeParams>) => void }) {
  const navigate = useNavigate();
  const columns: Column<TeamRow>[] = [
    {
      key: 'who', header: 'HR / Recruiter', primary: true,
      cell: (r) => (
        <span className={w.person}>
          <Avatar name={r.user.name} size={30} />
          <span className={w.personText}><span className={w.personName}>{r.user.name}</span><span className={w.personSub}>{ROLE_LABELS[r.user.role]}{r.user.accountStatus !== 'active' ? ` · ${r.user.accountStatus}` : ''}</span></span>
        </span>
      ),
    },
    { key: 'c', header: 'Candidates', cell: (r) => r.candidates, align: 'right', label: 'Candidates' },
    { key: 'p', header: 'Processing', cell: (r) => r.processing, align: 'right', label: 'Processing' },
    { key: 'i', header: 'Interviews', cell: (r) => r.interviews, align: 'right', label: 'Interviews' },
    { key: 'h', header: 'Hired', cell: (r) => r.hired, align: 'right', label: 'Hired' },
    { key: 's', header: 'Avg. score', cell: (r) => r.avgScore ?? '—', align: 'right', label: 'Avg. score' },
    { key: 'go', header: <span className="sr-only">Open</span>, align: 'right', cell: (r) => <Button size="sm" variant="ghost" onClick={(e) => { e.stopPropagation(); update({ user: String(r.user.id) }); }}>View analytics</Button> },
  ];
  return (
    <div className={w.page}>
      <PageHeader title="Analytics · Team performance" description="Compare workload and outcomes across the HR / Recruiters under your account."
        crumbs={[{ label: 'Recruiting' }, { label: 'Analytics' }]}
        actions={<Button variant="secondary" onClick={() => update({ view: 'me', user: undefined })}>My own analytics</Button>} />
      {bar}
      {d.rows.length === 0 ? (
        <Card><EmptyState icon="users" title="No HR / Recruiters yet" text="Once you add HR / Recruiters under your account, their workload and outcomes appear here."
          actions={<ButtonLink to="/app/admin/users">Create HR / Recruiter</ButtonLink>} /></Card>
      ) : (
        <>
          <StatGrid>
            <StatCard icon="candidates" label="Candidates" value={d.totals.candidates} />
            <StatCard icon="interviews" label="Interviews" value={d.totals.interviews} />
            <StatCard icon="checkcircle" label="Hired" value={d.totals.hired} />
            <StatCard icon="users" label="Active members" value={`${d.members.active} of ${d.members.total}`} />
          </StatGrid>
          <Card padding={0}>
            <div className={s.tableHead}>
              <CardHeader title="HR / Recruiter performance" subtitle={`Under your account · ${d.range.label}`}
                actions={<ButtonLink size="sm" variant="secondary" to={`/app/analytics/report${qs({ range: params.range, from: params.from, to: params.to })}`}>View report</ButtonLink>} />
            </div>
            <DataTable columns={columns} rows={d.rows} rowKey={(r) => r.user.id} caption="HR / Recruiter performance" onRowClick={(r) => navigate(`/app/analytics?user=${r.user.id}&range=${params.range}`)} />
          </Card>
          <Card>
            <CardHeader title="Comparison" subtitle="Candidates processed per HR / Recruiter" />
            {d.hasData
              ? <LabeledBars ariaLabel="Candidates processed per HR / Recruiter" items={d.rows.map((r) => ({ label: r.user.name, value: r.processing, color: 'var(--chart-1)' }))} />
              : <ChartEmpty>No candidate activity in this period.</ChartEmpty>}
          </Card>
        </>
      )}
    </div>
  );
}
