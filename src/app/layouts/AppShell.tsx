import { useEffect, useLayoutEffect, useRef, useState, type HTMLAttributes, type KeyboardEvent as ReactKeyboardEvent, type ReactNode, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import type { ShellSummaryDto } from '@shared/api/me';
import { BrandMark, Icon } from '@/components/icon/Icon';
import { IconButton, ButtonLink } from '@/components/ui/Button';
import { Avatar } from '@/components/ui/Display';
import { Menu } from '@/components/ui/Overlay';
import { Spinner } from '@/components/ui/Feedback';
import { cx } from '@/lib/cx';
import { AssistantDock } from '@/features/assistant/AssistantDock';
import { NotificationItem } from '@/features/notifications/NotificationItem';
import { useMarkRead, useNotifications, useShellSummary } from '@/features/notifications/api';
import { useAuth, useMe } from '../providers/AuthProvider';
import { useTheme } from '../providers/ThemeProvider';
import { navFor, type NavItem } from './nav';
import s from './AppShell.module.css';

const COLLAPSE_KEY = 'acme-sidebar-collapsed';
/** Below this the sidebar is an off-canvas drawer; keep in sync with AppShell.module.css. */
const MOBILE_QUERY = '(max-width: 767px)';
const SIDEBAR_ID = 'app-sidebar';
const FLYOUT_ID = 'app-sidebar-flyout';
/** Grace period for the pointer to travel from a rail icon to its flyout. */
const FLYOUT_CLOSE_DELAY = 150;
const POP_GAP = 8;
const POP_EDGE = 8;

type TipProps = Pick<HTMLAttributes<HTMLElement>, 'onPointerEnter' | 'onPointerLeave' | 'onFocus' | 'onBlur'>;

interface FlyoutState {
  key: string;
  anchor: HTMLButtonElement;
  /** Opened by click/keyboard: stays open when the pointer leaves. */
  pinned: boolean;
  focusFirst: boolean;
  left: number;
  top: number;
}

function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const mq = window.matchMedia(query);
    const onChange = () => setMatches(mq.matches);
    onChange();
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, [query]);
  return matches;
}

function badgeCount(item: NavItem, summary?: ShellSummaryDto): number {
  if (!summary || !item.badge) return 0;
  return item.badge === 'approvals' ? summary.badges.pendingApprovals : item.badge === 'accounts' ? summary.badges.accountRequests : summary.badges.passwordResets;
}

function NavEntry({ item, summary, onNavigate, tip }: { item: NavItem; summary?: ShellSummaryDto; onNavigate: () => void; tip?: TipProps }) {
  const location = useLocation();
  const count = badgeCount(item, summary);
  const extra = item.match?.some((m) => location.pathname.startsWith(m) && location.pathname !== '/app/candidates/new');
  return (
    <NavLink
      to={item.to}
      end={item.end}
      onClick={onNavigate}
      className={({ isActive }) => cx(s.item, (isActive || extra) && s.itemActive)}
      {...tip}
    >
      <Icon name={item.icon} size={18} />
      <span className={s.itemLabel}>{item.label}</span>
      {count ? <span className={s.count} aria-label={`${count} waiting`}>{count}</span> : null}
    </NavLink>
  );
}

/** Collapsed-rail submenu. Portaled to <body> so the sidebar's overflow can never clip it. */
function Flyout({ state, label, panelRef, onPointerEnter, onPointerLeave, onExit, children }: {
  state: FlyoutState;
  label: string;
  panelRef: RefObject<HTMLDivElement>;
  onPointerEnter: () => void;
  onPointerLeave: () => void;
  onExit: (to: 'anchor' | 'next') => void;
  children: ReactNode;
}) {
  const [top, setTop] = useState<number | null>(null);
  const { top: anchorTop, focusFirst } = state;

  useLayoutEffect(() => {
    const el = panelRef.current;
    if (!el) return;
    const maxTop = document.documentElement.clientHeight - el.offsetHeight - POP_EDGE;
    setTop(Math.max(POP_EDGE, Math.min(anchorTop - 8, maxTop)));
  }, [anchorTop, panelRef]);

  useEffect(() => {
    if (focusFirst && top !== null) panelRef.current?.querySelector('a')?.focus();
  }, [focusFirst, top, panelRef]);

  const onKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    const links = Array.from(e.currentTarget.querySelectorAll('a'));
    if (!links.length) return;
    const i = links.indexOf(document.activeElement as HTMLAnchorElement);
    const focusAt = (n: number) => { e.preventDefault(); links[(n + links.length) % links.length]?.focus(); };
    switch (e.key) {
      case 'ArrowDown': focusAt(i + 1); break;
      case 'ArrowUp': focusAt(i < 0 ? -1 : i - 1); break;
      case 'Home': focusAt(0); break;
      case 'End': focusAt(-1); break;
      case 'ArrowLeft': e.preventDefault(); onExit('anchor'); break;
      // The flyout lives at the end of <body>; route Tab back into the sidebar's order.
      case 'Tab': e.preventDefault(); onExit(e.shiftKey ? 'anchor' : 'next'); break;
    }
  };

  return createPortal(
    <div
      ref={panelRef}
      id={FLYOUT_ID}
      role="group"
      aria-labelledby={`${FLYOUT_ID}-title`}
      className={cx(s.flyout, top !== null && s.flyoutOpen)}
      style={{ left: state.left, top: top ?? 0 }}
      onPointerEnter={onPointerEnter}
      onPointerLeave={(e) => { if (e.pointerType !== 'touch') onPointerLeave(); }}
      onKeyDown={onKeyDown}
    >
      <div id={`${FLYOUT_ID}-title`} className={s.flyoutTitle}>{label}</div>
      <div className={s.flyoutList}>{children}</div>
    </div>,
    document.body,
  );
}

function Sidebar({ collapsed, rail, mobile, drawerOpen, onToggle, onNavigate, summary }: {
  collapsed: boolean;
  /** Collapsed and not in the mobile drawer: icons only, with tooltips and flyouts. */
  rail: boolean;
  mobile: boolean;
  drawerOpen: boolean;
  onToggle: () => void;
  onNavigate: () => void;
  summary?: ShellSummaryDto;
}) {
  const me = useMe();
  const { signOut } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const groups = navFor(me);
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const isOpen = (key: string, items: NavItem[]) => open[key] ?? items.some((i) => location.pathname.startsWith(i.to));

  const asideRef = useRef<HTMLElement>(null);
  const navRef = useRef<HTMLElement>(null);
  const flyoutRef = useRef<HTMLDivElement>(null);
  const closeTimer = useRef(0);
  const [flyout, setFlyout] = useState<FlyoutState | null>(null);
  const [tip, setTip] = useState<{ text: string; left: number; top: number } | null>(null);

  const closeFlyout = () => {
    window.clearTimeout(closeTimer.current);
    if (!flyout) return;
    if (flyoutRef.current?.contains(document.activeElement)) flyout.anchor.focus();
    setFlyout(null);
  };

  const scheduleClose = () => {
    if (flyout?.pinned) return;
    window.clearTimeout(closeTimer.current);
    closeTimer.current = window.setTimeout(() => setFlyout((f) => (f?.pinned ? f : null)), FLYOUT_CLOSE_DELAY);
  };

  const openFlyout = (key: string, anchor: HTMLButtonElement, opts: { pin?: boolean; focusFirst?: boolean } = {}) => {
    window.clearTimeout(closeTimer.current);
    const sidebar = asideRef.current?.getBoundingClientRect();
    if (!sidebar) return;
    setTip(null);
    setFlyout((f) => ({
      key,
      anchor,
      pinned: !!opts.pin || (f?.key === key && f.pinned),
      focusFirst: !!opts.focusFirst,
      left: sidebar.right + POP_GAP,
      top: anchor.getBoundingClientRect().top,
    }));
  };

  const exitFlyout = (to: 'anchor' | 'next') => {
    if (!flyout) return;
    const { anchor } = flyout;
    window.clearTimeout(closeTimer.current);
    setFlyout(null);
    anchor.focus();
    if (to !== 'next' || !asideRef.current) return;
    const focusable = Array.from(asideRef.current.querySelectorAll<HTMLElement>('a[href], button:not([disabled])'))
      .filter((n) => n.getClientRects().length > 0 && getComputedStyle(n).visibility !== 'hidden');
    focusable[focusable.indexOf(anchor) + 1]?.focus();
  };

  const showTip = (el: HTMLElement, text: string) => {
    const sidebar = asideRef.current?.getBoundingClientRect();
    if (!sidebar) return;
    const r = el.getBoundingClientRect();
    setTip({ text, left: sidebar.right + POP_GAP, top: r.top + r.height / 2 });
  };

  const tipBind = (text: string): TipProps => ({
    onPointerEnter: (e) => {
      if (e.pointerType === 'touch') return;
      if (!flyout?.pinned) closeFlyout();
      showTip(e.currentTarget, text);
    },
    onPointerLeave: () => setTip(null),
    onFocus: (e) => { if (e.currentTarget.matches(':focus-visible')) showTip(e.currentTarget, text); },
    onBlur: () => setTip(null),
  });
  /** Nav items only need a tooltip when their label is hidden. */
  const tipFor = (text: string): TipProps | undefined => (rail ? tipBind(text) : undefined);

  // Pinned flyouts close on outside press or Escape.
  useEffect(() => {
    if (!flyout) return;
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (flyoutRef.current?.contains(t) || flyout.anchor.contains(t)) return;
      window.clearTimeout(closeTimer.current);
      setFlyout(null);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (flyoutRef.current?.contains(document.activeElement)) flyout.anchor.focus();
      window.clearTimeout(closeTimer.current);
      setFlyout(null);
    };
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('pointerdown', onDown); document.removeEventListener('keydown', onKey); };
  }, [flyout]);

  // Popovers are anchored to viewport coordinates; dismiss rather than chase them.
  useEffect(() => {
    if (mobile) return;
    const nav = navRef.current;
    const timer = closeTimer;
    const dismiss = () => { window.clearTimeout(timer.current); setFlyout(null); setTip(null); };
    nav?.addEventListener('scroll', dismiss, { passive: true });
    window.addEventListener('resize', dismiss);
    return () => {
      nav?.removeEventListener('scroll', dismiss);
      window.removeEventListener('resize', dismiss);
      window.clearTimeout(timer.current);
    };
  }, [mobile]);

  const flyoutGroup = rail && flyout ? groups.find((g) => g.key === flyout.key) : undefined;
  const toggleLabel = mobile ? 'Close navigation' : collapsed ? 'Open sidebar' : 'Close sidebar';

  return (
    <aside id={SIDEBAR_ID} ref={asideRef} className={cx(s.sidebar, rail && s.collapsed, drawerOpen && s.drawerOpen)} aria-label="Main navigation">
      <div className={s.brand}>
        <div className={s.brandLogo} aria-hidden={rail || undefined}>
          <BrandMark size={32} />
          <span className={s.brandText}>
            <span className={s.brandName}>Acme<em>/</em>people</span>
            <span className={s.brandRole}>{me.roleLabel}</span>
          </span>
        </div>
        <button
          type="button"
          className={s.toggleBtn}
          aria-label={toggleLabel}
          aria-controls={SIDEBAR_ID}
          aria-expanded={mobile ? drawerOpen : !collapsed}
          onClick={() => { window.clearTimeout(closeTimer.current); setFlyout(null); setTip(null); onToggle(); }}
          {...(mobile ? undefined : tipBind(toggleLabel))}
        >
          {/* Collapsed: the logo holds the toggle's place and gives way to the icon on hover or focus. */}
          {rail ? <span className={s.toggleLogo} aria-hidden="true"><BrandMark size={32} /></span> : null}
          <Icon className={s.toggleIcon} name={rail ? 'panelopen' : 'panelclose'} size={20} />
        </button>
      </div>
      <nav ref={navRef} className={s.nav}>
        {groups.map((g) => {
          if (!g.collapsible) {
            return (
              <div key={g.key}>
                <div className={s.groupLabel}>{g.label}</div>
                {g.items.map((i) => <NavEntry key={i.to} item={i} summary={summary} onNavigate={onNavigate} tip={tipFor(i.label)} />)}
              </div>
            );
          }
          const expanded = !rail && isOpen(g.key, g.items);
          const flyoutOpen = rail && flyout?.key === g.key;
          const active = g.items.some((i) => location.pathname.startsWith(i.to));
          const total = g.items.reduce((n, i) => n + badgeCount(i, summary), 0);
          const panelId = `${SIDEBAR_ID}-${g.key}`;
          return (
            <div key={g.key}>
              <button
                type="button"
                className={cx(s.item, rail && active && s.itemActive)}
                aria-expanded={rail ? flyoutOpen : expanded}
                aria-controls={rail ? (flyoutOpen ? FLYOUT_ID : undefined) : panelId}
                onClick={(e) => {
                  if (!rail) { setOpen((o) => ({ ...o, [g.key]: !isOpen(g.key, g.items) })); return; }
                  if (flyout?.key === g.key && flyout.pinned) closeFlyout();
                  // detail === 0 → activated from the keyboard: move focus into the flyout.
                  else openFlyout(g.key, e.currentTarget, { pin: true, focusFirst: e.detail === 0 });
                }}
                onPointerEnter={rail ? (e) => { if (e.pointerType !== 'touch') openFlyout(g.key, e.currentTarget); } : undefined}
                onPointerLeave={rail ? scheduleClose : undefined}
                onKeyDown={rail ? (e) => {
                  if (e.key !== 'ArrowRight') return;
                  e.preventDefault();
                  openFlyout(g.key, e.currentTarget, { pin: true, focusFirst: true });
                } : undefined}
                onFocus={rail ? (e) => { if (!flyoutOpen && e.currentTarget.matches(':focus-visible')) showTip(e.currentTarget, g.label); } : undefined}
                onBlur={rail ? () => setTip(null) : undefined}
              >
                <Icon name={g.icon ?? 'layers'} size={18} />
                <span className={s.itemLabel}>{g.label}</span>
                {total && !expanded ? <span className={s.count} aria-label={`${total} waiting`}>{total}</span> : null}
                <span className={cx(s.caret, expanded && s.caretOpen)}><Icon name="chevron" size={14} /></span>
              </button>
              <div id={panelId} className={cx(s.subPanel, expanded && s.subPanelOpen)}>
                <div className={s.sub}>{g.items.map((i) => <NavEntry key={i.to} item={i} summary={summary} onNavigate={onNavigate} />)}</div>
              </div>
            </div>
          );
        })}
      </nav>
      <div className={s.bottom}>
        <NavLink to="/app/notifications" onClick={onNavigate} className={({ isActive }) => cx(s.item, isActive && s.itemActive)} {...tipFor('Notifications')}>
          <Icon name="bell" size={18} />
          <span className={s.itemLabel}>Notifications</span>
          {summary?.unread ? <span className={s.count}>{summary.unread}</span> : null}
        </NavLink>
        <NavLink to="/app/profile" onClick={onNavigate} className={({ isActive }) => cx(s.item, isActive && s.itemActive)} {...tipFor('My profile')}>
          <Icon name="user" size={18} />
          <span className={s.itemLabel}>My profile</span>
        </NavLink>
        {me.role !== 'employee' ? (
          <Link to="/" className={s.item} {...tipFor('Public careers site')}>
            <Icon name="public" size={18} />
            <span className={s.itemLabel}>Public careers site</span>
          </Link>
        ) : null}
        <button type="button" className={s.item} onClick={async () => { await signOut(); navigate('/login'); }} {...tipFor('Sign out')}>
          <Icon name="signout" size={18} />
          <span className={s.itemLabel}>Sign out</span>
        </button>
      </div>
      {flyout && flyoutGroup ? (
        <Flyout
          state={flyout}
          label={flyoutGroup.label}
          panelRef={flyoutRef}
          onPointerEnter={() => window.clearTimeout(closeTimer.current)}
          onPointerLeave={scheduleClose}
          onExit={exitFlyout}
        >
          {flyoutGroup.items.map((i) => <NavEntry key={i.to} item={i} summary={summary} onNavigate={() => { closeFlyout(); onNavigate(); }} />)}
        </Flyout>
      ) : null}
      {tip && !mobile ? createPortal(
        <div className={s.tooltip} style={{ left: tip.left, top: tip.top }} aria-hidden="true">{tip.text}</div>,
        document.body,
      ) : null}
    </aside>
  );
}

function NotificationBell({ unread }: { unread: number }) {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const list = useNotifications(undefined, 6);
  const markRead = useMarkRead();
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (!wrap.current?.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey); };
  }, [open]);
  return (
    <div ref={wrap} style={{ position: 'relative' }}>
      <IconButton icon="bell" label={unread ? `Notifications, ${unread} unread` : 'Notifications'} size={40} badge={unread} onClick={() => setOpen((v) => !v)} aria-expanded={open} />
      {open ? (
        <div className={s.popover} role="dialog" aria-label="Notifications">
          <div className={s.popHead}>
            <strong>Notifications</strong>
            {unread ? <button type="button" className={s.linkBtn} onClick={() => markRead.mutate({ all: true })}>Mark all read</button> : null}
          </div>
          <div className={s.popList}>
            {list.isLoading ? <div style={{ padding: 24, display: 'flex', justifyContent: 'center' }}><Spinner /></div> : null}
            {list.data?.items.length === 0 ? <p style={{ padding: 24, textAlign: 'center', color: 'var(--text3)' }}>You are all caught up.</p> : null}
            {list.data?.items.map((n) => (
              <NotificationItem key={n.id} n={n} compact onOpen={(item) => { if (!item.read) markRead.mutate({ ids: [item.id] }); setOpen(false); }} />
            ))}
          </div>
          <Link to="/app/notifications" className={s.popFoot} onClick={() => setOpen(false)}>See all notifications</Link>
        </div>
      ) : null}
    </div>
  );
}

export function AppShell({ wide }: { wide?: boolean }) {
  const me = useMe();
  const { signOut } = useAuth();
  const { theme, toggle } = useTheme();
  const navigate = useNavigate();
  const location = useLocation();
  const summary = useShellSummary();
  const mobile = useMediaQuery(MOBILE_QUERY);
  const [collapsed, setCollapsed] = useState(() => {
    try { return localStorage.getItem(COLLAPSE_KEY) === '1'; } catch { return false; }
  });
  const [drawerOpen, setDrawerOpen] = useState(false);
  useEffect(() => { setDrawerOpen(false); }, [location.pathname]);
  const toggleCollapsed = () => setCollapsed((c) => {
    try { localStorage.setItem(COLLAPSE_KEY, c ? '0' : '1'); } catch { /* per-browser preference only */ }
    return !c;
  });
  const live = summary.data?.liveMeeting;
  const inRoom = live && location.pathname.startsWith(`/app/interviews/${live.interviewId}/room`);

  return (
    <div className={s.shell}>
      <a href="#main" className="skip-link">Skip to content</a>
      <Sidebar
        collapsed={collapsed}
        rail={collapsed && !mobile}
        mobile={mobile}
        drawerOpen={drawerOpen}
        onToggle={mobile ? () => setDrawerOpen(false) : toggleCollapsed}
        onNavigate={() => setDrawerOpen(false)}
        summary={summary.data}
      />
      {drawerOpen ? <div className={s.scrim} onClick={() => setDrawerOpen(false)} /> : null}
      <div className={s.main}>
        <header className={s.header}>
          <div className={s.headerLeft}>
            <IconButton className={s.mobileMenu} icon="menu" label="Open navigation" size={40} onClick={() => setDrawerOpen(true)} />
          </div>
          <div className={s.headerRight}>
            <IconButton icon={theme === 'dark' ? 'sun' : 'moon'} label={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'} size={40} onClick={toggle} />
            <NotificationBell unread={summary.data?.unread ?? 0} />
            <Menu
              trigger={(p) => (
                <button type="button" className={s.accountBtn} {...p} aria-label="Account menu">
                  <Avatar name={me.name} src={me.avatarUrl} size={32} />
                  <Icon name="chevron" size={14} />
                </button>
              )}
              header={<div><div style={{ fontWeight: 600 }}>{me.name}</div><div style={{ fontSize: 13, color: 'var(--text3)' }}>{me.roleLabel}</div></div>}
              items={[
                { label: 'My profile', icon: 'user', onSelect: () => navigate('/app/profile') },
                { label: 'Notifications', icon: 'bell', onSelect: () => navigate('/app/notifications') },
                { label: theme === 'dark' ? 'Light theme' : 'Dark theme', icon: theme === 'dark' ? 'sun' : 'moon', onSelect: toggle },
                { label: 'Sign out', icon: 'signout', danger: true, separatorBefore: true, onSelect: async () => { await signOut(); navigate('/login'); } },
              ]}
            />
          </div>
        </header>
        {live && !inRoom ? (
          <div className={s.liveBanner} role="status">
            <span style={{ display: 'flex', alignItems: 'center', gap: 10 }}><span className={s.liveDot} />Interview in progress · {live.jobTitle} with {live.candidateName}</span>
            <ButtonLink size="sm" variant="secondary" to={`/app/interviews/${live.interviewId}/room`}>Back to meeting</ButtonLink>
          </div>
        ) : null}
        <main id="main" className={cx(s.content, wide && s.contentWide)}>
          <Outlet />
        </main>
      </div>
      <AssistantDock />
    </div>
  );
}
