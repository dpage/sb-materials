import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { createTestDb } from './helpers';
import { getSetting, setSetting, getAllSettings } from '../utils/settings';
import { allocateNextReference, recordReferenceUsed } from '../utils/collection-note-reference';

describe('settings store', () => {
  let db: Database.Database;
  beforeEach(() => {
    db = createTestDb();
  });

  it('returns the seeded collection note defaults', () => {
    expect(getSetting(db, 'collection_note_prefix', 'XXX')).toBe('SBM');
    expect(getSetting(db, 'collection_note_next_number', '0')).toBe('1');
  });

  it('returns the fallback for an unknown key', () => {
    expect(getSetting(db, 'no_such_key', 'fallback')).toBe('fallback');
  });

  it('upserts a value', () => {
    setSetting(db, 'collection_note_next_number', '1500');
    expect(getSetting(db, 'collection_note_next_number', '0')).toBe('1500');
    setSetting(db, 'collection_note_next_number', '1501');
    expect(getSetting(db, 'collection_note_next_number', '0')).toBe('1501');
  });

  it('returns every setting as a map', () => {
    expect(getAllSettings(db).collection_note_prefix).toBe('SBM');
  });
});

describe('reference allocation', () => {
  let db: Database.Database;
  beforeEach(() => {
    db = createTestDb();
  });

  function insertNote(reference: string): void {
    const cust = db.prepare('INSERT INTO customers (name) VALUES (?)').run('Test Customer');
    db.prepare('INSERT INTO collection_notes (reference, customer_id, collection_date) VALUES (?, ?, ?)').run(
      reference,
      cust.lastInsertRowid,
      '2026-08-03',
    );
  }

  it('starts from the configured next number when there are no notes', () => {
    setSetting(db, 'collection_note_next_number', '1061');
    expect(allocateNextReference(db)).toBe('SBM1061');
  });

  it('does not reuse a reference already present', () => {
    setSetting(db, 'collection_note_next_number', '1061');
    insertNote('SBM1061');
    expect(allocateNextReference(db)).toBe('SBM1062');
  });

  it('follows a manually entered higher reference', () => {
    setSetting(db, 'collection_note_next_number', '1061');
    insertNote('SBM2000');
    expect(allocateNextReference(db)).toBe('SBM2001');
  });

  it('ignores references that do not match the prefix pattern', () => {
    setSetting(db, 'collection_note_next_number', '10');
    insertNote('LEGACY-ABC');
    expect(allocateNextReference(db)).toBe('SBM10');
  });

  it('matches the prefix case insensitively', () => {
    setSetting(db, 'collection_note_next_number', '1');
    insertNote('sbm55');
    expect(allocateNextReference(db)).toBe('SBM56');
  });

  it('advances the stored next number when a reference is recorded', () => {
    setSetting(db, 'collection_note_next_number', '1061');
    recordReferenceUsed(db, 'SBM1061');
    expect(getSetting(db, 'collection_note_next_number', '0')).toBe('1062');
  });

  it('does not wind the stored next number backwards', () => {
    setSetting(db, 'collection_note_next_number', '1061');
    recordReferenceUsed(db, 'SBM500');
    expect(getSetting(db, 'collection_note_next_number', '0')).toBe('1061');
  });

  it('tolerates a non-conforming reference when recording', () => {
    setSetting(db, 'collection_note_next_number', '1061');
    expect(() => recordReferenceUsed(db, 'ONE-OFF')).not.toThrow();
    expect(getSetting(db, 'collection_note_next_number', '0')).toBe('1061');
  });
});

describe('collection note schema', () => {
  let db: Database.Database;
  beforeEach(() => {
    db = createTestDb();
  });

  it('rejects a duplicate reference', () => {
    const cust = db.prepare('INSERT INTO customers (name) VALUES (?)').run('Test Customer');
    const insert = db.prepare('INSERT INTO collection_notes (reference, customer_id) VALUES (?, ?)');
    insert.run('SBM1', cust.lastInsertRowid);
    expect(() => insert.run('SBM1', cust.lastInsertRowid)).toThrow(/UNIQUE/i);
  });

  it('cascades item deletion when the note is deleted', () => {
    const cust = db.prepare('INSERT INTO customers (name) VALUES (?)').run('Test Customer');
    const note = db
      .prepare('INSERT INTO collection_notes (reference, customer_id) VALUES (?, ?)')
      .run('SBM1', cust.lastInsertRowid);
    db.prepare(
      'INSERT INTO collection_note_items (note_id, quantity, description, collection_point, sort_order) VALUES (?, ?, ?, ?, ?)',
    ).run(note.lastInsertRowid, '1x', 'Poly cup reels', 'Bay 3', 0);

    db.prepare('DELETE FROM collection_notes WHERE id = ?').run(note.lastInsertRowid);

    const remaining = db.prepare('SELECT COUNT(*) AS n FROM collection_note_items').get() as { n: number };
    expect(remaining.n).toBe(0);
  });
});
