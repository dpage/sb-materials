import { Router } from 'express';
import Database from 'better-sqlite3';
import { requireSuperuser } from '../middleware/auth';

const MAX_LIMIT = 200;

/**
 * Reading the audit log. Superuser only throughout: the log names who did
 * what, which is management information rather than something a colleague
 * needs.
 */
export function auditRoutes(db: Database.Database): Router {
  const router = Router();

  router.use(requireSuperuser);

  // The values actually present in the log, so the filters offer what there is
  // to filter by rather than a hardcoded list that drifts from the recorder.
  router.get('/filters', (_req, res) => {
    const column = (name: 'action' | 'entity_type') =>
      (db.prepare(`SELECT DISTINCT ${name} AS value FROM audit_log ORDER BY value`).all() as { value: string }[]).map(
        (row) => row.value,
      );

    res.json({
      actions: column('action'),
      entityTypes: column('entity_type'),
      users: db
        .prepare(
          `SELECT DISTINCT a.user_id AS id, COALESCE(u.display_name, a.display_name, a.username) AS display_name
             FROM audit_log a
             LEFT JOIN users u ON u.id = a.user_id
            WHERE a.user_id IS NOT NULL
            ORDER BY display_name`,
        )
        .all(),
    });
  });

  router.get('/', (req, res) => {
    const { page = '1', limit = '50', user_id, action, entity_type, date_from, date_to, search } = req.query;

    const conditions: string[] = [];
    const params: unknown[] = [];

    if (user_id) {
      conditions.push('a.user_id = ?');
      params.push(user_id);
    }
    if (action) {
      conditions.push('a.action = ?');
      params.push(action);
    }
    if (entity_type) {
      conditions.push('a.entity_type = ?');
      params.push(entity_type);
    }
    // The dates are days, whilst created_at is a timestamp, so the upper bound
    // takes everything on that day rather than only the stroke of midnight.
    if (date_from) {
      conditions.push('a.created_at >= ?');
      params.push(`${date_from} 00:00:00`);
    }
    if (date_to) {
      conditions.push('a.created_at <= ?');
      params.push(`${date_to} 23:59:59`);
    }
    if (search) {
      conditions.push('(a.summary LIKE ? OR a.entity_type LIKE ? OR a.username LIKE ? OR a.display_name LIKE ?)');
      const like = `%${search}%`;
      params.push(like, like, like, like);
    }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const pageNumber = Math.max(1, parseInt(page as string, 10) || 1);
    const pageSize = Math.min(MAX_LIMIT, Math.max(1, parseInt(limit as string, 10) || 50));

    const { total } = db.prepare(`SELECT COUNT(*) AS total FROM audit_log a ${where}`).get(...params) as {
      total: number;
    };

    const rows = db
      .prepare(
        `SELECT a.*, u.display_name AS current_display_name
           FROM audit_log a
           LEFT JOIN users u ON u.id = a.user_id
          ${where}
          ORDER BY a.created_at DESC, a.id DESC
          LIMIT ? OFFSET ?`,
      )
      .all(...params, pageSize, (pageNumber - 1) * pageSize);

    res.json({ data: rows, total, page: pageNumber, limit: pageSize });
  });

  return router;
}
