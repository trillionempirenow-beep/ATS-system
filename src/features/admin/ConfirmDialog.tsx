import { useEffect, useState, type ReactNode } from 'react';
import { Button } from '@/components/ui/Button';
import { Field, Textarea, formStyles } from '@/components/ui/Form';
import { Notice } from '@/components/ui/Feedback';
import { Modal } from '@/components/ui/Overlay';

export interface ConfirmRequest {
  title: string;
  body: ReactNode;
  confirmLabel: string;
  danger?: boolean;
  /** Ask for an optional (or required) note that is passed to run(). */
  note?: { label: string; required?: boolean };
  run: (note: string) => Promise<unknown>;
}

/** "Changes are confirmed before they save": every account-level change goes through this dialog. */
export function ConfirmDialog({ request, onClose }: { request: ConfirmRequest | null; onClose: () => void }) {
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { setNote(''); setError(null); setBusy(false); }, [request]);
  if (!request) return null;
  const confirm = async () => {
    if (request.note?.required && !note.trim()) { setError(`${request.note.label} is required.`); return; }
    setBusy(true);
    setError(null);
    try {
      await request.run(note.trim());
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong. Please try again.');
      setBusy(false);
    }
  };
  return (
    <Modal open onClose={onClose} role="alertdialog" title={request.title}
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button variant={request.danger ? 'danger' : 'primary'} loading={busy} onClick={() => void confirm()}>{request.confirmLabel}</Button></>}>
      <div className={formStyles.stack}>
        {error ? <Notice tone="danger">{error}</Notice> : null}
        <div>{request.body}</div>
        {request.note ? (
          <Field label={request.note.label} optional={!request.note.required}><Textarea rows={3} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} /></Field>
        ) : null}
      </div>
    </Modal>
  );
}
