import { useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import type { DashboardDto } from '@shared/api/insights';
import { STAGE_LABELS } from '@shared/domain/pipeline';
import type { DisplayInterviewState } from '@shared/domain/interviews';
import type { JobState } from '@shared/domain/jobs';
import { ButtonLink } from '@/components/ui/Button';
import { Avatar, Badge, StatusBadge } from '@/components/ui/Display';
import { EmptyState, Skeleton } from '@/components/ui/Feedback';
import { Card, CardHeader, DataTable, PageHeader, StatCard, StatGrid } from '@/components/ui/Surface';
import { AreaTrend, ChartEmpty, LabeledBars } from '@/components/charts/Charts';
import { QueryErrorPage } from '@/app/system/StatusPages';
import { useAuth } from '@/app/providers/AuthProvider';
import { api } from '@/lib/api';
import { formatTime, timeAgo } from '@/lib/format';
import w from '../workspace.module.css';

export function DashboardPage() {
  const navigate = useNavigate();
  const { can } = useAuth();
  const q = useQuery({ queryKey: ['dashboard'], queryFn: () => api.get<DashboardDto>('/dashboard'), refetchInterval: 60_000 });
  useEffect(() => { document.title = 'Overview · Acme People'; }, []);
  if (q.isError) return <QueryErrorPage error={q.error} onRetry={() => void q.refetch()} />;
  const d = q.data;
  const trendEmpty = d ? d.trend.every((t) => t.count === 0) : false;
  const weekNow = d ? d.trend.slice(7).reduce((a, b) => a + b.count, 0) : 0;
  const weekPrev = d ? d.trend.slice(0, 7).reduce((a, b) => a + b.count, 0) : 0;
  const change = weekPrev ? Math.round(((weekNow - weekPrev) / weekPrev) * 100) : null;

  return (
    <div className={w.page}>
      <PageHeader
        crumbs={[{ label: 'Recruiting' }, { label: 'Overview' }]}
        title="Recruiter overview"
        description="A working view of your hiring operation."
        actions={<>
          <ButtonLink to="/" variant="secondary" icon="public">View careers site</ButtonLink>
          {can.permission('job_posting') ? <ButtonLink to="/app/jobs/new" icon="plus">New job</ButtonLink> : null}
        </>}
      />
      <StatGrid>
        <StatCard icon="briefcase" label="Open roles" value={d?.stats.openRoles.value ?? 0} delta={d?.stats.openRoles.delta} loading={!d} />
        <StatCard icon="candidates" label="Active candidates" value={d?.stats.activeCandidates.value ?? 0} delta={d?.stats.activeCandidates.delta} loading={!d} />
        <StatCard icon="interviews" label="Interviews this week" value={d?.stats.interviewsThisWeek.value ?? 0} loading={!d} />
        <StatCard icon="checkcircle" label="Hired this month" value={d?.stats.hiredThisMonth.value ?? 0} loading={!d} />
      </StatGrid>

      <div className={w.cols21}>
        <Card>
          <CardHeader title="Applications received" subtitle="Last 14 days · this week vs. the previous 7 days"
            actions={change !== null && !trendEmpty ? <Badge tone={change >= 0 ? 'success' : 'danger'} size="sm">{change >= 0 ? `+${change}` : change}%</Badge> : null} />
          {!d ? <Skeleton height={220} /> : trendEmpty ? (
            <ChartEmpty>Applications from the careers site will chart here once a role is published.</ChartEmpty>
          ) : (
            <AreaTrend unit="application" ariaLabel="Applications received per day over the last 14 days"
              data={d.trend.map((t) => ({ label: new Date(`${t.date}T12:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }), value: t.count }))} />
          )}
        </Card>
        <Card>
          <CardHeader title="Pipeline overview" subtitle="Active candidates by stage" actions={<ButtonLink to="/app/pipeline" size="sm" variant="ghost" iconRight="arrowr">Open pipeline</ButtonLink>} />
          {!d ? <Skeleton height={200} /> : <LabeledBars ariaLabel="Active candidates by stage" items={d.funnel.map((f) => ({ label: STAGE_LABELS[f.stage], value: f.count }))} />}
        </Card>
      </div>

      <div className={w.cols11}>
        <Card>
          <CardHeader title="Upcoming interviews" actions={<ButtonLink to="/app/interviews" size="sm" variant="ghost" iconRight="arrowr">See all</ButtonLink>} />
          {!d ? <Skeleton height={200} /> : d.upcoming.length === 0 ? (
            <EmptyState compact icon="calendar" title="No interviews scheduled" text="Schedule a screening or interview from a candidate's profile or the Interviews page." />
          ) : (
            <div className={w.list}>
              {d.upcoming.map((u) => {
                const date = new Date(u.startsAt);
                return (
                  <Link key={u.id} to="/app/interviews" className={`${w.listItem} ${w.listItemLink}`}>
                    <span className={w.dateChip}><span>{date.toLocaleDateString('en-US', { month: 'short' })}</span><strong>{date.getDate()}</strong></span>
                    <span className={w.personText} style={{ flex: 1 }}>
                      <span className={`${w.personName} ${w.strong}`}>{u.candidateName}</span>
                      <span className={w.personSub}>{formatTime(u.startsAt)} · {u.meetingType === 'screening' ? 'Screening' : 'Interview'} · {u.interviewType.charAt(0).toUpperCase() + u.interviewType.slice(1)}</span>
                    </span>
                    <StatusBadge kind="interview" value={u.state as DisplayInterviewState} size="sm" />
                  </Link>
                );
              })}
            </div>
          )}
        </Card>
        <Card>
          <CardHeader title="Applications to review" subtitle="Published roles with new applicants" />
          {!d ? <Skeleton height={200} /> : d.jobsToReview.length === 0 ? (
            <EmptyState compact icon="briefcase" title="No published roles" text="Roles appear here once they are live on the careers site." />
          ) : (
            <div className={w.list}>
              {d.jobsToReview.map((j) => (
                <div key={j.id} className={w.listItem}>
                  <span className={w.personText} style={{ flex: 1 }}>
                    <span className={w.row} style={{ gap: 8 }}><span className={`${w.personName} ${w.strong}`}>{j.title}</span><StatusBadge kind="job" value={j.state as JobState} size="sm" /></span>
                    <span className={w.personSub}>{j.department ?? 'No department'} · {j.applications} new</span>
                  </span>
                  <ButtonLink size="sm" variant="ghost" iconRight="arrowr" to={`/app/candidates?job=${j.id}&stage=new`}>Review</ButtonLink>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>

      <Card padding={0}>
        <CardHeader flush title="Recent applications" actions={<ButtonLink to="/app/candidates" size="sm" variant="ghost" iconRight="arrowr">See all candidates</ButtonLink>} />
        <DataTable
          loading={!d}
          rows={d?.recent ?? []}
          rowKey={(r) => r.applicationId}
          onRowClick={(r) => navigate(`/app/candidates/${r.applicationId}`)}
          empty={<EmptyState compact icon="candidates" title="No applications yet" text="New applications will show up here as they arrive." />}
          columns={[
            { key: 'c', header: 'Candidate', primary: true, cell: (r) => (
              <span className={w.person}><Avatar name={r.candidateName} src={r.avatarUrl} size={32} /><span className={w.personText}><span className={w.personName}>{r.candidateName}</span><span className={w.personSub}>{r.email}</span></span></span>
            ) },
            { key: 'r', header: 'Role', cell: (r) => r.jobTitle },
            { key: 's', header: 'Stage', cell: (r) => <StatusBadge kind="stage" value={r.stage} size="sm" /> },
            { key: 'u', header: 'Updated', align: 'right', cell: (r) => <span className={w.faint}>{timeAgo(r.updatedAt)}</span> },
          ]}
        />
      </Card>
    </div>
  );
}
