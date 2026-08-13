import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { createSchema, DB_SCHEMA_VERSION } from '../db/schema';
import { seedData } from '../db/seed';
import { createArchive } from '../backup/archive';
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
  let scratchRoot: string;
  let archivePath: string;

  beforeEach(async () => {
    db = new Database(':memory:');
    db.pragma('journal_mode = WAL');
    createSchema(db);
    seedData(db);

    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-restore-test-'));
    backupsDir = path.join(tmpDir, 'backups');
    uploadsDir = path.join(tmpDir, 'uploads');
    // Scratch space belongs under the data directory, not in os.tmpdir().
    scratchRoot = restorePaths(tmpDir).scratchDir;
    fs.mkdirSync(uploadsDir, { recursive: true });

    const result = await createArchive({ db, backupsDir, uploadsDir, kind: 'manual' });
    archivePath = result.path;
  });

  afterEach(() => {
    db.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('accepts a well-formed archive against a schema version this build supports', async () => {
    const manifest = await validateArchive(archivePath, DB_SCHEMA_VERSION, scratchRoot);
    expect(manifest.kind).toBe('manual');
  });

  it('accepts an archive recorded against an older schema version, leaving it to the boot-time migrations', async () => {
    const manifest = await validateArchive(archivePath, DB_SCHEMA_VERSION + 5, scratchRoot);
    expect(manifest.kind).toBe('manual');
  });

  it('accepts an archive carrying columns this build no longer defines, with no recorded schema version — the actual production incident', async () => {
    // Reproduces the real shape of the archive that failed in production, not
    // just its missing field: production's collection_notes table had carried
    // three columns (received_signature_path, received_signed_date, weight)
    // since before the commit that dropped them from CREATE TABLE, because the
    // migrations here are additive-only and nothing ever ran a compensating
    // DROP COLUMN. A strict structural comparison rejected restoring that
    // archive into a freshly-seeded database that had never had those columns,
    // even though the app's own boot-time migrations already tolerate exactly
    // that drift for any live database. Reinstating the old structural
    // comparison here must fail this test.
    db.exec(`
      ALTER TABLE collection_notes ADD COLUMN weight TEXT;
      ALTER TABLE collection_notes ADD COLUMN received_signature_path TEXT;
      ALTER TABLE collection_notes ADD COLUMN received_signed_date TEXT;
    `);
    const vestigial = await createArchive({ db, backupsDir, uploadsDir, kind: 'manual' });

    const extractDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-restore-no-version-'));
    const tar = await import('tar');
    await tar.extract({ file: vestigial.path, cwd: extractDir });
    const manifestPath = path.join(extractDir, 'manifest.json');
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
    delete manifest.dbSchemaVersion;
    fs.writeFileSync(manifestPath, JSON.stringify(manifest));
    const rebuilt = path.join(tmpDir, 'no-schema-version.tar.gz');
    await tar.create({ gzip: true, file: rebuilt, cwd: extractDir }, ['manifest.json', 'sb-materials.db', 'uploads']);

    await expect(validateArchive(rebuilt, DB_SCHEMA_VERSION, scratchRoot)).resolves.toMatchObject({ kind: 'manual' });
    fs.rmSync(extractDir, { recursive: true, force: true });
  });

  it('extracts beneath the given scratch root and leaves nothing behind, whether it passes or fails', async () => {
    await validateArchive(archivePath, DB_SCHEMA_VERSION, scratchRoot);
    expect(fs.readdirSync(scratchRoot)).toEqual([]);

    await expect(validateArchive(archivePath, DB_SCHEMA_VERSION - 1, scratchRoot)).rejects.toThrow(
      RestoreValidationError,
    );
    expect(fs.readdirSync(scratchRoot)).toEqual([]);
  });

  it('rejects an archive that requires a newer schema version than this build supports', async () => {
    const extractDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-restore-future-version-'));
    const tar = await import('tar');
    await tar.extract({ file: archivePath, cwd: extractDir });
    const manifestPath = path.join(extractDir, 'manifest.json');
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
    manifest.dbSchemaVersion = DB_SCHEMA_VERSION + 1;
    fs.writeFileSync(manifestPath, JSON.stringify(manifest));
    const rebuilt = path.join(tmpDir, 'future-schema-version.tar.gz');
    await tar.create({ gzip: true, file: rebuilt, cwd: extractDir }, ['manifest.json', 'sb-materials.db', 'uploads']);

    await expect(validateArchive(rebuilt, DB_SCHEMA_VERSION, scratchRoot)).rejects.toThrow(RestoreValidationError);
    fs.rmSync(extractDir, { recursive: true, force: true });
  });

  it('rejects an archive whose recorded schema version is not a valid non-negative integer', async () => {
    const extractDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-restore-bad-version-'));
    const tar = await import('tar');
    await tar.extract({ file: archivePath, cwd: extractDir });
    const manifestPath = path.join(extractDir, 'manifest.json');
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
    manifest.dbSchemaVersion = 'not-a-number';
    fs.writeFileSync(manifestPath, JSON.stringify(manifest));
    const rebuilt = path.join(tmpDir, 'invalid-schema-version.tar.gz');
    await tar.create({ gzip: true, file: rebuilt, cwd: extractDir }, ['manifest.json', 'sb-materials.db', 'uploads']);

    await expect(validateArchive(rebuilt, DB_SCHEMA_VERSION, scratchRoot)).rejects.toThrow(RestoreValidationError);
    fs.rmSync(extractDir, { recursive: true, force: true });
  });

  it('rejects a truncated archive', async () => {
    const truncated = path.join(tmpDir, 'truncated.tar.gz');
    const full = fs.readFileSync(archivePath);
    fs.writeFileSync(truncated, full.subarray(0, Math.floor(full.length / 2)));
    await expect(validateArchive(truncated, DB_SCHEMA_VERSION, scratchRoot)).rejects.toThrow(RestoreValidationError);
  });

  it('rejects an archive whose database checksum does not match the manifest', async () => {
    const extractDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-restore-tamper-'));
    const tar = await import('tar');
    await tar.extract({ file: archivePath, cwd: extractDir });
    fs.appendFileSync(path.join(extractDir, 'sb-materials.db'), Buffer.from('corruption'));
    const tampered = path.join(tmpDir, 'tampered.tar.gz');
    await tar.create({ gzip: true, file: tampered, cwd: extractDir }, ['manifest.json', 'sb-materials.db', 'uploads']);

    await expect(validateArchive(tampered, DB_SCHEMA_VERSION, scratchRoot)).rejects.toThrow(RestoreValidationError);
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

    await expect(validateArchive(rebuilt, DB_SCHEMA_VERSION, scratchRoot)).rejects.toThrow(RestoreValidationError);
    fs.rmSync(extractDir, { recursive: true, force: true });
  });

  it('does not touch the real data directory when validation fails', async () => {
    const dataDir = path.join(tmpDir, 'data');
    fs.mkdirSync(dataDir, { recursive: true });
    fs.writeFileSync(path.join(dataDir, 'sb-materials.db'), 'original');
    const before = fs.readFileSync(path.join(dataDir, 'sb-materials.db'), 'utf-8');

    await expect(validateArchive(archivePath, DB_SCHEMA_VERSION - 1, scratchRoot)).rejects.toThrow(
      RestoreValidationError,
    );

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

    expect(result).toEqual({ status: 'completed', quarantinedAt: null });
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

  function retiredAsideDirs(): string[] {
    return fs
      .readdirSync(dataDir)
      .filter((entry) => entry.startsWith('.restore-aside-'))
      .map((entry) => path.join(dataDir, entry));
  }

  it('retires set-aside items it did not supersede rather than deleting the whole directory', () => {
    seedCurrentState();
    const paths = restorePaths(dataDir);

    // An earlier restore died between moving the original database's write-ahead
    // log aside and putting it back, and its staging directory has since been
    // lost, so the only copy of that log is the one in the aside directory. A
    // later, unrelated restore then stages nothing but uploads.
    fs.mkdirSync(paths.asideDir, { recursive: true });
    fs.writeFileSync(path.join(paths.asideDir, 'sb-materials.db-wal'), 'stranded-wal');
    fs.mkdirSync(path.join(paths.stagingDir, 'uploads', '2'), { recursive: true });
    fs.writeFileSync(path.join(paths.stagingDir, 'uploads', '2', 'photo.jpg'), 'new-photo');

    const result = applySwap(paths);

    expect(fs.readFileSync(path.join(dataDir, 'uploads', '2', 'photo.jpg'), 'utf-8')).toBe('new-photo');
    expect(fs.existsSync(paths.asideDir)).toBe(false);
    const retired = retiredAsideDirs();
    expect(retired).toHaveLength(1);
    // The quarantine is reported back rather than swallowed, so it can be logged.
    expect(result.quarantinedAt).toBe(retired[0]);
    // The uploads this call really did supersede are gone; the stranded log is not.
    expect(fs.readdirSync(retired[0])).toEqual(['sb-materials.db-wal']);
    expect(fs.readFileSync(path.join(retired[0], 'sb-materials.db-wal'), 'utf-8')).toBe('stranded-wal');
  });

  it('preserves the set-aside originals when nothing this run did superseded them', () => {
    // The nightmare: uploads/ was moved aside by a crashed restore, the staging
    // directory is gone, and something else has recreated an empty uploads/
    // before recovery ran. The photos in the aside directory are the only copy
    // in existence and must survive.
    fs.writeFileSync(path.join(dataDir, 'sb-materials.db'), 'db');
    fs.mkdirSync(path.join(dataDir, 'uploads'), { recursive: true });
    const paths = restorePaths(dataDir);
    fs.mkdirSync(path.join(paths.asideDir, 'uploads', '1'), { recursive: true });
    fs.writeFileSync(path.join(paths.asideDir, 'uploads', '1', 'photo.jpg'), 'only-copy');

    const result = applySwap(paths);

    const retired = retiredAsideDirs();
    expect(retired).toHaveLength(1);
    expect(fs.readFileSync(path.join(retired[0], 'uploads', '1', 'photo.jpg'), 'utf-8')).toBe('only-copy');
    expect(result.quarantinedAt).toBe(retired[0]);
  });

  it('reports the quarantine directory back through recoverInterruptedRestore', () => {
    // Same nightmare as above, reached the way it actually would be: on startup,
    // with a marker present.
    fs.writeFileSync(path.join(dataDir, 'sb-materials.db'), 'db');
    fs.mkdirSync(path.join(dataDir, 'uploads'), { recursive: true });
    const paths = restorePaths(dataDir);
    fs.mkdirSync(path.join(paths.asideDir, 'uploads', '1'), { recursive: true });
    fs.writeFileSync(path.join(paths.asideDir, 'uploads', '1', 'photo.jpg'), 'only-copy');
    writeMarker(paths.markerPath, { stagingDir: paths.stagingDir, createdAt: new Date().toISOString() });

    const result = recoverInterruptedRestore(dataDir);

    expect(result.status).toBe('completed');
    const retired = retiredAsideDirs();
    expect(retired).toHaveLength(1);
    expect(result).toEqual({ status: 'completed', quarantinedAt: retired[0] });
  });

  it('clears leftover restore scratch space once a pending restore has been applied', async () => {
    seedCurrentState();
    const paths = await seedStaging();
    fs.mkdirSync(path.join(paths.scratchDir, 'source-abc123'), { recursive: true });
    fs.writeFileSync(path.join(paths.scratchDir, 'source-abc123', 'archive.tar.gz'), 'leftover');
    writeMarker(paths.markerPath, { stagingDir: paths.stagingDir, createdAt: new Date().toISOString() });

    recoverInterruptedRestore(dataDir);

    expect(fs.existsSync(paths.scratchDir)).toBe(false);
  });

  it('clears sessions.db even when it finds nothing left to swap', () => {
    seedCurrentState();
    fs.writeFileSync(path.join(dataDir, 'sessions.db-wal'), 'sessions-wal');
    const paths = restorePaths(dataDir);

    applySwap(paths);

    expect(fs.existsSync(path.join(dataDir, 'sessions.db'))).toBe(false);
    expect(fs.existsSync(path.join(dataDir, 'sessions.db-wal'))).toBe(false);
  });

  it('flushes the staged database to disk before renaming it into place', async () => {
    seedCurrentState();
    const paths = await seedStaging();
    const stagedDb = path.join(paths.stagingDir, 'sb-materials.db');

    // Track which descriptors belong to the staged database, then check that one
    // of them was fsynced: nothing else forces those contents out before the
    // rename makes them durably visible.
    const realOpenSync = fs.openSync;
    const stagedDbFds = new Set<number>();
    const fsyncedFds: number[] = [];
    const openSpy = vi.spyOn(fs, 'openSync').mockImplementation(((target: fs.PathLike, ...rest: unknown[]) => {
      const fd = (realOpenSync as (...args: unknown[]) => number)(target, ...rest);
      if (String(target) === stagedDb) stagedDbFds.add(fd);
      return fd;
    }) as typeof fs.openSync);
    const realFsyncSync = fs.fsyncSync;
    const fsyncSpy = vi.spyOn(fs, 'fsyncSync').mockImplementation((fd: number) => {
      fsyncedFds.push(fd);
      realFsyncSync(fd);
    });

    try {
      applySwap(paths);
    } finally {
      openSpy.mockRestore();
      fsyncSpy.mockRestore();
    }

    expect(stagedDbFds.size).toBeGreaterThan(0);
    expect(fsyncedFds.some((fd) => stagedDbFds.has(fd))).toBe(true);
    expect(fs.readFileSync(path.join(dataDir, 'sb-materials.db'), 'utf-8')).toBe('new-db');
  });

  it('recoverInterruptedRestore is a no-op when there is no marker', () => {
    expect(recoverInterruptedRestore(dataDir)).toEqual({ status: 'none' });
  });

  it('recoverInterruptedRestore completes a swap left behind by a marker', async () => {
    seedCurrentState();
    const paths = await seedStaging();
    writeMarker(paths.markerPath, { stagingDir: paths.stagingDir, createdAt: new Date().toISOString() });

    const result = recoverInterruptedRestore(dataDir);

    expect(result).toEqual({ status: 'completed', quarantinedAt: null });
    expect(fs.readFileSync(path.join(dataDir, 'sb-materials.db'), 'utf-8')).toBe('new-db');
    expect(readMarker(paths.markerPath)).toBeNull();
  });

  it('recoverInterruptedRestore still completes when the marker itself is unreadable', async () => {
    seedCurrentState();
    const paths = await seedStaging();
    fs.writeFileSync(paths.markerPath, '{"stagingDir": "trunca');

    const result = recoverInterruptedRestore(dataDir);

    expect(result).toEqual({ status: 'completed', quarantinedAt: null });
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
    expect(readMarker(paths.markerPath)).toEqual({
      stagingDir: paths.stagingDir,
      createdAt: '2026-08-13T00:00:00.000Z',
    });

    clearMarker(paths.markerPath);
    expect(readMarker(paths.markerPath)).toBeNull();

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });
});
