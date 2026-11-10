import { useEffect, useState, type ReactNode } from 'react';
import { Button } from './Button';
import { Modal } from './Overlay';

/**
 * Asks before throwing away unsaved edits.
 *  - `guard(close)` runs `close` straight away when nothing changed, otherwise asks first.
 *    Pass it as a drawer's onClose (Esc, backdrop, ×) and to its Cancel button.
 *  - While there are edits, closing or reloading the tab gets the browser's own warning.
 * Render `dialog` once, anywhere in the component.
 * (For leaving a whole page through a link, use react-router's useBlocker: a router allows only one.)
 */
export function useDiscardGuard(dirty: boolean, what = 'changes'): { guard: (close: () => void) => void; dialog: ReactNode } {
  const [pending, setPending] = useState<(() => void) | null>(null);

  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  const guard = (close: () => void) => {
    if (dirty) setPending(() => close);
    else close();
  };

  const dialog = (
    <Modal open={pending !== null} onClose={() => setPending(null)} title={`Discard ${what}?`} role="alertdialog"
      footer={<>
        <Button variant="secondary" onClick={() => setPending(null)}>Keep editing</Button>
        <Button variant="danger" onClick={() => { const close = pending; setPending(null); close?.(); }}>Discard</Button>
      </>}>
      <p style={{ color: 'var(--text2)' }}>Your {what} haven&rsquo;t been saved. If you close this now, they&rsquo;re lost.</p>
    </Modal>
  );

  return { guard, dialog };
}

/** A yes/no confirmation for actions that can't be undone. Render `dialog`; call `ask(run)` from the button. */
export function useConfirm(opts: { title: string; body: ReactNode; confirmLabel: string; danger?: boolean }): { ask: (run: () => void) => void; dialog: ReactNode } {
  const [pending, setPending] = useState<(() => void) | null>(null);
  const dialog = (
    <Modal open={pending !== null} onClose={() => setPending(null)} title={opts.title} role="alertdialog"
      footer={<>
        <Button variant="secondary" onClick={() => setPending(null)}>Go back</Button>
        <Button variant={opts.danger === false ? 'primary' : 'danger'} onClick={() => { const run = pending; setPending(null); run?.(); }}>{opts.confirmLabel}</Button>
      </>}>
      <div style={{ color: 'var(--text2)' }}>{opts.body}</div>
    </Modal>
  );
  return { ask: (run) => setPending(() => run), dialog };
}
