import Database from 'better-sqlite3';
import { config } from '../config';
import { migrateImages } from './migrate-images';
import { logger } from '../utils/logger';

/**
 * One-time CLI runner for the image backfill. Build first, then:
 *   node dist/db/run-image-migration.js
 * (exposed as `npm run migrate:images`).
 */
async function main() {
  const db = new Database(config.dbPath);
  db.pragma('foreign_keys = ON');
  try {
    logger.info(`migrate-images: scanning photos under ${config.uploadsDir} ...`);
    const stats = await migrateImages(db, config.uploadsDir);
    logger.info(
      `migrate-images complete: processed=${stats.processed} skipped=${stats.skipped} ` +
        `missing=${stats.missing} failed=${stats.failed} reclaimed=${(stats.bytesSaved / 1024 / 1024).toFixed(1)}MB`,
    );
  } finally {
    db.close();
  }
}

main().catch((err) => {
  logger.error('migrate-images failed:', err);
  process.exit(1);
});
