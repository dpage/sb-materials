import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import { logger } from '../utils/logger';

export interface OrphanFile {
  /** Path relative to the uploads directory, as it would be stored in the DB. */
  relPath: string;
  bytes: number;
}

export interface OrphanSweepResult {
  /** Every file found on disk under the uploads directory. */
  scanned: number;
  /** Files on disk with no row in the database referencing them. */
  orphans: OrphanFile[];
  orphanBytes: number;
  /** Distinct file paths referenced by the database (whether or not present). */
  referenced: number;
  /** Files actually removed; zero unless `deleteFiles` was set. */
  deleted: number;
  /** True when the safety check below refused to delete anything. */
  refused: boolean;
}

export interface SweepOptions {
  /** Remove the orphans rather than only reporting them. Defaults to false. */
  deleteFiles?: boolean;
  /** Override the refusal below, for the legitimate case of an empty database. */
  force?: boolean;
}

/**
 * Every file path the database knows about, relative to the uploads directory.
 *
 * The collection note signature columns are read defensively because older
 * databases predate them, and a missing column must not turn the whole of
 * uploads into "unreferenced".
 */
function referencedPaths(db: Database.Database): Set<string> {
  const paths = new Set<string>();
  const add = (value: unknown) => {
    if (typeof value === 'string' && value.length > 0) paths.add(normalise(value));
  };

  for (const row of db.prepare('SELECT file_path FROM report_photos').all() as { file_path: string }[]) {
    add(row.file_path);
  }
  for (const row of db.prepare('SELECT signature_path FROM reports WHERE signature_path IS NOT NULL').all() as {
    signature_path: string;
  }[]) {
    add(row.signature_path);
  }

  const noteColumns = (db.prepare('PRAGMA table_info(collection_notes)').all() as { name: string }[])
    .map((c) => c.name)
    .filter((name) => name.endsWith('_signature_path'));
  for (const column of noteColumns) {
    for (const row of db
      .prepare(`SELECT "${column}" AS p FROM collection_notes WHERE "${column}" IS NOT NULL`)
      .all() as {
      p: string;
    }[]) {
      add(row.p);
    }
  }

  return paths;
}

/** Normalise a stored or discovered path so the two sides compare equal. */
function normalise(relPath: string): string {
  return path.normalize(relPath).split(path.sep).join('/');
}

function walk(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    return entry.isDirectory() ? walk(full) : [full];
  });
}

/** Remove directories left empty by the sweep, deepest first. */
function pruneEmptyDirs(root: string): void {
  const dirs: string[] = [];
  const collect = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        const full = path.join(dir, entry.name);
        dirs.push(full);
        collect(full);
      }
    }
  };
  collect(root);

  for (const dir of dirs.sort((a, b) => b.length - a.length)) {
    try {
      if (fs.readdirSync(dir).length === 0) fs.rmdirSync(dir);
    } catch (err) {
      logger.warn(`sweep-orphans: could not remove empty directory ${dir}:`, err);
    }
  }
}

/**
 * Find (and optionally delete) files under the uploads directory that no
 * database row refers to.
 *
 * These accumulate because deleting a report or collection note used to drop
 * the rows and leave the images behind; that leak is fixed, but the historical
 * debris still needs clearing, and an interrupted upload can strand a file at
 * any time.
 *
 * As a guard against being pointed at the wrong database, a sweep that finds
 * files on disk but no references at all deletes nothing unless `force` is set:
 * that combination almost always means an empty or unrelated database rather
 * than an installation whose every image is genuinely orphaned.
 */
export function sweepOrphanedUploads(
  db: Database.Database,
  uploadsDir: string,
  options: SweepOptions = {},
): OrphanSweepResult {
  const root = path.resolve(uploadsDir);
  const result: OrphanSweepResult = {
    scanned: 0,
    orphans: [],
    orphanBytes: 0,
    referenced: 0,
    deleted: 0,
    refused: false,
  };

  if (!fs.existsSync(root)) return result;

  const referenced = referencedPaths(db);
  result.referenced = referenced.size;

  for (const absPath of walk(root)) {
    result.scanned++;
    const relPath = normalise(path.relative(root, absPath));
    if (referenced.has(relPath)) continue;

    let bytes: number;
    try {
      bytes = fs.statSync(absPath).size;
    } catch {
      continue; // vanished under us; nothing to report or delete
    }
    result.orphans.push({ relPath, bytes });
    result.orphanBytes += bytes;
  }

  result.orphans.sort((a, b) => b.bytes - a.bytes);

  if (!options.deleteFiles || result.orphans.length === 0) return result;

  if (referenced.size === 0 && !options.force) {
    logger.warn(
      `sweep-orphans: the database references no files at all but ${result.scanned} exist on disk; ` +
        'refusing to delete. Check DATA_DIR points at the right installation, then re-run with --force.',
    );
    result.refused = true;
    return result;
  }

  for (const orphan of result.orphans) {
    const absPath = path.join(root, orphan.relPath);
    try {
      fs.rmSync(absPath, { force: true });
      result.deleted++;
    } catch (err) {
      logger.error(`sweep-orphans: failed to delete ${absPath}:`, err);
    }
  }

  pruneEmptyDirs(root);
  return result;
}
