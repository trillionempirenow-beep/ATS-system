import type { ReactNode } from 'react';
import { Link, Outlet } from 'react-router-dom';
import { STAGE_LABELS, STAGE_ORDER } from '@shared/domain/pipeline';
import { BrandMark } from '@/components/icon/Icon';
import { IconButton } from '@/components/ui/Button';
import { useTheme } from '../providers/ThemeProvider';
import s from './AuthLayout.module.css';

/**
 * Sign in, reset and session-ended screens. The ink panel carries the stage scale the
 * workspace is built around; on a phone it folds into a single bar.
 */
export function AuthLayout({ children }: { children?: ReactNode }) {
  const { theme, toggle } = useTheme();
  return (
    <div className={s.split}>
      <section className={s.brand} aria-label="Acme People">
        <div className={s.bar}>
          <div className={s.logo}><BrandMark size={28} /><span>Acme<em>/</em>people</span></div>
          <IconButton icon={theme === 'dark' ? 'sun' : 'moon'} label={theme === 'dark' ? 'Use light theme' : 'Use dark theme'} className={s.themeBtn} onClick={toggle} />
        </div>
        <div className={s.pitch}>
          <p className={s.pitchText}>The hiring workspace for the Acme recruiting and HR team.</p>
          <ol className={s.scale} aria-label="Hiring stages">
            {STAGE_ORDER.map((st) => <li key={st} data-stage={st}><span className={s.scaleBar} aria-hidden />{STAGE_LABELS[st]}</li>)}
          </ol>
        </div>
        <p className={s.foot}>
          Applying for a role? You do not need an account. <Link to="/jobs">See open roles</Link> or <Link to="/status">check your application</Link>.
        </p>
      </section>
      <main className={s.formSide} id="main">
        <div className={s.panel}>{children ?? <Outlet />}</div>
      </main>
    </div>
  );
}
