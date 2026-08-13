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
// Only the dispatching signature is captured: the note leaves with the load and
// never comes back, so a "goods received" signature could never be collected.
const SIGNATURE_KINDS = ['dispatched'] as const;
type SignatureKind = (typeof SIGNATURE_KINDS)[number];

function isUniqueViolation(err: unknown): boolean {
  return err instanceof Error && /UNIQUE constraint failed/i.test(err.message);
}

export function collectionNoteRoutes(db: Database.Database): Router {
  const router = Router();

  router.use(requireAuth);

  const storage = multer.diskStorage({
    destination: (req: any, _file, cb) => {
      // By the time multer runs, Express has already matched the route and
      // populated req.params against the /:id/signature/:kind pattern, and
      // the validation middleware below has confirmed :id is a plain
      // integer, so this always agrees with what the handler later derives
      // for the stored path - no separate URL-regex parsing to fall out of
      // step with it.
      const dir = path.join(config.uploadsDir, SIGNATURE_SUBDIR, req.params.id);
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
             contact_name, contact_phone, buyer_reference, minimum_weight,
             collection_date, transport_company, dispatched_signed_date,
             created_by_id
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          reference,
          body.customer_id,
          body.site_id ?? null,
          body.collect_from_address ?? null,
          body.comments ?? null,
          body.contact_name ?? null,
          body.contact_phone ?? null,
          body.buyer_reference ?? null,
          body.minimum_weight ?? null,
          body.collection_date ?? null,
          body.transport_company ?? null,
          body.dispatched_signed_date ?? null,
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
           comments = ?, contact_name = ?, contact_phone = ?, buyer_reference = ?,
           minimum_weight = ?, collection_date = ?, transport_company = ?,
           dispatched_signed_date = ?,
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
        body.buyer_reference ?? null,
        body.minimum_weight ?? null,
        body.collection_date ?? null,
        body.transport_company ?? null,
        body.dispatched_signed_date ?? null,
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

  // Duplicate a note. The same load often goes out a dozen times over, so the
  // whole note is copied bar the things that must not be shared: the copy takes
  // the next reference in the sequence, today's collection date, and no
  // signature, since a signature belongs to the load it was given for.
  router.post('/:id/duplicate', (req, res) => {
    const source = loadCollectionNote(db, parseInt(req.params.id, 10));
    if (!source) {
      res.status(404).json({ error: 'Collection note not found' });
      return;
    }

    const copy = db.transaction(() => {
      const reference = allocateNextReference(db);
      const result = db
        .prepare(
          `INSERT INTO collection_notes (
             reference, customer_id, site_id, collect_from_address, comments,
             contact_name, contact_phone, buyer_reference, minimum_weight,
             collection_date, transport_company, created_by_id
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, date('now'), ?, ?)`,
        )
        .run(
          reference,
          source.customer_id,
          source.site_id,
          source.collect_from_address,
          source.comments,
          source.contact_name,
          source.contact_phone,
          source.buyer_reference,
          source.minimum_weight,
          source.transport_company,
          req.session.userId,
        );

      const noteId = result.lastInsertRowid as number;
      insertItems(db, noteId, source.items);
      recordReferenceUsed(db, reference);
      return { id: noteId, reference };
    });

    try {
      res.json(copy());
    } catch (err) {
      if (isUniqueViolation(err)) {
        res.status(409).json({ error: 'The next reference is already in use; try again' });
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

  // Validate :id and :kind, and confirm the note exists, before the upload
  // middleware runs, so a malformed or bogus URL is rejected without ever
  // writing a file to disk (rather than writing it under a "misc" fallback
  // directory and then rejecting).
  function validateSignatureTarget(req: any, res: any, next: any): void {
    const kind = req.params.kind as SignatureKind;
    if (!SIGNATURE_KINDS.includes(kind)) {
      res.status(400).json({ error: 'Signature kind must be dispatched or received' });
      return;
    }
    if (
      !/^\d+$/.test(req.params.id) ||
      !db.prepare('SELECT id FROM collection_notes WHERE id = ?').get(req.params.id)
    ) {
      res.status(404).json({ error: 'Collection note not found' });
      return;
    }
    next();
  }

  router.post('/:id/signature/:kind', validateSignatureTarget, upload.single('signature'), (req, res) => {
    const noteId = parseInt(req.params.id as string, 10);
    const kind = req.params.kind as SignatureKind;

    if (!req.file) {
      res.status(400).json({ error: 'No file uploaded' });
      return;
    }

    // Derived from where the file actually landed, rather than reconstructed
    // from the id and kind, so it can never disagree with reality.
    const relPath = path.relative(config.uploadsDir, req.file.path);
    const column = kind === 'dispatched' ? 'dispatched_signature_path' : 'received_signature_path';
    db.prepare(`UPDATE collection_notes SET ${column} = ?, updated_at = datetime('now') WHERE id = ?`).run(
      relPath,
      noteId,
    );
    res.json({ signature_path: relPath });
  });

  return router;
}

function isBlankItem(item: any): boolean {
  const blank = (v: unknown) => v === null || v === undefined || String(v).trim() === '';
  return blank(item?.quantity) && blank(item?.description) && blank(item?.nett_weight) && blank(item?.collection_point);
}

function insertItems(db: Database.Database, noteId: number, items: any): void {
  if (!Array.isArray(items) || !items.length) return;
  const stmt = db.prepare(
    `INSERT INTO collection_note_items (note_id, quantity, description, nett_weight, collection_point, sort_order)
     VALUES (?, ?, ?, ?, ?, ?)`,
  );
  // The form always starts with (and can be left with) one blank line item,
  // so skip rows where every field is empty rather than storing and later
  // printing an empty PDF table row.
  let sortOrder = 0;
  for (const item of items) {
    if (isBlankItem(item)) continue;
    stmt.run(
      noteId,
      item?.quantity ?? null,
      item?.description ?? null,
      item?.nett_weight ?? null,
      item?.collection_point ?? null,
      sortOrder,
    );
    sortOrder += 1;
  }
}
