import { useEffect, useState } from 'react';
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import type { PublicConfigDto } from '@shared/api/public';
import { BrandMark } from '@/components/icon/Icon';
import { ButtonLink, IconButton } from '@/components/ui/Button';
import { api } from '@/lib/api';
import { cx } from '@/lib/cx';
import { useAuth } from '../providers/AuthProvider';
import { useTheme } from '../providers/ThemeProvider';
import s from './PublicLayout.module.css';

export function usePublicConfig() {
  return useQuery({ queryKey: ['public', 'config'], queryFn: () => api.get<PublicConfigDto>('/public/config'), staleTime: 5 * 60_000 });
}

const LINKS = [
  { to: '/jobs', label: 'Open roles' },
  { to: '/#how', label: 'How hiring works' },
  { to: '/status', label: 'Check your application' },
  { to: '/refer', label: 'Refer someone' },
];

export function PublicLayout() {
  const { theme, toggle } = useTheme();
  const { user } = useAuth();
  const config = usePublicConfig();
  const company = config.data?.companyName ?? 'Acme';
  const [open, setOpen] = useState(false);
  const location = useLocation();
  useEffect(() => { setOpen(false); }, [location.pathname, location.hash]);
  useEffect(() => {
    if (location.hash) document.getElementById(location.hash.slice(1))?.scrollIntoView({ behavior: 'smooth' });
    else window.scrollTo(0, 0);
  }, [location.pathname, location.hash]);

  const hub = user ? (user.role === 'super_admin' ? '/app/admin/admins' : user.role === 'employee' ? '/app/attendance' : '/app') : '/login';
  const links = LINKS.map((l) => (
    <NavLink key={l.to} to={l.to} className={({ isActive }) => cx(s.link, isActive && !l.to.includes('#') && s.linkActive)}>{l.label}</NavLink>
  ));

  return (
    <div className={s.page}>
      <a href="#main" className="skip-link">Skip to content</a>
      <header className={s.header}>
        <Link to="/" className={s.logo} aria-label={`${company} careers home`}>
          <BrandMark size={28} label={`${company} logo`} />
          <span>{company}<em>/</em>careers</span>
        </Link>
        <nav className={s.nav} aria-label="Careers">
          {links}
        </nav>
        <div className={s.tools}>
          <IconButton icon={theme === 'dark' ? 'sun' : 'moon'} label={theme === 'dark' ? 'Use light theme' : 'Use dark theme'} size={36} onClick={toggle} />
          <ButtonLink variant="secondary" size="sm" to={hub}>{user ? 'Open workspace' : 'Staff sign in'}</ButtonLink>
        </div>
        <div className={s.menuBtn}>
          <IconButton icon={theme === 'dark' ? 'sun' : 'moon'} label={theme === 'dark' ? 'Use light theme' : 'Use dark theme'} size={40} onClick={toggle} />
          <IconButton icon={open ? 'close' : 'menu'} label={open ? 'Close menu' : 'Open menu'} size={40} onClick={() => setOpen((v) => !v)} aria-expanded={open} />
        </div>
      </header>
      {open ? (
        <nav className={s.mobileNav} aria-label="Careers">
          {links}
          <Link to={hub} className={s.link}>{user ? 'Open workspace' : 'Staff sign in'}</Link>
        </nav>
      ) : null}
      <main id="main" className={s.main}>
        <Outlet />
      </main>
      <footer className={s.footer}>
        <div className={s.footerInner}>
          <div className={s.logo}><BrandMark size={22} label={`${company} logo`} /><span>{company}<em>/</em>careers</span></div>
          <nav className={s.footerLinks} aria-label="Footer">
            <Link to="/jobs">Open roles</Link>
            <Link to="/#how">How hiring works</Link>
            <Link to="/status">Check your application</Link>
            <Link to="/refer">Refer someone</Link>
            <Link to={hub}>{user ? 'Open workspace' : 'Staff sign in'}</Link>
          </nav>
        </div>
      </footer>
    </div>
  );
}
