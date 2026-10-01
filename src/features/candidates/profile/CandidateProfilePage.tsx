import { useEffect, useState, type CSSProperties } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { STAGE_LABELS, STAGE_ORDER, stageRank, type Stage } from '@shared/domain/pipeline';
import { Icon } from '@/components/icon/Icon';
import { Button } from '@/components/ui/Button';
import { Avatar, Rating, StatusBadge } from '@/components/ui/Display';
import { Notice, Skeleton } from '@/components/ui/Feedback';
import { Menu } from '@/components/ui/Overlay';
import { Card, Tabs } from '@/components/ui/Surface';
import { useToast } from '@/components/ui/Toast';
import { QueryErrorPage } from '@/app/system/StatusPages';
import { api, errorMessage } from '@/lib/api';
import { cx } from '@/lib/cx';
import { StageMoveDialog, type PendingMove } from '../../pipeline/StageMoveDialog';
import { useCandidate, useCandidateAction } from '../api';
import { ProfileTab } from './ProfileTab';
import { ResumeTab } from './ResumeTab';
import { AnalysisTab } from './AnalysisTab';
import { InterviewsTab } from './InterviewsTab';
import { ActivityTab } from './ActivityTab';
import w from '../../workspace.module.css';
import s from './Profile.module.css';

const TABS = ['profile', 'resume', 'ai', 'interviews', 'activity'] as const;
type TabKey = (typeof TABS)[number];

function StageTrack({ stage }: { stage: Stage }) {
  const rank = stageRank(stage);
  const steps: Stage[] = stage === 'rejected' ? [...STAGE_ORDER, 'rejected'] : [...STAGE_ORDER];
  return (
    // The six steps sit on one row; Rejected only appears, at the end, for a rejected application.
    <div className={s.track} style={{ '--steps': steps.length } as CSSProperties} aria-label={`Current stage: ${STAGE_LABELS[stage]}`}>
      {steps.map((st) => {
        const r = stageRank(st);
        const current = st === stage;
        const done = stage !== 'rejected' && r !== -1 && r < rank;
        return (
          <span key={st} className={cx(s.trackStep, done && s.trackDone, current && (st === 'rejected' ? s.trackRejected : s.trackCurrent))} aria-current={current ? 'step' : undefined}>
            {STAGE_LABELS[st]}
          </span>
        );
      })}
    </div>
  );
}

export function CandidateProfilePage() {
  const { id = '' } = useParams();
  const applicationId = Number(id);
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const toast = useToast();
  const tab = (TABS as readonly string[]).includes(params.get('tab') ?? '') ? (params.get('tab') as TabKey) : 'profile';
  const q = useCandidate(applicationId);
  const [move, setMove] = useState<PendingMove | null>(null);
  const rate = useCandidateAction(applicationId, (rating: number) => api.put(`/candidates/${applicationId}/rating`, { rating }));
  useEffect(() => { if (q.data) document.title = `${q.data.name} · Candidates`; }, [q.data]);

  if (q.isError) return <QueryErrorPage error={q.error} onRetry={() => void q.refetch()} />;
  if (!q.data) {
    return (
      <div className={w.page}>
        <Skeleton height={16} width={140} />
        <Skeleton height={168} radius={12} />
        <Skeleton height={420} radius={12} />
      </div>
    );
  }
  const c = q.data;
  const openMove = (to: Stage) => setMove({ applicationId, name: c.name, jobTitle: c.job.title, avatarUrl: c.avatarUrl, from: c.stage, to });
  const withdrawn = c.applicationStatus === 'withdrawn';

  return (
    <div className={w.page}>
      <Link to="/app/candidates" className={w.link} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><Icon name="arrowl" size={16} />Back to candidates</Link>
      {withdrawn ? <Notice tone="info" title="The applicant withdrew this application.">It no longer appears in the pipeline. The record is kept for reference.</Notice> : null}
      {c.recordStatus === 'draft' ? <Notice tone="warning" title="Draft record">This candidate was saved as a draft from Add candidate.</Notice> : null}
      <Card padding={0}>
        <div className={s.header}>
          <div className={s.headTop}>
            <Avatar name={c.name} src={c.avatarUrl} size={64} />
            <div className={s.headInfo}>
              <h1 className={s.name}>{c.name}</h1>
              <div className={s.meta}>
                <span>{[c.job.title, c.job.department, c.job.location].filter(Boolean).join(' · ')}</span>
                <StatusBadge kind="stage" value={c.stage} />
                <Rating value={c.rating} size={16} onChange={(n) => rate.mutate(n, { onError: (e) => toast.error(errorMessage(e)) })} label="Candidate rating" />
                {c.aiAnalysis ? <span className={s.aiPill}><Icon name="sparkle" size={12} />AI score {c.aiAnalysis.overallScore} / 100</span> : null}
              </div>
            </div>
            <div className={s.headActions}>
              {!withdrawn ? (
                <Menu
                  trigger={(p) => <Button variant="secondary" iconRight="chevron" {...p}>Update stage</Button>}
                  items={[
                    ...STAGE_ORDER.filter((st) => st !== c.stage).map((st) => ({ label: `Move to ${STAGE_LABELS[st]}`, icon: 'arrowr' as const, onSelect: () => openMove(st) })),
                    ...(c.stage !== 'rejected' ? [{ label: 'Reject', icon: 'xcircle' as const, danger: true, separatorBefore: true, onSelect: () => openMove('rejected') }] : []),
                  ]}
                />
              ) : null}
              {!withdrawn && c.stage !== 'hired' && c.stage !== 'rejected' ? (
                <Button icon="calendar" onClick={() => navigate(`/app/interviews?schedule=${applicationId}`)}>Schedule interview</Button>
              ) : null}
            </div>
          </div>
          <StageTrack stage={c.stage} />
        </div>
      </Card>

      <div>
        <Tabs<TabKey>
          label="Candidate sections"
          value={tab}
          onChange={(k) => setParams(k === 'profile' ? {} : { tab: k }, { replace: true })}
          items={[
            { key: 'profile', label: 'Profile and contact' },
            { key: 'resume', label: 'Resume / CV', count: c.documents.length },
            { key: 'ai', label: 'AI analysis' },
            { key: 'interviews', label: 'Interview history', count: c.interviews.length },
            { key: 'activity', label: 'Activity' },
          ]}
        />
        <div className={s.tabBody} role="tabpanel">
          {tab === 'profile' ? <ProfileTab c={c} /> : null}
          {tab === 'resume' ? <ResumeTab c={c} /> : null}
          {tab === 'ai' ? <AnalysisTab c={c} /> : null}
          {tab === 'interviews' ? <InterviewsTab c={c} /> : null}
          {tab === 'activity' ? <ActivityTab c={c} /> : null}
        </div>
      </div>
      <StageMoveDialog move={move} onClose={() => setMove(null)} />
    </div>
  );
}

