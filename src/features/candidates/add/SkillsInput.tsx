import { useState, type KeyboardEvent } from 'react';
import { Icon } from '@/components/icon/Icon';
import s from './AddCandidate.module.css';

interface Props {
  value: string[];
  onChange: (next: string[]) => void;
  id?: string;
  'aria-invalid'?: boolean;
  'aria-describedby'?: string;
}

/** Chip entry for skills: Enter or comma adds, Backspace on empty removes the last chip. */
export function SkillsInput({ value, onChange, id, ...aria }: Props) {
  const [draft, setDraft] = useState('');
  const add = (raw: string) => {
    const parts = raw.split(',').map((p) => p.trim()).filter(Boolean);
    if (!parts.length) return;
    const lower = new Set(value.map((v) => v.toLowerCase()));
    onChange([...value, ...parts.filter((p) => !lower.has(p.toLowerCase()))].slice(0, 40));
    setDraft('');
  };
  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      add(draft);
    } else if (e.key === 'Backspace' && !draft && value.length) {
      onChange(value.slice(0, -1));
    }
  };
  return (
    <div className={s.chips} aria-invalid={aria['aria-invalid']}>
      {value.map((skill) => (
        <button key={skill} type="button" className={s.chip} onClick={() => onChange(value.filter((v) => v !== skill))} aria-label={`Remove ${skill}`}>
          {skill}<Icon name="close" size={12} />
        </button>
      ))}
      <input id={id} className={s.chipInput} value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={onKey} onBlur={() => add(draft)}
        placeholder={value.length ? '' : 'Type a skill and press Enter'} aria-describedby={aria['aria-describedby']} />
    </div>
  );
}
