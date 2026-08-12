import Database from 'better-sqlite3';
import { describe, it, expect } from 'vitest';
import { createSchema } from '../db/schema';
import { migrateRefined } from '../db/migrate-refined';

function seedLegacy(db: Database.Database) {
  db.prepare("INSERT INTO users (username, password_hash, display_name) VALUES ('u','x','U')").run();
  db.prepare("INSERT INTO customers (name) VALUES ('C')").run();
  db.prepare("INSERT INTO customer_sites (customer_id, address) VALUES (1,'A')").run();
  db.prepare(
    `INSERT INTO reports (report_type, customer_id, site_id, inspection_date, inspector_id, inspector_name, status)
     VALUES ('inspection_plastics', 1, 1, '2026-01-01', 1, 'U', 'completed')`,
  ).run();
  db.prepare(
    `INSERT INTO report_inspection_details (report_id, occ_exceeds_80, plastic_exceeds_97_5) VALUES (1, 'YES', 'YES')`,
  ).run();
  db.prepare(
    `INSERT INTO report_containers (report_id, container_number, weight_info) VALUES (1, 'X', '32 Bales - 786371 - 19.04 Tonnes')`,
  ).run();
}

describe('migrateRefined', () => {
  it('re-points types, splits weight_info, builds thresholds, backfills created_by', () => {
    const db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    createSchema(db);
    seedLegacy(db);

    migrateRefined(db);

    const report = db.prepare('SELECT * FROM reports WHERE id = 1').get() as any;
    expect(report.report_type).toBe('loading_inspection');
    expect(report.created_by_id).toBe(1);

    const container = db.prepare('SELECT * FROM report_containers WHERE id = 1').get() as any;
    expect(container.number_of_bales).toBe('32 Bales');
    expect(container.weighbridge_ticket).toBe('786371');
    expect(container.weight).toBe('19.04 Tonnes');

    const det = db.prepare('SELECT * FROM report_inspection_details WHERE report_id = 1').get() as any;
    expect(JSON.parse(det.packaging_thresholds)).toEqual(expect.arrayContaining(['OCC 80%', 'PET 97.5%']));
  });

  it('collapses the duplicate lookups that re-pointing the old types creates', () => {
    // The seed inserts each value once per material-split report type, so
    // after re-pointing they arrive as identical rows and the dropdown shows
    // "PET" twice. This is what Stew saw on the collection note form.
    const db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    createSchema(db);
    const ins = db.prepare('INSERT INTO lookup_product_descriptions (report_type, value) VALUES (?, ?)');
    for (const type of ['inspection_plastics', 'inspection_metals']) {
      for (const value of ['PET', 'HDPE']) ins.run(type, value);
    }
    // A value that only ever existed under one type must survive untouched.
    ins.run('inspection_fibre', 'Mixed Paper');

    migrateRefined(db);

    const rows = db.prepare('SELECT report_type, value FROM lookup_product_descriptions ORDER BY value').all() as {
      report_type: string;
      value: string;
    }[];
    expect(rows.map((r) => r.value)).toEqual(['HDPE', 'Mixed Paper', 'PET']);
    expect(rows.every((r) => r.report_type === 'loading_inspection')).toBe(true);
  });

  it('keeps a deduplicated value active when any of its duplicates was active', () => {
    const db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    createSchema(db);
    // The surviving (lowest id) row is the deactivated one, but the value is
    // still active on its twin, so it must not vanish from every dropdown.
    db.prepare(
      "INSERT INTO lookup_contaminants (report_type, value, is_active) VALUES ('inspection_plastics','Metal',0)",
    ).run();
    db.prepare(
      "INSERT INTO lookup_contaminants (report_type, value, is_active) VALUES ('inspection_metals','Metal',1)",
    ).run();
    // A value deactivated on every copy stays deactivated.
    db.prepare(
      "INSERT INTO lookup_contaminants (report_type, value, is_active) VALUES ('inspection_plastics','Fibre',0)",
    ).run();
    db.prepare(
      "INSERT INTO lookup_contaminants (report_type, value, is_active) VALUES ('inspection_metals','Fibre',0)",
    ).run();

    migrateRefined(db);

    const rows = db.prepare('SELECT value, is_active FROM lookup_contaminants ORDER BY value').all() as {
      value: string;
      is_active: number;
    }[];
    expect(rows).toEqual([
      { value: 'Fibre', is_active: 0 },
      { value: 'Metal', is_active: 1 },
    ]);
  });

  it('leaves an already-deduplicated set of lookups alone', () => {
    const db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    createSchema(db);
    db.prepare(
      "INSERT INTO lookup_product_grades (report_type, value, is_active) VALUES ('loading_inspection','OCC',1)",
    ).run();
    db.prepare(
      "INSERT INTO lookup_product_grades (report_type, value, is_active) VALUES ('quarterly_pern','OCC',1)",
    ).run();
    db.prepare(
      "INSERT INTO lookup_product_grades (report_type, value, is_active) VALUES ('loading_inspection','PET',0)",
    ).run();

    migrateRefined(db);
    migrateRefined(db);

    const rows = db
      .prepare('SELECT report_type, value, is_active FROM lookup_product_grades ORDER BY value, report_type')
      .all();
    // The same value under two *current* report types is not a duplicate, and
    // a value deactivated on its only row stays that way.
    expect(rows).toEqual([
      { report_type: 'loading_inspection', value: 'OCC', is_active: 1 },
      { report_type: 'quarterly_pern', value: 'OCC', is_active: 1 },
      { report_type: 'loading_inspection', value: 'PET', is_active: 0 },
    ]);
  });

  it('is idempotent', () => {
    const db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    createSchema(db);
    seedLegacy(db);
    migrateRefined(db);
    const before = db.prepare('SELECT * FROM report_containers WHERE id = 1').get() as any;
    migrateRefined(db); // run again
    const after = db.prepare('SELECT * FROM report_containers WHERE id = 1').get() as any;
    expect(after.number_of_bales).toBe(before.number_of_bales);
    expect(after.weight).toBe(before.weight);
  });
});
