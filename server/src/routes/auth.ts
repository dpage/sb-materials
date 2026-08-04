import { Router } from 'express';
import bcrypt from 'bcryptjs';
import Database from 'better-sqlite3';

export function authRoutes(db: Database.Database): Router {
  const router = Router();

  router.post('/login', (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) {
      res.status(400).json({ error: 'Username and password required' });
      return;
    }

    const user = db
      .prepare(
        'SELECT id, username, password_hash, display_name, phone, is_superuser, is_active FROM users WHERE username = ?',
      )
      .get(username) as any;

    if (!user || !user.is_active) {
      res.status(401).json({ error: 'Invalid credentials' });
      return;
    }

    if (!bcrypt.compareSync(password, user.password_hash)) {
      res.status(401).json({ error: 'Invalid credentials' });
      return;
    }

    req.session.userId = user.id;
    req.session.username = user.username;
    req.session.displayName = user.display_name;
    req.session.phone = user.phone ?? null;
    req.session.isSuperuser = !!user.is_superuser;

    res.json({
      id: user.id,
      username: user.username,
      displayName: user.display_name,
      phone: user.phone ?? null,
      isSuperuser: !!user.is_superuser,
    });
  });

  router.post('/logout', (req, res) => {
    req.session.destroy((err) => {
      if (err) {
        res.status(500).json({ error: 'Failed to logout' });
        return;
      }
      res.json({ ok: true });
    });
  });

  router.get('/me', (req, res) => {
    if (!req.session.userId) {
      res.status(401).json({ error: 'Not authenticated' });
      return;
    }
    res.json({
      id: req.session.userId,
      username: req.session.username,
      displayName: req.session.displayName,
      phone: req.session.phone ?? null,
      isSuperuser: req.session.isSuperuser,
    });
  });

  return router;
}
