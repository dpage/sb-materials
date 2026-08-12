import Database from 'better-sqlite3';
import { logger } from '../utils/logger';

const OLD_TYPES = ['inspection_fibre', 'inspection_plastics', 'inspection_metals'];

const TYPED_LOOKUPS = [
  'lookup_product_descriptions',
  'lookup_product_grades',
  'lookup_unwanted_materials',
  'lookup_contaminants',
];

/**
 * Collapse lookup rows that differ only by id.
 *
 * The seed inserts each value once per material-split report type, and step 2
 * above then re-points every one of those types onto loading_inspection, so a
 * value seeded under both inspection_plastics and inspection_metals arrives
 * here as two identical rows (three, where it was seeded under all three old
 * types). That is what put "PET" in the dropdown twice.
 *
 * Nothing references a lookup by id: reports and collection notes store the
 * chosen text, so the surplus rows can simply go. The lowest id is kept, and
 * it is left active if any of its duplicates was active, because quietly
 * dropping a value out of every dropdown is a worse outcome than showing one
 * that somebody had deactivated on only one of its two rows; with a single row
 * left, deactivating it now actually works.
 */
function dedupeLookups(db: Database.Database): void {
  for (const table of TYPED_LOOKUPS) {
    // Carry an active duplicate's state onto the row that is about to become
    // the survivor. Once a group is down to a single row this is a no-op, so
    // it is safe to run on every startup.
    db.prepare(
      `UPDATE ${table} AS keep SET is_active = 1
        WHERE keep.id IN (SELECT MIN(id) FROM ${table} GROUP BY report_type, value)
          AND keep.is_active = 0
          AND EXISTS (
            SELECT 1 FROM ${table} dup
             WHERE dup.report_type = keep.report_type
               AND dup.value = keep.value
               AND dup.is_active = 1
          )`,
    ).run();

    const removed = db
      .prepare(
        `DELETE FROM ${table}
          WHERE id NOT IN (SELECT MIN(id) FROM ${table} GROUP BY report_type, value)`,
      )
      .run();
    if (removed.changes > 0) {
      logger.info(`Removed ${removed.changes} duplicate row(s) from ${table}`);
    }
  }
}

export function migrateRefined(db: Database.Database): void {
  const tx = db.transaction(() => {
    // 1. Re-point report types on reports
    const placeholders = OLD_TYPES.map(() => '?').join(',');
    const repointed = db
      .prepare(`UPDATE reports SET report_type = 'loading_inspection' WHERE report_type IN (${placeholders})`)
      .run(...OLD_TYPES);
    if (repointed.changes > 0) logger.info(`Re-pointed ${repointed.changes} report(s) to loading_inspection`);

    // 2. Re-point lookup report_type values too (so existing lookups still
    // resolve), then collapse the duplicates that re-pointing creates.
    for (const table of TYPED_LOOKUPS) {
      db.prepare(`UPDATE ${table} SET report_type = 'loading_inspection' WHERE report_type IN (${placeholders})`).run(
        ...OLD_TYPES,
      );
    }
    dedupeLookups(db);

    // 3. Backfill created_by_id from inspector_id
    db.prepare('UPDATE reports SET created_by_id = inspector_id WHERE created_by_id IS NULL').run();

    // 4. Split weight_info into the three columns (only where not already split)
    const containers = db
      .prepare(
        "SELECT id, weight_info FROM report_containers WHERE weight_info IS NOT NULL AND weight_info != '' AND (number_of_bales IS NULL AND weighbridge_ticket IS NULL AND weight IS NULL)",
      )
      .all() as { id: number; weight_info: string }[];
    const setSplit = db.prepare(
      'UPDATE report_containers SET number_of_bales = ?, weighbridge_ticket = ?, weight = ? WHERE id = ?',
    );
    for (const c of containers) {
      const parts = c.weight_info.split(' - ').map((p) => p.trim());
      setSplit.run(parts[0] ?? null, parts[1] ?? null, parts[2] ?? null, c.id);
    }

    // 5. Build packaging_thresholds JSON from legacy columns (only where NULL)
    const details = db
      .prepare(
        'SELECT report_id, occ_exceeds_80, mixed_paper_exceeds_34_5, plastic_exceeds_97_5 FROM report_inspection_details WHERE packaging_thresholds IS NULL',
      )
      .all() as {
      report_id: number;
      occ_exceeds_80: string | null;
      mixed_paper_exceeds_34_5: string | null;
      plastic_exceeds_97_5: string | null;
    }[];
    const setThresholds = db.prepare(
      'UPDATE report_inspection_details SET packaging_thresholds = ? WHERE report_id = ?',
    );
    for (const d of details) {
      const arr: string[] = [];
      if (d.occ_exceeds_80 === 'YES') arr.push('OCC 80%');
      if (d.mixed_paper_exceeds_34_5 === 'YES') arr.push('Mixed Paper 34.5%');
      if (d.plastic_exceeds_97_5 === 'YES') arr.push('PET 97.5%');
      setThresholds.run(JSON.stringify(arr), d.report_id);
    }
  });
  tx();
}
