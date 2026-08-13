import { Router } from 'express';
import Database from 'better-sqlite3';
import multer from 'multer';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { Request, Response } from 'express';
import { requireSuperuser } from '../middleware/auth';
import { listArchives, computeSchemaFingerprint } from '../backup/archive';
import { validateArchive, stageArchive, restorePaths, writeMarker, RestoreValidationError } from '../backup/restore';
import { BackupCoordinator } from '../backup/scheduler';
import { logger } from '../utils/logger';

export interface BackupRouteDeps {
  dataDir: string;
  backupsDir: string;
  uploadsDir: string;
  coordinator: BackupCoordinator;
  closeAndRestart: () => void;
}

function resolveArchive(backupsDir: string, requested: string): string | null {
  const listing = fs.existsSync(backupsDir) ? fs.readdirSync(backupsDir) : [];
  return listing.find((name) => name === requested) ?? null;
}

/**
 * Wrap an async route handler so a rejected promise can never escape uncaught.
 * Express 4 does not await handlers or catch their rejections, so without this
 * any unexpected error (as opposed to one already turned into a response) would
 * become an unhandled rejection and, on Node's current default behaviour, take
 * the whole process down for every user rather than just failing the one
 * request.
 */
function asyncRoute<P extends Record<string, string> = Record<string, never>>(
  handler: (req: Request<P>, res: Response) => Promise<void>,
) {
  return async (req: Request<P>, res: Response): Promise<void> => {
    try {
      await handler(req, res);
    } catch (err) {
      logger.error('Unexpected error in backups route:', err);
      if (!res.headersSent) {
        res.status(500).json({ error: 'Unexpected error' });
      }
    }
  };
}

export function backupRoutes(db: Database.Database, deps: BackupRouteDeps): Router {
  const router = Router();
  router.use(requireSuperuser);

  const upload = multer({
    storage: multer.diskStorage({
      destination: (_req, _file, cb) => cb(null, os.tmpdir()),
      filename: (_req, _file, cb) => cb(null, `sb-restore-upload-${Date.now()}-${Math.round(Math.random() * 1e9)}.tar.gz`),
    }),
  });

  router.get(
    '/',
    asyncRoute(async (_req, res) => {
      res.json(await listArchives(deps.backupsDir));
    }),
  );

  router.post(
    '/',
    asyncRoute(async (_req, res) => {
      const result = await deps.coordinator.takeBackupNow('manual');
      res.json({ filename: result.filename });
    }),
  );

  router.get('/:file/download', (req, res) => {
    const match = resolveArchive(deps.backupsDir, req.params.file);
    if (!match) {
      res.status(404).json({ error: 'Archive not found' });
      return;
    }
    res.download(path.join(deps.backupsDir, match));
  });

  router.delete('/:file', (req, res) => {
    const match = resolveArchive(deps.backupsDir, req.params.file);
    if (!match) {
      res.status(404).json({ error: 'Archive not found' });
      return;
    }
    fs.unlinkSync(path.join(deps.backupsDir, match));
    res.json({ ok: true });
  });

  router.post(
    '/:file/restore',
    asyncRoute<{ file: string }>(async (req, res) => {
      const match = resolveArchive(deps.backupsDir, req.params.file);
      if (!match) {
        res.status(404).json({ error: 'Archive not found' });
        return;
      }
      await performRestore(db, deps, path.join(deps.backupsDir, match), res);
    }),
  );

  router.post(
    '/restore/upload',
    upload.single('archive'),
    asyncRoute(async (req, res) => {
      if (!req.file) {
        res.status(400).json({ error: 'No archive uploaded' });
        return;
      }
      await performRestore(db, deps, req.file.path, res, true);
    }),
  );

  return router;
}

async function performRestore(
  db: Database.Database,
  deps: BackupRouteDeps,
  archivePath: string,
  res: Response,
  cleanupSourceAfter = false,
): Promise<void> {
  const paths = restorePaths(deps.dataDir);

  if (fs.existsSync(paths.markerPath)) {
    if (cleanupSourceAfter) fs.rmSync(archivePath, { force: true });
    res.status(409).json({ error: 'A previous restore did not finish cleanly; restart the service before trying again' });
    return;
  }

  let scratchDir: string | null = null;
  try {
    const manifest = await validateArchive(archivePath, computeSchemaFingerprint(db));

    // Copy the archive to a scratch location outside `backupsDir` before taking
    // the pre-restore snapshot below. `takeBackupNow` unconditionally prunes
    // `backupsDir` down to the current `backup.keep` setting as a side effect of
    // creating any archive, including this one, so if the on-disk archive being
    // restored is already beyond that limit (e.g. `keep` was lowered after it
    // was created), pruning would delete it out from under `stageArchive` below.
    // An uploaded archive already lives outside `backupsDir` (in `os.tmpdir()`
    // via multer), so this can never bite the upload path, but copying
    // unconditionally keeps both paths on one code path.
    scratchDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-restore-source-'));
    const scratchPath = path.join(scratchDir, 'archive.tar.gz');
    fs.copyFileSync(archivePath, scratchPath);

    await deps.coordinator.takeBackupNow('pre-restore');

    await stageArchive(scratchPath, paths.stagingDir);
    if (cleanupSourceAfter) fs.rmSync(archivePath, { force: true });

    writeMarker(paths.markerPath, { stagingDir: paths.stagingDir, createdAt: new Date().toISOString() });

    res.json({ ok: true, manifest });

    setImmediate(() => {
      try {
        deps.closeAndRestart();
      } catch (err) {
        logger.error('Failed to restart after restore:', err);
      }
    });
  } catch (err) {
    if (cleanupSourceAfter) fs.rmSync(archivePath, { force: true });
    if (err instanceof RestoreValidationError) {
      res.status(400).json({ error: err.message });
      return;
    }
    // Anything else is unexpected (e.g. disk full mid-extract, a failed fsync
    // or rename while writing the marker). The data itself stays safe here —
    // no marker gets written, so a retry or restart just picks the restore back
    // up — but an uncaught throw from an async Express handler becomes an
    // unhandled rejection with no global handler installed, which takes the
    // whole multi-user process down. Log it and fail just this request instead.
    logger.error('Unexpected error during restore:', err);
    if (!res.headersSent) {
      res.status(500).json({ error: 'Restore failed unexpectedly' });
    }
  } finally {
    if (scratchDir) fs.rmSync(scratchDir, { recursive: true, force: true });
  }
}
