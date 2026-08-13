import { Router } from 'express';
import Database from 'better-sqlite3';
import multer from 'multer';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { Response } from 'express';
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

export function backupRoutes(db: Database.Database, deps: BackupRouteDeps): Router {
  const router = Router();
  router.use(requireSuperuser);

  const upload = multer({
    storage: multer.diskStorage({
      destination: (_req, _file, cb) => cb(null, os.tmpdir()),
      filename: (_req, _file, cb) => cb(null, `sb-restore-upload-${Date.now()}-${Math.round(Math.random() * 1e9)}.tar.gz`),
    }),
  });

  router.get('/', async (_req, res) => {
    res.json(await listArchives(deps.backupsDir));
  });

  router.post('/', async (_req, res) => {
    const result = await deps.coordinator.takeBackupNow('manual');
    res.json({ filename: result.filename });
  });

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

  router.post('/:file/restore', async (req, res) => {
    const match = resolveArchive(deps.backupsDir, req.params.file);
    if (!match) {
      res.status(404).json({ error: 'Archive not found' });
      return;
    }
    await performRestore(db, deps, path.join(deps.backupsDir, match), res);
  });

  router.post('/restore/upload', upload.single('archive'), async (req, res) => {
    if (!req.file) {
      res.status(400).json({ error: 'No archive uploaded' });
      return;
    }
    await performRestore(db, deps, req.file.path, res, true);
  });

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

  try {
    const manifest = await validateArchive(archivePath, computeSchemaFingerprint(db));

    await deps.coordinator.takeBackupNow('pre-restore');

    await stageArchive(archivePath, paths.stagingDir);
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
    throw err;
  }
}
