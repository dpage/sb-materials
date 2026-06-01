import Database from 'better-sqlite3';
import bcrypt from 'bcryptjs';
import { logger } from '../utils/logger';

export function seedData(db: Database.Database): void {
  // Only seed if no users exist
  const userCount = db.prepare('SELECT COUNT(*) as count FROM users').get() as { count: number };
  if (userCount.count > 0) return;

  logger.info('Seeding default data...');

  // Default admin user (password: admin)
  const hash = bcrypt.hashSync('admin', 10);
  db.prepare('INSERT INTO users (username, password_hash, display_name, is_superuser) VALUES (?, ?, ?, 1)').run(
    'admin',
    hash,
    'Administrator',
  );

  // Product descriptions (plastics/metals)
  const productDescs = ['PET', 'HDPE', 'PP', 'LDPE', 'Mixed Plastics', 'Aluminium', 'Steel', 'Mixed Metals'];
  for (const desc of productDescs) {
    db.prepare('INSERT INTO lookup_product_descriptions (report_type, value) VALUES (?, ?)').run(
      'inspection_plastics',
      desc,
    );
    db.prepare('INSERT INTO lookup_product_descriptions (report_type, value) VALUES (?, ?)').run(
      'inspection_metals',
      desc,
    );
  }

  // Product grades - fibre
  const fibreGrades = [
    'Fruit Box',
    'OCC',
    'Mixed Paper',
    'News & Pams',
    'Heavy Letterstock',
    'Sorted Office Paper',
    'Light Letterstock',
  ];
  for (const grade of fibreGrades) {
    db.prepare('INSERT INTO lookup_product_grades (report_type, value) VALUES (?, ?)').run('inspection_fibre', grade);
  }

  // Product grades - plastics/metals
  const plasticGrades = ['98/2', '95/5', '90/10', '80/20', '60/40'];
  for (const grade of plasticGrades) {
    db.prepare('INSERT INTO lookup_product_grades (report_type, value) VALUES (?, ?)').run(
      'inspection_plastics',
      grade,
    );
    db.prepare('INSERT INTO lookup_product_grades (report_type, value) VALUES (?, ?)').run('inspection_metals', grade);
  }

  // Storage modes (fibre)
  const storageModes = [
    'Bale Stacking Outside Storage',
    'Bale Stacking Inside Storage',
    'Loose Material',
    'Loose Material Inside Storage',
    'Loose Material Outside Storage',
  ];
  for (const mode of storageModes) {
    db.prepare('INSERT INTO lookup_storage_modes (value) VALUES (?)').run(mode);
  }

  // Unwanted materials - fibre
  const fibreUnwanted = ['Paper', 'Greyboard', 'Cores', 'Magazines', 'Newspaper', 'Other'];
  for (const mat of fibreUnwanted) {
    db.prepare('INSERT INTO lookup_unwanted_materials (report_type, value) VALUES (?, ?)').run('inspection_fibre', mat);
  }

  // Unwanted materials - plastics
  const plasticUnwanted = ['HDPE', 'PP', 'LDPE', 'PVC', 'Other'];
  for (const mat of plasticUnwanted) {
    db.prepare('INSERT INTO lookup_unwanted_materials (report_type, value) VALUES (?, ?)').run(
      'inspection_plastics',
      mat,
    );
    db.prepare('INSERT INTO lookup_unwanted_materials (report_type, value) VALUES (?, ?)').run(
      'inspection_metals',
      mat,
    );
  }

  // Contaminants (shared across types)
  const contaminants = ['Metal', 'Polythene', 'Fibre', 'Polystyrene', 'Food Waste', 'Medical', 'Hazardous', 'Other'];
  for (const cont of contaminants) {
    db.prepare('INSERT INTO lookup_contaminants (report_type, value) VALUES (?, ?)').run('inspection_fibre', cont);
    db.prepare('INSERT INTO lookup_contaminants (report_type, value) VALUES (?, ?)').run('inspection_plastics', cont);
    db.prepare('INSERT INTO lookup_contaminants (report_type, value) VALUES (?, ?)').run('inspection_metals', cont);
  }

  logger.info('Seed data created. Default login: admin / admin');
}

export function ensureReferenceData(db: Database.Database): void {
  const GRADES = [
    '95/5 OCC', '98/2 OCC', '90/10 OCC', 'OCC 80/20', 'Mixed Paper', 'Fruit Box',
    'HDPE 80/20', '95/5 HDPE', 'PET 80/20', 'PET 60/40', 'Aluminium',
  ];
  const STORAGE = [
    'Stand Trailer',
    'Bale Stack - Undercover Storage',
    'Bale Stacking - Outside Storage',
    'Bale Stacking - Outside & Undercover Storage',
  ];
  const UNWANTED = ['Paper', 'Greyboard', 'Cores', 'Magazines', 'Newspaper', 'PET', 'LDPE', 'PP', 'Ferrous Metals', 'Other'];
  const CONTAMINANTS = ['Metal', 'Polythene', 'Polystyrene', 'Food Waste', 'Medical', 'Hazardous', 'Fibre', 'Other'];
  const CLIENTS = ['VISY Recycling UK', 'Genus Trading', 'CTL Europe', 'MRL LTD', 'Baileys Skip Hire'];
  const INSPECTION_TYPES = ['loading_inspection', 'quarterly_pern'];

  const ensureGlobal = (table: string, values: string[]) => {
    const existing = new Set(
      (db.prepare(`SELECT value FROM ${table}`).all() as { value: string }[]).map((r) => r.value),
    );
    const ins = db.prepare(`INSERT INTO ${table} (value) VALUES (?)`);
    for (const v of values) if (!existing.has(v)) ins.run(v);
  };

  const ensureTyped = (table: string, reportType: string, values: string[]) => {
    const existing = new Set(
      (db.prepare(`SELECT value FROM ${table} WHERE report_type = ?`).all(reportType) as { value: string }[]).map(
        (r) => r.value,
      ),
    );
    const ins = db.prepare(`INSERT INTO ${table} (report_type, value) VALUES (?, ?)`);
    for (const v of values) if (!existing.has(v)) ins.run(reportType, v);
  };

  const tx = db.transaction(() => {
    ensureGlobal('lookup_clients', CLIENTS);
    ensureGlobal('lookup_storage_modes', STORAGE);
    for (const t of INSPECTION_TYPES) {
      ensureTyped('lookup_product_grades', t, GRADES);
      ensureTyped('lookup_unwanted_materials', t, UNWANTED);
      ensureTyped('lookup_contaminants', t, CONTAMINANTS);
    }
  });
  tx();
}
