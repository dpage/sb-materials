import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import { logger } from '../utils/logger';
import { allocateLineReferences, takenLineReferences } from '../utils/collection-note-line-reference';

/**
 * Bump this whenever a table or column is added, removed or renamed below,
 * in the same commit as the change — `backup-archive.test.ts`'s checked-in
 * fingerprint snapshot will fail otherwise, which is the point: nothing else
 * enforces it. It has nothing to do with the live shape of any particular
 * database (that always drifts, gets migrated forward, and is never checked
 * byte-for-byte) and everything to do with whether *this running code's*
 * migrations were written with a given schema in mind. A backup restore
 * compares the archive's recorded version against this one and refuses only
 * an archive newer than it: an older archive is safe, because the migrations
 * below already bring any older database forward on every boot, restore or
 * not; a newer archive was produced by code with migrations this build has
 * never seen, so nothing here can promise to make sense of it.
 *
 * That "older is safe" promise is only as good as every migration honouring
 * it. A migration that isn't purely additive with a safe default — a
 * NOT NULL column with no default, a table drop, a column whose meaning
 * changes without a rename — can still fail or misbehave against a database
 * that predates it, no matter how large a gap `DB_SCHEMA_VERSION` records.
 * Write migrations that bring *any* older database forward, not just the one
 * you tested against.
 */
export const DB_SCHEMA_VERSION = 7;

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

    CREATE TABLE IF NOT EXISTS lookup_clients (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
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

  const addColumns = (table: string, columns: { name: string; type: string }[]) => {
    const existing = (db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map((c) => c.name);
    for (const col of columns) {
      if (!existing.includes(col.name)) {
        db.exec(`ALTER TABLE ${table} ADD COLUMN ${col.name} ${col.type}`);
      }
    }
  };

  addColumns('reports', [
    { name: 'on_behalf_of', type: 'TEXT' },
    { name: 'assigned_to_id', type: 'INTEGER' },
    { name: 'created_by_id', type: 'INTEGER' },
  ]);
  addColumns('report_inspection_details', [
    { name: 'rejected_bales', type: 'TEXT' },
    { name: 'bale_break', type: 'INTEGER' },
    { name: 'bale_break_results', type: 'TEXT' },
    { name: 'packaging_thresholds', type: 'TEXT' },
  ]);
  // Material description and grade on the PERN audit: plain text rather than
  // lookups, since the lookup tables are keyed by report type and hold nothing
  // for pern_audit.
  addColumns('report_pern_details', [
    { name: 'product_description', type: 'TEXT' },
    { name: 'product_grade', type: 'TEXT' },
  ]);
  addColumns('report_containers', [
    { name: 'number_of_bales', type: 'TEXT' },
    { name: 'weighbridge_ticket', type: 'TEXT' },
    { name: 'weight', type: 'TEXT' },
  ]);

  // ─── Collection notes ───
  // A collection note is a standalone document rather than a report: it is
  // raised for material being picked up, carries its own SBM reference, and is
  // signed at the collection point by whoever dispatches the goods.
  //
  // Databases created before the note was reworked also carry
  // received_signature_path, received_signed_date, and weight. Nothing reads
  // them any more (goods are never signed for on the returning copy in
  // practice, and the only weight that matters is the minimum the vehicle must
  // be loaded to), so they are simply left in place on those databases rather
  // than rebuilt out of the table, which would mean recreating it wholesale in
  // SQLite.
  db.exec(`
    CREATE TABLE IF NOT EXISTS collection_notes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      reference TEXT NOT NULL,
      customer_id INTEGER NOT NULL REFERENCES customers(id),
      site_id INTEGER REFERENCES customer_sites(id),
      collect_from_address TEXT,
      comments TEXT,
      contact_name TEXT,
      contact_phone TEXT,
      buyer_reference TEXT,
      minimum_weight TEXT,
      collection_date TEXT,
      transport_company TEXT,
      dispatched_signature_path TEXT,
      dispatched_signed_date TEXT,
      -- The sale behind the collection: who bought the load, what it cost and
      -- what it went for, and whether the money has arrived. Read and written
      -- by superusers only (see stripSaleFields), and deliberately absent from
      -- the PDF, which goes out with the load.
      buyer TEXT,
      buy_price REAL,
      sale_price REAL,
      is_paid INTEGER DEFAULT 0,
      paid_date TEXT,
      created_by_id INTEGER REFERENCES users(id),
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS collection_note_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      note_id INTEGER NOT NULL REFERENCES collection_notes(id) ON DELETE CASCADE,
      -- The line's own unique reference, allocated by the app as the note's
      -- reference plus a suffix (SBM1061-1). The reference column below is
      -- separate: free text the user types for their own purposes.
      line_reference TEXT,
      quantity TEXT,
      description TEXT,
      nett_weight TEXT,
      reference TEXT,
      vehicle_registration TEXT,
      is_container INTEGER DEFAULT 0,
      container_number TEXT,
      seal_number TEXT,
      sort_order INTEGER DEFAULT 0
    );

    -- Sampling (the bale break, reworked): one row per report, on every report
    -- type, because a sample is always taken unless the area is unsafe. Weights
    -- are REAL rather than the free text used for weights elsewhere because the
    -- percentages shown beside them are arithmetic; the percentages themselves
    -- are derived wherever they are shown rather than stored, so a corrected
    -- weight cannot leave a stale percentage behind.
    CREATE TABLE IF NOT EXISTS report_sampling (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      report_id INTEGER NOT NULL UNIQUE REFERENCES reports(id) ON DELETE CASCADE,
      not_carried_out INTEGER,
      not_carried_out_reason TEXT,
      sample_size_kg REAL,
      in_scope_kg REAL,
      out_of_scope_kg REAL,
      non_packaging_kg REAL,
      contamination_kg REAL,
      prohibited_kg REAL,
      product_description TEXT,
      product_grade TEXT,
      prohibited_items TEXT,
      pern_prn_claimed_percent REAL,
      contamination_limit_percent REAL,
      comments TEXT
    );

    -- Travel and expenses are kept per person per month: UNIQUE (user_id,
    -- year, month) is what makes a sheet monthly, so opening September 2026
    -- either finds the existing sheet or creates it and there is no way to end
    -- up with two competing sheets for one month. Miles and money are REAL
    -- because they are totalled; costs are in pounds, rounded to pence only
    -- where they are shown.
    CREATE TABLE IF NOT EXISTS travel_sheets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      year INTEGER NOT NULL,
      month INTEGER NOT NULL,
      notes TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT,
      UNIQUE (user_id, year, month)
    );

    -- One row per leg rather than per day: a run serving four customers is
    -- four rows sharing a date, so the mileage is attributable to the customer
    -- it was driven for. A round trip is one row with round_trip set, which
    -- doubles the distance wherever it is totalled; customer_name is
    -- denormalised beside customer_id as the reports do, so a journey still
    -- reads correctly after a customer is renamed or removed.
    CREATE TABLE IF NOT EXISTS travel_journeys (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sheet_id INTEGER NOT NULL REFERENCES travel_sheets(id) ON DELETE CASCADE,
      journey_date TEXT,
      customer_id INTEGER REFERENCES customers(id) ON DELETE SET NULL,
      customer_name TEXT,
      job TEXT,
      from_location TEXT,
      to_location TEXT,
      miles REAL,
      round_trip INTEGER,
      sort_order INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS expense_sheets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      year INTEGER NOT NULL,
      month INTEGER NOT NULL,
      notes TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT,
      UNIQUE (user_id, year, month)
    );

    -- vat_amount is entered rather than derived: receipts state the VAT that
    -- was actually charged, and assuming 20% would be wrong for the zero and
    -- reduced rated things an inspector buys.
    CREATE TABLE IF NOT EXISTS expense_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sheet_id INTEGER NOT NULL REFERENCES expense_sheets(id) ON DELETE CASCADE,
      item_date TEXT,
      description TEXT,
      cost REAL,
      vat_applicable INTEGER,
      vat_amount REAL,
      sort_order INTEGER NOT NULL DEFAULT 0
    );

    -- Receipts live under uploads/expenses/<sheetId>/, following the
    -- collection note signatures, so the backup archive already carries them.
    -- item_id is nullable because a receipt covering a whole trip belongs to
    -- the sheet rather than to any one line.
    CREATE TABLE IF NOT EXISTS expense_photos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sheet_id INTEGER NOT NULL REFERENCES expense_sheets(id) ON DELETE CASCADE,
      item_id INTEGER REFERENCES expense_items(id) ON DELETE SET NULL,
      file_path TEXT NOT NULL,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- Who did what, as plain history: no hash chain and no append-only
    -- trickery, since the point is answering "where did that report go?"
    -- rather than defending against a determined insider. The username and
    -- display name are snapshotted beside user_id so an entry still reads
    -- after an account is renamed or removed, and the summary is written at
    -- the time of the event because the record it describes may be gone.
    CREATE TABLE IF NOT EXISTS audit_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      username TEXT,
      display_name TEXT,
      action TEXT NOT NULL,
      entity_type TEXT NOT NULL,
      entity_id INTEGER,
      summary TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_audit_log_created_at ON audit_log(created_at DESC, id DESC);
    CREATE INDEX IF NOT EXISTS idx_audit_log_entity ON audit_log(entity_type, entity_id);

    -- Generic key/value settings, so values such as the collection note
    -- sequence can be corrected without a redeploy.
    CREATE TABLE IF NOT EXISTS app_settings (
      key TEXT PRIMARY KEY,
      value TEXT
    );
  `);

  addColumns('users', [{ name: 'phone', type: 'TEXT' }]);
  addColumns('collection_note_items', [
    { name: 'nett_weight', type: 'TEXT' },
    // The collection point was dropped from the note in favour of a reference
    // and a vehicle registration per line, and the container details that go
    // with a containerised line. Databases from before the change keep their
    // collection_point column, which nothing reads any more, for the same
    // reason the superseded signature columns are left in place above.
    { name: 'reference', type: 'TEXT' },
    { name: 'vehicle_registration', type: 'TEXT' },
    { name: 'is_container', type: 'INTEGER DEFAULT 0' },
    { name: 'container_number', type: 'TEXT' },
    { name: 'seal_number', type: 'TEXT' },
    { name: 'line_reference', type: 'TEXT' },
  ]);

  addColumns('collection_notes', [
    { name: 'buyer', type: 'TEXT' },
    { name: 'buy_price', type: 'REAL' },
    { name: 'sale_price', type: 'REAL' },
    { name: 'is_paid', type: 'INTEGER DEFAULT 0' },
    { name: 'paid_date', type: 'TEXT' },
  ]);

  addColumns('report_sampling', [
    { name: 'non_packaging_kg', type: 'REAL' },
    { name: 'product_description', type: 'TEXT' },
    { name: 'product_grade', type: 'TEXT' },
  ]);

  // The two fields the collection note carried under their original Word
  // document names were renamed once their real use was settled: the PO
  // number is the buyer's own reference, and what was filled in as a packing
  // list number is in fact the minimum weight the vehicle must be loaded to.
  // A rename keeps the data, which a drop-and-add would not.
  renameColumn(db, 'collection_notes', 'po_number', 'buyer_reference');
  renameColumn(db, 'collection_notes', 'packing_list_no', 'minimum_weight');

  ensureCaseInsensitiveReferenceIndex(db);

  // Created here rather than alongside the tables, because on a database from
  // before the column existed it is addColumns above that adds it. Line
  // references are matched case-insensitively for the same reason the note's
  // own reference is.
  db.exec(
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_collection_note_items_line_reference
       ON collection_note_items(line_reference COLLATE NOCASE)`,
  );

  backfillLineReferences(db);
}

/**
 * Give the lines of existing notes the per-line references the column was
 * added for, numbered in the order they appear on the note. Lines created
 * before the column existed would otherwise stay blank for ever, since the
 * references are only allocated when a note is saved.
 *
 * Cheap on every startup once done: a single count of the blank rows.
 */
function backfillLineReferences(db: Database.Database): void {
  const blank = db.prepare('SELECT COUNT(*) AS n FROM collection_note_items WHERE line_reference IS NULL').get() as {
    n: number;
  };
  if (!blank.n) return;

  const fill = db.transaction(() => {
    const notes = db
      .prepare(
        `SELECT DISTINCT n.id, n.reference
         FROM collection_notes n
         JOIN collection_note_items i ON i.note_id = n.id
         WHERE i.line_reference IS NULL`,
      )
      .all() as { id: number; reference: string }[];
    const update = db.prepare('UPDATE collection_note_items SET line_reference = ? WHERE id = ?');

    for (const note of notes) {
      const lines = db
        .prepare('SELECT id, line_reference FROM collection_note_items WHERE note_id = ? ORDER BY sort_order, id')
        .all(note.id) as { id: number; line_reference: string | null }[];
      const references = allocateLineReferences(takenLineReferences(db), note.reference, lines);
      lines.forEach((line, i) => {
        if (!line.line_reference) update.run(references[i], line.id);
      });
    }
  });

  fill();
}

/**
 * Rename a column, idempotently: a database that has already been migrated (or
 * was created fresh with the new name) is left alone, so this can run on every
 * startup alongside the other schema top-ups.
 */
function renameColumn(db: Database.Database, table: string, from: string, to: string): void {
  const columns = (db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map((c) => c.name);
  if (columns.includes(from) && !columns.includes(to)) {
    db.exec(`ALTER TABLE ${table} RENAME COLUMN ${from} TO ${to}`);
  }
}

/**
 * Reference parsing (parseReferenceNumber) matches "SBM1061" and "sbm1061"
 * as the same reference, so the uniqueness constraint must agree, otherwise
 * a customer can end up with two notes bearing what reads as one reference.
 *
 * `CREATE UNIQUE INDEX IF NOT EXISTS` will not redefine an index that
 * already exists on a developer or production database from before this
 * change, so the upgrade is done explicitly: drop the plain-collation index
 * and recreate it with `COLLATE NOCASE`, inside a transaction so a database
 * that already has case-differing duplicate references (which would violate
 * the new constraint) fails loudly and rolls back to the original index,
 * rather than being left with no unique index at all or with the duplicates
 * silently kept. Resolving such duplicates is a manual, human decision
 * (which one is "correct"), so this deliberately does not try to merge or
 * delete rows itself.
 *
 * Safe and cheap to call on every startup: once the index already carries
 * COLLATE NOCASE, this is a single read of sqlite_master and nothing else.
 */
function ensureCaseInsensitiveReferenceIndex(db: Database.Database): void {
  const existing = db
    .prepare("SELECT sql FROM sqlite_master WHERE type = 'index' AND name = 'idx_collection_notes_reference'")
    .get() as { sql: string | null } | undefined;

  if (existing && existing.sql && /COLLATE NOCASE/i.test(existing.sql)) return;

  const migrate = db.transaction(() => {
    db.exec('DROP INDEX IF EXISTS idx_collection_notes_reference');
    db.exec('CREATE UNIQUE INDEX idx_collection_notes_reference ON collection_notes(reference COLLATE NOCASE)');
  });

  try {
    migrate();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(
      `Cannot enforce case-insensitive collection note references: existing references collide when ` +
        `compared case-insensitively (e.g. "SBM1061" and "sbm1061"). Resolve the duplicate rows by hand ` +
        `and restart. Underlying error: ${message}`,
      { cause: err },
    );
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
