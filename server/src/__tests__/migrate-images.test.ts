import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import sharp from 'sharp';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { createSchema } from '../db/schema';
import { seedData } from '../db/seed';
import { migrateImages } from '../db/migrate-images';

describe('migrateImages', () => {
  let db: Database.Database;
  let uploadsDir: string;
  let tmpDir: string;
  let reportId: number;

  beforeEach(() => {
    db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    createSchema(db);
    seedData(db);

    const cust = db.prepare('INSERT INTO customers (name) VALUES (?)').run('Migrate Co');
    const site = db
      .prepare('INSERT INTO customer_sites (customer_id, address) VALUES (?, ?)')
      .run(cust.lastInsertRowid, 'Addr');
    const report = db
      .prepare(
        `INSERT INTO reports (report_type, customer_id, site_id, inspection_date, inspector_id, inspector_name)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run('loading_inspection', cust.lastInsertRowid, site.lastInsertRowid, '2026-05-01', 1, 'Insp');
    reportId = report.lastInsertRowid as number;

    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-migrate-'));
    uploadsDir = path.join(tmpDir, 'uploads');
    fs.mkdirSync(path.join(uploadsDir, String(reportId)), { recursive: true });
  });

  afterEach(() => {
    db.close();
    fs.rmSync(tmpDir, { recursive: true });
  });

  function addPhoto(relPath: string): number {
    const res = db
      .prepare('INSERT INTO report_photos (report_id, file_path, sort_order) VALUES (?, ?, 0)')
      .run(reportId, relPath);
    return res.lastInsertRowid as number;
  }

  it('downscales an oversized photo and updates the DB path to .jpg', async () => {
    const rel = `${reportId}/big.png`;
    await sharp({ create: { width: 4000, height: 3000, channels: 3, background: { r: 80, g: 120, b: 160 } } })
      .png()
      .toFile(path.join(uploadsDir, rel));
    const photoId = addPhoto(rel);
    const originalSize = fs.statSync(path.join(uploadsDir, rel)).size;

    const stats = await migrateImages(db, uploadsDir);

    expect(stats.processed).toBe(1);
    const newRel = db.prepare('SELECT file_path FROM report_photos WHERE id = ?').get(photoId) as any;
    expect(newRel.file_path).toBe(`${reportId}/big.jpg`);

    // Old file gone, new file is a downscaled JPEG.
    expect(fs.existsSync(path.join(uploadsDir, rel))).toBe(false);
    const newPath = path.join(uploadsDir, newRel.file_path);
    expect(fs.existsSync(newPath)).toBe(true);
    const meta = await sharp(fs.readFileSync(newPath)).metadata();
    expect(meta.format).toBe('jpeg');
    expect(Math.max(meta.width!, meta.height!)).toBeLessThanOrEqual(2048);
    expect(fs.statSync(newPath).size).toBeLessThan(originalSize);
  });

  it('is idempotent: already-archival photos are skipped and left untouched', async () => {
    const rel = `${reportId}/big.png`;
    await sharp({ create: { width: 4000, height: 3000, channels: 3, background: { r: 80, g: 120, b: 160 } } })
      .png()
      .toFile(path.join(uploadsDir, rel));
    addPhoto(rel);

    await migrateImages(db, uploadsDir);
    const afterFirst = db.prepare('SELECT file_path FROM report_photos').all() as any[];
    const newPath = path.join(uploadsDir, afterFirst[0].file_path);
    const bytesAfterFirst = fs.readFileSync(newPath);

    const stats = await migrateImages(db, uploadsDir);

    expect(stats.processed).toBe(0);
    expect(stats.skipped).toBe(1);
    const afterSecond = db.prepare('SELECT file_path FROM report_photos').all() as any[];
    expect(afterSecond[0].file_path).toBe(afterFirst[0].file_path);
    // File not re-encoded.
    expect(fs.readFileSync(newPath).equals(bytesAfterFirst)).toBe(true);
  });

  it('skips rows whose file is missing on disk', async () => {
    addPhoto(`${reportId}/gone.png`);
    const stats = await migrateImages(db, uploadsDir);
    expect(stats.processed).toBe(0);
    expect(stats.missing).toBe(1);
  });
});
