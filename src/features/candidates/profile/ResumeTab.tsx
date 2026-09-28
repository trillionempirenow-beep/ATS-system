import { useState } from 'react';
import type { CandidateProfileDto } from '@shared/api/candidates';
import { UPLOAD_RULES, formatBytes } from '@shared/api/uploads';
import { Icon } from '@/components/icon/Icon';
import { Button, ButtonLink } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Display';
import { Dropzone, FileRow } from '@/components/ui/Form';
import { EmptyState, Notice } from '@/components/ui/Feedback';
import { Card, CardHeader } from '@/components/ui/Surface';
import { useToast } from '@/components/ui/Toast';
import { api, errorMessage } from '@/lib/api';
import { uploadFile } from '@/lib/upload';
import { formatDate } from '@/lib/format';
import { useCandidateAction } from '../api';
import w from '../../workspace.module.css';
import s from './Profile.module.css';

const docUrl = (id: number, inline = false) => `/api/v1/documents/${id}/download${inline ? '?inline=1' : ''}`;

export function ResumeTab({ c }: { c: CandidateProfileDto }) {
  const toast = useToast();
  const [progress, setProgress] = useState<{ name: string; pct: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** Id of the document shown inline; keyed by id so a newly uploaded version starts closed. */
  const [previewId, setPreviewId] = useState<number | null>(null);
  const attach = useCandidateAction(c.applicationId, (uploadId: string) => api.post(`/candidates/${c.applicationId}/documents`, { uploadId }));
  const primary = c.documents.find((d) => d.isPrimary) ?? c.documents[0];

  const onFile = async (file: File) => {
    setError(null);
    setProgress({ name: file.name, pct: 0 });
    try {
      const id = await uploadFile('resume', file, (pct) => setProgress({ name: file.name, pct }));
      await attach.mutateAsync(id);
      toast.success('New resume version uploaded.');
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setProgress(null);
    }
  };

  const uploader = (
    <div className={w.stack8}>
      {progress ? <FileRow name={progress.name} progress={progress.pct} sub={`Uploading… ${progress.pct}%`} /> : (
        <Dropzone accept=".pdf,.doc,.docx" title={primary ? 'Drop a new version, or browse' : 'Drop a resume, or browse'} hint={UPLOAD_RULES.resume.label} error={Boolean(error)} onFile={(f) => void onFile(f)} />
      )}
      {error ? <Notice tone="danger">{error}</Notice> : null}
    </div>
  );

  if (!primary) {
    return (
      <Card>
        {c.legacyResumePath ? <Notice tone="warning" title="Legacy upload">This candidate has a resume from the previous system that was not migrated to storage yet. Upload it again to keep it with the profile.</Notice> : null}
        <EmptyState icon="doc" title="Nothing has been uploaded for this candidate yet" text="Add a resume to keep it with the profile. Older versions are kept, not overwritten." />
        {uploader}
      </Card>
    );
  }
  const isPdf = primary.extension === 'pdf';
  const previewing = isPdf && previewId === primary.id;
  return (
    <div className={w.aside340}>
      <Card>
        <div className={s.docHead}>
          <div className={w.row}><strong className={w.truncate}>{primary.originalName}</strong><Badge tone="success" size="sm">Current</Badge></div>
          <div className={w.row}>
            {isPdf ? (
              <Button size="sm" variant="secondary" icon={previewing ? 'close' : 'eye'} aria-expanded={previewing} aria-controls="resume-preview"
                onClick={() => setPreviewId(previewing ? null : primary.id)}>
                {previewing ? 'Close preview' : 'View (PDF)'}
              </Button>
            ) : null}
            <ButtonLink to={docUrl(primary.id)} size="sm" variant="secondary" icon="download" reloadDocument>Download</ButtonLink>
          </div>
        </div>
        <div id="resume-preview" className={s.preview}>
          {previewing
            ? <iframe className={s.previewFrame} src={`${docUrl(primary.id, true)}#toolbar=0`} title={`Resume: ${primary.originalName}`} sandbox="allow-same-origin allow-scripts allow-downloads" />
            : isPdf
              ? <EmptyState compact icon="doc" title="Preview this resume here" text="Select View (PDF) to read it without leaving the profile." />
              : <EmptyState compact icon="doc" title="Preview is available for PDF files" text="Download this Word document to read it." />}
        </div>
      </Card>
      <div className={w.stack}>
        <Card>
          <CardHeader title="Versions" subtitle={`${c.documents.length} version${c.documents.length === 1 ? '' : 's'}${c.resumeIndexed ? ' · text indexed' : ''}`} />
          <div className={w.stack8}>
            {c.documents.map((d) => (
              <FileRow key={d.id} name={d.originalName}
                sub={`${formatBytes(d.byteSize)} · uploaded ${formatDate(d.createdAt)}${d.uploadedBy ? ` by ${d.uploadedBy}` : ' · applicant'}`}
                actions={<a href={docUrl(d.id)} className={w.link} aria-label={`Download ${d.originalName}`}><Icon name="download" size={16} /></a>} />
            ))}
          </div>
          <p className={w.faint} style={{ marginTop: 12 }}>Older versions are kept rather than overwritten, so the history stays intact.</p>
        </Card>
        <Card>{uploader}</Card>
      </div>
    </div>
  );
}
