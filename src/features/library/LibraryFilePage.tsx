import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import {
  DEFAULT_SHARE_SECTIONS, LIBRARY_SECTION_LABELS, LIBRARY_SECTIONS, type CreateShareResultDto, type LibraryFileDto, type LibrarySection,
  type LibraryShareDto, type ShareExpiry,
} from '@shared/api/library';
import { Button, ButtonLink } from '@/components/ui/Button';
import { Badge, StatusBadge } from '@/components/ui/Display';
import { Checkbox, Field, RadioGroup, TextInput, Textarea } from '@/components/ui/Form';
import { Notice, Skeleton } from '@/components/ui/Feedback';
import { Modal } from '@/components/ui/Overlay';
import { Breadcrumbs, Card, CardHeader } from '@/components/ui/Surface';
import { useToast } from '@/components/ui/Toast';
import { QueryErrorPage } from '@/app/system/StatusPages';
import { ApiError, errorMessage } from '@/lib/api';
import { formatDate, timeAgo } from '@/lib/format';
import { copyText } from '@/features/room/GuestAdmissions';
import { staffDocumentUrl, staffRecordingUrl, useCreateShare, useLibraryFile, useRevokeShare } from './api';
import { LibraryFileView } from './LibraryFileView';
import w from '../workspace.module.css';
import s from './Library.module.css';

const EXPIRY_OPTIONS: Array<{ value: ShareExpiry; label: string }> = [
  { value: '7d', label: '7 days' },
  { value: '30d', label: '30 days' },
  { value: 'never', label: 'Until I turn it off' },
];

/** Only parts this file actually has can be shared. */
function available(file: LibraryFileDto): LibrarySection[] {
  const ivs = file.interviews;
  return LIBRARY_SECTIONS.filter((k) => {
    if (k === 'notes') return file.notes.length > 0;
    if (k === 'ai') return Boolean(file.ai);
    if (k === 'reviews') return file.reviews.length > 0;
    if (k === 'interviews') return ivs.length > 0;
    if (k === 'transcripts') return ivs.some((i) => i.transcript.length);
    if (k === 'recordings') return ivs.some((i) => i.recordings.length);
    return true;
  });
}

function ShareDialog({ file, open, onClose }: { file: LibraryFileDto; open: boolean; onClose: () => void }) {
  const create = useCreateShare(file.applicationId);
  const options = available(file);
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [message, setMessage] = useState('');
  const [sections, setSections] = useState<Set<LibrarySection>>(new Set(DEFAULT_SHARE_SECTIONS.filter((k) => options.includes(k))));
  const [download, setDownload] = useState(true);
  const [expiry, setExpiry] = useState<ShareExpiry>('30d');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [done, setDone] = useState<CreateShareResultDto | null>(null);
  const toast = useToast();

  const reset = () => { setEmail(''); setName(''); setMessage(''); setErrors({}); setDone(null); create.reset(); };
  const close = () => { reset(); onClose(); };
  const submit = () => {
    setErrors({});
    create.mutate({ recipientEmail: email, recipientName: name, message, sections: [...sections], allowDownload: download, expiry }, {
      onSuccess: (r) => setDone(r),
      onError: (e) => { if (e instanceof ApiError && Object.keys(e.fields).length) setErrors(e.fields); else toast.error(errorMessage(e)); },
    });
  };

  if (done) {
    const sent = done.email === 'sent';
    return (
      <Modal open={open} onClose={close} title={sent ? 'File shared' : 'Share created'} footer={<Button onClick={close}>Done</Button>}>
        <div className={w.stack}>
          {sent
            ? <p>We emailed <strong>{done.share.recipientEmail}</strong> a link. They enter their email and a code we send them to open the file.</p>
            : <Notice tone="warning" title="The email was not sent">{done.email === 'skipped' ? 'Email is not delivered in this environment.' : 'Email delivery is not working right now.'} Copy the link below and send it yourself. It still only opens for {done.share.recipientEmail}.</Notice>}
          <Field label="Link">
            <div className={s.linkBox}>
              <TextInput readOnly value={done.link} onFocus={(e) => e.currentTarget.select()} aria-label="Share link" />
              <Button variant="secondary" icon="copy" onClick={() => void copyText(done.link).then((ok) => ok && toast.success('Link copied.'))}>Copy</Button>
            </div>
          </Field>
          <p className={w.faint}>{done.share.expiresAt ? `Works until ${formatDate(done.share.expiresAt)}.` : 'Works until you turn it off.'} You can turn it off any time from "Shared with".</p>
        </div>
      </Modal>
    );
  }

  return (
    <Modal open={open} onClose={close} width={560} title={`Share ${file.name}'s file`} subtitle="A view-only copy, by email. They do not need an account."
      footer={<><Button variant="secondary" onClick={close}>Cancel</Button><Button loading={create.isPending} disabled={!sections.size} icon="send" onClick={submit}>Share</Button></>}>
      <div className={w.stack}>
        <div className={w.cols11}>
          <Field label="Their email" required error={errors.recipientEmail}><TextInput type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="manager@company.com" data-autofocus /></Field>
          <Field label="Their name" optional><TextInput value={name} onChange={(e) => setName(e.target.value)} /></Field>
        </div>
        <Field label="Message" optional hint="Shown in the email and at the top of the file."><Textarea rows={2} maxLength={1000} value={message} onChange={(e) => setMessage(e.target.value)} /></Field>
        <fieldset className={s.fieldset}>
          <legend className={s.legend}>What they can see</legend>
          <div className={s.sectionPicks}>
            {options.map((k) => (
              <Checkbox key={k} checked={sections.has(k)} label={LIBRARY_SECTION_LABELS[k].label} description={LIBRARY_SECTION_LABELS[k].hint}
                onChange={(e) => { const next = new Set(sections); if (e.target.checked) next.add(k); else next.delete(k); setSections(next); }} />
            ))}
          </div>
          {errors.sections ? <p className={s.errorText}>{errors.sections}</p> : null}
        </fieldset>
        {sections.has('cv') ? <Checkbox checked={download} onChange={(e) => setDownload(e.target.checked)} label="Let them download the CV" /> : null}
        <RadioGroup legend="Link works for" name="expiry" inline value={expiry} onChange={setExpiry} options={EXPIRY_OPTIONS} />
      </div>
    </Modal>
  );
}

function ShareRow({ share }: { share: LibraryShareDto }) {
  const revoke = useRevokeShare();
  const toast = useToast();
  const tone = share.status === 'active' ? 'success' : share.status === 'expired' ? 'neutral' : 'neutral';
  const label = share.status === 'active' ? 'Active' : share.status === 'expired' ? 'Expired' : 'Turned off';
  return (
    <li className={s.share}>
      <div className={s.shareTop}><span className={s.shareTo}>{share.recipientName ? `${share.recipientName}, ` : ''}{share.recipientEmail}</span><Badge tone={tone} size="sm">{label}</Badge></div>
      <span className={s.muted}>
        By {share.createdBy ?? 'a former user'}, {formatDate(share.createdAt)}.{' '}
        {share.status === 'active' ? (share.expiresAt ? `Until ${formatDate(share.expiresAt)}.` : 'No end date.') : share.revokedAt ? `Turned off ${formatDate(share.revokedAt)}.` : ''}
      </span>
      <span className={s.muted}>{share.openCount ? `Opened ${share.openCount} ${share.openCount === 1 ? 'time' : 'times'}, last ${timeAgo(share.lastOpenedAt)}.` : 'Not opened yet.'}</span>
      <span className={s.muted}>{share.sections.map((k) => LIBRARY_SECTION_LABELS[k].label).join(', ')}{share.sections.includes('cv') && !share.allowDownload ? ' (no download)' : ''}</span>
      {share.status === 'active' ? (
        <div className={s.shareActions}>
          <Button size="sm" variant="dangerGhost" loading={revoke.isPending}
            onClick={() => revoke.mutate(share.id, { onSuccess: () => toast.success(`Turned off. ${share.recipientEmail} can no longer open the file.`), onError: (e) => toast.error(errorMessage(e)) })}>
            Turn off
          </Button>
        </div>
      ) : null}
    </li>
  );
}

export function LibraryFilePage() {
  const { id = '' } = useParams();
  const applicationId = Number(id);
  const q = useLibraryFile(applicationId);
  const [sharing, setSharing] = useState(false);
  useEffect(() => { if (q.data) document.title = `${q.data.file.name} · Library`; }, [q.data]);

  if (q.isError) return <QueryErrorPage error={q.error} onRetry={() => void q.refetch()} />;
  if (!q.data) return <div className={w.page}><Skeleton height={16} width={200} /><Skeleton height={80} /><Skeleton height={420} /></div>;
  const { file, shares } = q.data;
  const active = shares.filter((x) => x.status === 'active');

  return (
    <div className={w.page}>
      <Breadcrumbs items={[{ label: 'Recruiting' }, { label: 'Library', to: '/app/library' }, { label: file.name }]} />
      <header className={s.head}>
        <div className={s.headText}>
          <h1 className={s.name}>{file.name}</h1>
          <div className={s.meta}>
            <span>{[file.jobTitle, file.department].filter(Boolean).join(', ')}</span>
            {file.withdrawn ? <Badge tone="neutral" size="sm">Withdrawn</Badge> : <StatusBadge kind="stage" value={file.stage} />}
            <span className={w.faint}>Applied {formatDate(file.appliedAt)}</span>
          </div>
        </div>
        <div className={w.row}>
          <ButtonLink variant="secondary" to={`/app/candidates/${file.applicationId}`}>Open profile</ButtonLink>
          <Button icon="send" onClick={() => setSharing(true)}>Share</Button>
        </div>
      </header>
      <div className={s.layout}>
        <LibraryFileView file={file} actions={{
          allowDownload: true,
          documentUrl: (docId, download) => staffDocumentUrl(file.applicationId, docId, download),
          recordingUrl: (recId) => staffRecordingUrl(file.applicationId, recId),
        }} />
        <aside className={s.aside}>
          <Card>
            <CardHeader title="Shared with" subtitle={active.length ? `${active.length} can open it now` : 'Not shared right now'} />
            {shares.length ? <ul className={s.shares}>{shares.map((x) => <ShareRow key={x.id} share={x} />)}</ul>
              : <p className={w.faint}>Share a view-only copy with someone who has no account, like a hiring manager. Only the email you send it to can open it.</p>}
            <div className={w.mt12}><Button variant="secondary" icon="send" onClick={() => setSharing(true)}>Share</Button></div>
          </Card>
          <p className={w.faint}>Every share, and every time someone opens a shared file, is kept in the audit trail.</p>
        </aside>
      </div>
      <ShareDialog key={sharing ? 'open' : 'closed'} file={file} open={sharing} onClose={() => setSharing(false)} />
    </div>
  );
}
