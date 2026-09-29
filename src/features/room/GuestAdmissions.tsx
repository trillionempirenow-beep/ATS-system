import type { GuestRequestDto } from '@shared/api/interviews';
import { Avatar } from '@/components/ui/Display';
import { cx } from '@/lib/cx';
import { formatTime } from '@/lib/format';
import s from './Room.module.css';

const SHOWN = 3;

export type GuestDecision = 'admit' | 'deny';

/** Copies text to the clipboard; false when the browser refuses (no permission, insecure origin). */
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

/**
 * Final interview: one card per guest at the door, showing exactly what they
 * typed on the entry page. Every host in the room sees the same cards; the
 * first decision wins and the card disappears for everyone.
 */
export function GuestAdmissions({ requests, deciding, onDecide }: {
  requests: GuestRequestDto[];
  deciding: number | null;
  onDecide: (guest: GuestRequestDto, decision: GuestDecision) => void;
}) {
  if (!requests.length) return null;
  const shown = requests.slice(0, SHOWN);
  const more = requests.length - shown.length;
  return (
    <div className={s.admitStack} aria-live="polite" aria-label="Guests waiting to join">
      {shown.map((g) => (
        <div key={g.id} className={s.admitToast} role="group" aria-label={`${g.name}, ${g.position}, is waiting`}>
          <div className={s.admitHead}>
            <Avatar name={g.name} size={36} />
            <div className={s.admitText}>
              <p>Guest <strong>{g.name}</strong> (<strong>{g.position}</strong>) is requesting to join the Final Interview.</p>
              <small>Waiting since {formatTime(g.since)}</small>
            </div>
          </div>
          <div className={s.admitActions}>
            <button type="button" className={cx(s.darkBtn, s.denyBtn)} disabled={deciding === g.id} onClick={() => onDecide(g, 'deny')}>Deny</button>
            <button type="button" className={s.lightBtn} disabled={deciding === g.id} onClick={() => onDecide(g, 'admit')}>
              {deciding === g.id ? 'Working…' : 'Admit'}
            </button>
          </div>
        </div>
      ))}
      {more > 0 ? <span className={s.admitMore}>{more} more waiting</span> : null}
    </div>
  );
}
