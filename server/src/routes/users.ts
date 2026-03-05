import { Router } from 'express';
import bcrypt from 'bcryptjs';
import Database from 'better-sqlite3';
import { requireSuperuser } from '../middleware/auth';

export function userRoutes(db: Database.Database): Router {
  const router = Router();

  router.use(requireSuperuser);

  router.get('/', (_req, res) => {
    const users = db
      .prepare(
        'SELECT id, username, display_name, is_superuser, is_active, created_at FROM users ORDER BY display_name',
      )
      .all();
    res.json(users);
  });

  router.get('/:id', (req, res) => {
    const user = db
      .prepare('SELECT id, username, display_name, is_superuser, is_active, created_at FROM users WHERE id = ?')
      .get(req.params.id);
    if (!user) {
      res.status(404).json({ error: 'User not found' });
      return;
    }
    res.json(user);
  });

  router.post('/', (req, res) => {
    const { username, password, display_name, is_superuser } = req.body;
    if (!username || !password || !display_name) {
      res.status(400).json({ error: 'Username, password, and display name required' });
      return;
    }
    const hash = bcrypt.hashSync(password, 10);
    try {
      const result = db
        .prepare('INSERT INTO users (username, password_hash, display_name, is_superuser) VALUES (?, ?, ?, ?)')
        .run(username, hash, display_name, is_superuser ? 1 : 0);
      res.json({ id: result.lastInsertRowid });
    } catch (err: any) {
      if (err.message?.includes('UNIQUE')) {
        res.status(409).json({ error: 'Username already exists' });
        return;
      }
      throw err;
    }
  });

  router.put('/:id', (req, res) => {
    const { username, password, display_name, is_superuser, is_active } = req.body;
    const user = db.prepare('SELECT id FROM users WHERE id = ?').get(req.params.id);
    if (!user) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    if (password) {
      const hash = bcrypt.hashSync(password, 10);
      db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hash, req.params.id);
    }

    db.prepare(
      'UPDATE users SET username = COALESCE(?, username), display_name = COALESCE(?, display_name), is_superuser = COALESCE(?, is_superuser), is_active = COALESCE(?, is_active) WHERE id = ?',
    ).run(
      username,
      display_name,
      is_superuser !== undefined ? (is_superuser ? 1 : 0) : null,
      is_active !== undefined ? (is_active ? 1 : 0) : null,
      req.params.id,
    );

    res.json({ ok: true });
  });

  return router;
}
