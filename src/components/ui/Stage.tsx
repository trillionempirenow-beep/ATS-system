import type { CSSProperties, ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { STAGE_LABELS, STAGE_ORDER, stageRank, type Stage } from '@shared/domain/pipeline';
import { Icon } from '../icon/Icon';
import { cx } from '@/lib/cx';
import s from './Stage.module.css';

/**
 * The stage rail: how far someone has come through hiring, drawn the same way
 * everywhere in Acme People. Six steps from Applied to Hired on one ordered colour
 * scale (slate to deep jade); Rejected sits outside the order, in Ember.
 */

export const STAGE_COLOR: Record<Stage, string> = {
  new: 'var(--stage-new)',
  screening: 'var(--stage-screening)',
  interview: 'var(--stage-interview)',
  final_interview: 'var(--stage-final)',
  offer: 'var(--stage-offer)',
  hired: 'var(--stage-hired)',
  rejected: 'var(--stage-rejected)',
};

const colorVar = (stage: Stage) => ({ '--c': STAGE_COLOR[stage] }) as CSSProperties;

/** One short bar in the stage's colour: marks a stage in a list or a filter. */
export function StagePip({ stage }: { stage: Stage }) {
  return <span className={s.pip} style={colorVar(stage)} aria-hidden />;
}

/** Six ticks, filled up to the stage: the rail in miniature. */
export function StageTicks({ stage, size = 'md' }: { stage: Stage; size?: 'sm' | 'md' }) {
  const rank = stageRank(stage);
  return (
    <span className={cx(s.ticks, size === 'sm' && s.ticksSm, stage === 'rejected' && s.ticksRejected)} aria-hidden>
      {STAGE_ORDER.map((st, i) => (
        <span key={st} className={s.tick} data-on={stage !== 'rejected' && i <= rank ? '' : undefined} style={colorVar(st)} />
      ))}
    </span>
  );
}

/** A stage, as a label with its mini rail. Used in tables, cards, dialogs and lists. */
export function StageTag({ stage, size = 'md', label }: { stage: Stage; size?: 'sm' | 'md'; label?: ReactNode }) {
  const rank = stageRank(stage);
  const text = label ?? STAGE_LABELS[stage];
  const where = stage === 'rejected' ? 'closed' : `step ${rank + 1} of ${STAGE_ORDER.length}`;
  return (
    <span className={cx(s.tag, size === 'sm' && s.tagSm, stage === 'rejected' && s.tagRejected)} title={typeof text === 'string' ? `${text}, ${where}` : undefined}>
      <StageTicks stage={stage} size={size} />
      <span className={s.tagLabel}>{text}</span>
    </span>
  );
}

export interface RailStep { stage: Stage; reached: boolean; note?: ReactNode }

/**
 * The full rail. `steps` are the stages to show in order (the optional final round
 * can be left out); `current` is where the person is now. A step that was passed
 * over without being reached shows as skipped. `end` adds a closing marker for a
 * rejected or withdrawn application.
 */
export function StageRail({ steps: all, current, end, label = 'Hiring progress' }: {
  steps: RailStep[];
  current: Stage | null;
  end?: { kind: 'rejected' | 'withdrawn'; label: string; note?: ReactNode } | null;
  label?: string;
}) {
  const lastReached = all.reduce((acc, st, i) => (st.reached ? i : acc), -1);
  // A closed application ends where it stopped: the steps it never got to are not drawn.
  const steps = end ? all.slice(0, lastReached + 1) : all;
  const count = steps.length + (end ? 1 : 0);
  return (
    <div className={s.rail}>
      <ol className={s.steps} aria-label={label} style={{ '--n': count } as CSSProperties}>
        {steps.map((st, i) => {
          const isCurrent = st.stage === current && !end;
          const skipped = !st.reached && i < lastReached;
          const linkOn = i < lastReached && steps[i + 1]?.reached;
          const state = isCurrent ? 'current' : st.reached ? 'done' : skipped ? 'skipped' : 'todo';
          return (
            <li key={st.stage} className={cx(s.step, s[state], (linkOn || (end && i === lastReached)) && s.linkOn, end && i === lastReached && (end.kind === 'rejected' ? s.linkEnd : s.linkQuiet))}
              style={colorVar(st.stage)} aria-current={isCurrent ? 'step' : undefined}>
              <span className={s.node} aria-hidden>{state === 'done' ? <Icon name="check" size={10} /> : null}</span>
              <span className={s.text}>
                <span className={s.label}>{STAGE_LABELS[st.stage]}</span>
                <span className={s.note}>{isCurrent ? (st.note ?? 'Now') : skipped ? 'Skipped' : st.note ?? (st.reached ? 'Done' : '')}</span>
              </span>
              <span className="visually-hidden">{isCurrent ? ' (current stage)' : st.reached ? ' (done)' : skipped ? ' (skipped)' : ' (not reached)'}</span>
            </li>
          );
        })}
        {end ? (
          <li className={cx(s.step, end.kind === 'rejected' ? s.endRejected : s.endWithdrawn)} aria-current="step">
            <span className={s.node} aria-hidden><Icon name="close" size={10} /></span>
            <span className={s.text}>
              <span className={s.label}>{end.label}</span>
              <span className={s.note}>{end.note ?? ''}</span>
            </span>
          </li>
        ) : null}
      </ol>
    </div>
  );
}

/**
 * Where everyone is right now: one proportional bar and the count per stage, each
 * count opening the candidate list filtered to that stage.
 */
export function StageDistribution({ items, hrefFor }: { items: Array<{ stage: Stage; count: number }>; hrefFor?: (stage: Stage) => string }) {
  const total = items.reduce((a, b) => a + b.count, 0);
  return (
    <div className={s.dist}>
      <div className={s.bar} role="img" aria-label={`${total} candidates: ${items.map((i) => `${STAGE_LABELS[i.stage]} ${i.count}`).join(', ')}`}>
        {total === 0 ? null : items.filter((i) => i.count > 0).map((i) => (
          <span key={i.stage} className={s.seg} style={{ ...colorVar(i.stage), flexGrow: i.count }} />
        ))}
      </div>
      <ul className={s.cells}>
        {items.map((i) => {
          const body = (
            <>
              <span className={s.cellTop}><StagePip stage={i.stage} />{STAGE_LABELS[i.stage]}</span>
              <span className={s.cellCount} data-zero={i.count === 0 ? '' : undefined}>{i.count}</span>
            </>
          );
          return (
            <li key={i.stage} style={colorVar(i.stage)}>
              {hrefFor ? <Link className={s.cell} to={hrefFor(i.stage)} aria-label={`${STAGE_LABELS[i.stage]}: ${i.count}. Open these candidates`}>{body}</Link> : <span className={s.cell}>{body}</span>}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
