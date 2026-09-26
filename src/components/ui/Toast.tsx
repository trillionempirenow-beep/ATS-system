import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Icon, type IconName } from '../icon/Icon';
import { cx } from '@/lib/cx';
import s from './Overlay.module.css';

type ToastTone = 'success' | 'error' | 'info' | 'warning';
interface ToastItem { id: number; tone: ToastTone; title?: string; message: string }
interface ToastApi {
  show: (t: Omit<ToastItem, 'id'> & { duration?: number }) => void;
  success: (message: string, title?: string) => void;
  error: (message: string, title?: string) => void;
  info: (message: string, title?: string) => void;
}

const ToastContext = createContext<ToastApi | null>(null);
const ICONS: Record<ToastTone, IconName> = { success: 'checkcircle', error: 'xcircle', info: 'info', warning: 'alert' };
const TONE_CLASS: Record<ToastTone, string | undefined> = { success: s.toastSuccess, error: s.toastError, info: s.toastInfo, warning: s.toastWarning };

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const seq = useRef(0);
  const dismiss = useCallback((id: number) => setItems((all) => all.filter((t) => t.id !== id)), []);
  const show = useCallback<ToastApi['show']>(({ duration = 4500, ...t }) => {
    const id = ++seq.current;
    setItems((all) => [...all.slice(-3), { id, ...t }]);
    window.setTimeout(() => dismiss(id), duration);
  }, [dismiss]);
  const api = useMemo<ToastApi>(() => ({
    show,
    success: (message, title) => show({ tone: 'success', message, title }),
    error: (message, title) => show({ tone: 'error', message, title, duration: 7000 }),
    info: (message, title) => show({ tone: 'info', message, title }),
  }), [show]);
  return (
    <ToastContext.Provider value={api}>
      {children}
      {createPortal(
        <div className={s.toasts} aria-live="polite" aria-relevant="additions">
          {items.map((t) => (
            <div key={t.id} className={cx(s.toast, TONE_CLASS[t.tone])} role={t.tone === 'error' ? 'alert' : 'status'}>
              <Icon name={ICONS[t.tone]} size={18} className={s.toastIcon} />
              <div style={{ flex: 1, minWidth: 0 }}>
                {t.title ? <div className={s.toastTitle}>{t.title}</div> : null}
                <div className={t.title ? s.toastMsg : undefined}>{t.message}</div>
              </div>
              <button type="button" onClick={() => dismiss(t.id)} aria-label="Dismiss" style={{ border: 0, background: 'none', color: 'var(--text3)', padding: 2, display: 'inline-flex', borderRadius: 4 }}>
                <Icon name="close" size={14} />
              </button>
            </div>
          ))}
        </div>,
        document.body,
      )}
    </ToastContext.Provider>
  );
}

export function useToast(): ToastApi {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used inside ToastProvider');
  return ctx;
}
