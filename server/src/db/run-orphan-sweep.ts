import Database from 'better-sqlite3';
import { config } from '../config';
import { sweepOrphanedUploads } from './sweep-orphans';

/**
 * CLI for the orphan sweep. Build first, then from the project root:
 *   npm run sweep:orphans                 # report only (the default)
 *   npm run sweep:orphans -- --list       # and name every file
 *   npm run sweep:orphans -- --delete     # actually remove them
 *
 * Reporting is the default deliberately: read the list, satisfy yourself it is
 * only debris, and delete on a second run.
 *
 * Output goes through console directly rather than the logger, whose `info` is
 * silent when NODE_ENV=production - which is exactly where this gets run, and
 * a maintenance command that prints nothing at all is no use to anyone.
 */
function main() {
  const deleteFiles = process.argv.includes('--delete');
  const force = process.argv.includes('--force');
  const verbose = process.argv.includes('--list');

  const db = new Database(config.dbPath, { readonly: !deleteFiles });
  try {
    console.log(`sweep-orphans: scanning ${config.uploadsDir} against ${config.dbPath} ...`);
    const result = sweepOrphanedUploads(db, config.uploadsDir, { deleteFiles, force });

    if (verbose) {
      for (const orphan of result.orphans) {
        console.log(`  orphan ${orphan.relPath} (${(orphan.bytes / 1024).toFixed(0)}KB)`);
      }
    }

    const megabytes = (result.orphanBytes / 1024 / 1024).toFixed(1);
    console.log(
      `sweep-orphans: scanned=${result.scanned} referenced=${result.referenced} ` +
        `orphans=${result.orphans.length} (${megabytes}MB) deleted=${result.deleted}`,
    );
    if (!deleteFiles && result.orphans.length > 0) {
      console.log('sweep-orphans: nothing was removed; re-run with --delete to reclaim the space.');
    }
    if (result.refused) process.exitCode = 1;
  } finally {
    db.close();
  }
}

main();
