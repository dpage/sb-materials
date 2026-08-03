import { Router } from 'express';
import Database from 'better-sqlite3';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { requireAuth } from '../middleware/auth';
import { config } from '../config';
import {
  allocateNextReference,
  recordReferenceUsed,
  PREFIX_SETTING,
  DEFAULT_PREFIX,
} from '../utils/collection-note-reference';
import { getSetting } from '../utils/settings';
import { loadCollectionNote } from '../utils/collection-note-loader';

const SIGNATURE_SUBDIR = 'collection-notes';
const SIGNATURE_KINDS = ['dispatched', 'received'] as const;
type SignatureKind = (typeof SIGNATURE_KINDS)[number];

function isUniqueViolation(err: unknown): boolean {
  return err instanceof Error && /UNIQUE constraint failed/i.test(err.message);
}

export function collectionNoteRoutes(db: Database.Database): Router {
  const router = Router();

  router.use(requireAuth);

  const storage = multer.diskStorage({
    destination: (req: any, _file, cb) => {
      // The signature URL is /:id/signature/:kind, so the id sits before the
      // word "signature" rather than after it, unlike the report photo route.
      const match =
        req.originalUrl?.match(/collection-notes\/(\d+)\/signature/) || req.url?.match(/\/(\d+)\/signature/);
      const noteId = match ? match[1] : 'misc';
      const dir = path.join(config.uploadsDir, SIGNATURE_SUBDIR, noteId);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      cb(null, dir);
    },
    filename: (_req, file, cb) => {
      cb(null, `${Date.now()}-${Math.round(Math.random() * 1e9)}${path.extname(file.originalname)}`);
    },
  });

  const upload = multer({
    storage,
    limits: { fileSize: 5 * 1024 * 1024 },
    fileFilter: (_req, file, cb) => {
      if (/\.(png|jpg|jpeg)$/i.test(path.extname(file.originalname))) cb(null, true);
      else cb(new Error('Only image files are allowed'));
    },
  });

  // Registered before "/:id" so "next-reference" is not parsed as an id.
  router.get('/next-reference', (_req, res) => {
    res.json({
      reference: allocateNextReference(db),
      prefix: getSetting(db, PREFIX_SETTING, DEFAULT_PREFIX),
    });
  });

  router.get('/', (req, res) => {
    const { page = '1', limit = '25', sort = 'collection_date', order = 'DESC', customer_id, search } = req.query;

    const conditions: string[] = [];
    const params: any[] = [];

    if (customer_id) {
      conditions.push('n.customer_id = ?');
      params.push(customer_id);
    }
    if (search) {
      conditions.push(
        `(n.reference LIKE ? OR c.name LIKE ? OR n.transport_company LIKE ?
          OR EXISTS (SELECT 1 FROM collection_note_items i WHERE i.note_id = n.id AND i.description LIKE ?))`,
      );
      const s = `%${search}%`;
      params.push(s, s, s, s);
    }

    const where = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';

    const allowedSorts = ['collection_date', 'reference', 'created_at', 'customer_name'];
    const sortCol = allowedSorts.includes(sort as string)
      ? sort === 'customer_name'
        ? 'c.name'
        : `n.${sort}`
      : 'n.collection_date';
    const sortOrder = order === 'ASC' ? 'ASC' : 'DESC';

    const parsedLimit = parseInt(limit as string, 10) || 25;
    const offset = ((parseInt(page as string, 10) || 1) - 1) * parsedLimit;

    const countRow = db
      .prepare(`SELECT COUNT(*) AS total FROM collection_notes n JOIN customers c ON n.customer_id = c.id ${where}`)
      .get(...params) as { total: number };

    const rows = db
      .prepare(
        `SELECT n.*, c.name AS customer_name,
                (SELECT GROUP_CONCAT(i.description, ', ')
                   FROM collection_note_items i WHERE i.note_id = n.id) AS items_summary
         FROM collection_notes n
         JOIN customers c ON n.customer_id = c.id
         ${where}
         ORDER BY ${sortCol} ${sortOrder}, n.id DESC
         LIMIT ? OFFSET ?`,
      )
      .all(...params, parsedLimit, offset);

    res.json({ data: rows, total: countRow.total, page: parseInt(page as string, 10) || 1, limit: parsedLimit });
  });

  router.get('/:id', (req, res) => {
    const note = loadCollectionNote(db, parseInt(req.params.id, 10));
    if (!note) {
      res.status(404).json({ error: 'Collection note not found' });
      return;
    }
    res.json(note);
  });

  router.post('/', (req, res) => {
    const body = req.body ?? {};
    const reference = (body.reference ?? '').toString().trim();

    if (!reference) {
      res.status(400).json({ error: 'A reference is required' });
      return;
    }
    if (!body.customer_id) {
      res.status(400).json({ error: 'A customer is required' });
      return;
    }

    const save = db.transaction(() => {
      const result = db
        .prepare(
          `INSERT INTO collection_notes (
             reference, customer_id, site_id, collect_from_address, comments,
             contact_name, contact_phone, po_number, weight, packing_list_no,
             collection_date, transport_company, dispatched_signed_date,
             received_signed_date, created_by_id
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          reference,
          body.customer_id,
          body.site_id ?? null,
          body.collect_from_address ?? null,
          body.comments ?? null,
          body.contact_name ?? null,
          body.contact_phone ?? null,
          body.po_number ?? null,
          body.weight ?? null,
          body.packing_list_no ?? null,
          body.collection_date ?? null,
          body.transport_company ?? null,
          body.dispatched_signed_date ?? null,
          body.received_signed_date ?? null,
          req.session.userId,
        );

      const noteId = result.lastInsertRowid as number;
      insertItems(db, noteId, body.items);
      recordReferenceUsed(db, reference);
      return noteId;
    });

    try {
      const id = save();
      res.json({ id, reference });
    } catch (err) {
      if (isUniqueViolation(err)) {
        res.status(409).json({ error: `Reference ${reference} is already in use` });
        return;
      }
      throw err;
    }
  });

  router.put('/:id', (req, res) => {
    const noteId = parseInt(req.params.id, 10);
    const body = req.body ?? {};
    const reference = (body.reference ?? '').toString().trim();

    if (!db.prepare('SELECT id FROM collection_notes WHERE id = ?').get(noteId)) {
      res.status(404).json({ error: 'Collection note not found' });
      return;
    }
    if (!reference) {
      res.status(400).json({ error: 'A reference is required' });
      return;
    }
    if (!body.customer_id) {
      res.status(400).json({ error: 'A customer is required' });
      return;
    }

    const update = db.transaction(() => {
      db.prepare(
        `UPDATE collection_notes SET
           reference = ?, customer_id = ?, site_id = ?, collect_from_address = ?,
           comments = ?, contact_name = ?, contact_phone = ?, po_number = ?,
           weight = ?, packing_list_no = ?, collection_date = ?, transport_company = ?,
           dispatched_signed_date = ?, received_signed_date = ?,
           updated_at = datetime('now')
         WHERE id = ?`,
      ).run(
        reference,
        body.customer_id,
        body.site_id ?? null,
        body.collect_from_address ?? null,
        body.comments ?? null,
        body.contact_name ?? null,
        body.contact_phone ?? null,
        body.po_number ?? null,
        body.weight ?? null,
        body.packing_list_no ?? null,
        body.collection_date ?? null,
        body.transport_company ?? null,
        body.dispatched_signed_date ?? null,
        body.received_signed_date ?? null,
        noteId,
      );

      // Items carry no foreign keys of their own, so unlike report containers
      // they are safe to replace wholesale.
      db.prepare('DELETE FROM collection_note_items WHERE note_id = ?').run(noteId);
      insertItems(db, noteId, body.items);
      recordReferenceUsed(db, reference);
    });

    try {
      update();
      res.json({ ok: true });
    } catch (err) {
      if (isUniqueViolation(err)) {
        res.status(409).json({ error: `Reference ${reference} is already in use` });
        return;
      }
      throw err;
    }
  });

  router.delete('/:id', (req, res) => {
    const noteId = parseInt(req.params.id, 10);
    if (!db.prepare('SELECT id FROM collection_notes WHERE id = ?').get(noteId)) {
      res.status(404).json({ error: 'Collection note not found' });
      return;
    }
    db.prepare('DELETE FROM collection_notes WHERE id = ?').run(noteId);
    res.json({ ok: true });
  });

  router.post('/:id/signature/:kind', upload.single('signature'), (req, res) => {
    const noteId = parseInt(req.params.id as string, 10);
    const kind = req.params.kind as SignatureKind;

    if (!SIGNATURE_KINDS.includes(kind)) {
      res.status(400).json({ error: 'Signature kind must be dispatched or received' });
      return;
    }
    if (!db.prepare('SELECT id FROM collection_notes WHERE id = ?').get(noteId)) {
      res.status(404).json({ error: 'Collection note not found' });
      return;
    }
    if (!req.file) {
      res.status(400).json({ error: 'No file uploaded' });
      return;
    }

    const relPath = `${SIGNATURE_SUBDIR}/${noteId}/${req.file.filename}`;
    const column = kind === 'dispatched' ? 'dispatched_signature_path' : 'received_signature_path';
    db.prepare(`UPDATE collection_notes SET ${column} = ?, updated_at = datetime('now') WHERE id = ?`).run(
      relPath,
      noteId,
    );
    res.json({ signature_path: relPath });
  });

  return router;
}

function insertItems(db: Database.Database, noteId: number, items: any): void {
  if (!Array.isArray(items) || !items.length) return;
  const stmt = db.prepare(
    'INSERT INTO collection_note_items (note_id, quantity, description, collection_point, sort_order) VALUES (?, ?, ?, ?, ?)',
  );
  for (let i = 0; i < items.length; i++) {
    const item = items[i] ?? {};
    stmt.run(noteId, item.quantity ?? null, item.description ?? null, item.collection_point ?? null, i);
  }
}
