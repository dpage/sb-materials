import Database from 'better-sqlite3';

/**
 * Read a single setting, falling back when the key is absent.
 */
export function getSetting(db: Database.Database, key: string, fallback: string): string {
  const row = db.prepare('SELECT value FROM app_settings WHERE key = ?').get(key) as
    | { value: string | null }
    | undefined;
  return row?.value ?? fallback;
}

/**
 * Insert or replace a setting.
 */
export function setSetting(db: Database.Database, key: string, value: string): void {
  db.prepare(
    `INSERT INTO app_settings (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
  ).run(key, value);
}

/**
 * Every setting as a plain map, for the settings API.
 */
export function getAllSettings(db: Database.Database): Record<string, string> {
  const rows = db.prepare('SELECT key, value FROM app_settings').all() as { key: string; value: string | null }[];
  const out: Record<string, string> = {};
  for (const row of rows) {
    out[row.key] = row.value ?? '';
  }
  return out;
}
