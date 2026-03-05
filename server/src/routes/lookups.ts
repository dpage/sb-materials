import { Router } from 'express';
import Database from 'better-sqlite3';
import { requireAuth } from '../middleware/auth';

const LOOKUP_TABLES = [
  'lookup_product_descriptions',
  'lookup_product_grades',
  'lookup_storage_modes',
  'lookup_unwanted_materials',
  'lookup_contaminants',
] as const;

type LookupTable = (typeof LOOKUP_TABLES)[number];

function isValidTable(table: string): table is LookupTable {
  return LOOKUP_TABLES.includes(table as LookupTable);
}

export function lookupRoutes(db: Database.Database): Router {
  const router = Router();

  router.use(requireAuth);

  // Get values for a lookup table
  router.get('/:table', (req, res) => {
    const table = req.params.table;
    if (!isValidTable(table)) {
      res.status(400).json({ error: 'Invalid lookup table' });
      return;
    }

    const reportType = req.query.report_type as string | undefined;
    const includeInactive = req.query.includeInactive === 'true';

    let query = `SELECT * FROM ${table}`;
    const conditions: string[] = [];
    const params: any[] = [];

    if (reportType && table !== 'lookup_storage_modes') {
      conditions.push('report_type = ?');
      params.push(reportType);
    }
    if (!includeInactive) {
      conditions.push('is_active = 1');
    }
    if (conditions.length) {
      query += ' WHERE ' + conditions.join(' AND ');
    }
    query += ' ORDER BY value';

    const rows = db.prepare(query).all(...params);
    res.json(rows);
  });

  // Create a lookup value
  router.post('/:table', (req, res) => {
    const table = req.params.table;
    if (!isValidTable(table)) {
      res.status(400).json({ error: 'Invalid lookup table' });
      return;
    }

    const { value, report_type } = req.body;
    if (!value) {
      res.status(400).json({ error: 'Value required' });
      return;
    }

    if (table === 'lookup_storage_modes') {
      const result = db.prepare(`INSERT INTO ${table} (value) VALUES (?)`).run(value);
      res.json({ id: result.lastInsertRowid, value });
    } else {
      if (!report_type) {
        res.status(400).json({ error: 'report_type required' });
        return;
      }
      const result = db.prepare(`INSERT INTO ${table} (report_type, value) VALUES (?, ?)`).run(report_type, value);
      res.json({ id: result.lastInsertRowid, report_type, value });
    }
  });

  // Update a lookup value
  router.put('/:table/:id', (req, res) => {
    const table = req.params.table;
    if (!isValidTable(table)) {
      res.status(400).json({ error: 'Invalid lookup table' });
      return;
    }

    const { value, is_active } = req.body;
    db.prepare(`UPDATE ${table} SET value = COALESCE(?, value), is_active = COALESCE(?, is_active) WHERE id = ?`).run(
      value,
      is_active !== undefined ? (is_active ? 1 : 0) : null,
      req.params.id,
    );
    res.json({ ok: true });
  });

  return router;
}
