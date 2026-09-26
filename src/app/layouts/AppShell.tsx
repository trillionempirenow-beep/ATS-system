import { useEffect, useRef, useState } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import type { ShellSummaryDto } from '@shared/api/me';
import { BrandMark, Icon } from '@/components/icon/Icon';
import { IconButton, ButtonLink } from '@/components/ui/Button';
import { Avatar } from '@/components/ui/Display';
import { Menu } from '@/components/ui/Overlay';
import { Spinner } from '@/components/ui/Feedback';
import { cx } from '@/lib/cx';
import { NotificationItem } from '@/features/notifications/NotificationItem';
import { useMarkRead, useNotifications, useShellSummary } from '@/features/notifications/api';
import { useAuth, useMe } from '../providers/AuthProvider';
import { useTheme } from '../providers/ThemeProvider';
import { navFor, type NavItem } from './nav';
import s from './AppShell.module.css';

const COLLAPSE_KEY = 'acme-sidebar-collapsed';

function badgeCount(item: NavItem, summary?: ShellSummaryDto): number {
  if (!summary || !item.badge) return 0;
  return item.badge === 'approvals' ? summary.badges.pendingApprovals : item.badge === 'accounts' ? summary.badges.accountRequests : summary.badges.passwordResets;
}

function NavEntry({ item, summary, onNavigate }: { item: NavItem; summary?: ShellSummaryDto; onNavigate: () => void }) {
  const location = useLocation();
  const count = badgeCount(item, summary);
  const extra = item.match?.some((m) => location.pathname.startsWith(m) && location.pathname !== '/app/candidates/new');
  return (
    <NavLink
      to={item.to}
      end={item.end}
      title={item.label}
      onClick={onNavigate}
      className={({ isActive }) => cx(s.item, (isActive || extra) && s.itemActive)}
    >
      <Icon name={item.icon} size={18} />
      <span className={s.itemLabel}>{item.label}</span>
      {count ? <span className={s.count} aria-label={`${count} waiting`}>{count}</span> : null}
    </NavLink>
  );
}

function Sidebar({ collapsed, drawerOpen, onToggle, onNavigate, summary }: { collapsed: boolean; drawerOpen: boolean; onToggle: () => void; onNavigate: () => void; summary?: ShellSummaryDto }) {
  const me = useMe();
  const { signOut } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const groups = navFor(me);
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const isOpen = (key: string, items: NavItem[]) => open[key] ?? items.some((i) => location.pathname.startsWith(i.to));

  return (
    <aside className={cx(s.sidebar, collapsed && s.collapsed, !collapsed && s.expandedTablet, drawerOpen && s.drawerOpen)} aria-label="Main navigation">
      <div className={s.brand}>
        <BrandMark size={32} />
        <span className={s.brandText}>
          <span className={s.brandName}>Acme<em>/</em>people</span>
          <span className={s.brandRole}>{me.roleLabel}</span>
        </span>
        <IconButton className={s.collapseBtn} icon="panel" label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'} size={32} onClick={onToggle} />
      </div>
      {collapsed ? <div style={{ display: 'flex', justifyContent: 'center', padding: '8px 0 0' }}><IconButton icon="panel" label="Expand sidebar" size={32} onClick={onToggle} /></div> : null}
      <nav className={s.nav}>
        {groups.map((g) => (
          <div key={g.key}>
            {g.collapsible ? (
              <>
                <div className={s.groupDivider} />
                <button type="button" className={s.item} onClick={() => setOpen((o) => ({ ...o, [g.key]: !isOpen(g.key, g.items) }))} aria-expanded={isOpen(g.key, g.items)} title={g.label}>
                  <Icon name={g.icon ?? 'layers'} size={18} />
                  <span className={s.itemLabel}>{g.label}</span>
                  <span className={cx(s.caret, isOpen(g.key, g.items) && s.caretOpen)}><Icon name="chevron" size={14} /></span>
                </button>
                {isOpen(g.key, g.items) || collapsed ? (
                  <div className={s.sub}>{g.items.map((i) => <NavEntry key={i.to} item={i} summary={summary} onNavigate={onNavigate} />)}</div>
                ) : null}
              </>
            ) : (
              <>
                <div className={s.groupLabel}>{g.label}</div>
                {g.items.map((i) => <NavEntry key={i.to} item={i} summary={summary} onNavigate={onNavigate} />)}
              </>
            )}
          </div>
        ))}
      </nav>
      <div className={s.bottom}>
        <NavLink to="/app/notifications" title="Notifications" onClick={onNavigate} className={({ isActive }) => cx(s.item, isActive && s.itemActive)}>
          <Icon name="bell" size={18} />
          <span className={s.itemLabel}>Notifications</span>
          {summary?.unread ? <span className={s.count}>{summary.unread}</span> : null}
        </NavLink>
        <NavLink to="/app/profile" title="My profile" onClick={onNavigate} className={({ isActive }) => cx(s.item, isActive && s.itemActive)}>
          <Icon name="user" size={18} />
          <span className={s.itemLabel}>My profile</span>
        </NavLink>
        {me.role !== 'employee' ? (
          <Link to="/" className={s.item} title="Public careers site">
            <Icon name="public" size={18} />
            <span className={s.itemLabel}>Public careers site</span>
          </Link>
        ) : null}
        <button type="button" className={s.item} title="Sign out" onClick={async () => { await signOut(); navigate('/login'); }}>
          <Icon name="signout" size={18} />
          <span className={s.itemLabel}>Sign out</span>
        </button>
      </div>
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
      <Sidebar collapsed={collapsed} drawerOpen={drawerOpen} onToggle={toggleCollapsed} onNavigate={() => setDrawerOpen(false)} summary={summary.data} />
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
              header={<div><div style={{ fontWeight: 650 }}>{me.name}</div><div style={{ fontSize: 13, color: 'var(--text3)' }}>{me.roleLabel}</div></div>}
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
    </div>
  );
}
