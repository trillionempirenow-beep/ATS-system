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
import { useLegacyLook } from './useLegacyLook';
import s from './PublicLayout.module.css';

export function usePublicConfig() {
  return useQuery({ queryKey: ['public', 'config'], queryFn: () => api.get<PublicConfigDto>('/public/config'), staleTime: 5 * 60_000 });
}

const LINKS = [
  { to: '/jobs', label: 'Find roles' },
  { to: '/#why', label: 'Why Acme' },
  { to: '/status', label: 'Check status' },
  { to: '/refer', label: 'Refer someone' },
];

export function PublicLayout() {
  useLegacyLook();
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
          <span className={s.spacer} />
          <IconButton icon={theme === 'dark' ? 'sun' : 'moon'} label="Toggle color theme" size={40} onClick={toggle} />
          <ButtonLink variant="secondary" icon="public" to={hub}>{user ? 'Open workspace' : 'Recruiter hub'}</ButtonLink>
        </nav>
        <div className={s.menuBtn} style={{ gap: 4 }}>
          <IconButton icon={theme === 'dark' ? 'sun' : 'moon'} label="Toggle color theme" size={40} onClick={toggle} />
          <IconButton icon={open ? 'close' : 'menu'} label={open ? 'Close menu' : 'Open menu'} size={40} onClick={() => setOpen((v) => !v)} aria-expanded={open} />
        </div>
      </header>
      {open ? (
        <nav className={s.mobileNav} aria-label="Careers">
          {links}
          <Link to={hub} className={s.link}>{user ? 'Open workspace' : 'Recruiter hub'}</Link>
        </nav>
      ) : null}
      <main id="main" className={s.main}>
        <Outlet />
      </main>
      <footer className={s.footer}>
        <div className={s.footerInner}>
          <div className={s.footerBrand}>
            <div className={s.logo}><BrandMark size={24} label={`${company} logo`} /><span>{company}<em>/</em>careers</span></div>
            <p className={s.footerText}>Small teams, big ownership. Interviews run inside {company}, and you can track every application.</p>
          </div>
          <div className={s.footerCols}>
            <div className={s.footerCol}>
              <strong>Candidates</strong>
              <Link to="/jobs">Open roles</Link>
              <Link to="/status">Check status</Link>
              <Link to="/refer">Refer someone</Link>
            </div>
            <div className={s.footerCol}>
              <strong>Company</strong>
              <Link to="/#why">Why {company}</Link>
              <Link to={hub}>Recruiter hub</Link>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}
