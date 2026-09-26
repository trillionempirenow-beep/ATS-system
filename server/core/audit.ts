import { sql, type Db } from '../db/client.js';

export interface AuditEntry {
  userId: number | null;
  action: string;
  entityType?: string | null;
  entityId?: number | null;
  details?: Record<string, unknown> | null;
  ip?: string | null;
}

/**
 * Written inside the caller's transaction when one is passed, so an action and
 * its audit row commit together. Empty values are dropped, as array_filter did.
 */
export async function audit(entry: AuditEntry, db: Db = sql): Promise<void> {
  const details = entry.details
    ? Object.fromEntries(Object.entries(entry.details).filter(([, v]) => v !== '' && v !== null && v !== undefined))
    : null;
  await db`insert into audit_logs (user_id, action, entity_type, entity_id, details, ip_address)
           values (${entry.userId}, ${entry.action}, ${entry.entityType ?? null}, ${entry.entityId ?? null},
                   ${details && Object.keys(details).length ? sql.json(details as never) : null}, ${entry.ip ?? null})`;
}

/** For writes that must never break the main action (e.g. logging a download). */
export async function auditQuietly(entry: AuditEntry): Promise<void> {
  try {
    await audit(entry);
  } catch (e) {
    console.error('[audit] failed', e);
  }
}
