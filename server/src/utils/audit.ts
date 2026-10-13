import Database from 'better-sqlite3';
import type { Request } from 'express';
import { logger } from './logger';

/**
 * The audit log: a flat table of "who did what, when", written as things
 * happen and read by a superuser on the Audit page.
 *
 * Deliberately not tamper resistant. There is no hash chain, no separate
 * append-only store and no attempt to stop somebody with the database file
 * editing it: the question it exists to answer is "where did that report go?",
 * and a plain table answers that at a fraction of the complexity.
 */

export type AuditAction =
  | 'create'
  | 'update'
  | 'delete'
  | 'submit'
  | 'reopen'
  | 'duplicate'
  | 'login'
  | 'login-failed'
  | 'logout'
  | 'restore';

export interface AuditEntry {
  action: AuditAction;
  entityType: string;
  entityId?: number | null;
  /**
   * How the entry reads on the page, written now because the record it
   * describes may not exist by the time anybody looks.
   */
  summary?: string | null;
  /** Override the actor, for an event with no session behind it (a failed login). */
  actor?: { id?: number | null; username?: string | null; displayName?: string | null };
}

/**
 * Record an event. Never throws: an audit write failing must not turn a
 * successful delete into a 500, since the user's work has already happened by
 * the time we get here.
 */
export function recordAudit(db: Database.Database, req: Request | null, entry: AuditEntry): void {
  try {
    const session = req?.session;
    const actor = entry.actor ?? {
      id: session?.userId ?? null,
      username: session?.username ?? null,
      displayName: session?.displayName ?? null,
    };

    db.prepare(
      `INSERT INTO audit_log (user_id, username, display_name, action, entity_type, entity_id, summary)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      actor.id ?? null,
      actor.username ?? null,
      actor.displayName ?? null,
      entry.action,
      entry.entityType,
      entry.entityId ?? null,
      entry.summary ?? null,
    );
  } catch (err) {
    logger.error('Failed to write an audit log entry:', err);
  }
}

/**
 * How each kind of record reads in the log. Called before a delete, whilst the
 * row is still there, and after a create or update, so the summary describes
 * the record as it was at the moment of the event.
 */
export function describeReport(db: Database.Database, id: number): string {
  const row = db
    .prepare(
      `SELECT r.report_type, r.inspection_date, c.name AS customer_name
         FROM reports r LEFT JOIN customers c ON c.id = r.customer_id
        WHERE r.id = ?`,
    )
    .get(id) as { report_type?: string; inspection_date?: string; customer_name?: string } | undefined;
  if (!row) return `Report ${id}`;
  return [row.report_type, row.customer_name, row.inspection_date].filter(Boolean).join(', ');
}

export function describeCollectionNote(db: Database.Database, id: number): string {
  const row = db
    .prepare(
      `SELECT n.reference, n.collection_date, c.name AS customer_name
         FROM collection_notes n LEFT JOIN customers c ON c.id = n.customer_id
        WHERE n.id = ?`,
    )
    .get(id) as { reference?: string; collection_date?: string; customer_name?: string } | undefined;
  if (!row) return `Collection note ${id}`;
  return [row.reference, row.customer_name, row.collection_date].filter(Boolean).join(', ');
}

const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

export function describeSheet(db: Database.Database, table: 'travel_sheets' | 'expense_sheets', id: number): string {
  const row = db
    .prepare(
      `SELECT s.year, s.month, u.display_name
         FROM ${table} s LEFT JOIN users u ON u.id = s.user_id
        WHERE s.id = ?`,
    )
    .get(id) as { year?: number; month?: number; display_name?: string } | undefined;
  if (!row?.year || !row?.month) return `Sheet ${id}`;
  return [`${MONTHS[row.month - 1]} ${row.year}`, row.display_name].filter(Boolean).join(', ');
}
