import { useState } from 'react';
import type { CandidateProfileDto } from '@shared/api/candidates';
import { FEEDBACK_FIT_LABELS, FEEDBACK_FITS, type FeedbackFit } from '@shared/domain/pipeline';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Display';
import { Field, Select, Textarea, formStyles } from '@/components/ui/Form';
import { EmptyState, ProgressBar } from '@/components/ui/Feedback';
import { Card, CardHeader } from '@/components/ui/Surface';
import { useToast } from '@/components/ui/Toast';
import { api, errorMessage } from '@/lib/api';
import { formatDateTime } from '@/lib/format';
import { useCandidateAction } from '../api';
import w from '../../workspace.module.css';
import s from './Profile.module.css';

function ScoreRing({ value }: { value: number }) {
  const r = 36;
  const len = 2 * Math.PI * r;
  return (
    <div className={s.ring} role="img" aria-label={`Score ${value} out of 100`}>
      <svg width="84" height="84" viewBox="0 0 84 84">
        <circle cx="42" cy="42" r={r} fill="none" stroke="var(--sunken)" strokeWidth="8" />
        <circle cx="42" cy="42" r={r} fill="none" stroke="var(--chart-4)" strokeWidth="8" strokeLinecap="round"
          strokeDasharray={`${(value / 100) * len} ${len}`} transform="rotate(-90 42 42)" />
      </svg>
      <span className={s.ringValue}>{value}<span>/ 100</span></span>
    </div>
  );
}

export function AnalysisTab({ c }: { c: CandidateProfileDto }) {
  const toast = useToast();
  const a = c.aiAnalysis;
  const run = useCandidateAction(c.applicationId, () => api.post(`/candidates/${c.applicationId}/analysis`));
  const [fit, setFit] = useState<FeedbackFit | ''>('');
  const [notes, setNotes] = useState('');
  const saveFeedback = useCandidateAction(c.applicationId, () => api.post(`/candidates/${c.applicationId}/feedback`, { fit, notes }));
  const [jobId, setJobId] = useState('');
  const [why, setWhy] = useState('');
  const suggest = useCandidateAction(c.applicationId, () => api.post(`/candidates/${c.applicationId}/suggestions`, { jobId: Number(jobId), note: why }));

  return (
    <div className={w.cols21}>
      <div className={w.stack}>
        <Card>
          <CardHeader
            title="Application analysis"
            subtitle="Advisory only. A heuristic reading of the application; recruiters make the decision."
            actions={<Button variant={a ? 'secondary' : 'primary'} icon="sparkle" loading={run.isPending}
              onClick={() => run.mutate(undefined, { onSuccess: () => toast.success('Analysis updated.'), onError: (e) => toast.error(errorMessage(e)) })}>
              {a ? 'Run again' : 'Analyze application'}
            </Button>}
          />
          {!a ? (
            <EmptyState compact icon="sparkle" title="Not analysed yet" text="Run the analysis to score the application against this role's requirements." />
          ) : (
            <div className={w.stack}>
              <div className={s.scoreBig}>
                <ScoreRing value={a.overallScore} />
                <div className={w.stack8}>
                  <Badge tone={a.overallScore >= 80 ? 'success' : a.overallScore >= 65 ? 'info' : 'warning'}>{a.recommendation}</Badge>
                  <p className={w.muted}>{a.summary}</p>
                  <span className={w.faint}>Generated {formatDateTime(a.generatedAt)}</span>
                </div>
              </div>
              <div className={w.stack8}>
                {Object.entries(a.categoryScores).map(([k, v]) => (
                  <div key={k} className={s.catRow}><span>{k}</span><ProgressBar value={v} label={k} /><strong className="num">{v}</strong></div>
                ))}
              </div>
              <div className={w.cols11}>
                <div><div className={`${w.overline} ${w.mb6}`}>Strengths</div><ul className={`${w.muted} ${w.bulletList}`}>{a.strengths.map((x) => <li key={x}>{x}</li>)}</ul></div>
                <div><div className={`${w.overline} ${w.mb6}`}>Concerns</div><ul className={`${w.muted} ${w.bulletList}`}>{a.concerns.map((x) => <li key={x}>{x}</li>)}</ul></div>
              </div>
            </div>
          )}
        </Card>
        <Card>
          <CardHeader title="Fit assessment" subtitle="Shared with the applicant if they are not moving forward." />
          <div className={formStyles.stack}>
            <div className={`${w.row} ${w.gap8} ${w.wrapRow}`} role="radiogroup" aria-label="Fit">
              {FEEDBACK_FITS.map((f) => (
                <Button key={f} size="sm" variant={fit === f ? 'subtle' : 'secondary'} aria-pressed={fit === f} onClick={() => setFit(f)}>{FEEDBACK_FIT_LABELS[f]}</Button>
              ))}
            </div>
            <Field label="Areas for improvement"><Textarea rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={5000} /></Field>
            <div className={w.formActions}>
              <Button disabled={!fit} loading={saveFeedback.isPending} onClick={() => saveFeedback.mutate(undefined, {
                onSuccess: () => { toast.success('Feedback saved.'); setFit(''); setNotes(''); }, onError: (e) => toast.error(errorMessage(e)),
              })}>Save feedback</Button>
            </div>
            {c.feedback.map((f) => (
              <div key={f.id} className={w.noteCard}>
                <div className={w.rowBetween}><Badge tone={f.fit === 'strong-fit' ? 'success' : f.fit === 'potential-fit' ? 'info' : 'danger'} size="sm">{FEEDBACK_FIT_LABELS[f.fit]}</Badge><span className={w.faint}>{f.author ?? 'Former user'} · {formatDateTime(f.createdAt)}</span></div>
                {f.notes ? <p className={`${w.pre} ${w.mt8}`}>{f.notes}</p> : null}
              </div>
            ))}
          </div>
        </Card>
      </div>
      <Card>
        <CardHeader title="Suggest another role" subtitle="Shown to the applicant, with your note, on their application status page." />
        <div className={formStyles.stack}>
          <Field label="Other open role"><Select value={jobId} onChange={(e) => setJobId(e.target.value)} placeholder="Select a role" options={c.openRoles.map((r) => ({ value: r.id, label: r.title }))} /></Field>
          <Field label="Why this role?" optional><Textarea rows={3} value={why} onChange={(e) => setWhy(e.target.value)} maxLength={2000} /></Field>
          <div className={w.formActions}>
            <Button variant="secondary" disabled={!jobId} loading={suggest.isPending} onClick={() => suggest.mutate(undefined, {
              onSuccess: () => { toast.success('Role suggestion saved.'); setJobId(''); setWhy(''); }, onError: (e) => toast.error(errorMessage(e)),
            })}>Save suggestion</Button>
          </div>
          {c.suggestions.map((sg) => (
            <div key={sg.id} className={w.noteCard}>
              <strong>{sg.jobTitle}</strong>
              {sg.note ? <p className={`${w.muted} ${w.mt4}`}>{sg.note}</p> : null}
              <div className={w.noteMeta}>{sg.author ?? 'Former user'} · {formatDateTime(sg.createdAt)}</div>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}
