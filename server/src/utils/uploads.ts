import fs from 'fs';
import path from 'path';
import { logger } from './logger';

/**
 * Recursively remove a directory of uploaded files.
 *
 * Deleting the files is best-effort and deliberately never throws: the database
 * rows have already gone by the time this is called, and anything left behind
 * on disk is picked up by the orphan sweep (`npm run sweep:orphans`). Failing
 * the request instead would leave the user unable to delete the record at all.
 *
 * Anything resolving outside `uploadsDir`, or to `uploadsDir` itself, is
 * refused rather than removed.
 */
export function removeUploadDir(uploadsDir: string, relDir: string): void {
  const root = path.resolve(uploadsDir);
  const target = path.resolve(root, relDir);

  if (target === root || !target.startsWith(root + path.sep)) {
    logger.warn(`removeUploadDir: refusing to remove ${target}, which is outside ${root}`);
    return;
  }

  try {
    fs.rmSync(target, { recursive: true, force: true });
  } catch (err) {
    logger.error(`removeUploadDir: failed to remove ${target}:`, err);
  }
}
