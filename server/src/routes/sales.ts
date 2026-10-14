import { Router } from 'express';
import Database from 'better-sqlite3';
import { requireSuperuser } from '../middleware/auth';
import { describeCollectionNote, recordAudit } from '../utils/audit';

/**
 * The sales list: one line per consignment, fed by the collection notes
 * themselves rather than entered separately, staying on the list until the
 * sale is ticked as paid. Superuser only, since it carries the prices.
 */
export function salesRoutes(db: Database.Database): Router {
  const router = Router();

  router.use(requireSuperuser);

  router.get('/', (req, res) => {
    const status = req.query.status === 'paid' ? 'paid' : req.query.status === 'all' ? 'all' : 'unpaid';
    const search = (req.query.search ?? '').toString().trim();

    const conditions: string[] = [];
    const params: unknown[] = [];

    if (status === 'unpaid') conditions.push('COALESCE(n.is_paid, 0) = 0');
    if (status === 'paid') conditions.push('COALESCE(n.is_paid, 0) = 1');
    if (search) {
      conditions.push('(n.reference LIKE ? OR c.name LIKE ? OR n.buyer LIKE ?)');
      const s = `%${search}%`;
      params.push(s, s, s);
    }

    const where = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';

    const rows = db
      .prepare(
        `SELECT n.id, n.reference, n.collection_date, n.buyer, n.buy_price, n.sale_price,
                COALESCE(n.is_paid, 0) AS is_paid, n.paid_date, c.name AS customer_name
           FROM collection_notes n
           JOIN customers c ON n.customer_id = c.id
           ${where}
          ORDER BY n.collection_date DESC, n.id DESC`,
      )
      .all(...params) as { sale_price: number | null; buy_price: number | null }[];

    // The figure that matters on an unpaid list is what is still owed, so the
    // outstanding total counts only the lines that have not been ticked.
    const outstanding = db
      .prepare(
        `SELECT COALESCE(SUM(sale_price), 0) AS total
           FROM collection_notes WHERE COALESCE(is_paid, 0) = 0`,
      )
      .get() as { total: number };

    res.json({ data: rows, outstanding: outstanding.total });
  });

  router.put('/:id/paid', (req, res) => {
    const noteId = parseInt(req.params.id, 10);
    if (!db.prepare('SELECT id FROM collection_notes WHERE id = ?').get(noteId)) {
      res.status(404).json({ error: 'Collection note not found' });
      return;
    }

    const isPaid = !!req.body?.is_paid;
    db.prepare(
      `UPDATE collection_notes
          SET is_paid = ?, paid_date = ?, updated_at = datetime('now')
        WHERE id = ?`,
    ).run(isPaid ? 1 : 0, isPaid ? new Date().toISOString().slice(0, 10) : null, noteId);

    recordAudit(db, req, {
      action: isPaid ? 'mark-paid' : 'mark-unpaid',
      entityType: 'collection-note',
      entityId: noteId,
      summary: describeCollectionNote(db, noteId),
    });

    const row = db.prepare('SELECT is_paid, paid_date FROM collection_notes WHERE id = ?').get(noteId);
    res.json(row);
  });

  return router;
}
