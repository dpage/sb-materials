import Database from 'better-sqlite3';
import sharp from 'sharp';
import path from 'path';
import fs from 'fs';
import { archiveImageFile, ARCHIVE_MAX_DIM } from '../utils/image';
import { logger } from '../utils/logger';

export interface MigrateImagesStats {
  processed: number;
  skipped: number;
  missing: number;
  failed: number;
  bytesSaved: number;
}

/**
 * One-time backfill: downscale existing report photos to the archival JPEG
 * format used for new uploads, reclaiming the storage taken up by full-size
 * originals uploaded before resizing was added.
 *
 * Idempotent — a photo that is already a JPEG within the archival dimensions is
 * left untouched, so this is safe to re-run.
 */
export async function migrateImages(db: Database.Database, uploadsDir: string): Promise<MigrateImagesStats> {
  const stats: MigrateImagesStats = { processed: 0, skipped: 0, missing: 0, failed: 0, bytesSaved: 0 };
  const photos = db.prepare('SELECT id, file_path FROM report_photos').all() as { id: number; file_path: string }[];
  const updateStmt = db.prepare('UPDATE report_photos SET file_path = ? WHERE id = ?');

  for (const photo of photos) {
    const absPath = path.resolve(uploadsDir, photo.file_path);
    if (!fs.existsSync(absPath)) {
      stats.missing++;
      logger.warn(`migrate-images: file missing for photo ${photo.id}: ${photo.file_path}`);
      continue;
    }

    try {
      const meta = await sharp(absPath).metadata();
      const longEdge = Math.max(meta.width ?? 0, meta.height ?? 0);
      if (meta.format === 'jpeg' && longEdge <= ARCHIVE_MAX_DIM) {
        stats.skipped++;
        continue;
      }

      const sizeBefore = fs.statSync(absPath).size;
      const newAbsPath = await archiveImageFile(absPath);
      const sizeAfter = fs.statSync(newAbsPath).size;
      stats.bytesSaved += Math.max(0, sizeBefore - sizeAfter);

      const newRel = path.relative(uploadsDir, newAbsPath);
      if (newRel !== photo.file_path) {
        updateStmt.run(newRel, photo.id);
      }
      stats.processed++;
    } catch (err) {
      stats.failed++;
      logger.error(`migrate-images: failed to process photo ${photo.id} (${photo.file_path}):`, err);
    }
  }

  return stats;
}
