import { useEffect, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { STAGE_LABELS, type Stage } from '@shared/domain/pipeline';
import { Button } from '@/components/ui/Button';
import { Field, TextInput } from '@/components/ui/Form';
import { StageTicks } from '@/components/ui/Stage';
import { usePublicConfig } from '@/app/layouts/PublicLayout';
import { usePublicHome } from './api';
import { RoleBoard } from './RolesPage';
import s from './Careers.module.css';

/** What happens after someone applies: the same stages the hiring team works in. */
const PROCESS: Array<[Stage, string]> = [
  ['new', 'Send your CV and a short cover letter. No account needed. We email you an application ID.'],
  ['screening', 'A recruiter reads your application against the role and decides whether to invite you to talk.'],
  ['interview', 'Interviews happen in your browser, from a link on your status page. Some roles add a final round.'],
  ['offer', 'If it is a match, we make you an offer and go through the details together.'],
  ['hired', 'You join the team. Your application closes and your onboarding starts.'],
];

function StatusEntry() {
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [id, setId] = useState('');
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const q = new URLSearchParams({ email: email.trim(), ...(id.trim() ? { id: id.trim() } : {}) });
    navigate(`/status?${q.toString()}`);
  };
  return (
    <form className={s.statusEntry} onSubmit={submit}>
      <Field label="Email you applied with" required>
        <TextInput type="email" icon="mail" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
      </Field>
      <Field label="Application ID" optional>
        <TextInput inputMode="numeric" pattern="\d*" value={id} onChange={(e) => setId(e.target.value)} />
      </Field>
      <Button type="submit" variant="secondary">Check status</Button>
    </form>
  );
}

export function HomePage() {
  const home = usePublicHome();
  const config = usePublicConfig();
  const company = config.data?.companyName ?? 'Acme';
  useEffect(() => { document.title = `Careers · ${company}`; }, [company]);
  const stats = home.data?.stats;
  const headline = config.data?.careersHeadline?.trim();

  return (
    <div className={s.container}>
      <header className={s.intro}>
        <h1 id="roles-title" className={s.title}>
          {stats ? (stats.openRoles === 0 ? `${company} has no open roles right now` : `${company} is hiring for ${stats.openRoles} ${stats.openRoles === 1 ? 'role' : 'roles'}`) : `Open roles at ${company}`}
        </h1>
        <p className={s.lead}>
          {headline ? <>{headline} </> : null}
          Apply with your CV, interview in your browser, and check where your application stands at any time.
        </p>
      </header>

      <RoleBoard headingId="roles-title" />

      <section id="how" className={s.section} aria-labelledby="how-title">
        <div className={s.sectionHead}>
          <h2 id="how-title" className={s.h2}>What happens after you apply</h2>
          <p className={s.sectionText}>The same stages our hiring team works in. Your status page shows which one you are at.</p>
        </div>
        <ol className={s.process}>
          {PROCESS.map(([stage, text]) => (
            <li key={stage} className={s.processStep}>
              <StageTicks stage={stage} />
              <h3 className={s.processTitle}>{STAGE_LABELS[stage]}</h3>
              <p className={s.processText}>{text}</p>
            </li>
          ))}
        </ol>
      </section>

      <section id="status" className={s.section} aria-labelledby="status-title">
        <div className={s.sectionHead}>
          <h2 id="status-title" className={s.h2}>Already applied?</h2>
          <p className={s.sectionText}>Use the email you applied with. Add your application ID to go straight to one application.</p>
        </div>
        <StatusEntry />
      </section>
    </div>
  );
}
