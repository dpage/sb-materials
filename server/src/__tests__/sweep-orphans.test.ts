import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { createSchema } from '../db/schema';
import { seedData } from '../db/seed';
import { sweepOrphanedUploads } from '../db/sweep-orphans';

describe('sweepOrphanedUploads', () => {
  let db: Database.Database;
  let tmpDir: string;
  let uploadsDir: string;
  let reportId: number;

  beforeEach(() => {
    db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    createSchema(db);
    seedData(db);

    const cust = db.prepare('INSERT INTO customers (name) VALUES (?)').run('Sweep Co');
    const site = db
      .prepare('INSERT INTO customer_sites (customer_id, address) VALUES (?, ?)')
      .run(cust.lastInsertRowid, 'Addr');
    reportId = db
      .prepare(
        `INSERT INTO reports (report_type, customer_id, site_id, inspection_date, inspector_id, inspector_name)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run('loading_inspection', cust.lastInsertRowid, site.lastInsertRowid, '2026-05-01', 1, 'Insp')
      .lastInsertRowid as number;

    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-sweep-'));
    uploadsDir = path.join(tmpDir, 'uploads');
    fs.mkdirSync(path.join(uploadsDir, String(reportId)), { recursive: true });
  });

  afterEach(() => {
    db.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function writeFile(relPath: string, contents = 'x'): void {
    const abs = path.join(uploadsDir, relPath);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, contents);
  }

  function addPhoto(relPath: string): void {
    db.prepare('INSERT INTO report_photos (report_id, file_path, sort_order) VALUES (?, ?, 0)').run(reportId, relPath);
  }

  it('reports unreferenced files and leaves everything on disk by default', () => {
    writeFile(`${reportId}/kept.jpg`, 'kept');
    addPhoto(`${reportId}/kept.jpg`);
    writeFile(`${reportId}/orphan.jpg`, 'orphaned');

    const result = sweepOrphanedUploads(db, uploadsDir);

    expect(result.scanned).toBe(2);
    expect(result.referenced).toBe(1);
    expect(result.orphans.map((o) => o.relPath)).toEqual([`${reportId}/orphan.jpg`]);
    expect(result.orphanBytes).toBe('orphaned'.length);
    expect(result.deleted).toBe(0);
    expect(fs.existsSync(path.join(uploadsDir, `${reportId}/orphan.jpg`))).toBe(true);
  });

  it('deletes orphans and prunes the directories they emptied when asked', () => {
    writeFile(`${reportId}/kept.jpg`, 'kept');
    addPhoto(`${reportId}/kept.jpg`);
    writeFile('99/gone.jpg');
    writeFile('99/also-gone.jpg');

    const result = sweepOrphanedUploads(db, uploadsDir, { deleteFiles: true });

    expect(result.deleted).toBe(2);
    expect(result.refused).toBe(false);
    expect(fs.existsSync(path.join(uploadsDir, '99'))).toBe(false);
    expect(fs.readFileSync(path.join(uploadsDir, `${reportId}/kept.jpg`), 'utf8')).toBe('kept');
  });

  it('treats report signatures and collection note signatures as referenced', () => {
    const noteId = db
      .prepare(
        `INSERT INTO collection_notes (reference, customer_id, site_id, collection_date, dispatched_signature_path)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run('CN-1', 1, 1, '2026-05-01', 'collection-notes/1/sig.png').lastInsertRowid as number;
    expect(noteId).toBeGreaterThan(0);

    db.prepare('UPDATE reports SET signature_path = ? WHERE id = ?').run(`${reportId}/sig.png`, reportId);
    writeFile(`${reportId}/sig.png`);
    writeFile('collection-notes/1/sig.png');

    const result = sweepOrphanedUploads(db, uploadsDir, { deleteFiles: true });

    expect(result.orphans).toEqual([]);
    expect(result.deleted).toBe(0);
    expect(fs.existsSync(path.join(uploadsDir, `${reportId}/sig.png`))).toBe(true);
    expect(fs.existsSync(path.join(uploadsDir, 'collection-notes/1/sig.png'))).toBe(true);
  });

  it('refuses to delete when the database references nothing at all', () => {
    writeFile('7/suspicious.jpg');

    const result = sweepOrphanedUploads(db, uploadsDir, { deleteFiles: true });

    expect(result.refused).toBe(true);
    expect(result.deleted).toBe(0);
    expect(fs.existsSync(path.join(uploadsDir, '7/suspicious.jpg'))).toBe(true);
  });

  it('deletes anyway when the empty-database refusal is overridden', () => {
    writeFile('7/suspicious.jpg');

    const result = sweepOrphanedUploads(db, uploadsDir, { deleteFiles: true, force: true });

    expect(result.refused).toBe(false);
    expect(result.deleted).toBe(1);
    expect(fs.existsSync(path.join(uploadsDir, '7/suspicious.jpg'))).toBe(false);
  });

  it('returns an empty result when the uploads directory does not exist', () => {
    const result = sweepOrphanedUploads(db, path.join(tmpDir, 'nope'), { deleteFiles: true });

    expect(result).toMatchObject({ scanned: 0, deleted: 0, orphans: [] });
  });
});
