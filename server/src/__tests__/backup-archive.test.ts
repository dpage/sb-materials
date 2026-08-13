import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import fs from 'fs';
import os from 'os';
import path from 'path';
import * as tar from 'tar';
import { createSchema, DB_SCHEMA_VERSION } from '../db/schema';
import { seedData } from '../db/seed';
import {
  computeSchemaFingerprint,
  archiveFilename,
  createArchive,
  listArchives,
  pruneRetention,
  manifestSidecarPath,
  isArchiveFilename,
} from '../backup/archive';

describe('computeSchemaFingerprint', () => {
  it('lists tables with their sorted column names', () => {
    const db = new Database(':memory:');
    createSchema(db);
    const fp = computeSchemaFingerprint(db);
    expect(fp.users).toEqual([...fp.users].sort());
    expect(fp.users).toContain('username');
    expect(fp.reports).toContain('inspection_date');
    db.close();
  });

  it('is stable across two schema-identical databases', () => {
    const db1 = new Database(':memory:');
    createSchema(db1);
    const db2 = new Database(':memory:');
    createSchema(db2);
    expect(computeSchemaFingerprint(db1)).toEqual(computeSchemaFingerprint(db2));
    db1.close();
    db2.close();
  });

  // DB_SCHEMA_VERSION (server/src/db/schema.ts) is what restore actually
  // gates on, and it is only as good as the discipline of bumping it whenever
  // a table or column changes — nothing enforces that mechanically except
  // this test. If it fails, a table or column really did change: bump
  // DB_SCHEMA_VERSION and paste the new fingerprint below as part of the same
  // commit, rather than editing this test to make it pass unchanged.
  it('matches the checked-in fingerprint for the current DB_SCHEMA_VERSION', () => {
    const db = new Database(':memory:');
    createSchema(db);
    expect(computeSchemaFingerprint(db)).toEqual({
      app_settings: ['key', 'value'],
      collection_note_items: [
        'collection_point',
        'description',
        'id',
        'nett_weight',
        'note_id',
        'quantity',
        'sort_order',
      ],
      collection_notes: [
        'buyer_reference',
        'collect_from_address',
        'collection_date',
        'comments',
        'contact_name',
        'contact_phone',
        'created_at',
        'created_by_id',
        'customer_id',
        'dispatched_signature_path',
        'dispatched_signed_date',
        'id',
        'minimum_weight',
        'reference',
        'site_id',
        'transport_company',
        'updated_at',
      ],
      customer_sites: ['address', 'customer_id', 'id', 'is_active'],
      customers: ['address', 'contact_name', 'email', 'id', 'is_active', 'name', 'phone'],
      lookup_clients: ['id', 'is_active', 'value'],
      lookup_contaminants: ['id', 'is_active', 'report_type', 'value'],
      lookup_product_descriptions: ['id', 'is_active', 'report_type', 'value'],
      lookup_product_grades: ['id', 'is_active', 'report_type', 'value'],
      lookup_storage_modes: ['id', 'is_active', 'value'],
      lookup_unwanted_materials: ['id', 'is_active', 'report_type', 'value'],
      report_containers: [
        'container_number',
        'id',
        'number_of_bales',
        'report_id',
        'seal_number',
        'sort_order',
        'weighbridge_ticket',
        'weight',
        'weight_info',
      ],
      report_contaminants: ['contaminant', 'id', 'notes', 'report_id'],
      report_inspection_details: [
        'bale_break',
        'bale_break_results',
        'id',
        'loading_reference',
        'material_originates_uk',
        'mixed_paper_exceeds_34_5',
        'mode_of_storage',
        'moisture_reading_high',
        'moisture_reading_low',
        'moisture_readings',
        'number_of_containers',
        'occ_exceeds_80',
        'packaging_thresholds',
        'plastic_exceeds_97_5',
        'prebaled_uk_assurance',
        'product_description',
        'product_grade',
        'radiation_reading',
        'rejected_bales',
        'report_id',
        'site_aware_non_uk',
        'site_buys_prebaled',
        'stock_bale_count',
        'supplier_aware_pern',
        'supplier_controls_volume',
        'volume_consistency_notes',
      ],
      report_pern_details: [
        'accident_log',
        'accreditations',
        'area_size',
        'auditor_position',
        'bale_split_results',
        'company_name_address',
        'contact_name',
        'email',
        'employer_liability',
        'follow_up',
        'grades_supplied',
        'id',
        'intro_letter',
        'materials_handled',
        'mgmt_experience',
        'non_uk_comments',
        'non_uk_packaging',
        'notes',
        'num_workers',
        'packaging_differentiation',
        'packaging_identification',
        'permits_licences',
        'phone',
        'ppe_suitable',
        'prn_accredited',
        'prn_claimed_once',
        'prn_expertise',
        'prn_numbers',
        'process_flow',
        'public_liability',
        'quality_discussion',
        'report_id',
        'safety_comments',
        'safety_equipment',
        'safety_inducted',
        'site_facilities',
        'site_type',
        'throughput',
        'training_recording',
        'training_records_inspected',
        'training_review_frequency',
        'training_scope',
        'training_types',
        'transfer_notes_checked',
        'uniform_or_own',
        'waste_sources',
        'worker_recording',
        'worker_recording_comments',
        'workers_consistent',
      ],
      report_photos: ['container_id', 'created_at', 'file_path', 'id', 'photo_label', 'report_id', 'sort_order'],
      report_unwanted_materials: ['id', 'material', 'notes', 'report_id'],
      reports: [
        'assigned_to_id',
        'created_at',
        'created_by_id',
        'customer_id',
        'date_completed',
        'id',
        'inspection_date',
        'inspection_passed',
        'inspection_time',
        'inspector_id',
        'inspector_name',
        'on_behalf_of',
        'other_information',
        'quality_score',
        'report_type',
        'signature_path',
        'site_id',
        'status',
        'updated_at',
      ],
      users: ['created_at', 'display_name', 'id', 'is_active', 'is_superuser', 'password_hash', 'phone', 'username'],
    });
    db.close();
  });
});

describe('archiveFilename', () => {
  it('formats as sb-materials-<kind>-YYYYMMDD-HHMMSS.tar.gz', () => {
    const date = new Date('2026-08-13T14:05:09.000Z');
    expect(archiveFilename('scheduled', date)).toBe('sb-materials-scheduled-20260813-140509.tar.gz');
    expect(archiveFilename('manual', date)).toBe('sb-materials-manual-20260813-140509.tar.gz');
    expect(archiveFilename('pre-restore', date)).toBe('sb-materials-pre-restore-20260813-140509.tar.gz');
  });
});

describe('isArchiveFilename', () => {
  it('accepts genuine archive names and rejects everything else', () => {
    expect(isArchiveFilename('sb-materials-scheduled-20260813-140509.tar.gz')).toBe(true);
    expect(isArchiveFilename('sb-materials-pre-restore-20260813-140509.tar.gz')).toBe(true);
    // A sidecar, a staging directory mid-creation, and a traversal attempt.
    expect(isArchiveFilename('sb-materials-manual-20260813-140509.tar.gz.manifest.json')).toBe(false);
    expect(isArchiveFilename('.building-a1b2c3')).toBe(false);
    expect(isArchiveFilename('../../etc/passwd')).toBe(false);
  });
});

describe('createArchive / listArchives / pruneRetention', () => {
  let db: Database.Database;
  let tmpDir: string;
  let backupsDir: string;
  let uploadsDir: string;

  beforeEach(() => {
    db = new Database(':memory:');
    db.pragma('journal_mode = WAL');
    createSchema(db);
    seedData(db);

    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-backup-test-'));
    backupsDir = path.join(tmpDir, 'backups');
    uploadsDir = path.join(tmpDir, 'uploads');
    fs.mkdirSync(uploadsDir, { recursive: true });
    fs.mkdirSync(path.join(uploadsDir, '1'), { recursive: true });
    fs.writeFileSync(path.join(uploadsDir, '1', 'photo.jpg'), 'fake-jpeg-bytes');
  });

  afterEach(() => {
    db.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('creates a tar.gz containing manifest.json, sb-materials.db and uploads/', async () => {
    const {
      filename,
      path: archivePath,
      manifest,
    } = await createArchive({
      db,
      backupsDir,
      uploadsDir,
      kind: 'manual',
      now: new Date('2026-08-13T14:05:09.000Z'),
    });

    expect(filename).toBe('sb-materials-manual-20260813-140509.tar.gz');
    expect(fs.existsSync(archivePath)).toBe(true);
    expect(manifest.formatVersion).toBe(1);
    expect(manifest.kind).toBe('manual');
    expect(manifest.dbSchemaVersion).toBe(DB_SCHEMA_VERSION);

    const extractDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-backup-extract-'));
    await tar.extract({ file: archivePath, cwd: extractDir });

    expect(fs.existsSync(path.join(extractDir, 'manifest.json'))).toBe(true);
    expect(fs.existsSync(path.join(extractDir, 'sb-materials.db'))).toBe(true);
    expect(fs.existsSync(path.join(extractDir, 'uploads', '1', 'photo.jpg'))).toBe(true);

    const extractedDb = new Database(path.join(extractDir, 'sb-materials.db'), { readonly: true });
    const row = extractedDb.prepare("SELECT username FROM users WHERE username = 'admin'").get();
    expect(row).toBeTruthy();
    extractedDb.close();

    fs.rmSync(extractDir, { recursive: true, force: true });
  });

  it('lists archives newest first with manifest-derived counts', async () => {
    await createArchive({ db, backupsDir, uploadsDir, kind: 'manual', now: new Date('2026-08-13T10:00:00.000Z') });
    await createArchive({ db, backupsDir, uploadsDir, kind: 'scheduled', now: new Date('2026-08-14T02:00:00.000Z') });

    const listing = listArchives(backupsDir);
    expect(listing).toHaveLength(2);
    expect(listing[0].kind).toBe('scheduled');
    expect(listing[0].createdAt.startsWith('2026-08-14')).toBe(true);
    expect(listing[0].reportCount).not.toBeNull();
    expect(listing[1].kind).toBe('manual');
  });

  it('returns an empty list when the backups directory does not exist yet', () => {
    expect(listArchives(path.join(tmpDir, 'does-not-exist'))).toEqual([]);
  });

  it('writes a manifest sidecar alongside the archive', async () => {
    const { path: archivePath, manifest } = await createArchive({ db, backupsDir, uploadsDir, kind: 'manual' });

    const sidecarPath = manifestSidecarPath(archivePath);
    expect(sidecarPath).toBe(`${archivePath}.manifest.json`);
    expect(JSON.parse(fs.readFileSync(sidecarPath, 'utf-8'))).toEqual(manifest);
  });

  it('takes the listing counts from the sidecar without reading the archive itself', async () => {
    const { path: archivePath, manifest } = await createArchive({ db, backupsDir, uploadsDir, kind: 'manual' });

    // Destroy the tar entirely, keeping only its size. Anything that decompressed
    // it to recover the manifest would now come back with null counts (or throw),
    // so counts surviving this proves the listing never opened it.
    const sizeBefore = fs.statSync(archivePath).size;
    fs.writeFileSync(archivePath, Buffer.alloc(sizeBefore, 0));

    const listing = listArchives(backupsDir);
    expect(listing).toHaveLength(1);
    expect(listing[0].reportCount).toBe(manifest.reportCount);
    expect(listing[0].photoCount).toBe(manifest.photoCount);
    expect(listing[0].collectionNoteCount).toBe(manifest.collectionNoteCount);
    expect(listing[0].sizeBytes).toBe(sizeBefore);
  });

  it('degrades to unknown counts for an archive with no sidecar', async () => {
    const { path: archivePath } = await createArchive({ db, backupsDir, uploadsDir, kind: 'manual' });
    fs.rmSync(manifestSidecarPath(archivePath));

    const listing = listArchives(backupsDir);
    expect(listing).toHaveLength(1);
    expect(listing[0].reportCount).toBeNull();
    expect(listing[0].photoCount).toBeNull();
    expect(listing[0].collectionNoteCount).toBeNull();
  });

  it('does not list a sidecar as though it were an archive in its own right', async () => {
    await createArchive({ db, backupsDir, uploadsDir, kind: 'manual' });
    expect(listArchives(backupsDir)).toHaveLength(1);
  });

  it('prunes scheduled/manual archives to the newest N, leaving pre-restore alone', async () => {
    for (let i = 0; i < 5; i++) {
      await createArchive({
        db,
        backupsDir,
        uploadsDir,
        kind: 'scheduled',
        now: new Date(Date.UTC(2026, 0, i + 1, 2, 0, 0)),
      });
    }
    await createArchive({ db, backupsDir, uploadsDir, kind: 'pre-restore', now: new Date(Date.UTC(2026, 0, 10)) });

    const removed = pruneRetention(backupsDir, 2);
    expect(removed).toHaveLength(3);

    const remaining = listArchives(backupsDir);
    const scheduled = remaining.filter((a) => a.kind === 'scheduled');
    const preRestore = remaining.filter((a) => a.kind === 'pre-restore');
    expect(scheduled).toHaveLength(2);
    expect(preRestore).toHaveLength(1);
  });

  it('keeps only the newest 3 pre-restore archives regardless of the general keep count', async () => {
    for (let i = 0; i < 4; i++) {
      await createArchive({
        db,
        backupsDir,
        uploadsDir,
        kind: 'pre-restore',
        now: new Date(Date.UTC(2026, 0, i + 1, 2, 0, 0)),
      });
    }

    pruneRetention(backupsDir, 14);
    const remaining = listArchives(backupsDir);
    expect(remaining).toHaveLength(3);
  });

  it('removes each pruned archive together with its manifest sidecar', async () => {
    const created = [];
    for (let i = 0; i < 3; i++) {
      created.push(
        await createArchive({
          db,
          backupsDir,
          uploadsDir,
          kind: 'scheduled',
          now: new Date(Date.UTC(2026, 0, i + 1, 2, 0, 0)),
        }),
      );
    }

    const removed = pruneRetention(backupsDir, 1);
    expect(removed).toEqual([created[1].filename, created[0].filename]);

    for (const pruned of [created[0], created[1]]) {
      expect(fs.existsSync(pruned.path)).toBe(false);
      expect(fs.existsSync(manifestSidecarPath(pruned.path))).toBe(false);
    }
    expect(fs.existsSync(manifestSidecarPath(created[2].path))).toBe(true);

    // Nothing orphaned: exactly one archive and its one sidecar are left.
    expect(fs.readdirSync(backupsDir).sort()).toEqual(
      [created[2].filename, `${created[2].filename}.manifest.json`].sort(),
    );
  });
});
