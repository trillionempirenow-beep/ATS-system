import { useEffect } from 'react';
import type { IconName } from '@/components/icon/Icon';
import { Icon } from '@/components/icon/Icon';
import { ButtonLink } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Display';
import { EmptyState, ErrorState, Skeleton } from '@/components/ui/Feedback';
import { surfaceStyles as surface } from '@/components/ui/Surface';
import { usePublicConfig } from '@/app/layouts/PublicLayout';
import { usePublicHome } from './api';
import { JobCard } from './JobCard';
import s from './Careers.module.css';

const STEPS: Array<[IconName, string, string]> = [
  ['edit', '1. Apply in minutes', 'Submit your details and resume. No account required to get started.'],
  ['video', '2. Meet the team, built-in', 'Interviews run right inside Acme, with no external links or extra apps to install.'],
  ['checkcircle', '3. Fast, transparent decisions', 'Track your application status and hear back quickly at every stage.'],
];

function CardsSkeleton({ count = 3 }: { count?: number }) {
  return <div className={s.grid}>{Array.from({ length: count }, (_, i) => <Skeleton key={i} height={208} radius={14} />)}</div>;
}

export function HomePage() {
  const home = usePublicHome();
  const config = usePublicConfig();
  const company = config.data?.companyName ?? 'Acme';
  useEffect(() => { document.title = `Careers · ${company}`; }, [company]);
  const stats = home.data?.stats;

  return (
    <div className={s.container}>
      <section className={s.hero} aria-labelledby="hero-title">
        <div className={s.heroCopy}>
          {stats && stats.openRoles > 0 ? (
            <span className={s.kicker}><span className={s.kickerDot} />Now hiring across {stats.openRoles} open role{stats.openRoles === 1 ? '' : 's'}</span>
          ) : null}
          <h1 id="hero-title" className={s.display}>{config.data?.careersHeadline || 'Small teams. Big ownership.'}</h1>
          <p className={s.lead}>Join a company where interviews run inside {company} and every application is visible to you, start to finish.</p>
          <div className={s.heroActions}>
            <ButtonLink to="/jobs" size="lg" iconRight="arrowr">Explore open roles</ButtonLink>
            <ButtonLink to="/#why" size="lg" variant="secondary" iconRight="chevron">Why {company}</ButtonLink>
          </div>
          <div className={s.heroBadges}>
            {stats && stats.remoteRoles > 0 ? <Badge tone="success" icon="public">Remote-friendly</Badge> : null}
            <Badge tone="info" icon="video">Interviews built in</Badge>
          </div>
        </div>
        <aside className={s.principle} aria-label="How we hire">
          <span className={surface.eyebrow} style={{ color: 'var(--text3)' }}>Our operating principle</span>
          <p className={s.principleQuote}>Decide fast. Give feedback. Keep candidates informed.</p>
          <div className={s.facts}>
            <div className={s.fact}><span className={s.factValue}>{stats ? stats.openRoles : '—'}</span><span className={s.factLabel}>Open roles right now</span></div>
            <div className={s.fact}><span className={s.factValue}>{stats ? stats.departmentsHiring : '—'}</span><span className={s.factLabel}>Teams hiring</span></div>
            <div className={s.fact}><span className={s.factValue}>{stats ? stats.remoteRoles : '—'}</span><span className={s.factLabel}>Remote-friendly roles</span></div>
            <div className={s.fact}><span className={s.factValue}>Live</span><span className={s.factLabel}>Status tracking for every application</span></div>
          </div>
        </aside>
      </section>

      <section aria-labelledby="steps-title">
        <div className={s.sectionHead}><h2 id="steps-title" className={s.h2}>Three simple steps.</h2></div>
        <div className={s.steps}>
          {STEPS.map(([icon, title, text]) => (
            <div key={title} className={s.step}>
              <span className={s.stepIcon}><Icon name={icon} size={18} /></span>
              <h3 className={s.stepTitle}>{title}</h3>
              <p className={s.stepText}>{text}</p>
            </div>
          ))}
        </div>
      </section>

      {home.data && home.data.urgent.length > 0 ? (
        <section aria-labelledby="urgent-title">
          <div className={s.sectionHead}>
            <h2 id="urgent-title" className={s.h2}>We need these roles filled fast.</h2>
            <Badge tone="warning" icon="flag">Urgent hiring</Badge>
          </div>
          <div className={s.grid}>{home.data.urgent.slice(0, 3).map((j) => <JobCard key={j.id} job={j} />)}</div>
        </section>
      ) : null}

      <section aria-labelledby="roles-title">
        <div className={s.sectionHead}>
          <h2 id="roles-title" className={s.h2}>Find your next move.</h2>
          {home.data && home.data.featured.length > 0 ? <ButtonLink to="/jobs" variant="secondary" size="sm" iconRight="arrowr">View all jobs</ButtonLink> : null}
        </div>
        {home.isLoading ? <CardsSkeleton count={6} /> : null}
        {home.isError ? <ErrorState onRetry={() => void home.refetch()} /> : null}
        {home.data && home.data.featured.length === 0 ? (
          <EmptyState icon="briefcase" title="No open roles yet." text="New opportunities will appear here when the recruiting team publishes them." />
        ) : null}
        {home.data && home.data.featured.length > 0 ? <div className={s.grid}>{home.data.featured.map((j) => <JobCard key={j.id} job={j} />)}</div> : null}
      </section>

      <section id="why" className={s.why} aria-labelledby="why-title">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <span className={surface.eyebrow}>How we work</span>
          <h2 id="why-title" className={s.h2}>Small teams. Big ownership.</h2>
          <p className={s.lead}>We value clear thinking, generous collaboration, and momentum over meetings. Everyone has a voice in the room.</p>
        </div>
        <ul className={s.whyList}>
          <li><Icon name="users" size={20} /><span><strong>Small teams</strong>Own meaningful work end to end, with room to shape how it gets done.</span></li>
          <li><Icon name="video" size={20} /><span><strong>Interviews without friction</strong>Meet the team in the browser. No external links or apps to install.</span></li>
          <li><Icon name="eye" size={20} /><span><strong>Transparent hiring</strong>Check where your application stands at any time with your email and application ID.</span></li>
        </ul>
      </section>
    </div>
  );
}
