import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { createSchema } from '../db/schema';
import { seedData } from '../db/seed';
import { getSetting, setSetting } from '../utils/settings';
import {
  isBackupDue,
  BackupCoordinator,
  BACKUP_LAST_RUN_SETTING,
  BACKUP_ENABLED_SETTING,
  BACKUP_HOUR_SETTING,
} from '../backup/scheduler';
import { listArchives } from '../backup/archive';

describe('isBackupDue', () => {
  it('is due when now is past the hour and there is no last run', () => {
    expect(isBackupDue(null, 2, new Date('2026-08-13T03:00:00Z'))).toBe(true);
  });

  it('is not due before the scheduled hour', () => {
    expect(isBackupDue(null, 2, new Date('2026-08-13T01:00:00Z'))).toBe(false);
  });

  it("is not due again the same day once last run is after today's due-time", () => {
    expect(isBackupDue('2026-08-13T02:05:00Z', 2, new Date('2026-08-13T03:00:00Z'))).toBe(false);
  });

  it("is due again the next day even if last run was after yesterday's due-time", () => {
    expect(isBackupDue('2026-08-13T02:05:00Z', 2, new Date('2026-08-14T03:00:00Z'))).toBe(true);
  });

  it('is due shortly after boot when the box was off overnight and missed its window', () => {
    expect(isBackupDue('2026-08-11T02:05:00Z', 2, new Date('2026-08-13T09:00:00Z'))).toBe(true);
  });
});

describe('BackupCoordinator', () => {
  let db: Database.Database;
  let tmpDir: string;
  let backupsDir: string;
  let uploadsDir: string;

  beforeEach(() => {
    db = new Database(':memory:');
    db.pragma('journal_mode = WAL');
    createSchema(db);
    seedData(db);

    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-scheduler-test-'));
    backupsDir = path.join(tmpDir, 'backups');
    uploadsDir = path.join(tmpDir, 'uploads');
    fs.mkdirSync(uploadsDir, { recursive: true });
  });

  afterEach(() => {
    db.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('takeBackupNow creates an archive and prunes retention', async () => {
    setSetting(db, 'backup.keep', '1');
    const coordinator = new BackupCoordinator(db, backupsDir, uploadsDir);

    await coordinator.takeBackupNow('manual');
    await coordinator.takeBackupNow('manual');

    const listing = await listArchives(backupsDir);
    expect(listing).toHaveLength(1);
  });

  it('tick takes a scheduled backup and records last_run when due', async () => {
    setSetting(db, BACKUP_HOUR_SETTING, '2');
    const coordinator = new BackupCoordinator(db, backupsDir, uploadsDir);

    await coordinator.tick(new Date('2026-08-13T03:00:00Z'));

    const listing = await listArchives(backupsDir);
    expect(listing).toHaveLength(1);
    expect(listing[0].kind).toBe('scheduled');
    expect(getSetting(db, BACKUP_LAST_RUN_SETTING, '')).toBe('2026-08-13T03:00:00.000Z');
  });

  it('tick does nothing when backups are disabled', async () => {
    setSetting(db, BACKUP_ENABLED_SETTING, 'false');
    setSetting(db, BACKUP_HOUR_SETTING, '2');
    const coordinator = new BackupCoordinator(db, backupsDir, uploadsDir);

    await coordinator.tick(new Date('2026-08-13T03:00:00Z'));

    expect(await listArchives(backupsDir)).toHaveLength(0);
  });

  it('tick does nothing when not yet due', async () => {
    setSetting(db, BACKUP_HOUR_SETTING, '2');
    const coordinator = new BackupCoordinator(db, backupsDir, uploadsDir);

    await coordinator.tick(new Date('2026-08-13T01:00:00Z'));

    expect(await listArchives(backupsDir)).toHaveLength(0);
  });

  it('serialises a manual backup against a concurrent scheduled tick so only one runs at a time', async () => {
    setSetting(db, BACKUP_HOUR_SETTING, '2');
    const coordinator = new BackupCoordinator(db, backupsDir, uploadsDir);

    const [manual] = await Promise.all([
      coordinator.takeBackupNow('manual'),
      coordinator.tick(new Date('2026-08-13T03:00:00Z')),
    ]);

    expect(manual.filename).toContain('manual');
    const listing = await listArchives(backupsDir);
    expect(listing.length).toBeGreaterThanOrEqual(1);
    expect(listing.length).toBeLessThanOrEqual(2);
  });
});
