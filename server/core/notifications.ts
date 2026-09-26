import { sql, type Db } from '../db/client.js';
import { notificationTypeInfo } from '../../shared/domain/people.js';
import { canPublishJobs, type PermissionKey, type Role } from '../../shared/domain/access.js';
import { channels, EVENTS } from '../realtime/channels.js';
import { publish } from '../realtime/publisher.js';

export interface NotifyInput {
  userId: number;
  type: string;
  title: string;
  body?: string | null;
  link?: string | null;
  actionLabel?: string | null;
  actorId?: number | null;
  entityType?: string | null;
  entityId?: number | null;
}

/**
 * Notifications are best effort, as in the PHP app: a failure is logged and
 * never undoes the action that caused it.
 */
export async function notify(input: NotifyInput, db: Db = sql): Promise<void> {
  const info = notificationTypeInfo(input.type);
  try {
    const [row] = await db<{ id: number; created_at: Date }[]>`
      insert into notifications (user_id, actor_id, type, category, priority, title, body, link, action_label, entity_type, entity_id)
      values (${input.userId}, ${input.actorId ?? null}, ${input.type}, ${info.category}, ${info.priority},
              ${input.title.slice(0, 200)}, ${input.body ? input.body.slice(0, 500) : null}, ${input.link ?? null},
              ${input.actionLabel ? input.actionLabel.slice(0, 60) : null}, ${input.entityType ?? null}, ${input.entityId ?? null})
      returning id, created_at`;
    if (row) {
      void publish(channels.user(input.userId), EVENTS.notificationNew, { id: row.id, title: input.title, type: input.type });
    }
  } catch (e) {
    console.error('[notify] failed', e);
  }
}

export async function notifyMany(userIds: Iterable<number>, input: Omit<NotifyInput, 'userId'>, db: Db = sql): Promise<void> {
  for (const userId of new Set(userIds)) {
    if (input.actorId && userId === input.actorId) continue;
    await notify({ ...input, userId }, db);
  }
}

export async function superAdminIds(db: Db = sql): Promise<number[]> {
  const rows = await db<{ id: number }[]>`select id from users where role = 'super_admin' and active`;
  return rows.map((r) => r.id);
}

/** Everyone who can act on the job approval queue: Admin-level holding job_posting. */
export async function jobReviewerIds(db: Db = sql): Promise<number[]> {
  const rows = await db<{ id: number; role: Role; permissions: PermissionKey[] }[]>`
    select u.id, u.role, coalesce(array_agg(p.permission) filter (where p.permission is not null), '{}') as permissions
    from users u left join user_permissions p on p.user_id = u.id
    where u.role in ('admin','super_admin') and u.active
    group by u.id`;
  return rows.filter((r) => canPublishJobs(r)).map((r) => r.id);
}
