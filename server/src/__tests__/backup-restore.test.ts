import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { createSchema } from '../db/schema';
import { seedData } from '../db/seed';
import { createArchive, computeSchemaFingerprint } from '../backup/archive';
import {
  validateArchive,
  stageArchive,
  restorePaths,
  writeMarker,
  readMarker,
  clearMarker,
  applySwap,
  recoverInterruptedRestore,
  RestoreValidationError,
} from '../backup/restore';

describe('validateArchive', () => {
  let db: Database.Database;
  let tmpDir: string;
  let backupsDir: string;
  let uploadsDir: string;
  let archivePath: string;

  beforeEach(async () => {
    db = new Database(':memory:');
    db.pragma('journal_mode = WAL');
    createSchema(db);
    seedData(db);

    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-restore-test-'));
    backupsDir = path.join(tmpDir, 'backups');
    uploadsDir = path.join(tmpDir, 'uploads');
    fs.mkdirSync(uploadsDir, { recursive: true });

    const result = await createArchive({ db, backupsDir, uploadsDir, kind: 'manual' });
    archivePath = result.path;
  });

  afterEach(() => {
    db.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('accepts a well-formed archive against a matching schema fingerprint', async () => {
    const manifest = await validateArchive(archivePath, computeSchemaFingerprint(db));
    expect(manifest.kind).toBe('manual');
  });

  it('rejects an archive with a schema fingerprint mismatch', async () => {
    await expect(validateArchive(archivePath, { unrelated_table: ['id'] })).rejects.toThrow(RestoreValidationError);
  });

  it('rejects a truncated archive', async () => {
    const truncated = path.join(tmpDir, 'truncated.tar.gz');
    const full = fs.readFileSync(archivePath);
    fs.writeFileSync(truncated, full.subarray(0, Math.floor(full.length / 2)));
    await expect(validateArchive(truncated, computeSchemaFingerprint(db))).rejects.toThrow(RestoreValidationError);
  });

  it('rejects an archive whose database checksum does not match the manifest', async () => {
    const extractDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-restore-tamper-'));
    const tar = await import('tar');
    await tar.extract({ file: archivePath, cwd: extractDir });
    fs.appendFileSync(path.join(extractDir, 'sb-materials.db'), Buffer.from('corruption'));
    const tampered = path.join(tmpDir, 'tampered.tar.gz');
    await tar.create({ gzip: true, file: tampered, cwd: extractDir }, ['manifest.json', 'sb-materials.db', 'uploads']);

    await expect(validateArchive(tampered, computeSchemaFingerprint(db))).rejects.toThrow(RestoreValidationError);
    fs.rmSync(extractDir, { recursive: true, force: true });
  });

  it('rejects an archive with an unknown format version', async () => {
    const extractDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-restore-version-'));
    const tar = await import('tar');
    await tar.extract({ file: archivePath, cwd: extractDir });
    const manifestPath = path.join(extractDir, 'manifest.json');
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
    manifest.formatVersion = 999;
    fs.writeFileSync(manifestPath, JSON.stringify(manifest));
    const rebuilt = path.join(tmpDir, 'future-version.tar.gz');
    await tar.create({ gzip: true, file: rebuilt, cwd: extractDir }, ['manifest.json', 'sb-materials.db', 'uploads']);

    await expect(validateArchive(rebuilt, computeSchemaFingerprint(db))).rejects.toThrow(RestoreValidationError);
    fs.rmSync(extractDir, { recursive: true, force: true });
  });

  it('does not touch the real data directory when validation fails', async () => {
    const dataDir = path.join(tmpDir, 'data');
    fs.mkdirSync(dataDir, { recursive: true });
    fs.writeFileSync(path.join(dataDir, 'sb-materials.db'), 'original');
    const before = fs.readFileSync(path.join(dataDir, 'sb-materials.db'), 'utf-8');

    await expect(validateArchive(archivePath, { unrelated_table: ['id'] })).rejects.toThrow(RestoreValidationError);

    expect(fs.readFileSync(path.join(dataDir, 'sb-materials.db'), 'utf-8')).toBe(before);
    expect(fs.existsSync(path.join(dataDir, '.restore-staging'))).toBe(false);
  });

  it('stages an archive into the staging directory', async () => {
    const dataDir = path.join(tmpDir, 'data-stage');
    fs.mkdirSync(dataDir, { recursive: true });
    const paths = restorePaths(dataDir);

    await stageArchive(archivePath, paths.stagingDir);

    expect(fs.existsSync(path.join(paths.stagingDir, 'sb-materials.db'))).toBe(true);
    expect(fs.existsSync(path.join(paths.stagingDir, 'manifest.json'))).toBe(true);
    expect(fs.existsSync(path.join(paths.stagingDir, 'uploads'))).toBe(true);
  });
});

describe('applySwap and recoverInterruptedRestore', () => {
  let tmpDir: string;
  let dataDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-swap-test-'));
    dataDir = path.join(tmpDir, 'data');
    fs.mkdirSync(dataDir, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function seedCurrentState() {
    fs.writeFileSync(path.join(dataDir, 'sb-materials.db'), 'old-db');
    fs.writeFileSync(path.join(dataDir, 'sb-materials.db-wal'), 'old-wal');
    fs.mkdirSync(path.join(dataDir, 'uploads', '1'), { recursive: true });
    fs.writeFileSync(path.join(dataDir, 'uploads', '1', 'photo.jpg'), 'old-photo');
    fs.writeFileSync(path.join(dataDir, 'sessions.db'), 'sessions');
  }

  async function seedStaging() {
    const paths = restorePaths(dataDir);
    fs.mkdirSync(paths.stagingDir, { recursive: true });
    fs.writeFileSync(path.join(paths.stagingDir, 'sb-materials.db'), 'new-db');
    fs.mkdirSync(path.join(paths.stagingDir, 'uploads', '2'), { recursive: true });
    fs.writeFileSync(path.join(paths.stagingDir, 'uploads', '2', 'photo.jpg'), 'new-photo');
    return paths;
  }

  it('swaps staged files into place, removes the wal file and sessions.db', async () => {
    seedCurrentState();
    const paths = await seedStaging();

    applySwap(paths);

    expect(fs.readFileSync(path.join(dataDir, 'sb-materials.db'), 'utf-8')).toBe('new-db');
    expect(fs.existsSync(path.join(dataDir, 'sb-materials.db-wal'))).toBe(false);
    expect(fs.readFileSync(path.join(dataDir, 'uploads', '2', 'photo.jpg'), 'utf-8')).toBe('new-photo');
    expect(fs.existsSync(path.join(dataDir, 'uploads', '1'))).toBe(false);
    expect(fs.existsSync(path.join(dataDir, 'sessions.db'))).toBe(false);
    expect(fs.existsSync(paths.stagingDir)).toBe(false);
    expect(fs.existsSync(paths.asideDir)).toBe(false);
  });

  it('is safe to re-run after a simulated crash partway through', async () => {
    seedCurrentState();
    const paths = await seedStaging();

    // Simulate a crash: only the database has been moved aside and swapped in.
    fs.mkdirSync(paths.asideDir, { recursive: true });
    fs.renameSync(path.join(dataDir, 'sb-materials.db'), path.join(paths.asideDir, 'sb-materials.db'));
    fs.renameSync(path.join(dataDir, 'sb-materials.db-wal'), path.join(paths.asideDir, 'sb-materials.db-wal'));
    fs.renameSync(path.join(paths.stagingDir, 'sb-materials.db'), path.join(dataDir, 'sb-materials.db'));
    // uploads and sessions.db were never touched before the crash.

    applySwap(paths);

    expect(fs.readFileSync(path.join(dataDir, 'sb-materials.db'), 'utf-8')).toBe('new-db');
    expect(fs.readFileSync(path.join(dataDir, 'uploads', '2', 'photo.jpg'), 'utf-8')).toBe('new-photo');
    expect(fs.existsSync(path.join(dataDir, 'sessions.db'))).toBe(false);
    expect(fs.existsSync(paths.stagingDir)).toBe(false);
    expect(fs.existsSync(paths.asideDir)).toBe(false);
  });

  it('is safe to re-run after a crash between moving the original aside and swapping the new one in', async () => {
    seedCurrentState();
    const paths = await seedStaging();

    // Simulate a crash: the originals are aside, nothing has been swapped in yet.
    fs.mkdirSync(paths.asideDir, { recursive: true });
    fs.renameSync(path.join(dataDir, 'sb-materials.db'), path.join(paths.asideDir, 'sb-materials.db'));
    fs.renameSync(path.join(dataDir, 'sb-materials.db-wal'), path.join(paths.asideDir, 'sb-materials.db-wal'));
    fs.renameSync(path.join(dataDir, 'uploads'), path.join(paths.asideDir, 'uploads'));

    applySwap(paths);

    expect(fs.readFileSync(path.join(dataDir, 'sb-materials.db'), 'utf-8')).toBe('new-db');
    expect(fs.readFileSync(path.join(dataDir, 'uploads', '2', 'photo.jpg'), 'utf-8')).toBe('new-photo');
    expect(fs.existsSync(path.join(dataDir, 'sb-materials.db-wal'))).toBe(false);
    expect(fs.existsSync(paths.stagingDir)).toBe(false);
    expect(fs.existsSync(paths.asideDir)).toBe(false);
  });

  it('is a no-op when called again after a completed swap', async () => {
    seedCurrentState();
    const paths = await seedStaging();

    applySwap(paths);
    applySwap(paths);

    expect(fs.readFileSync(path.join(dataDir, 'sb-materials.db'), 'utf-8')).toBe('new-db');
    expect(fs.readFileSync(path.join(dataDir, 'uploads', '2', 'photo.jpg'), 'utf-8')).toBe('new-photo');
    expect(fs.existsSync(paths.stagingDir)).toBe(false);
    expect(fs.existsSync(paths.asideDir)).toBe(false);
  });

  it('leaves the live data alone when a marker outlives its staging directory', async () => {
    // The swap completed, but the process died before the marker was cleared:
    // the marker now points at a staging directory that no longer exists, and
    // the data directory holds the freshly restored state.
    seedCurrentState();
    const paths = restorePaths(dataDir);
    writeMarker(paths.markerPath, { stagingDir: paths.stagingDir, createdAt: new Date().toISOString() });

    const result = recoverInterruptedRestore(dataDir);

    expect(result).toBe('completed');
    expect(fs.readFileSync(path.join(dataDir, 'sb-materials.db'), 'utf-8')).toBe('old-db');
    expect(fs.readFileSync(path.join(dataDir, 'uploads', '1', 'photo.jpg'), 'utf-8')).toBe('old-photo');
    expect(fs.existsSync(path.join(dataDir, 'sb-materials.db-wal'))).toBe(true);
    expect(readMarker(paths.markerPath)).toBeNull();
  });

  it('rolls the originals back if the staged copies have gone missing', async () => {
    seedCurrentState();
    const paths = restorePaths(dataDir);

    // Originals moved aside, and the staged replacements are nowhere to be found.
    fs.mkdirSync(paths.asideDir, { recursive: true });
    fs.renameSync(path.join(dataDir, 'sb-materials.db'), path.join(paths.asideDir, 'sb-materials.db'));
    fs.renameSync(path.join(dataDir, 'uploads'), path.join(paths.asideDir, 'uploads'));

    applySwap(paths);

    expect(fs.readFileSync(path.join(dataDir, 'sb-materials.db'), 'utf-8')).toBe('old-db');
    expect(fs.readFileSync(path.join(dataDir, 'uploads', '1', 'photo.jpg'), 'utf-8')).toBe('old-photo');
    expect(fs.existsSync(paths.asideDir)).toBe(false);
  });

  it('recoverInterruptedRestore is a no-op when there is no marker', () => {
    expect(recoverInterruptedRestore(dataDir)).toBe('none');
  });

  it('recoverInterruptedRestore completes a swap left behind by a marker', async () => {
    seedCurrentState();
    const paths = await seedStaging();
    writeMarker(paths.markerPath, { stagingDir: paths.stagingDir, createdAt: new Date().toISOString() });

    const result = recoverInterruptedRestore(dataDir);

    expect(result).toBe('completed');
    expect(fs.readFileSync(path.join(dataDir, 'sb-materials.db'), 'utf-8')).toBe('new-db');
    expect(readMarker(paths.markerPath)).toBeNull();
  });

  it('recoverInterruptedRestore still completes when the marker itself is unreadable', async () => {
    seedCurrentState();
    const paths = await seedStaging();
    fs.writeFileSync(paths.markerPath, '{"stagingDir": "trunca');

    const result = recoverInterruptedRestore(dataDir);

    expect(result).toBe('completed');
    expect(fs.readFileSync(path.join(dataDir, 'sb-materials.db'), 'utf-8')).toBe('new-db');
    expect(fs.existsSync(paths.markerPath)).toBe(false);
  });
});

describe('marker read/write/clear', () => {
  it('round-trips a marker and clears it', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-marker-test-'));
    const paths = restorePaths(tmpDir);
    expect(readMarker(paths.markerPath)).toBeNull();

    writeMarker(paths.markerPath, { stagingDir: paths.stagingDir, createdAt: '2026-08-13T00:00:00.000Z' });
    expect(readMarker(paths.markerPath)).toEqual({ stagingDir: paths.stagingDir, createdAt: '2026-08-13T00:00:00.000Z' });

    clearMarker(paths.markerPath);
    expect(readMarker(paths.markerPath)).toBeNull();

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });
});
