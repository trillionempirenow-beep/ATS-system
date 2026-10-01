import { useEffect, useState, type DragEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import type { PipelineCardDto } from '@shared/api/pipeline';
import { STAGE_LABELS, STAGE_ORDER, type BoardStage, type Stage } from '@shared/domain/pipeline';
import { Button, ButtonLink, IconButton } from '@/components/ui/Button';
import { Avatar, Rating } from '@/components/ui/Display';
import { Select, TextInput } from '@/components/ui/Form';
import { Skeleton } from '@/components/ui/Feedback';
import { Drawer, Menu } from '@/components/ui/Overlay';
import { Card, DescriptionList, PageHeader } from '@/components/ui/Surface';
import { STAGE_CHART_COLORS } from '@/components/charts/Charts';
import { QueryErrorPage } from '@/app/system/StatusPages';
import { timeAgo } from '@/lib/format';
import { cx } from '@/lib/cx';
import { useDebouncedParam, useUrlParams } from '@/lib/urlState';
import { usePipeline } from './api';
import { StageMoveDialog, type PendingMove } from './StageMoveDialog';
import w from '../workspace.module.css';
import s from './Pipeline.module.css';

function PipelineCard({ card, onMove, onPreview, onDragStart, dragging }: {
  card: PipelineCardDto; onMove: (to: Stage) => void; onPreview: () => void; onDragStart: (e: DragEvent) => void; dragging: boolean;
}) {
  const navigate = useNavigate();
  return (
    <article className={cx(s.card, dragging && s.cardDragging)} draggable onDragStart={onDragStart} aria-label={`${card.name}, ${card.jobTitle}`}>
      <div className={s.cardTop}>
        <Avatar name={card.name} src={card.avatarUrl} size={32} />
        <div style={{ minWidth: 0, flex: 1 }}>
          <div className={s.cardName}>{card.name}</div>
          <div className={s.cardRole}>{card.jobTitle}</div>
        </div>
        <Menu
          trigger={(p) => <IconButton icon="more" label={`Move ${card.name}`} size={32} {...p} />}
          items={[
            ...STAGE_ORDER.filter((st) => st !== card.stage).map((st) => ({ label: `Move to ${STAGE_LABELS[st]}`, icon: 'arrowr' as const, onSelect: () => onMove(st) })),
            { label: 'Reject', icon: 'xcircle', danger: true, separatorBefore: true, onSelect: () => onMove('rejected') },
          ]}
        />
      </div>
      <div className={s.cardMeta}>
        {card.aiScore !== null ? <span className={s.aiBadge} title="Application analysis score">AI {card.aiScore}</span> : <span>Not analysed</span>}
        {card.rating ? <Rating value={card.rating} size={12} /> : <span>Unrated</span>}
      </div>
      <div className={s.cardActions}>
        <Button size="sm" variant="secondary" onClick={onPreview}>View</Button>
        <Button size="sm" variant="ghost" onClick={() => navigate(`/app/interviews?schedule=${card.applicationId}`)}>Schedule</Button>
      </div>
    </article>
  );
}

export function PipelinePage() {
  const [params, setUrl] = useUrlParams();
  const filters = { q: params.get('q') ?? undefined, job: params.get('job') ?? undefined, dept: params.get('dept') ?? undefined };
  const [search, setSearch] = useDebouncedParam('q');
  const board = usePipeline(filters);
  const [dragging, setDragging] = useState<PipelineCardDto | null>(null);
  const [over, setOver] = useState<BoardStage | null>(null);
  const [move, setMove] = useState<PendingMove | null>(null);
  const [preview, setPreview] = useState<PipelineCardDto | null>(null);
  useEffect(() => { document.title = 'Hiring pipeline · Acme People'; }, []);
  const set = (key: string, value: string | null) => setUrl({ [key]: value });
  const requestMove = (card: PipelineCardDto, to: Stage) => {
    if (card.stage === to) return;
    setMove({ applicationId: card.applicationId, name: card.name, jobTitle: card.jobTitle, avatarUrl: card.avatarUrl, from: card.stage, to });
  };

  if (board.isError) return <QueryErrorPage error={board.error} onRetry={() => void board.refetch()} />;
  const data = board.data;
  const anyFilter = Boolean(filters.q || filters.job || filters.dept);

  return (
    <div className={w.page}>
      <PageHeader
        crumbs={[{ label: 'Recruiting' }, { label: 'Hiring pipeline' }]}
        title="Hiring pipeline"
        description="Drag candidates between stages. Moving a candidate always asks for confirmation."
        actions={<ButtonLink to="/app/candidates/new" icon="plus">Add candidate</ButtonLink>}
      />
      <Card padding={0}>
        <div className={w.filterBar} role="search">
          <div className={w.filterSearch}><TextInput icon="search" placeholder="Search candidates…" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search candidates" /></div>
          <div className={w.filterSelect}><Select aria-label="Job" value={filters.job ?? ''} onChange={(e) => set('job', e.target.value || null)} placeholder="All jobs" options={(data?.jobs ?? []).map((j) => ({ value: j.id, label: j.title }))} /></div>
          <div className={w.filterSelect}><Select aria-label="Department" value={filters.dept ?? ''} onChange={(e) => set('dept', e.target.value || null)} placeholder="All departments" options={(data?.departments ?? []).map((d) => ({ value: d.id, label: d.name }))} /></div>
          {anyFilter ? <Button variant="ghost" onClick={() => { setSearch(''); setUrl({ q: null, job: null, dept: null }); }}>Clear</Button> : null}
        </div>
      </Card>

      <div className={s.board}>
        {STAGE_ORDER.map((stage, i) => {
          const cards = data?.columns[stage] ?? [];
          return (
            <section
              key={stage}
              className={cx(s.column, over === stage && dragging && dragging.stage !== stage && s.columnOver)}
              aria-label={`${STAGE_LABELS[stage]}, ${cards.length} candidates`}
              onDragOver={(e) => { if (dragging) { e.preventDefault(); setOver(stage); } }}
              onDragLeave={() => setOver((o) => (o === stage ? null : o))}
              onDrop={(e) => { e.preventDefault(); setOver(null); if (dragging) requestMove(dragging, stage); setDragging(null); }}
            >
              <div className={s.colHead}>
                <span className={s.colTitle}><span className={s.colDot} style={{ background: STAGE_CHART_COLORS[i] }} />{STAGE_LABELS[stage]}</span>
                <span className={s.colCount}>{data ? cards.length : '–'}</span>
              </div>
              {!data ? Array.from({ length: 3 }, (_, k) => <Skeleton key={k} height={116} radius={12} />) : cards.length === 0 ? (
                <div className={s.colEmpty}>{anyFilter ? 'No matches in this stage' : 'No candidates in this stage'}</div>
              ) : cards.map((c) => (
                <PipelineCard key={c.applicationId} card={c} dragging={dragging?.applicationId === c.applicationId}
                  onDragStart={(e) => { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', String(c.applicationId)); setDragging(c); }}
                  onMove={(to) => requestMove(c, to)} onPreview={() => setPreview(c)} />
              ))}
            </section>
          );
        })}
      </div>

      <StageMoveDialog move={move} onClose={() => setMove(null)} />
      <Drawer open={Boolean(preview)} onClose={() => setPreview(null)} title={preview?.name ?? ''} subtitle="Candidate preview"
        footer={<><Button variant="secondary" onClick={() => setPreview(null)}>Close</Button>{preview ? <ButtonLink to={`/app/candidates/${preview.applicationId}`}>View full profile</ButtonLink> : null}</>}>
        {preview ? (
          <div className={s.previewSection}>
            <div className={s.previewHead}>
              <Avatar name={preview.name} src={preview.avatarUrl} size={48} />
              <div><div style={{ fontWeight: 600 }}>{preview.jobTitle}</div><div className={w.faint}>{preview.email}</div></div>
            </div>
            <DescriptionList items={[
              ['Current stage', STAGE_LABELS[preview.stage]],
              ['Applied', timeAgo(preview.appliedAt)],
              ['AI match score', preview.aiScore !== null ? `${preview.aiScore} / 100` : 'Not analysed'],
              ['Rating', preview.rating ? <Rating value={preview.rating} size={14} /> : 'Unrated'],
              ['Screening review', preview.screeningScore !== null ? `${preview.screeningScore} / 100` : 'Pending'],
              ['Interview review', preview.interviewScore !== null ? `${preview.interviewScore} / 100` : 'Not started'],
              ['Resume', preview.primaryDocumentId ? <a href={`/api/v1/documents/${preview.primaryDocumentId}/download?inline=1`} target="_blank" rel="noopener noreferrer" className={w.link}>View resume</a> : preview.hasResume ? 'Legacy upload' : 'Not uploaded'],
            ]} />
            <div>
              <div className={w.overline} style={{ marginBottom: 6 }}>Recruiter notes ({preview.noteCount})</div>
              <p className={w.muted}>{preview.latestNote ?? 'No notes yet.'}</p>
            </div>
          </div>
        ) : null}
      </Drawer>
    </div>
  );
}
