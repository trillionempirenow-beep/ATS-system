import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import type { StaffRoomDto } from '@shared/api/interviews';
import { RECOMMENDATIONS, type Recommendation } from '@shared/domain/interviews';
import { Button } from '@/components/ui/Button';
import { Field, Select, TextInput, Textarea, formStyles } from '@/components/ui/Form';
import { Notice } from '@/components/ui/Feedback';
import { ApiError, errorMessage } from '@/lib/api';
import { cx } from '@/lib/cx';
import { useSaveScorecard, useSubmitReview } from './api';
import s from './Interviews.module.css';

export function suggestedScore(ratings: Record<string, number | null>): { score: number | null; average: number | null; count: number } {
  const values = Object.values(ratings).filter((v): v is number => typeof v === 'number');
  if (!values.length) return { score: null, average: null, count: 0 };
  const average = values.reduce((a, b) => a + b, 0) / values.length;
  return { score: Math.round((average / 5) * 100), average, count: values.length };
}

export function scoreBand(score: number | null): string {
  if (score === null) return 'Not rated yet';
  if (score >= 85) return 'Strong';
  if (score >= 70) return 'Good';
  if (score >= 50) return 'Mixed';
  return 'Weak';
}

const SCALE = [1, 2, 3, 4, 5];

/**
 * One 1-5 radio group per criterion. Standard radio keyboard model: the group is one
 * tab stop (the chosen number, or 1), arrow keys move and choose, Home/End jump to 1/5.
 * Clicking the chosen number again clears it (ratings are optional).
 */
export function ScorecardRatings({ criteria, ratings, onChange, readOnly }: {
  criteria: string[]; ratings: Record<string, number | null>; onChange?: (criterion: string, value: number | null) => void; readOnly?: boolean;
}) {
  const onKey = (c: string, e: KeyboardEvent<HTMLButtonElement>) => {
    if (readOnly) return;
    const cur = ratings[c] ?? 0;
    const next = e.key === 'ArrowRight' || e.key === 'ArrowUp' ? Math.min(5, cur + 1)
      : e.key === 'ArrowLeft' || e.key === 'ArrowDown' ? Math.max(1, cur - 1)
        : e.key === 'Home' ? 1 : e.key === 'End' ? 5 : null;
    if (next === null) return;
    e.preventDefault();
    onChange?.(c, next);
    (e.currentTarget.parentElement?.children[next - 1] as HTMLElement | undefined)?.focus();
  };
  return (
    <div className={s.criteria}>
      {criteria.map((c) => (
        <div key={c} className={s.criterion} role="radiogroup" aria-label={c} aria-readonly={readOnly || undefined}>
          <span className={s.criterionName} aria-hidden>{c}</span>
          <div className={s.scale}>
            {SCALE.map((n) => (
              <button key={n} type="button" role="radio" aria-checked={ratings[c] === n} aria-label={`${n} of 5`} disabled={readOnly}
                tabIndex={(ratings[c] ?? 1) === n ? 0 : -1}
                className={cx(s.scaleBtn, ratings[c] === n && s.scaleOn)}
                onKeyDown={(e) => onKey(c, e)}
                onClick={() => onChange?.(c, ratings[c] === n ? null : n)}>{n}</button>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

export function ScoreSummary({ ratings, criteriaCount }: { ratings: Record<string, number | null>; criteriaCount: number }) {
  const sug = suggestedScore(ratings);
  return (
    <div className={s.scoreSummary}>
      <div className={s.scoreBig}><strong className="num">{sug.score ?? '—'}</strong><span>out of 100</span></div>
      <div>
        <div className={s.scoreLabel}>Suggested score <b>{scoreBand(sug.score)}</b></div>
        <div className={s.scoreHint}>
          {sug.average !== null ? `Average ${sug.average.toFixed(1)} of 5 across ${sug.count} of ${criteriaCount} criteria. Ratings are optional.` : 'Rate the criteria to get a suggestion. Ratings are optional.'}
        </div>
      </div>
    </div>
  );
}

/** Score, recommendation and written review. Score and recommendation are required here; the server accepts any one. */
export function ReviewForm({ room, onSubmitted, onCancel, prefillReview, onDirtyChange }: {
  room: StaffRoomDto; onSubmitted: () => void; onCancel?: () => void; prefillReview?: string | null;
  /** Told whether the score, recommendation or written review has unsaved edits (ratings save themselves). */
  onDirtyChange?: (dirty: boolean) => void;
}) {
  const id = room.interview.id;
  const [ratings, setRatings] = useState<Record<string, number | null>>(() => ({ ...room.scorecard.myRatings }));
  const [score, setScore] = useState<string>(room.interview.score !== null ? String(room.interview.score) : '');
  const [scoreTouched, setScoreTouched] = useState(room.interview.score !== null);
  const [recommendation, setRecommendation] = useState<Recommendation | ''>(room.interview.recommendation ?? '');
  const [review, setReview] = useState(room.interview.feedback ?? '');
  const [errors, setErrors] = useState<{ score?: string; recommendation?: string; review?: string }>({});
  const [formError, setFormError] = useState<string | null>(null);
  const submit = useSubmitReview(id);
  const saveDraft = useSaveScorecard(id);
  const pendingDraft = useRef<Record<string, number | null>>({});
  const timer = useRef<number>();
  const [draftFailed, setDraftFailed] = useState(false);
  const scoreRef = useRef<HTMLInputElement>(null);
  const recommendationRef = useRef<HTMLSelectElement>(null);

  const dirty = !submit.isSuccess && (
    review.trim() !== (room.interview.feedback ?? '').trim()
    || (scoreTouched && score !== (room.interview.score !== null ? String(room.interview.score) : ''))
    || recommendation !== (room.interview.recommendation ?? '')
  );
  useEffect(() => { onDirtyChange?.(dirty); }, [dirty, onDirtyChange]);
  useEffect(() => () => onDirtyChange?.(false), [onDirtyChange]);

  useEffect(() => {
    if (prefillReview) setReview((cur) => (cur.trim() ? `${cur.trim()}\n\n${prefillReview}` : prefillReview));
  }, [prefillReview]);
  useEffect(() => () => window.clearTimeout(timer.current), []);

  const sug = suggestedScore(ratings);
  useEffect(() => {
    if (!scoreTouched && sug.score !== null) setScore(String(sug.score));
  }, [sug.score, scoreTouched]);

  const rate = (criterion: string, value: number | null) => {
    setRatings((r) => ({ ...r, [criterion]: value }));
    pendingDraft.current[criterion] = value;
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(flushDraft, 600);
  };
  // Ratings save on their own. If a save fails, keep them queued and say so, with a retry.
  function flushDraft() {
    const batch = pendingDraft.current;
    if (!Object.keys(batch).length) return;
    pendingDraft.current = {};
    saveDraft.mutate(batch, {
      onSuccess: () => setDraftFailed(false),
      onError: () => { pendingDraft.current = { ...batch, ...pendingDraft.current }; setDraftFailed(true); },
    });
  }

  const onSubmit = () => {
    const n = Number(score);
    const next: typeof errors = {};
    if (!score.trim() || !Number.isInteger(n) || n < 1 || n > 100) next.score = 'Enter a score from 1 to 100.';
    if (!recommendation) next.recommendation = 'Choose a recommendation.';
    setErrors(next);
    setFormError(null);
    if (next.score) return scoreRef.current?.focus();
    if (next.recommendation) return recommendationRef.current?.focus();
    submit.mutate({ score: n, recommendation: recommendation || null, review: review.trim() }, {
      onSuccess: onSubmitted,
      onError: (e) => {
        if (e instanceof ApiError && Object.keys(e.fields).length) setErrors(e.fields);
        setFormError(errorMessage(e));
      },
    });
  };

  return (
    <form className={formStyles.stack} noValidate onSubmit={(e) => { e.preventDefault(); onSubmit(); }}>
      {formError ? <Notice tone="danger">{formError}</Notice> : null}
      <ScoreSummary ratings={ratings} criteriaCount={room.scorecard.criteria.length} />
      <ScorecardRatings criteria={room.scorecard.criteria} ratings={ratings} onChange={rate} />
      {draftFailed ? (
        <Notice tone="danger" title="Your ratings weren’t saved."
          action={<Button size="sm" variant="secondary" loading={saveDraft.isPending} onClick={flushDraft}>Try again</Button>}>
          Check your connection, then try again.
        </Notice>
      ) : null}
      <div className={formStyles.grid2}>
        <Field label="Overall score 1–100" required hint={!scoreTouched && sug.score !== null ? 'Suggested from your ratings.' : undefined} error={errors.score}>
          <TextInput ref={scoreRef} name="score" autoComplete="off" type="number" min={1} max={100} inputMode="numeric" value={score} onChange={(e) => { setScore(e.target.value); setScoreTouched(true); }} />
        </Field>
        <Field label="Recommendation" required error={errors.recommendation}>
          <Select ref={recommendationRef} value={recommendation} onChange={(e) => setRecommendation(e.target.value as Recommendation | '')} placeholder="Select recommendation…"
            options={Object.entries(RECOMMENDATIONS).map(([value, label]) => ({ value, label }))} />
        </Field>
      </div>
      <Field label="Review / feedback" required error={errors.review}>
        <Textarea rows={5} maxLength={10000} showCount value={review} onChange={(e) => setReview(e.target.value)} />
      </Field>
      <div className={s.formActions}>
        {onCancel ? <Button variant="ghost" onClick={onCancel}>Cancel</Button> : null}
        <Button type="submit" loading={submit.isPending}>Submit interview review</Button>
      </div>
    </form>
  );
}
