import s from './Careers.module.css';

/** Sections of a job posting drawn from free text, in the careers page's own styles. */

const lines = (v: string) => v.split(/\r?\n/).map((l) => l.replace(/^[\s•\-*]+/, '').trim()).filter(Boolean);
const tags = (v: string) => v.split(/\r?\n|,\s*/).map((t) => t.trim()).filter(Boolean);

export function Bullets({ title, text }: { title: string; text: string | null }) {
  const items = lines(text ?? '');
  if (!items.length) return null;
  return (
    <section className={s.block}>
      <h2 className={s.blockTitle}>{title}</h2>
      <ul className={s.bullets}>{items.map((i) => <li key={i}>{i}</li>)}</ul>
    </section>
  );
}

export function Tags({ title, text }: { title: string; text: string | null }) {
  const items = tags(text ?? '');
  if (!items.length) return null;
  return (
    <section className={s.block}>
      <h2 className={s.blockTitle}>{title}</h2>
      <div className={s.tags}>{items.map((t) => <span key={t} className={s.tag}>{t}</span>)}</div>
    </section>
  );
}
