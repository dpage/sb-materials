import { Router } from 'express';
import Database from 'better-sqlite3';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { requireAuth } from '../middleware/auth';
import { config } from '../config';
import { archiveImageFile } from '../utils/image';
import { logger } from '../utils/logger';
import { removeUploadDir } from '../utils/uploads';
import { expenseTotals, toNumber } from '../utils/mileage';
import { describeSheet, recordAudit } from '../utils/audit';
import {
  isSuperuser,
  loadSheetForUser,
  openSheet,
  parseMonth,
  requestedUserId,
  sessionUserId,
  touchSheet,
} from '../utils/sheets';

// Receipts live under uploads/expenses/<sheetId>/, following the collection
// note signatures, so the backup archive and the orphan sweep already know
// about them.
export const RECEIPT_SUBDIR = 'expenses';
const MAX_RECEIPTS_PER_UPLOAD = 20;

interface ItemInput {
  item_date?: string | null;
  description?: string | null;
  cost?: number | string | null;
  vat_applicable?: boolean | number | null;
  vat_amount?: number | string | null;
}

export function expenseRoutes(db: Database.Database): Router {
  const router = Router();

  router.use(requireAuth);

  const storage = multer.diskStorage({
    destination: (req: any, _file, cb) => {
      // The ownership check below runs before multer, so by this point :id is
      // a sheet the caller may write to.
      const dir = path.join(config.uploadsDir, RECEIPT_SUBDIR, req.params.id);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      cb(null, dir);
    },
    filename: (_req, file, cb) => {
      cb(null, `${Date.now()}-${Math.round(Math.random() * 1e9)}${path.extname(file.originalname)}`);
    },
  });

  const upload = multer({
    storage,
    limits: { fileSize: 20 * 1024 * 1024 },
    fileFilter: (_file, file, cb) => {
      if (/\.(jpg|jpeg|png|gif|webp|heic|heif)$/i.test(path.extname(file.originalname))) cb(null, true);
      else cb(new Error('Only image files are allowed'));
    },
  });

  const itemsFor = (sheetId: number) =>
    db.prepare('SELECT * FROM expense_items WHERE sheet_id = ? ORDER BY sort_order, id').all(sheetId) as Record<
      string,
      unknown
    >[];

  const photosFor = (sheetId: number) =>
    db.prepare('SELECT * FROM expense_photos WHERE sheet_id = ? ORDER BY sort_order, id').all(sheetId) as Record<
      string,
      unknown
    >[];

  const withTotals = (sheet: { id: number }) => {
    const items = itemsFor(sheet.id);
    return { ...sheet, items, photos: photosFor(sheet.id), totals: expenseTotals(items) };
  };

  router.get('/', (req, res) => {
    const userId = requestedUserId(req);
    const rows = db
      .prepare(
        `SELECT s.*, u.display_name AS display_name
           FROM expense_sheets s
           JOIN users u ON u.id = s.user_id
          ${userId === null ? '' : 'WHERE s.user_id = ?'}
          ORDER BY s.year DESC, s.month DESC, u.display_name`,
      )
      .all(...(userId === null ? [] : [userId])) as { id: number }[];

    res.json(
      rows.map((row) => {
        const items = itemsFor(row.id);
        return { ...row, item_count: items.length, totals: expenseTotals(items) };
      }),
    );
  });

  router.get('/:id', (req, res) => {
    const sheet = loadSheetForUser(db, 'expense_sheets', parseInt(req.params.id, 10), req);
    if (!sheet) {
      res.status(404).json({ error: 'Expense sheet not found' });
      return;
    }
    res.json(withTotals(sheet));
  });

  router.post('/', (req, res) => {
    const month = parseMonth(req.body ?? {});
    if (!month) {
      res.status(400).json({ error: 'A valid year and month are required' });
      return;
    }

    const askedFor = parseInt(String(req.body?.user_id ?? ''), 10);
    const userId = isSuperuser(req) && Number.isFinite(askedFor) ? askedFor : sessionUserId(req);

    if (!db.prepare('SELECT id FROM users WHERE id = ?').get(userId)) {
      res.status(400).json({ error: 'Unknown user' });
      return;
    }

    // As on the travel sheets, only a sheet that did not already exist earns
    // an entry: opening a month you already have is a navigation, not a change.
    const existing = db
      .prepare('SELECT id FROM expense_sheets WHERE user_id = ? AND year = ? AND month = ?')
      .get(userId, month.year, month.month);
    const id = openSheet(db, 'expense_sheets', userId, month.year, month.month);
    if (!existing) {
      recordAudit(db, req, {
        action: 'create',
        entityType: 'expense-sheet',
        entityId: id,
        summary: describeSheet(db, 'expense_sheets', id),
      });
    }
    res.status(201).json(withTotals(loadSheetForUser(db, 'expense_sheets', id, req)!));
  });

  router.put('/:id', (req, res) => {
    const sheet = loadSheetForUser(db, 'expense_sheets', parseInt(req.params.id, 10), req);
    if (!sheet) {
      res.status(404).json({ error: 'Expense sheet not found' });
      return;
    }

    const { notes, items } = req.body ?? {};

    const save = db.transaction(() => {
      if (notes !== undefined) {
        db.prepare('UPDATE expense_sheets SET notes = ? WHERE id = ?').run(notes ?? null, sheet.id);
      }

      if (items !== undefined) {
        // A receipt points at the item it belongs to, so the items cannot
        // simply be deleted and reinserted the way the travel legs are: that
        // would orphan every photo. Rows that came back with an id are
        // updated in place, the rest are inserted, and anything the form no
        // longer holds is deleted, which releases its photos to the sheet
        // through ON DELETE SET NULL rather than taking them with it.
        const incoming = items as (ItemInput & { id?: number })[];
        const keptIds = incoming.map((item) => item.id).filter((id): id is number => Number.isFinite(id as number));

        const existing = db.prepare('SELECT id FROM expense_items WHERE sheet_id = ?').all(sheet.id) as {
          id: number;
        }[];
        for (const row of existing) {
          if (!keptIds.includes(row.id)) db.prepare('DELETE FROM expense_items WHERE id = ?').run(row.id);
        }

        const insert = db.prepare(
          `INSERT INTO expense_items (sheet_id, item_date, description, cost, vat_applicable, vat_amount, sort_order)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
        );
        const update = db.prepare(
          `UPDATE expense_items
              SET item_date = ?, description = ?, cost = ?, vat_applicable = ?, vat_amount = ?, sort_order = ?
            WHERE id = ? AND sheet_id = ?`,
        );

        incoming.forEach((item, index) => {
          const vatApplicable = item.vat_applicable ? 1 : 0;
          // The VAT amount is only meaningful when VAT applies, so an item
          // switched to "no VAT" does not keep a figure nobody can see.
          const vatAmount = vatApplicable ? toNumber(item.vat_amount) : null;
          const values = [
            item.item_date || null,
            item.description || null,
            toNumber(item.cost),
            vatApplicable,
            vatAmount,
            index,
          ];
          if (item.id !== undefined && keptIds.includes(item.id)) update.run(...values, item.id, sheet.id);
          else insert.run(sheet.id, ...values);
        });
      }

      touchSheet(db, 'expense_sheets', sheet.id);
    });
    save();

    recordAudit(db, req, {
      action: 'update',
      entityType: 'expense-sheet',
      entityId: sheet.id,
      summary: describeSheet(db, 'expense_sheets', sheet.id),
    });

    res.json(withTotals(loadSheetForUser(db, 'expense_sheets', sheet.id, req)!));
  });

  router.delete('/:id', (req, res) => {
    const sheet = loadSheetForUser(db, 'expense_sheets', parseInt(req.params.id, 10), req);
    if (!sheet) {
      res.status(404).json({ error: 'Expense sheet not found' });
      return;
    }
    const summary = describeSheet(db, 'expense_sheets', sheet.id);
    db.prepare('DELETE FROM expense_sheets WHERE id = ?').run(sheet.id);
    recordAudit(db, req, { action: 'delete', entityType: 'expense-sheet', entityId: sheet.id, summary });
    removeUploadDir(config.uploadsDir, path.join(RECEIPT_SUBDIR, String(sheet.id)));
    res.json({ ok: true });
  });

  /**
   * Confirm the caller may write to this sheet before multer writes anything
   * to disk, so an upload against somebody else's sheet never creates a file.
   */
  const requireOwnSheet = (req: any, res: any, next: any) => {
    const sheet = loadSheetForUser(db, 'expense_sheets', parseInt(req.params.id, 10), req);
    if (!sheet) {
      res.status(404).json({ error: 'Expense sheet not found' });
      return;
    }
    req.sheet = sheet;
    next();
  };

  router.post('/:id/photos', requireOwnSheet, upload.array('photos', MAX_RECEIPTS_PER_UPLOAD), async (req, res) => {
    const sheetId = (req as any).sheet.id as number;
    const files = req.files as Express.Multer.File[];
    if (!files?.length) {
      res.status(400).json({ error: 'No files uploaded' });
      return;
    }

    const filenames: string[] = [];
    try {
      for (const file of files) {
        filenames.push(path.basename(await archiveImageFile(file.path)));
      }
    } catch (err) {
      logger.error('Failed to process uploaded receipt:', err);
      files.forEach((f) => fs.existsSync(f.path) && fs.unlinkSync(f.path));
      res.status(400).json({ error: 'Failed to process image' });
      return;
    }

    const itemIds = Array.isArray(req.body.item_ids) ? req.body.item_ids : req.body.item_ids ? [req.body.item_ids] : [];
    const maxOrder = (
      db
        .prepare('SELECT COALESCE(MAX(sort_order), -1) AS max_order FROM expense_photos WHERE sheet_id = ?')
        .get(sheetId) as {
        max_order: number;
      }
    ).max_order;

    const insert = db.prepare(
      'INSERT INTO expense_photos (sheet_id, item_id, file_path, sort_order) VALUES (?, ?, ?, ?)',
    );
    const inserted = filenames.map((filename, index) => {
      const relPath = path.join(RECEIPT_SUBDIR, String(sheetId), filename);
      const itemId = toNumber(itemIds[index]);
      const result = insert.run(sheetId, itemId, relPath, maxOrder + 1 + index);
      return { id: result.lastInsertRowid, file_path: relPath, item_id: itemId };
    });

    res.json(inserted);
  });

  router.delete('/:id/photos/:photoId', requireOwnSheet, (req, res) => {
    const sheetId = (req as any).sheet.id as number;
    const photo = db
      .prepare('SELECT * FROM expense_photos WHERE id = ? AND sheet_id = ?')
      .get(parseInt(req.params.photoId, 10), sheetId) as { id: number; file_path: string } | undefined;
    if (!photo) {
      res.status(404).json({ error: 'Receipt not found' });
      return;
    }

    db.prepare('DELETE FROM expense_photos WHERE id = ?').run(photo.id);

    // Best effort, as the report photo delete is: the row has gone, and a file
    // left behind is picked up by the orphan sweep.
    const filePath = path.resolve(config.uploadsDir, photo.file_path);
    if (filePath.startsWith(path.resolve(config.uploadsDir) + path.sep) && fs.existsSync(filePath)) {
      try {
        fs.unlinkSync(filePath);
      } catch (err) {
        logger.error(`Failed to remove receipt ${photo.file_path}:`, err);
      }
    }

    res.json({ ok: true });
  });

  /**
   * Serve a receipt. Deliberately not the shared /api/photos/file route: a
   * receipt is somebody's personal spending, so it goes through the same
   * ownership check as the sheet it belongs to.
   */
  router.get('/:id/photos/:photoId/file', requireOwnSheet, (req, res) => {
    const sheetId = (req as any).sheet.id as number;
    const photo = db
      .prepare('SELECT file_path FROM expense_photos WHERE id = ? AND sheet_id = ?')
      .get(parseInt(req.params.photoId, 10), sheetId) as { file_path: string } | undefined;
    if (!photo) {
      res.status(404).json({ error: 'Receipt not found' });
      return;
    }

    const filePath = path.resolve(config.uploadsDir, photo.file_path);
    if (!filePath.startsWith(path.resolve(config.uploadsDir) + path.sep) || !fs.existsSync(filePath)) {
      res.status(404).json({ error: 'Receipt not found' });
      return;
    }
    res.sendFile(filePath);
  });

  return router;
}
