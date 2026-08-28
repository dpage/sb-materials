import Database from 'better-sqlite3';
import { config } from '../config';
import { sweepOrphanedUploads } from './sweep-orphans';
import { logger } from '../utils/logger';

/**
 * CLI for the orphan sweep. Build first, then:
 *   node dist/db/run-orphan-sweep.js            # report only (the default)
 *   node dist/db/run-orphan-sweep.js --delete   # actually remove them
 * (exposed as `npm run sweep:orphans` and `npm run sweep:orphans -- --delete`).
 *
 * Reporting is the default deliberately: read the list, satisfy yourself it is
 * only debris, and delete on a second run.
 */
function main() {
  const deleteFiles = process.argv.includes('--delete');
  const force = process.argv.includes('--force');
  const verbose = process.argv.includes('--list');

  const db = new Database(config.dbPath, { readonly: !deleteFiles });
  try {
    logger.info(`sweep-orphans: scanning ${config.uploadsDir} against ${config.dbPath} ...`);
    const result = sweepOrphanedUploads(db, config.uploadsDir, { deleteFiles, force });

    if (verbose) {
      for (const orphan of result.orphans) {
        logger.info(`  orphan ${orphan.relPath} (${(orphan.bytes / 1024).toFixed(0)}KB)`);
      }
    }

    const megabytes = (result.orphanBytes / 1024 / 1024).toFixed(1);
    logger.info(
      `sweep-orphans: scanned=${result.scanned} referenced=${result.referenced} ` +
        `orphans=${result.orphans.length} (${megabytes}MB) deleted=${result.deleted}`,
    );
    if (!deleteFiles && result.orphans.length > 0) {
      logger.info('sweep-orphans: nothing was removed; re-run with --delete to reclaim the space.');
    }
    if (result.refused) process.exitCode = 1;
  } finally {
    db.close();
  }
}

main();
