import { useEffect, useState } from 'react';
import type { LibraryDocumentDto, LibraryFileDto, LibraryInterviewDto, LibraryRecordingDto } from '@shared/api/library';
import { Icon } from '@/components/icon/Icon';
import { Button } from '@/components/ui/Button';
import { Chip } from '@/components/ui/Display';
import { EmptyState, Spinner } from '@/components/ui/Feedback';
import { Card, CardHeader, DescriptionList } from '@/components/ui/Surface';
import { useToast } from '@/components/ui/Toast';
import { errorMessage } from '@/lib/api';
import { formatDate, formatDateTime, mmss } from '@/lib/format';
import s from './Library.module.css';

export interface FileActions {
  documentUrl: (docId: number, download: boolean) => Promise<string>;
  recordingUrl: (recId: number) => Promise<string>;
  allowDownload: boolean;
}

/** One applicant's file, read only. The staff Library and the shared view both draw it. */
export function LibraryFileView({ file, actions }: { file: LibraryFileDto; actions: FileActions }) {
  const has = (k: LibraryFileDto['sections'][number]) => file.sections.includes(k);
  const nothing = !file.details && !file.documents.length && !file.notes.length && !file.ai && !file.reviews.length && !file.interviews.length;
  return (
    <div className={s.file}>
      {file.details ? <Details d={file.details} /> : null}
      {has('cv') ? <Documents docs={file.documents} actions={actions} /> : null}
      {file.ai ? (
        <Card>
          <CardHeader title="AI analysis" subtitle={`Generated ${formatDate(file.ai.generatedAt)}`} actions={<span className={s.score}>{file.ai.overallScore}<small>/100</small></span>} />
          <p className={s.prose}>{file.ai.summary}</p>
          <div className={s.twoLists}>
            {file.ai.strengths.length ? <List title="Strengths" items={file.ai.strengths} /> : null}
            {file.ai.concerns.length ? <List title="Concerns" items={file.ai.concerns} /> : null}
          </div>
          {file.ai.recommendation ? <p className={s.muted}><b>Recommendation:</b> {file.ai.recommendation}</p> : null}
        </Card>
      ) : null}
      {file.reviews.length ? (
        <Card>
          <CardHeader title="Scores" />
          <ul className={s.rows}>
            {file.reviews.map((r) => (
              <li key={r.stageType} className={s.row}>
                <div className={s.rowHead}><strong>{r.label}</strong><span className={s.rowScore}>{r.rating !== null ? `${r.rating}/100` : 'No score'}</span></div>
                <span className={s.muted}>{r.reviewer ?? 'Hiring team'}, {formatDate(r.updatedAt)}</span>
                {r.feedback ? <p className={s.prose}>{r.feedback}</p> : null}
              </li>
            ))}
          </ul>
        </Card>
      ) : null}
      {file.interviews.map((iv) => <Interview key={iv.id} iv={iv} actions={actions} showSummary={has('interviews')} />)}
      {file.notes.length ? (
        <Card>
          <CardHeader title="Recruiter notes" />
          <ul className={s.rows}>
            {file.notes.map((n, i) => (
              <li key={i} className={s.row}>
                <span className={s.muted}>{n.author ?? 'Hiring team'}, {formatDateTime(n.createdAt)}</span>
                <p className={s.prose}>{n.text}</p>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}
      {nothing ? <Card><EmptyState icon="doc" title="Nothing to show yet" text="This file has no details in the parts that were shared." /></Card> : null}
    </div>
  );
}

function Details({ d }: { d: NonNullable<LibraryFileDto['details']> }) {
  return (
    <Card>
      <CardHeader title="Details" />
      <DescriptionList items={[
        ['Email', <a key="e" href={`mailto:${d.email}`} className={s.link}>{d.email}</a>],
        ['Phone', d.phone ?? 'Not given'],
        ['Current role', d.currentTitle ?? 'Not given'],
        ['Experience', d.experience ?? 'Not given'],
        ['Education', d.education ?? 'Not given'],
        ['Heard about us', d.source],
        ...(d.portfolioUrl ? [['Portfolio', /^https?:\/\//i.test(d.portfolioUrl)
          ? <a key="p" href={d.portfolioUrl} target="_blank" rel="noopener noreferrer" className={s.link}>{d.portfolioUrl}</a> : d.portfolioUrl] as [string, React.ReactNode]] : []),
      ]} />
      {d.skills.length ? <div className={s.chips}>{d.skills.map((k) => <Chip key={k}>{k}</Chip>)}</div> : null}
      {d.coverLetter ? <><h3 className={s.subhead}>Cover letter</h3><p className={s.prose}>{d.coverLetter}</p></> : null}
      {d.whyUs ? <><h3 className={s.subhead}>Why they want to work here</h3><p className={s.prose}>{d.whyUs}</p></> : null}
    </Card>
  );
}

function Documents({ docs, actions }: { docs: LibraryDocumentDto[]; actions: FileActions }) {
  const toast = useToast();
  const first = docs.find((d) => d.isPrimary) ?? docs[0];
  const [viewing, setViewing] = useState<number | null>(first && first.extension === 'pdf' ? first.id : null);
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    setSrc(null);
    if (viewing === null) return;
    let live = true;
    actions.documentUrl(viewing, false).then((u) => { if (live) setSrc(u); }, (e) => toast.error(errorMessage(e)));
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewing]);
  const download = async (id: number) => {
    try { window.location.assign(await actions.documentUrl(id, true)); } catch (e) { toast.error(errorMessage(e)); }
  };
  if (!docs.length) return <Card><CardHeader title="CV / resume" /><p className={s.muted}>No CV was uploaded for this applicant.</p></Card>;
  return (
    <Card padding={0}>
      <CardHeader flush title="CV / resume" subtitle={docs.length > 1 ? `${docs.length} documents` : undefined} />
      <ul className={s.docs}>
        {docs.map((d) => (
          <li key={d.id} className={s.doc}>
            <Icon name="doc" size={18} />
            <span className={s.docName}><strong>{d.originalName}</strong><small>{d.extension.toUpperCase()}, added {formatDate(d.createdAt)}{d.isPrimary ? ', main CV' : ''}</small></span>
            {d.extension === 'pdf' ? (
              <Button size="sm" variant={viewing === d.id ? 'secondary' : 'ghost'} onClick={() => setViewing(viewing === d.id ? null : d.id)}>{viewing === d.id ? 'Hide' : 'View'}</Button>
            ) : null}
            {actions.allowDownload ? <Button size="sm" variant="ghost" icon="download" onClick={() => void download(d.id)}>Download</Button> : null}
          </li>
        ))}
      </ul>
      {viewing !== null ? (
        <div className={s.viewer}>
          {src ? <iframe src={src} title="CV preview" className={s.frame} /> : <div className={s.viewerWait}><Spinner /></div>}
        </div>
      ) : null}
    </Card>
  );
}

function Interview({ iv, actions, showSummary }: { iv: LibraryInterviewDto; actions: FileActions; showSummary: boolean }) {
  const sum = iv.aiSummary;
  return (
    <Card>
      <CardHeader title={`${iv.kind}, ${formatDate(iv.startsAt)}`} subtitle={iv.interviewerName ? `With ${iv.interviewerName}` : undefined}
        actions={showSummary && iv.score !== null ? <span className={s.score}>{iv.score}<small>/100</small></span> : null} />
      {showSummary ? (
        <>
          {sum ? (
            <div className={s.summary}>
              <p className={s.prose}>{sum.summary}</p>
              {sum.keyAnswers.length ? <DescriptionList items={sum.keyAnswers.map((k) => [k.label, k.value] as [string, string])} /> : null}
              <div className={s.twoLists}>
                {sum.strengths.length ? <List title="Strengths" items={sum.strengths} /> : null}
                {sum.concerns.length ? <List title="Concerns" items={sum.concerns} /> : null}
              </div>
              {sum.followUps.length ? <List title="Follow up on" items={sum.followUps} /> : null}
            </div>
          ) : <p className={s.muted}>No AI summary for this interview.</p>}
          {iv.feedback ? <><h3 className={s.subhead}>Interviewer's feedback{iv.recommendation ? `: ${iv.recommendation.replace(/_/g, ' ')}` : ''}</h3><p className={s.prose}>{iv.feedback}</p></> : null}
        </>
      ) : null}
      {iv.recordings.length ? <Recording parts={iv.recordings} actions={actions} /> : null}
      {iv.transcript.length ? (
        <details className={s.transcript}>
          <summary>Transcript ({iv.transcript.length} {iv.transcript.length === 1 ? 'part' : 'parts'})</summary>
          <ol>{iv.transcript.map((l, i) => <li key={i}><time>{mmss(l.atSecond)}</time><span>{l.text}</span></li>)}</ol>
        </details>
      ) : null}
    </Card>
  );
}

/** A recording is kept in five-minute parts; they play one after another. */
function Recording({ parts, actions }: { parts: LibraryRecordingDto[]; actions: FileActions }) {
  const toast = useToast();
  const [index, setIndex] = useState<number | null>(null);
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    setSrc(null);
    if (index === null) return;
    let live = true;
    actions.recordingUrl(parts[index]!.id).then((u) => { if (live) setSrc(u); }, (e) => toast.error(errorMessage(e)));
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index]);
  const total = parts.reduce((a, p) => a + p.durationSec, 0);
  return (
    <div className={s.recording}>
      <div className={s.recHead}>
        <strong><Icon name="video" size={16} />Recording</strong>
        <span className={s.muted}>{mmss(total)}{parts.length > 1 ? `, ${parts.length} parts` : ''}</span>
      </div>
      {index === null ? (
        <Button variant="secondary" icon="video" onClick={() => setIndex(0)}>Play recording</Button>
      ) : (
        <>
          {src ? (
            <video key={src} src={src} controls autoPlay className={s.video} onLoadedMetadata={(e) => fixDuration(e.currentTarget)}
              onEnded={() => { if (index < parts.length - 1) setIndex(index + 1); }} />
          ) : <div className={s.viewerWait}><Spinner /></div>}
          {parts.length > 1 ? (
            <div className={s.parts} role="group" aria-label="Recording parts">
              {parts.map((p, i) => (
                <button key={p.id} type="button" className={s.part} aria-pressed={i === index} onClick={() => setIndex(i)}>
                  Part {i + 1}<small>{mmss(p.durationSec)}</small>
                </button>
              ))}
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}

/** Recordings made in the browser carry no length, so the seek bar would not work; jumping to the end once reveals it. */
function fixDuration(v: HTMLVideoElement) {
  if (Number.isFinite(v.duration)) return;
  const back = () => {
    if (!Number.isFinite(v.duration)) return;
    v.removeEventListener('durationchange', back);
    v.removeEventListener('timeupdate', back);
    v.currentTime = 0;
  };
  v.addEventListener('durationchange', back);
  v.addEventListener('timeupdate', back);
  v.currentTime = 1e101;
}

function List({ title, items }: { title: string; items: string[] }) {
  return (
    <div>
      <h3 className={s.subhead}>{title}</h3>
      <ul className={s.bullets}>{items.map((x, i) => <li key={i}>{x}</li>)}</ul>
    </div>
  );
}
