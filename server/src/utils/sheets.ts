import Database from 'better-sqlite3';
import type { Request } from 'express';

// Shared machinery for the monthly travel and expenses sheets. Both are owned
// by one person, both are addressed by year and month, and both are read by
// superusers on everyone's behalf, so the rules live here rather than being
// written twice and drifting apart.

export type SheetTable = 'travel_sheets' | 'expense_sheets';

export interface SheetRow {
  id: number;
  user_id: number;
  year: number;
  month: number;
  notes: string | null;
  created_at: string;
  updated_at: string | null;
  display_name?: string;
}

export function isSuperuser(req: Request): boolean {
  return Boolean(req.session.isSuperuser);
}

export function sessionUserId(req: Request): number {
  return req.session.userId as number;
}

/**
 * Which person's sheets a request is about. A superuser may ask for somebody
 * else's with ?user_id=, or for everybody's with ?all=1; anyone else only ever
 * sees their own, whatever they ask for.
 */
export function requestedUserId(req: Request): number | null {
  if (!isSuperuser(req)) return sessionUserId(req);
  if (req.query.all === '1' || req.query.all === 'true') return null;
  const asked = parseInt(String(req.query.user_id ?? ''), 10);
  return Number.isFinite(asked) ? asked : sessionUserId(req);
}

/**
 * Load a sheet the caller is allowed to see, or undefined.
 *
 * Deliberately undefined rather than a 403 for somebody else's sheet: the
 * handlers turn this into a 404, so the API never confirms that a colleague's
 * September expenses exist to a person who may not read them.
 */
export function loadSheetForUser(
  db: Database.Database,
  table: SheetTable,
  id: number,
  req: Request,
): SheetRow | undefined {
  const row = db
    .prepare(
      `SELECT s.*, u.display_name AS display_name
         FROM ${table} s
         JOIN users u ON u.id = s.user_id
        WHERE s.id = ?`,
    )
    .get(id) as SheetRow | undefined;
  if (!row) return undefined;
  if (!isSuperuser(req) && row.user_id !== sessionUserId(req)) return undefined;
  return row;
}

/**
 * Open the sheet for a person and month, creating it if this is the first time
 * anyone has asked. The UNIQUE (user_id, year, month) constraint is what makes
 * that safe: two tabs opening October at once end up on the same sheet rather
 * than on two rival ones.
 */
export function openSheet(
  db: Database.Database,
  table: SheetTable,
  userId: number,
  year: number,
  month: number,
): number {
  const existing = db
    .prepare(`SELECT id FROM ${table} WHERE user_id = ? AND year = ? AND month = ?`)
    .get(userId, year, month) as { id: number } | undefined;
  if (existing) return existing.id;

  db.prepare(`INSERT INTO ${table} (user_id, year, month) VALUES (?, ?, ?)`).run(userId, year, month);
  const created = db
    .prepare(`SELECT id FROM ${table} WHERE user_id = ? AND year = ? AND month = ?`)
    .get(userId, year, month) as { id: number };
  return created.id;
}

export function touchSheet(db: Database.Database, table: SheetTable, id: number): void {
  db.prepare(`UPDATE ${table} SET updated_at = datetime('now') WHERE id = ?`).run(id);
}

/**
 * A year and month from a request body, rejected unless they are a real month:
 * sheets are addressed by them, so a month 13 would be a sheet nobody could
 * ever navigate back to.
 */
export function parseMonth(body: Record<string, unknown>): { year: number; month: number } | null {
  const year = parseInt(String(body.year ?? ''), 10);
  const month = parseInt(String(body.month ?? ''), 10);
  if (!Number.isFinite(year) || year < 2000 || year > 2100) return null;
  if (!Number.isFinite(month) || month < 1 || month > 12) return null;
  return { year, month };
}
