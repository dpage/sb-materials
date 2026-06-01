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
