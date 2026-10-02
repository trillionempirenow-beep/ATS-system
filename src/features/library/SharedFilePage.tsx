import { useEffect, useState, type FormEvent } from 'react';
import { useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { BrandMark } from '@/components/icon/Icon';
import { Button, IconButton } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Display';
import { Field, TextInput } from '@/components/ui/Form';
import { EmptyState, Notice, Skeleton } from '@/components/ui/Feedback';
import { useTheme } from '@/app/providers/ThemeProvider';
import { ApiError, errorMessage } from '@/lib/api';
import { formatDate } from '@/lib/format';
import { readViewer, saveViewer, sharedApi } from './api';
import { LibraryFileView } from './LibraryFileView';
import s from './Library.module.css';

/**
 * A view-only applicant file shared by email. The person it was sent to
 * enters their address, gets a 6-digit code there, and then reads the file.
 * No account, no editing; the sender can turn the link off at any time.
 */
export function SharedFilePage() {
  const { token = '' } = useParams();
  const { theme, toggle } = useTheme();
  const [viewer, setViewer] = useState<string | null>(() => readViewer(token));
  const landing = useQuery({ queryKey: ['shared', token], queryFn: () => sharedApi.landing(token), retry: false });
  const file = useQuery({
    queryKey: ['shared', token, 'file', viewer],
    queryFn: () => sharedApi.file(token, viewer!),
    enabled: Boolean(viewer) && landing.data?.state === 'ok',
    retry: false,
    staleTime: 5 * 60_000,
  });
  const company = file.data?.companyName ?? landing.data?.companyName ?? 'Acme';
  useEffect(() => { document.title = file.data ? `${file.data.file.name} · Shared by ${company}` : `Shared file · ${company}`; }, [file.data, company]);
  // The viewer session ended or the share changed: ask for a new code.
  useEffect(() => {
    if (file.error instanceof ApiError && (file.error.status === 403 || file.error.status === 410)) { saveViewer(token, null); setViewer(null); void landing.refetch(); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [file.error]);

  const bar = (
    <header className={s.sharedBar}>
      <span className={s.brand}><BrandMark size={26} label={`${company} logo`} />{company}<em>/</em>shared file</span>
      <IconButton icon={theme === 'dark' ? 'sun' : 'moon'} label={theme === 'dark' ? 'Use light theme' : 'Use dark theme'} onClick={toggle} />
    </header>
  );

  let body: React.ReactNode;
  if (landing.isLoading) body = <div className={s.gate}><Skeleton height={220} /></div>;
  else if (landing.isError || !landing.data) {
    body = <div className={s.gate}><div className={s.gateCard}><EmptyState icon="lock" title="This link is not valid" text={errorMessage(landing.error)} /></div></div>;
  } else if (landing.data.state !== 'ok') {
    body = (
      <div className={s.gate}><div className={s.gateCard}>
        <h1 className={s.gateTitle}>{landing.data.state === 'off' ? 'This share was turned off' : 'This share has expired'}</h1>
        <p className={s.muted}>{landing.data.sharedBy ? `Ask ${landing.data.sharedBy}` : 'Ask the person who shared it'} at {company} to send it again if you still need it.</p>
      </div></div>
    );
  } else if (!viewer) {
    body = <Gate token={token} masked={landing.data.maskedEmail} sharedBy={landing.data.sharedBy} company={company} onVerified={(t) => setViewer(t)} />;
  } else if (!file.data) {
    body = file.isError ? <div className={s.gate}><Notice tone="danger">{errorMessage(file.error)}</Notice></div> : <div className={s.sharedMain}><Skeleton height={80} /><Skeleton height={420} /></div>;
  } else {
    const d = file.data;
    body = (
      <div className={s.sharedMain}>
        <div className={s.banner}>
          <div className={s.bannerText}>
            <strong>Shared with you by {d.sharedBy ?? company}</strong>
            <span className={s.muted}>View only, for {d.recipientEmail}.{d.expiresAt ? ` Available until ${formatDate(d.expiresAt)}.` : ''} Please do not forward it.</span>
            {d.message ? <span className={s.quote}>"{d.message}"</span> : null}
          </div>
          <Button variant="ghost" size="sm" onClick={() => { saveViewer(token, null); setViewer(null); }}>Sign out</Button>
        </div>
        <header className={s.head}>
          <div className={s.headText}>
            <h1 className={s.name}>{d.file.name}</h1>
            <div className={s.meta}>
              <span>{[d.file.jobTitle, d.file.department].filter(Boolean).join(', ')}</span>
              {d.file.withdrawn ? <Badge tone="neutral" size="sm">Withdrawn</Badge> : null}
              <span className={s.muted}>Applied {formatDate(d.file.appliedAt)}</span>
            </div>
          </div>
        </header>
        <LibraryFileView file={d.file} actions={{
          allowDownload: d.allowDownload,
          documentUrl: (docId, download) => sharedApi.documentUrl(token, viewer, docId, download),
          recordingUrl: (recId) => sharedApi.recordingUrl(token, viewer, recId),
        }} />
      </div>
    );
  }

  return <div className={s.sharedPage}>{bar}<main id="main">{body}</main></div>;
}

function Gate({ token, masked, sharedBy, company, onVerified }: { token: string; masked: string; sharedBy: string | null; company: string; onVerified: (viewer: string) => void }) {
  const [step, setStep] = useState<'email' | 'code'>('email');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const sendCode = async (e?: FormEvent) => {
    e?.preventDefault();
    setError(null); setBusy(true);
    try { await sharedApi.requestCode(token, email.trim()); setStep('code'); setCode(''); } catch (err) { setError(errorMessage(err)); } finally { setBusy(false); }
  };
  const verify = async (e: FormEvent) => {
    e.preventDefault();
    setError(null); setBusy(true);
    try {
      const v = await sharedApi.verify(token, email.trim(), code.trim());
      saveViewer(token, v);
      onVerified(v.viewerToken);
    } catch (err) { setError(errorMessage(err)); } finally { setBusy(false); }
  };

  return (
    <div className={s.gate}>
      <div className={s.gateCard}>
        <div>
          <h1 className={s.gateTitle}>{sharedBy ? `${sharedBy} shared an applicant file with you` : `${company} shared an applicant file with you`}</h1>
          <p className={s.muted}>It was sent to {masked}. To keep the applicant's details private, we check it is you before showing it.</p>
        </div>
        {step === 'email' ? (
          <form className={s.gateForm} onSubmit={(e) => void sendCode(e)} noValidate>
            <Field label="Your email address" error={error ?? undefined}>
              <TextInput type="email" icon="mail" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} data-autofocus />
            </Field>
            <Button type="submit" loading={busy} disabled={!email.includes('@')}>Email me a code</Button>
          </form>
        ) : (
          <form className={s.gateForm} onSubmit={(e) => void verify(e)} noValidate>
            <p>If {email} is the address this was sent to, a 6-digit code is on its way. It works for 10 minutes.</p>
            <Field label="Code" error={error ?? undefined}>
              <TextInput className={s.codeInput} inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} data-autofocus />
            </Field>
            <Button type="submit" loading={busy} disabled={code.length !== 6}>Open the file</Button>
            <div className={s.shareActions}>
              <Button variant="ghost" size="sm" onClick={() => void sendCode()}>Send a new code</Button>
              <Button variant="ghost" size="sm" onClick={() => { setStep('email'); setError(null); }}>Use another email</Button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
