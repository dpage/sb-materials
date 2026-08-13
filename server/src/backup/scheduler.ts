import Database from 'better-sqlite3';
import { getSetting, setSetting } from '../utils/settings';
import { createArchive, pruneRetention } from './archive';
import { BackupKind, BackupManifest } from './manifest';

export const BACKUP_ENABLED_SETTING = 'backup.enabled';
export const BACKUP_HOUR_SETTING = 'backup.hour';
export const BACKUP_KEEP_SETTING = 'backup.keep';
export const BACKUP_LAST_RUN_SETTING = 'backup.last_run';

export const DEFAULT_BACKUP_HOUR = 2;
export const DEFAULT_BACKUP_KEEP = 14;

/**
 * Read a whole-number setting, falling back to the default for anything that is
 * not one. The API validates both of these on the way in, so this is defence in
 * depth against a hand-edited or corrupted `app_settings` row: a NaN retention
 * count would reach `pruneRetention`'s `group.slice()` and behave as `slice(0)`,
 * deleting every scheduled and manual archive, and a NaN hour would silently
 * stop scheduled backups happening at all.
 */
function readIntSetting(db: Database.Database, key: string, fallback: number): number {
  const parsed = parseInt(getSetting(db, key, String(fallback)), 10);
  return Number.isInteger(parsed) ? parsed : fallback;
}

export function isBackupDue(lastRunIso: string | null, hour: number, now: Date): boolean {
  const due = new Date(now);
  due.setUTCHours(hour, 0, 0, 0);
  if (now < due) return false;
  if (!lastRunIso) return true;
  return new Date(lastRunIso) < due;
}

export class BackupCoordinator {
  private queue: Promise<unknown> = Promise.resolve();
  private busy = false;

  constructor(
    private db: Database.Database,
    private backupsDir: string,
    private uploadsDir: string,
  ) {}

  async takeBackupNow(kind: BackupKind): Promise<{ filename: string; path: string; manifest: BackupManifest }> {
    return this.enqueue(() => this.run(kind));
  }

  async tick(now: Date = new Date()): Promise<void> {
    if (this.busy) return;

    const enabled = getSetting(this.db, BACKUP_ENABLED_SETTING, 'true') === 'true';
    if (!enabled) return;

    const hour = readIntSetting(this.db, BACKUP_HOUR_SETTING, DEFAULT_BACKUP_HOUR);
    const lastRun = getSetting(this.db, BACKUP_LAST_RUN_SETTING, '');
    if (!isBackupDue(lastRun || null, hour, now)) return;

    await this.enqueue(async () => {
      await this.run('scheduled');
      setSetting(this.db, BACKUP_LAST_RUN_SETTING, now.toISOString());
    });
  }

  private async run(kind: BackupKind) {
    const result = await createArchive({ db: this.db, backupsDir: this.backupsDir, uploadsDir: this.uploadsDir, kind });
    const keep = readIntSetting(this.db, BACKUP_KEEP_SETTING, DEFAULT_BACKUP_KEEP);
    pruneRetention(this.backupsDir, keep);
    return result;
  }

  private enqueue<T>(fn: () => Promise<T>): Promise<T> {
    this.busy = true;
    const result = this.queue.then(fn);
    this.queue = result.then(
      () => {
        this.busy = false;
      },
      () => {
        this.busy = false;
      },
    );
    return result;
  }
}
