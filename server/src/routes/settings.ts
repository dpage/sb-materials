import { Router } from 'express';
import Database from 'better-sqlite3';
import { requireAuth, requireSuperuser } from '../middleware/auth';
import { getAllSettings, setSetting } from '../utils/settings';
import { NEXT_NUMBER_SETTING, PREFIX_SETTING } from '../utils/collection-note-reference';

// Only these keys may be written through the API, so a stray request cannot
// invent settings the app never reads.
const WRITABLE_SETTINGS = [NEXT_NUMBER_SETTING, PREFIX_SETTING];

export function settingsRoutes(db: Database.Database): Router {
  const router = Router();

  router.get('/', requireAuth, (_req, res) => {
    res.json(getAllSettings(db));
  });

  router.put('/', requireSuperuser, (req, res) => {
    const body = req.body ?? {};
    const keys = Object.keys(body);

    const unknown = keys.filter((key) => !WRITABLE_SETTINGS.includes(key));
    if (unknown.length) {
      res.status(400).json({ error: `Unknown setting: ${unknown.join(', ')}` });
      return;
    }

    const raw = body[NEXT_NUMBER_SETTING];
    if (raw !== undefined) {
      const parsed = parseInt(raw, 10);
      if (!Number.isFinite(parsed) || parsed < 1 || String(parsed) !== String(raw).trim()) {
        res.status(400).json({ error: 'The next collection note number must be a positive whole number' });
        return;
      }
    }

    for (const key of keys) {
      setSetting(db, key, String(body[key]).trim());
    }
    res.json({ ok: true });
  });

  return router;
}
