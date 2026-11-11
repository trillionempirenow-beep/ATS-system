import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import {
  AE, AR, AT, AU, BD, BE, BH, BR, CA, CH, CL, CN, CO, CZ, DE, DK, EG, ES, FI, FR, GB, GH, GR, HK, HU, ID, IE, IL, IN, IT,
  JO, JP, KE, KR, KW, LB, LK, MA, MX, MY, NG, NL, NO, NP, NZ, OM, PH, PK, PL, PT, QA, RO, RU, SA, SE, SG, TH, TR, TW, UA,
  US, VN, ZA,
} from 'country-flag-icons/react/3x2';
import { PHONE_COUNTRIES } from '@shared/domain/phone';
import { Icon } from '@/components/icon/Icon';
import { cx } from '@/lib/cx';
import formStyles from './Form.module.css';
import s from './CountryPhoneSelect.module.css';

/**
 * Flag images, not emoji: Windows has no flag emoji and shows two letters instead.
 * Only the countries the phone list offers are imported, so the rest stay out of the bundle.
 */
const FLAGS: Record<string, typeof PH> = {
  AE, AR, AT, AU, BD, BE, BH, BR, CA, CH, CL, CN, CO, CZ, DE, DK, EG, ES, FI, FR, GB, GH, GR, HK, HU, ID, IE, IL, IN, IT,
  JO, JP, KE, KR, KW, LB, LK, MA, MX, MY, NG, NL, NO, NP, NZ, OM, PH, PK, PL, PT, QA, RO, RU, SA, SE, SG, TH, TR, TW, UA,
  US, VN, ZA,
};

export function Flag({ iso, className }: { iso: string; className?: string }) {
  const F = FLAGS[iso];
  return F ? <F className={cx(s.flag, className)} aria-hidden="true" /> : <span className={cx(s.flag, s.flagBlank, className)} aria-hidden="true" />;
}

const COUNTRIES = PHONE_COUNTRIES.map(([iso, name, dial]) => ({ iso, name, dial }));

/**
 * The dialing-code picker beside a phone number: closed, the flag and code (+63); open, a
 * searchable list with each country's flag, name and code. Type a name ("phil"), an ISO code
 * ("ph") or a dialing code ("63"). Arrow keys move, Enter picks, Escape closes.
 */
export function CountryPhoneSelect({ value, onChange, invalid, label = 'Country code' }: {
  value: string; onChange: (iso: string) => void; invalid?: boolean; label?: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const wrap = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLUListElement>(null);
  const listId = useId();
  const current = COUNTRIES.find((c) => c.iso === value) ?? COUNTRIES[0]!;

  const results = useMemo(() => {
    const q = query.trim().toLowerCase().replace(/^\+/, '');
    if (!q) return COUNTRIES;
    return COUNTRIES.filter((c) => c.name.toLowerCase().includes(q) || c.iso.toLowerCase() === q || c.dial.startsWith(q));
  }, [query]);

  // Opening starts on the chosen country, with an empty search.
  const show = () => { setQuery(''); setActive(Math.max(0, COUNTRIES.findIndex((c) => c.iso === value))); setOpen(true); };
  const close = (refocus = true) => { setOpen(false); if (refocus) trigger.current?.focus(); };
  const pick = (iso: string) => { onChange(iso); close(); };

  // A click anywhere else closes the list.
  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e: PointerEvent) => { if (!wrap.current?.contains(e.target as Node)) close(false); };
    document.addEventListener('pointerdown', onDown);
    return () => document.removeEventListener('pointerdown', onDown);
  }, [open]);

  // Keep the highlighted row in view.
  useEffect(() => {
    if (open) list.current?.querySelector<HTMLElement>(`[data-index="${active}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [open, active]);

  const onSearchKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive((i) => Math.min(results.length - 1, i + 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((i) => Math.max(0, i - 1)); }
    else if (e.key === 'Home') { e.preventDefault(); setActive(0); }
    else if (e.key === 'End') { e.preventDefault(); setActive(results.length - 1); }
    else if (e.key === 'Enter') { e.preventDefault(); const c = results[active]; if (c) pick(c.iso); }
    else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); }
    else if (e.key === 'Tab') close(false);
  };

  return (
    <div className={s.wrap} ref={wrap}>
      <button ref={trigger} type="button" className={cx(formStyles.control, s.trigger)} aria-haspopup="listbox" aria-expanded={open}
        aria-label={`${label}: ${current.name} +${current.dial}`} aria-invalid={invalid || undefined}
        onClick={() => (open ? close() : show())}
        onKeyDown={(e) => { if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); show(); } }}>
        <Flag iso={current.iso} />
        <span className={s.dial}>+{current.dial}</span>
        <Icon name="chevron" size={16} className={s.caret} />
      </button>
      {open ? (
        <div className={s.pop}>
          <div className={s.searchRow}>
            <Icon name="search" size={16} />
            <input className={s.search} autoFocus value={query} placeholder="Search country or code…" spellCheck={false} autoComplete="off"
              role="combobox" aria-expanded="true" aria-controls={listId} aria-label="Search countries"
              aria-activedescendant={results[active] ? `${listId}-${results[active]!.iso}` : undefined}
              onChange={(e) => { setQuery(e.target.value); setActive(0); }} onKeyDown={onSearchKey} />
          </div>
          <ul ref={list} id={listId} role="listbox" aria-label={label} className={s.list}>
            {results.length ? results.map((c, i) => (
              <li key={c.iso} id={`${listId}-${c.iso}`} role="option" aria-selected={c.iso === value} data-index={i}
                className={cx(s.option, i === active && s.optionActive, c.iso === value && s.optionChosen)}
                onPointerMove={() => setActive(i)} onClick={() => pick(c.iso)}>
                <Flag iso={c.iso} />
                <span className={s.name}>{c.name}</span>
                <span className={s.code}>+{c.dial}</span>
                {c.iso === value ? <Icon name="check" size={16} className={s.tick} /> : null}
              </li>
            )) : <li className={s.empty} role="presentation">No country matches “{query}”.</li>}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
