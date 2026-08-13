import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import * as tar from 'tar';
import { BACKUP_FORMAT_VERSION, BackupManifest } from './manifest';

export class RestoreValidationError extends Error {}

export interface RestorePaths {
  dataDir: string;
  stagingDir: string;
  asideDir: string;
  scratchDir: string;
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
    scratchDir: path.join(dataDir, '.restore-tmp'),
    markerPath: path.join(dataDir, '.restore-marker.json'),
  };
}

/**
 * Create a uniquely named temporary directory beneath `scratchRoot`, creating
 * the root itself if need be.
 *
 * Restore's scratch space deliberately lives under `DATA_DIR` rather than in
 * `os.tmpdir()`. Peak usage is roughly the uncompressed size of an archive (the
 * database plus the entire photo tree), and a systemd unit with
 * `PrivateTmp=yes` gets a private tmpfs sized as a fraction of RAM, so putting
 * it in the system temporary directory means a restore can run out of space
 * long before the volume the administrator actually sized for this data does,
 * and surface as an opaque 500.
 */
export function createScratchDir(scratchRoot: string, prefix: string): string {
  fs.mkdirSync(scratchRoot, { recursive: true });
  return fs.mkdtempSync(path.join(scratchRoot, prefix));
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
  currentSchemaVersion: number,
  scratchRoot: string,
): Promise<BackupManifest> {
  const scratchDir = createScratchDir(scratchRoot, 'validate-');
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

    // An archive with no recorded version predates this check entirely and is
    // treated as the oldest possible schema (0) — always restorable, same as
    // any other archive from before this build's migrations existed. Only an
    // archive from code *newer* than this build is refused: this build's
    // migrations were written without knowledge of whatever that code added.
    const archiveSchemaVersion = manifest.dbSchemaVersion ?? 0;
    if (archiveSchemaVersion > currentSchemaVersion) {
      throw new RestoreValidationError(
        `Archive requires database schema version ${archiveSchemaVersion}, but this application only supports up to version ${currentSchemaVersion}. Upgrade the application before restoring this archive.`,
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
 * Flush a file's contents to disk. `tar` writes the extracted files through the
 * page cache without ever fsyncing them, so without this a power cut shortly
 * after the swap could leave a durable rename pointing at a file whose data
 * blocks were never written, and recovery would see a database that is present
 * and therefore, as far as it can tell, already restored.
 */
function syncFile(filePath: string): void {
  let fd: number | undefined;
  try {
    fd = fs.openSync(filePath, 'r');
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
 * Retire the set-aside directory. If this run has already removed everything it
 * could show was superseded, whatever is left came from some earlier run that
 * never finished and might be the only surviving copy, so rather than delete it
 * the whole directory is renamed out of the way under a timestamped name and
 * left for a human to look at. An empty directory is simply removed.
 *
 * The rename also gets the leftovers out of the path of the next restore, which
 * would otherwise treat the set-aside directory as its own and overwrite them.
 */
function retireAsideDir(asideDir: string): string | null {
  try {
    fs.rmdirSync(asideDir);
    return null;
  } catch {
    /* absent, or not empty: fall through and deal with the leftovers */
  }
  if (!fs.existsSync(asideDir)) return null;

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  for (let attempt = 0; ; attempt += 1) {
    const target = `${asideDir}-${stamp}${attempt === 0 ? '' : `-${attempt}`}`;
    if (fs.existsSync(target)) continue;
    fs.renameSync(asideDir, target);
    return target;
  }
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
 *   - Staged copy absent and a live copy present: that item is already done, so
 *     nothing is moved. Moving a completed swap's result aside again would put
 *     the restored data somewhere the next run would treat as discardable.
 *   - Staged copy absent and no live copy, but a set-aside original: the swap
 *     was interrupted between the two renames and the staged copy has since
 *     been lost, so roll the original back rather than leave a hole.
 *
 * Because `rename` is atomic, an item is always in exactly one of those states,
 * never halfway between two of them.
 *
 * CONTRACT, and it is not a soft one: nothing else may create, move or restore
 * either the database or the uploads directory inside `dataDir` before this has
 * run to completion. The classification above reads "no staged copy but a live
 * copy" as "already swapped", so anything that recreates `sb-materials.db` or
 * `uploads/` ahead of time (a stray `mkdirSync` for the uploads directory being
 * the obvious candidate) makes an interrupted restore look finished and strands
 * the originals. In practice that means `recoverInterruptedRestore` must be the
 * very first thing the process does with the data directory, ahead of any
 * directory creation, any migration and any database connection. As a second
 * line of defence this function never deletes the set-aside directory wholesale:
 * it removes only those originals whose replacement it has itself carried out,
 * and retires anything else to a timestamped `.restore-aside-<when>` directory,
 * so a misordered caller costs some stale files left behind for a human to sort
 * out rather than the only copy of the data.
 *
 * Returns the path of that quarantine directory when one was created, so the
 * caller can say so out loud: files nobody knows about are files nobody
 * recovers, and this is precisely the situation the design takes the most
 * trouble to protect.
 */
export function applySwap(paths: RestorePaths): { quarantinedAt: string | null } {
  const { dataDir, stagingDir, asideDir } = paths;

  const stagedDb = path.join(stagingDir, DB_FILE);
  const stagedUploads = path.join(stagingDir, UPLOADS_DIR);
  const liveDb = path.join(dataDir, DB_FILE);
  const liveUploads = path.join(dataDir, UPLOADS_DIR);
  const asideDb = path.join(asideDir, DB_FILE);
  const asideUploads = path.join(asideDir, UPLOADS_DIR);

  const dbPending = fs.existsSync(stagedDb);
  const uploadsPending = fs.existsSync(stagedUploads);
  let dbSwapped = false;
  let uploadsSwapped = false;

  if (dbPending || uploadsPending) {
    fs.mkdirSync(asideDir, { recursive: true });
  }

  if (dbPending) {
    // `tar` extracted this file through the page cache without ever flushing
    // it, and the rename below lands it on a path `moveAside` has just vacated
    // rather than over an existing file, so nothing else is going to force the
    // contents out for us: flush them now, whilst the originals are still here.
    syncFile(stagedDb);
    moveAside(liveDb, asideDb);
    // The restored database is a checkpointed copy, so the live write-ahead log
    // and shared-memory files belong to the database being replaced and must go
    // with it; leaving them behind would corrupt the restored database.
    for (const sidecar of DB_SIDECARS) {
      moveAside(path.join(dataDir, sidecar), path.join(asideDir, sidecar));
    }
    fs.renameSync(stagedDb, liveDb);
    dbSwapped = true;
  } else if (!fs.existsSync(liveDb)) {
    moveBack(asideDb, liveDb);
    for (const sidecar of DB_SIDECARS) {
      moveBack(path.join(asideDir, sidecar), path.join(dataDir, sidecar));
    }
  }

  if (uploadsPending) {
    moveAside(liveUploads, asideUploads);
    fs.renameSync(stagedUploads, liveUploads);
    uploadsSwapped = true;
  } else if (!fs.existsSync(liveUploads)) {
    moveBack(asideUploads, liveUploads);
  }

  // Sessions are tied to the database that has just been replaced, so everybody
  // is logged out rather than left holding a stale session. Done unconditionally
  // on every call, including one that finds nothing left to do: a crash between
  // the last rename and this point would otherwise leave pre-restore sessions
  // authenticated against restored data, and the cost of being over-eager is at
  // worst one unnecessary login.
  for (const sessionFile of SESSION_FILES) {
    fs.rmSync(path.join(dataDir, sessionFile), { force: true });
  }

  syncDir(dataDir);

  // Discard only the originals this call has itself superseded, by performing
  // the swap that replaced them. Anything else in the set-aside directory came
  // from an earlier run that never finished, and may be the last copy of it in
  // existence, so it is retired to a timestamped directory instead of being
  // deleted; a wholesale delete here is how the only copy of somebody's photos
  // goes missing.
  if (dbSwapped) {
    fs.rmSync(asideDb, { force: true });
    for (const sidecar of DB_SIDECARS) {
      fs.rmSync(path.join(asideDir, sidecar), { force: true });
    }
  }
  if (uploadsSwapped) {
    fs.rmSync(asideUploads, { recursive: true, force: true });
  }
  const quarantinedAt = retireAsideDir(asideDir);
  fs.rmSync(stagingDir, { recursive: true, force: true });
  syncDir(dataDir);

  return { quarantinedAt };
}

/**
 * Called at startup, and it must be called before anything else so much as
 * looks at the data directory: not merely before the database is opened, but
 * before any code creates the uploads directory, runs a migration or otherwise
 * puts a file where `applySwap` expects to find either a hole or an original.
 * See the contract on `applySwap` for why that ordering matters.
 *
 * A marker means a restore was in flight when the process last stopped, so the
 * swap is re-run to convergence; the marker's contents are deliberately not
 * trusted, since the paths are derived from `dataDir` and the swap has to cope
 * with an unreadable marker just as safely as with a readable one.
 *
 * `quarantinedAt`, when set, names a directory holding data the swap declined to
 * delete because it could not show it had been superseded. It is reported back
 * so that the caller can log it prominently rather than leaving a directory of
 * possibly irreplaceable photos sitting silently in the data directory.
 */
export type RestoreRecovery = { status: 'none' } | { status: 'completed'; quarantinedAt: string | null };

export function recoverInterruptedRestore(dataDir: string): RestoreRecovery {
  const paths = restorePaths(dataDir);
  if (!fs.existsSync(paths.markerPath)) return { status: 'none' };

  const { quarantinedAt } = applySwap(paths);
  clearMarker(paths.markerPath);
  // Any scratch space left behind by the restore that wrote the marker is dead
  // weight once the swap has been applied, and can be large.
  fs.rmSync(paths.scratchDir, { recursive: true, force: true });
  return { status: 'completed', quarantinedAt };
}
