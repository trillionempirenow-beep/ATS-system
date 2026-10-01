import { Link } from 'react-router-dom';
import s from './Careers.module.css';

/** Where a careers page sits: the same slash-separated trail the staff workspace uses. */
export function Crumbs({ items }: { items: Array<{ label: string; to?: string }> }) {
  return (
    <nav aria-label="Breadcrumb" className={s.crumbs}>
      {items.map((c, i) => (
        <span key={c.label} className={s.crumb}>
          {i > 0 ? <span className={s.crumbSep} aria-hidden>/</span> : null}
          {c.to ? <Link to={c.to}>{c.label}</Link> : <span aria-current="page">{c.label}</span>}
        </span>
      ))}
    </nav>
  );
}
