import Database from 'better-sqlite3';
import { logger } from '../utils/logger';

const OLD_TYPES = ['inspection_fibre', 'inspection_plastics', 'inspection_metals'];

export function migrateRefined(db: Database.Database): void {
  const tx = db.transaction(() => {
    // 1. Re-point report types on reports
    const placeholders = OLD_TYPES.map(() => '?').join(',');
    const repointed = db
      .prepare(`UPDATE reports SET report_type = 'loading_inspection' WHERE report_type IN (${placeholders})`)
      .run(...OLD_TYPES);
    if (repointed.changes > 0) logger.info(`Re-pointed ${repointed.changes} report(s) to loading_inspection`);

    // 2. Re-point lookup report_type values too (so existing lookups still resolve)
    for (const table of [
      'lookup_product_descriptions',
      'lookup_product_grades',
      'lookup_unwanted_materials',
      'lookup_contaminants',
    ]) {
      db.prepare(`UPDATE ${table} SET report_type = 'loading_inspection' WHERE report_type IN (${placeholders})`).run(
        ...OLD_TYPES,
      );
    }

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
