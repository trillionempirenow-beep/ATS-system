import type { ReactNode } from 'react';
import { Link, Outlet } from 'react-router-dom';
import { BrandMark, Icon, type IconName } from '@/components/icon/Icon';
import { IconButton } from '@/components/ui/Button';
import { useTheme } from '../providers/ThemeProvider';
import s from './AuthLayout.module.css';

const POINTS: Array<[IconName, string]> = [
  ['shield', 'Role-based access control'],
  ['lock', 'Encrypted session, HTTP-only cookie'],
  ['layers', 'Every action written to the audit trail'],
];

/** Split brand panel and form, for sign in, reset and session-ended screens. */
export function AuthLayout({ children }: { children?: ReactNode }) {
  const { theme, toggle } = useTheme();
  return (
    <div className={s.split}>
      <section className={s.brand} aria-label="Acme People">
        <div className={s.logo}><BrandMark size={32} /><span>Acme<em>/</em>people</span></div>
        <div className={s.pitch}>
          <h1>Welcome back</h1>
          <p>Pick up where the team left off: candidates, interviews and approvals, all in one place.</p>
          <div className={s.points}>
            {POINTS.map(([icon, text]) => (
              <div key={text} className={s.point}><span className={s.pointIcon}><Icon name={icon} size={15} /></span>{text}</div>
            ))}
          </div>
        </div>
        <p className={s.foot}>
          Applicants do not need an account. <Link to="/jobs">Browse open roles</Link> or <Link to="/status">check an application</Link> from the careers site.
        </p>
      </section>
      <main className={s.formSide} id="main">
        <div className={s.theme}>
          <IconButton icon={theme === 'dark' ? 'sun' : 'moon'} label={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'} variant="secondary" onClick={toggle} />
        </div>
        <div className={s.panel}>{children ?? <Outlet />}</div>
      </main>
    </div>
  );
}
