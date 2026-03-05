import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import { logger } from '../utils/logger';

export function createSchema(db: Database.Database): void {
  db.exec(`
    -- Users
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      display_name TEXT NOT NULL,
      is_superuser INTEGER DEFAULT 0,
      is_active INTEGER DEFAULT 1,
      created_at TEXT DEFAULT (datetime('now'))
    );

    -- Customers (suppliers)
    CREATE TABLE IF NOT EXISTS customers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      contact_name TEXT,
      email TEXT,
      phone TEXT,
      address TEXT,
      is_active INTEGER DEFAULT 1
    );

    -- Customer sites
    CREATE TABLE IF NOT EXISTS customer_sites (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      customer_id INTEGER NOT NULL REFERENCES customers(id),
      address TEXT NOT NULL,
      is_active INTEGER DEFAULT 1
    );

    -- Reports
    CREATE TABLE IF NOT EXISTS reports (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      report_type TEXT NOT NULL,
      customer_id INTEGER NOT NULL REFERENCES customers(id),
      site_id INTEGER NOT NULL REFERENCES customer_sites(id),
      inspection_date TEXT NOT NULL,
      inspection_time TEXT,
      inspector_id INTEGER NOT NULL REFERENCES users(id),
      inspector_name TEXT NOT NULL,
      quality_score INTEGER,
      inspection_passed INTEGER,
      other_information TEXT,
      signature_path TEXT,
      date_completed TEXT,
      status TEXT DEFAULT 'draft',
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );

    -- Inspection details (fibre/plastics/metals)
    CREATE TABLE IF NOT EXISTS report_inspection_details (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      report_id INTEGER NOT NULL REFERENCES reports(id) ON DELETE CASCADE,
      product_description TEXT,
      product_grade TEXT,
      mode_of_storage TEXT,
      moisture_reading_low TEXT,
      moisture_reading_high TEXT,
      moisture_readings TEXT,
      radiation_reading TEXT,
      loading_reference TEXT,
      number_of_containers INTEGER,
      stock_bale_count TEXT,
      mixed_paper_exceeds_34_5 TEXT,
      occ_exceeds_80 TEXT,
      plastic_exceeds_97_5 TEXT,
      material_originates_uk TEXT,
      supplier_aware_pern TEXT,
      supplier_controls_volume TEXT,
      volume_consistency_notes TEXT,
      site_buys_prebaled TEXT,
      prebaled_uk_assurance TEXT,
      site_aware_non_uk TEXT
    );

    -- Unwanted materials
    CREATE TABLE IF NOT EXISTS report_unwanted_materials (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      report_id INTEGER NOT NULL REFERENCES reports(id) ON DELETE CASCADE,
      material TEXT NOT NULL,
      notes TEXT
    );

    -- Contaminants
    CREATE TABLE IF NOT EXISTS report_contaminants (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      report_id INTEGER NOT NULL REFERENCES reports(id) ON DELETE CASCADE,
      contaminant TEXT NOT NULL,
      notes TEXT
    );

    -- Containers (plastics/metals)
    CREATE TABLE IF NOT EXISTS report_containers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      report_id INTEGER NOT NULL REFERENCES reports(id) ON DELETE CASCADE,
      container_number TEXT,
      seal_number TEXT,
      weight_info TEXT,
      sort_order INTEGER DEFAULT 0
    );

    -- PERN Audit details
    CREATE TABLE IF NOT EXISTS report_pern_details (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      report_id INTEGER NOT NULL REFERENCES reports(id) ON DELETE CASCADE,
      company_name_address TEXT,
      contact_name TEXT,
      email TEXT,
      phone TEXT,
      grades_supplied TEXT,
      num_workers TEXT,
      site_type TEXT,
      safety_inducted TEXT,
      materials_handled TEXT,
      prn_accredited TEXT,
      prn_numbers TEXT,
      permits_licences TEXT,
      accreditations TEXT,
      site_facilities TEXT,
      area_size TEXT,
      process_flow TEXT,
      throughput TEXT,
      waste_sources TEXT,
      transfer_notes_checked TEXT,
      safety_equipment TEXT,
      safety_comments TEXT,
      worker_recording TEXT,
      worker_recording_comments TEXT,
      ppe_suitable TEXT,
      uniform_or_own TEXT,
      accident_log TEXT,
      employer_liability TEXT,
      public_liability TEXT,
      mgmt_experience TEXT,
      prn_expertise TEXT,
      packaging_differentiation TEXT,
      packaging_identification TEXT,
      non_uk_packaging TEXT,
      non_uk_comments TEXT,
      prn_claimed_once TEXT,
      training_types TEXT,
      training_scope TEXT,
      training_recording TEXT,
      training_review_frequency TEXT,
      training_records_inspected TEXT,
      workers_consistent TEXT,
      bale_split_results TEXT,
      quality_discussion TEXT,
      follow_up TEXT,
      notes TEXT,
      auditor_position TEXT,
      intro_letter TEXT
    );

    -- Photos
    CREATE TABLE IF NOT EXISTS report_photos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      report_id INTEGER NOT NULL REFERENCES reports(id) ON DELETE CASCADE,
      container_id INTEGER REFERENCES report_containers(id) ON DELETE CASCADE,
      photo_label TEXT,
      file_path TEXT NOT NULL,
      sort_order INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now'))
    );

    -- Lookup tables
    CREATE TABLE IF NOT EXISTS lookup_product_descriptions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      report_type TEXT NOT NULL,
      value TEXT NOT NULL,
      is_active INTEGER DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS lookup_product_grades (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      report_type TEXT NOT NULL,
      value TEXT NOT NULL,
      is_active INTEGER DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS lookup_storage_modes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      value TEXT NOT NULL,
      is_active INTEGER DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS lookup_unwanted_materials (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      report_type TEXT NOT NULL,
      value TEXT NOT NULL,
      is_active INTEGER DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS lookup_contaminants (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      report_type TEXT NOT NULL,
      value TEXT NOT NULL,
      is_active INTEGER DEFAULT 1
    );
  `);

  // Migrations - add columns if they don't exist
  const customerCols = db.prepare('PRAGMA table_info(customers)').all() as { name: string }[];
  const colNames = customerCols.map((c) => c.name);
  if (!colNames.includes('contact_name')) {
    db.exec('ALTER TABLE customers ADD COLUMN contact_name TEXT');
  }
  if (!colNames.includes('email')) {
    db.exec('ALTER TABLE customers ADD COLUMN email TEXT');
  }
  if (!colNames.includes('phone')) {
    db.exec('ALTER TABLE customers ADD COLUMN phone TEXT');
  }
  if (!colNames.includes('address')) {
    db.exec('ALTER TABLE customers ADD COLUMN address TEXT');
  }

  // Add intro_letter to report_pern_details
  const pernCols = db.prepare('PRAGMA table_info(report_pern_details)').all() as { name: string }[];
  if (!pernCols.map((c) => c.name).includes('intro_letter')) {
    db.exec('ALTER TABLE report_pern_details ADD COLUMN intro_letter TEXT');
  }
}

/**
 * Migrate flat photo storage to per-report subdirectories.
 * Moves files from uploads/{filename} to uploads/{reportId}/{filename}
 * and updates file_path in DB from "{filename}" to "{reportId}/{filename}".
 */
export function migratePhotoSubdirs(db: Database.Database, uploadsDir: string): void {
  // Migrate report_photos
  const photos = db
    .prepare("SELECT id, report_id, file_path FROM report_photos WHERE file_path NOT LIKE '%/%'")
    .all() as { id: number; report_id: number; file_path: string }[];

  if (photos.length > 0) {
    const updateStmt = db.prepare('UPDATE report_photos SET file_path = ? WHERE id = ?');
    const migrate = db.transaction(() => {
      for (const photo of photos) {
        const oldPath = path.join(uploadsDir, photo.file_path);
        const newDir = path.join(uploadsDir, String(photo.report_id));
        const newPath = path.join(newDir, photo.file_path);
        const newRelPath = `${photo.report_id}/${photo.file_path}`;

        if (fs.existsSync(oldPath)) {
          if (!fs.existsSync(newDir)) {
            fs.mkdirSync(newDir, { recursive: true });
          }
          fs.renameSync(oldPath, newPath);
        }
        updateStmt.run(newRelPath, photo.id);
      }
    });
    migrate();
    logger.info(`Migrated ${photos.length} photo(s) to per-report subdirectories`);
  }

  // Migrate signature_path on reports
  const sigs = db
    .prepare(
      "SELECT id, signature_path FROM reports WHERE signature_path IS NOT NULL AND signature_path != '' AND signature_path NOT LIKE '%/%'",
    )
    .all() as { id: number; signature_path: string }[];

  if (sigs.length > 0) {
    const updateStmt = db.prepare('UPDATE reports SET signature_path = ? WHERE id = ?');
    const migrate = db.transaction(() => {
      for (const sig of sigs) {
        const oldPath = path.join(uploadsDir, sig.signature_path);
        const newDir = path.join(uploadsDir, String(sig.id));
        const newPath = path.join(newDir, sig.signature_path);
        const newRelPath = `${sig.id}/${sig.signature_path}`;

        if (fs.existsSync(oldPath)) {
          if (!fs.existsSync(newDir)) {
            fs.mkdirSync(newDir, { recursive: true });
          }
          fs.renameSync(oldPath, newPath);
        }
        updateStmt.run(newRelPath, sig.id);
      }
    });
    migrate();
    logger.info(`Migrated ${sigs.length} signature(s) to per-report subdirectories`);
  }
}
