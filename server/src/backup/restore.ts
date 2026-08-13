import Database from 'better-sqlite3';
import fs from 'fs';
import os from 'os';
import path from 'path';
import crypto from 'crypto';
import * as tar from 'tar';
import { BACKUP_FORMAT_VERSION, BackupManifest } from './manifest';

export class RestoreValidationError extends Error {}

export interface RestorePaths {
  dataDir: string;
  stagingDir: string;
  asideDir: string;
  markerPath: string;
}

const DB_FILE = 'sb-materials.db';
const DB_SIDECARS = ['sb-materials.db-wal', 'sb-materials.db-shm'];
const UPLOADS_DIR = 'uploads';
const SESSION_FILES = ['sessions.db', 'sessions.db-wal', 'sessions.db-shm'];

export function restorePaths(dataDir: string): RestorePaths {
  return {
    dataDir,
    stagingDir: path.join(dataDir, '.restore-staging'),
    asideDir: path.join(dataDir, '.restore-aside'),
    markerPath: path.join(dataDir, '.restore-marker.json'),
  };
}

async function extractArchive(archivePath: string, destDir: string): Promise<void> {
  fs.mkdirSync(destDir, { recursive: true });
  await tar.extract({ file: archivePath, cwd: destDir });
}

function sha256File(filePath: string): string {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

export async function validateArchive(
  archivePath: string,
  currentSchemaFingerprint: Record<string, string[]>,
): Promise<BackupManifest> {
  const scratchDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-restore-validate-'));
  try {
    try {
      await extractArchive(archivePath, scratchDir);
    } catch {
      throw new RestoreValidationError('The file is not a valid gzip tar archive');
    }

    const manifestPath = path.join(scratchDir, 'manifest.json');
    if (!fs.existsSync(manifestPath)) {
      throw new RestoreValidationError('Archive is missing manifest.json');
    }
    let manifest: BackupManifest;
    try {
      manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
    } catch {
      throw new RestoreValidationError('Archive manifest.json is not valid JSON');
    }

    if (manifest.formatVersion !== BACKUP_FORMAT_VERSION) {
      throw new RestoreValidationError(
        `Archive format version ${manifest.formatVersion} is not supported by this version of the application`,
      );
    }

    const dbPath = path.join(scratchDir, DB_FILE);
    if (!fs.existsSync(dbPath)) {
      throw new RestoreValidationError(`Archive is missing ${DB_FILE}`);
    }

    if (sha256File(dbPath) !== manifest.dbSha256) {
      throw new RestoreValidationError('Database checksum does not match the manifest; the archive may be corrupt');
    }

    let quickCheck: { quick_check: string }[];
    let checkDb: Database.Database;
    try {
      checkDb = new Database(dbPath, { readonly: true });
    } catch {
      throw new RestoreValidationError('The database in the archive could not be opened; it may be corrupt');
    }
    try {
      quickCheck = checkDb.pragma('quick_check') as { quick_check: string }[];
    } catch {
      throw new RestoreValidationError('The database in the archive failed an integrity check');
    } finally {
      checkDb.close();
    }
    if (quickCheck.length !== 1 || quickCheck[0].quick_check !== 'ok') {
      throw new RestoreValidationError('The database in the archive failed an integrity check');
    }

    if (JSON.stringify(manifest.schemaFingerprint) !== JSON.stringify(currentSchemaFingerprint)) {
      throw new RestoreValidationError(
        'The archive was taken against a different database schema and cannot be restored by this version of the application',
      );
    }

    return manifest;
  } finally {
    fs.rmSync(scratchDir, { recursive: true, force: true });
  }
}

export async function stageArchive(archivePath: string, stagingDir: string): Promise<void> {
  fs.rmSync(stagingDir, { recursive: true, force: true });
  await extractArchive(archivePath, stagingDir);
  syncDir(stagingDir);
}

export interface RestoreMarker {
  stagingDir: string;
  createdAt: string;
}

/**
 * Flush a directory entry to disk, so that renames and unlinks performed inside
 * it survive a power cut rather than sitting in the page cache. Not every
 * platform allows a directory to be opened for fsync, hence the swallowed error.
 */
function syncDir(dirPath: string): void {
  let fd: number | undefined;
  try {
    fd = fs.openSync(dirPath, 'r');
    fs.fsyncSync(fd);
  } catch {
    /* best effort only */
  } finally {
    if (fd !== undefined) {
      try {
        fs.closeSync(fd);
      } catch {
        /* best effort only */
      }
    }
  }
}

/**
 * Written by way of a temporary file and a rename, so that a crash midway
 * through can never leave a half-written marker behind: the marker either
 * exists in full or does not exist at all.
 */
export function writeMarker(markerPath: string, marker: RestoreMarker): void {
  const tmpPath = `${markerPath}.tmp`;
  const fd = fs.openSync(tmpPath, 'w');
  try {
    fs.writeFileSync(fd, JSON.stringify(marker));
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  fs.renameSync(tmpPath, markerPath);
  syncDir(path.dirname(markerPath));
}

export function readMarker(markerPath: string): RestoreMarker | null {
  if (!fs.existsSync(markerPath)) return null;
  try {
    return JSON.parse(fs.readFileSync(markerPath, 'utf-8')) as RestoreMarker;
  } catch {
    return null;
  }
}

export function clearMarker(markerPath: string): void {
  fs.rmSync(markerPath, { force: true });
  syncDir(path.dirname(markerPath));
}

/**
 * Move `src` out of the way to `dest`, discarding anything already sitting at
 * `dest`. Only ever called when the staged replacement for `src` is still
 * waiting to be swapped in, which means anything at `dest` is a superseded
 * copy left behind by an earlier, already-completed restore.
 */
function moveAside(src: string, dest: string): void {
  if (!fs.existsSync(src)) return;
  fs.rmSync(dest, { recursive: true, force: true });
  fs.renameSync(src, dest);
}

/** Move `src` back to `dest` if, and only if, `dest` is vacant. */
function moveBack(src: string, dest: string): void {
  if (fs.existsSync(src) && !fs.existsSync(dest)) {
    fs.renameSync(src, dest);
  }
}

/**
 * Swap the staged restore into place.
 *
 * Idempotent, and safe to re-run after a crash at any point: every decision is
 * driven by what is actually on disk rather than by how far a previous run got,
 * and the single question that drives each item is whether its staged copy is
 * still waiting to be swapped in.
 *
 *   - Staged copy present: the swap for that item has not happened yet, so the
 *     live copy is still the original and is moved aside before the staged copy
 *     is renamed into place.
 *   - Staged copy absent and a live copy present: that item is already done.
 *     Nothing is moved, which matters because the set-aside originals are
 *     deleted at the end of this function; moving a completed swap's result
 *     aside again would destroy the restored data.
 *   - Staged copy absent and no live copy, but a set-aside original: the swap
 *     was interrupted between the two renames and the staged copy has since
 *     been lost, so roll the original back rather than leave a hole.
 *
 * Because `rename` is atomic, an item is always in exactly one of those states,
 * never halfway between two of them.
 */
export function applySwap(paths: RestorePaths): void {
  const { dataDir, stagingDir, asideDir } = paths;

  const stagedDb = path.join(stagingDir, DB_FILE);
  const stagedUploads = path.join(stagingDir, UPLOADS_DIR);
  const liveDb = path.join(dataDir, DB_FILE);
  const liveUploads = path.join(dataDir, UPLOADS_DIR);
  const asideDb = path.join(asideDir, DB_FILE);
  const asideUploads = path.join(asideDir, UPLOADS_DIR);

  const dbPending = fs.existsSync(stagedDb);
  const uploadsPending = fs.existsSync(stagedUploads);
  const anyPending = dbPending || uploadsPending;

  if (anyPending) {
    fs.mkdirSync(asideDir, { recursive: true });
  }

  if (dbPending) {
    moveAside(liveDb, asideDb);
    // The restored database is a checkpointed copy, so the live write-ahead log
    // and shared-memory files belong to the database being replaced and must go
    // with it; leaving them behind would corrupt the restored database.
    for (const sidecar of DB_SIDECARS) {
      moveAside(path.join(dataDir, sidecar), path.join(asideDir, sidecar));
    }
    fs.renameSync(stagedDb, liveDb);
  } else if (!fs.existsSync(liveDb)) {
    moveBack(asideDb, liveDb);
    for (const sidecar of DB_SIDECARS) {
      moveBack(path.join(asideDir, sidecar), path.join(dataDir, sidecar));
    }
  }

  if (uploadsPending) {
    moveAside(liveUploads, asideUploads);
    fs.renameSync(stagedUploads, liveUploads);
  } else if (!fs.existsSync(liveUploads)) {
    moveBack(asideUploads, liveUploads);
  }

  if (anyPending) {
    // Sessions are tied to the database that has just been replaced, so
    // everybody is logged out rather than left holding a stale session.
    for (const sessionFile of SESSION_FILES) {
      fs.rmSync(path.join(dataDir, sessionFile), { force: true });
    }
  }

  syncDir(dataDir);
  fs.rmSync(asideDir, { recursive: true, force: true });
  fs.rmSync(stagingDir, { recursive: true, force: true });
  syncDir(dataDir);
}

/**
 * Called at startup, before anything opens the database. A marker means a
 * restore was in flight when the process last stopped, so the swap is re-run to
 * convergence; the marker's contents are deliberately not trusted, since the
 * paths are derived from `dataDir` and the swap has to cope with an unreadable
 * marker just as safely as with a readable one.
 */
export function recoverInterruptedRestore(dataDir: string): 'none' | 'completed' {
  const paths = restorePaths(dataDir);
  if (!fs.existsSync(paths.markerPath)) return 'none';

  applySwap(paths);
  clearMarker(paths.markerPath);
  return 'completed';
}
