import { Link } from 'react-router-dom';
import type { NotificationDto } from '@shared/api/me';
import { notificationTypeInfo } from '@shared/domain/people';
import { Icon, type IconName } from '@/components/icon/Icon';
import { timeAgo } from '@/lib/format';
import { cx } from '@/lib/cx';
import s from './Notifications.module.css';

export function NotificationItem({ n, onOpen, compact }: { n: NotificationDto; onOpen?: (n: NotificationDto) => void; compact?: boolean }) {
  const info = notificationTypeInfo(n.type);
  const body = (
    <>
      <span className={cx(s.icon, s[`p_${n.priority}`])}><Icon name={info.icon as IconName} size={16} /></span>
      <span className={s.text}>
        <span className={s.titleRow}>
          <span className={s.title}>{n.title}</span>
          <span className={s.time}>{timeAgo(n.createdAt)}</span>
        </span>
        {n.body ? <span className={cx(s.body, compact && s.bodyClamp)}>{n.body}</span> : null}
        {!compact && n.actorName ? <span className={s.meta}>By {n.actorName}</span> : null}
      </span>
      {!n.read ? <span className={s.unreadDot} aria-label="Unread" /> : null}
    </>
  );
  const className = cx(s.item, !n.read && s.unread, compact && s.compact);
  return n.link ? (
    <Link to={n.link} className={className} onClick={() => onOpen?.(n)}>{body}</Link>
  ) : (
    <button type="button" className={className} onClick={() => onOpen?.(n)}>{body}</button>
  );
}
