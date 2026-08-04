import Database from 'better-sqlite3';
import { getSetting, setSetting } from './settings';

export const PREFIX_SETTING = 'collection_note_prefix';
export const NEXT_NUMBER_SETTING = 'collection_note_next_number';
export const DEFAULT_PREFIX = 'SBM';

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function configuredNextNumber(db: Database.Database): number {
  const parsed = parseInt(getSetting(db, NEXT_NUMBER_SETTING, '1'), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
}

/**
 * The numeric part of a reference, or null when it does not conform.
 */
export function parseReferenceNumber(prefix: string, reference: string): number | null {
  const match = new RegExp(`^${escapeRegExp(prefix)}(\\d+)$`, 'i').exec((reference ?? '').trim());
  return match ? parseInt(match[1], 10) : null;
}

/**
 * The reference a new note should be prefilled with.
 *
 * Takes the greater of the configured next number and one past the highest
 * conforming reference already stored, so a manually entered higher reference
 * pulls the sequence along with it rather than being handed out twice.
 */
export function allocateNextReference(db: Database.Database): string {
  const prefix = getSetting(db, PREFIX_SETTING, DEFAULT_PREFIX);
  const rows = db.prepare('SELECT reference FROM collection_notes').all() as { reference: string }[];

  let highest = 0;
  for (const row of rows) {
    const num = parseReferenceNumber(prefix, row.reference);
    if (num !== null && num > highest) highest = num;
  }

  return `${prefix}${Math.max(configuredNextNumber(db), highest + 1)}`;
}

/**
 * Advance the stored next number past a reference that has just been used.
 * Never winds the sequence backwards, and quietly ignores a reference that does
 * not follow the configured prefix.
 */
export function recordReferenceUsed(db: Database.Database, reference: string): void {
  const prefix = getSetting(db, PREFIX_SETTING, DEFAULT_PREFIX);
  const num = parseReferenceNumber(prefix, reference);
  if (num === null) return;
  if (num + 1 > configuredNextNumber(db)) {
    setSetting(db, NEXT_NUMBER_SETTING, String(num + 1));
  }
}
