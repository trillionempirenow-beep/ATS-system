import { useEffect, useId, useRef, useState, type ReactNode, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { Icon, type IconName } from '../icon/Icon';
import { cx } from '@/lib/cx';
import s from './Overlay.module.css';

const FOCUSABLE = 'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

/** Traps Tab inside the dialog, closes on Escape, and returns focus to the opener. */
function useDialog(ref: RefObject<HTMLElement>, onClose: () => void, open: boolean) {
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    if (!open) return;
    const opener = document.activeElement as HTMLElement | null;
    const el = ref.current;
    const first = el?.querySelector<HTMLElement>('[data-autofocus]') ?? el?.querySelector<HTMLElement>(FOCUSABLE);
    first?.focus();
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.stopPropagation(); close.current(); return; }
      if (e.key !== 'Tab' || !el) return;
      const nodes = Array.from(el.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((n) => n.offsetParent !== null);
      if (!nodes.length) return;
      const [a, b] = [nodes[0]!, nodes[nodes.length - 1]!];
      if (e.shiftKey && document.activeElement === a) { e.preventDefault(); b.focus(); }
      else if (!e.shiftKey && document.activeElement === b) { e.preventDefault(); a.focus(); }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
      opener?.focus?.();
    };
  }, [open, ref]);
}

interface ModalProps {
  open: boolean;
  title: ReactNode;
  subtitle?: ReactNode;
  width?: number;
  footer?: ReactNode;
  onClose: () => void;
  children?: ReactNode;
  role?: 'dialog' | 'alertdialog';
}

export function Modal({ open, title, subtitle, width = 480, footer, onClose, children, role = 'dialog' }: ModalProps) {
  const ref = useRef<HTMLDivElement>(null);
  const id = useId();
  useDialog(ref, onClose, open);
  if (!open) return null;
  return createPortal(
    <div className={s.scrim} onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div ref={ref} className={s.modal} style={{ maxWidth: width }} role={role} aria-modal="true" aria-labelledby={`${id}-t`}>
        <div className={s.modalHead}>
          <div>
            <h2 id={`${id}-t`} className={s.modalTitle}>{title}</h2>
            {subtitle ? <p className={s.modalSub}>{subtitle}</p> : null}
          </div>
          <button type="button" className={s.close} onClick={onClose} aria-label="Close"><Icon name="close" size={18} /></button>
        </div>
        {children ? <div className={s.modalBody}>{children}</div> : null}
        {footer ? <div className={s.modalFoot}>{footer}</div> : null}
      </div>
    </div>,
    document.body,
  );
}

interface DrawerProps {
  open: boolean;
  title: ReactNode;
  subtitle?: ReactNode;
  width?: number;
  footer?: ReactNode;
  onClose: () => void;
  children: ReactNode;
}

export function Drawer({ open, title, subtitle, width = 480, footer, onClose, children }: DrawerProps) {
  const ref = useRef<HTMLDivElement>(null);
  const id = useId();
  useDialog(ref, onClose, open);
  if (!open) return null;
  return createPortal(
    <>
      <div className={s.drawerScrim} onClick={onClose} />
      <aside ref={ref} className={s.drawer} style={{ ['--drawer-w' as string]: `${width}px` }} role="dialog" aria-modal="true" aria-labelledby={`${id}-t`}>
        <div className={s.drawerHead}>
          <div style={{ minWidth: 0 }}>
            <h2 id={`${id}-t`} style={{ fontSize: 18, lineHeight: '28px', fontWeight: 700 }}>{title}</h2>
            {subtitle ? <p style={{ color: 'var(--text2)', marginTop: 2 }}>{subtitle}</p> : null}
          </div>
          <button type="button" className={s.close} onClick={onClose} aria-label="Close"><Icon name="close" size={18} /></button>
        </div>
        <div className={s.drawerBody}>{children}</div>
        {footer ? <div className={s.drawerFoot}>{footer}</div> : null}
      </aside>
    </>,
    document.body,
  );
}

export interface MenuItem {
  label: string;
  icon?: IconName;
  onSelect: () => void;
  danger?: boolean;
  separatorBefore?: boolean;
  hidden?: boolean;
}

export function Menu({ trigger, items, align = 'right', header }: { trigger: (props: { onClick: () => void; 'aria-expanded': boolean; 'aria-haspopup': 'menu' }) => ReactNode; items: MenuItem[]; align?: 'left' | 'right'; header?: ReactNode }) {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (!wrap.current?.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { setOpen(false); (wrap.current?.querySelector('button') as HTMLElement | null)?.focus(); }
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        const nodes = Array.from(wrap.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? []);
        const i = nodes.indexOf(document.activeElement as HTMLElement);
        nodes[(i + (e.key === 'ArrowDown' ? 1 : -1) + nodes.length) % nodes.length]?.focus();
      }
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    wrap.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey); };
  }, [open]);
  return (
    <div className={s.menuWrap} ref={wrap}>
      {trigger({ onClick: () => setOpen((v) => !v), 'aria-expanded': open, 'aria-haspopup': 'menu' })}
      {open ? (
        <div className={cx(s.menu, align === 'right' ? s.menuRight : s.menuLeft)} role="menu">
          {header ? <div className={s.menuHeader}>{header}</div> : null}
          {items.filter((i) => !i.hidden).map((i) => (
            <div key={i.label}>
              {i.separatorBefore ? <div className={s.menuSep} /> : null}
              <button type="button" role="menuitem" className={cx(s.menuItem, i.danger && s.menuItemDanger)} onClick={() => { setOpen(false); i.onSelect(); }}>
                {i.icon ? <Icon name={i.icon} size={16} /> : null}
                {i.label}
              </button>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export const overlayStyles = s;
