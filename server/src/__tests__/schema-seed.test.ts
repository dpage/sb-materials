import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { createSchema, migratePhotoSubdirs } from '../db/schema';
import { seedData, ensureReferenceData } from '../db/seed';
import fs from 'fs';
import path from 'path';
import os from 'os';

describe('Schema', () => {
  it('should create all tables', () => {
    const db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    createSchema(db);

    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all() as {
      name: string;
    }[];
    const tableNames = tables.map((t) => t.name);

    expect(tableNames).toContain('users');
    expect(tableNames).toContain('customers');
    expect(tableNames).toContain('customer_sites');
    expect(tableNames).toContain('reports');
    expect(tableNames).toContain('report_inspection_details');
    expect(tableNames).toContain('report_unwanted_materials');
    expect(tableNames).toContain('report_contaminants');
    expect(tableNames).toContain('report_containers');
    expect(tableNames).toContain('report_pern_details');
    expect(tableNames).toContain('report_photos');
    expect(tableNames).toContain('lookup_product_descriptions');
    expect(tableNames).toContain('lookup_product_grades');
    expect(tableNames).toContain('lookup_storage_modes');
    expect(tableNames).toContain('lookup_unwanted_materials');
    expect(tableNames).toContain('lookup_contaminants');
  });

  it('should be idempotent', () => {
    const db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    createSchema(db);
    createSchema(db); // Should not throw
  });
});

describe('Seed Data', () => {
  it('should seed default users and lookups', () => {
    const db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    createSchema(db);
    seedData(db);

    const users = db.prepare('SELECT * FROM users').all() as any[];
    expect(users.length).toBe(1);
    expect(users.find((u: any) => u.username === 'admin')).toBeDefined();

    const grades = db.prepare('SELECT * FROM lookup_product_grades').all();
    expect(grades.length).toBeGreaterThan(0);

    const modes = db.prepare('SELECT * FROM lookup_storage_modes').all();
    expect(modes.length).toBe(5);

    const contaminants = db.prepare('SELECT * FROM lookup_contaminants').all();
    expect(contaminants.length).toBeGreaterThan(0);
  });

  it('should not seed if users already exist', () => {
    const db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    createSchema(db);
    seedData(db);
    const count1 = (db.prepare('SELECT COUNT(*) as c FROM users').get() as any).c;
    seedData(db); // Should not add more
    const count2 = (db.prepare('SELECT COUNT(*) as c FROM users').get() as any).c;
    expect(count1).toBe(count2);
  });
});

describe('refined schema', () => {
  function cols(db: Database.Database, table: string): string[] {
    return (db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map((c) => c.name);
  }

  it('adds handoff + refined columns and lookup_clients', () => {
    const db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    createSchema(db);

    expect(cols(db, 'reports')).toEqual(
      expect.arrayContaining(['on_behalf_of', 'assigned_to_id', 'created_by_id']),
    );
    expect(cols(db, 'report_inspection_details')).toEqual(
      expect.arrayContaining(['rejected_bales', 'bale_break', 'bale_break_results', 'packaging_thresholds']),
    );
    expect(cols(db, 'report_containers')).toEqual(
      expect.arrayContaining(['number_of_bales', 'weighbridge_ticket', 'weight']),
    );
    const lookupClients = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='lookup_clients'").get();
    expect(lookupClients).toBeDefined();
  });
});

describe('ensureReferenceData', () => {
  it('adds refined lookups idempotently', () => {
    const db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    createSchema(db);

    ensureReferenceData(db);
    ensureReferenceData(db); // idempotent — second run must not duplicate

    const clients = db.prepare('SELECT value FROM lookup_clients').all() as { value: string }[];
    expect(clients.map((c) => c.value)).toEqual(
      expect.arrayContaining(['VISY Recycling UK', 'Genus Trading', 'CTL Europe', 'MRL LTD', 'Baileys Skip Hire']),
    );
    expect(clients.length).toBe(5); // no duplicates after two runs

    const grades = db
      .prepare("SELECT value FROM lookup_product_grades WHERE report_type = 'loading_inspection'")
      .all() as { value: string }[];
    expect(grades.map((g) => g.value)).toContain('95/5 HDPE');

    const unwanted = db
      .prepare("SELECT value FROM lookup_unwanted_materials WHERE report_type = 'loading_inspection'")
      .all() as { value: string }[];
    expect(unwanted.map((u) => u.value)).toContain('Other');
  });
});

describe('Photo Migration', () => {
  it('should migrate flat photos to subdirectories', () => {
    const db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    createSchema(db);
    seedData(db);

    // Create test data
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-test-'));
    const uploadsDir = path.join(tmpDir, 'uploads');
    fs.mkdirSync(uploadsDir, { recursive: true });

    // Create a customer, site, and report
    const cust = db.prepare('INSERT INTO customers (name) VALUES (?)').run('MigTest');
    const site = db
      .prepare('INSERT INTO customer_sites (customer_id, address) VALUES (?, ?)')
      .run(cust.lastInsertRowid, 'Test');
    const report = db
      .prepare(
        'INSERT INTO reports (report_type, customer_id, site_id, inspection_date, inspector_id, inspector_name) VALUES (?, ?, ?, ?, ?, ?)',
      )
      .run('inspection_fibre', cust.lastInsertRowid, site.lastInsertRowid, '2025-01-01', 1, 'Test');
    const reportId = report.lastInsertRowid;

    // Create a photo file in flat structure
    const testFile = 'test-photo.jpg';
    fs.writeFileSync(path.join(uploadsDir, testFile), 'fake photo data');
    db.prepare('INSERT INTO report_photos (report_id, file_path) VALUES (?, ?)').run(reportId, testFile);

    // Run migration
    migratePhotoSubdirs(db, uploadsDir);

    // Verify file moved
    const photo = db.prepare('SELECT file_path FROM report_photos WHERE report_id = ?').get(reportId) as any;
    expect(photo.file_path).toBe(`${reportId}/${testFile}`);
    expect(fs.existsSync(path.join(uploadsDir, String(reportId), testFile))).toBe(true);
    expect(fs.existsSync(path.join(uploadsDir, testFile))).toBe(false);

    // Cleanup
    fs.rmSync(tmpDir, { recursive: true });
  });

  it('should migrate signature paths', () => {
    const db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    createSchema(db);
    seedData(db);

    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-test-'));
    const uploadsDir = path.join(tmpDir, 'uploads');
    fs.mkdirSync(uploadsDir, { recursive: true });

    const cust = db.prepare('INSERT INTO customers (name) VALUES (?)').run('MigTest');
    const site = db
      .prepare('INSERT INTO customer_sites (customer_id, address) VALUES (?, ?)')
      .run(cust.lastInsertRowid, 'Test');
    const sigFile = 'sig.png';
    fs.writeFileSync(path.join(uploadsDir, sigFile), 'fake sig');
    const report = db
      .prepare(
        'INSERT INTO reports (report_type, customer_id, site_id, inspection_date, inspector_id, inspector_name, signature_path) VALUES (?, ?, ?, ?, ?, ?, ?)',
      )
      .run('inspection_fibre', cust.lastInsertRowid, site.lastInsertRowid, '2025-01-01', 1, 'Test', sigFile);

    migratePhotoSubdirs(db, uploadsDir);

    const rpt = db.prepare('SELECT signature_path FROM reports WHERE id = ?').get(report.lastInsertRowid) as any;
    expect(rpt.signature_path).toBe(`${report.lastInsertRowid}/${sigFile}`);

    fs.rmSync(tmpDir, { recursive: true });
  });

  it('should handle already-migrated photos (no-op)', () => {
    const db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    createSchema(db);
    seedData(db);

    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-test-'));
    const uploadsDir = path.join(tmpDir, 'uploads');
    fs.mkdirSync(uploadsDir, { recursive: true });

    const cust = db.prepare('INSERT INTO customers (name) VALUES (?)').run('Test');
    const site = db
      .prepare('INSERT INTO customer_sites (customer_id, address) VALUES (?, ?)')
      .run(cust.lastInsertRowid, 'Test');
    const report = db
      .prepare(
        'INSERT INTO reports (report_type, customer_id, site_id, inspection_date, inspector_id, inspector_name) VALUES (?, ?, ?, ?, ?, ?)',
      )
      .run('inspection_fibre', cust.lastInsertRowid, site.lastInsertRowid, '2025-01-01', 1, 'Test');

    // Already has subdir path
    db.prepare('INSERT INTO report_photos (report_id, file_path) VALUES (?, ?)').run(
      report.lastInsertRowid,
      `${report.lastInsertRowid}/photo.jpg`,
    );

    // Should not throw
    migratePhotoSubdirs(db, uploadsDir);

    fs.rmSync(tmpDir, { recursive: true });
  });
});
