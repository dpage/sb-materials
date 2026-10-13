import { Router } from 'express';
import bcrypt from 'bcryptjs';
import Database from 'better-sqlite3';
import { recordAudit } from '../utils/audit';

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

    // A failed attempt has no session to attribute it to, so the username as
    // typed is recorded as the actor: whether the account exists is exactly
    // what somebody reading the log wants to tell apart.
    const failed = (reason: string) => {
      recordAudit(db, null, {
        action: 'login-failed',
        entityType: 'session',
        entityId: user?.id ?? null,
        summary: `${username}: ${reason}`,
        actor: { id: user?.id ?? null, username, displayName: user?.display_name ?? null },
      });
      res.status(401).json({ error: 'Invalid credentials' });
    };

    if (!user) {
      failed('no such user');
      return;
    }
    if (!user.is_active) {
      failed('account deactivated');
      return;
    }
    if (!bcrypt.compareSync(password, user.password_hash)) {
      failed('wrong password');
      return;
    }

    req.session.userId = user.id;
    req.session.username = user.username;
    req.session.displayName = user.display_name;
    req.session.phone = user.phone ?? null;
    req.session.isSuperuser = !!user.is_superuser;

    recordAudit(db, req, { action: 'login', entityType: 'session', entityId: user.id, summary: user.display_name });

    res.json({
      id: user.id,
      username: user.username,
      displayName: user.display_name,
      phone: user.phone ?? null,
      isSuperuser: !!user.is_superuser,
    });
  });

  router.post('/logout', (req, res) => {
    // Written before the session is destroyed, since afterwards there is
    // nothing left to say who logged out.
    if (req.session.userId) {
      recordAudit(db, req, {
        action: 'logout',
        entityType: 'session',
        entityId: req.session.userId,
        summary: req.session.displayName ?? null,
      });
    }

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
