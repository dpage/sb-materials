import { Router } from 'express';
import Database from 'better-sqlite3';
import { requireAuth, requireSuperuser } from '../middleware/auth';
import { getAllSettings, setSetting } from '../utils/settings';
import { NEXT_NUMBER_SETTING, PREFIX_SETTING } from '../utils/collection-note-reference';
import { BACKUP_ENABLED_SETTING, BACKUP_HOUR_SETTING, BACKUP_KEEP_SETTING } from '../backup/scheduler';

// Only these keys may be written through the API, so a stray request cannot
// invent settings the app never reads.
const WRITABLE_SETTINGS = [NEXT_NUMBER_SETTING, PREFIX_SETTING, BACKUP_ENABLED_SETTING, BACKUP_HOUR_SETTING, BACKUP_KEEP_SETTING];

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

    const hourRaw = body[BACKUP_HOUR_SETTING];
    if (hourRaw !== undefined) {
      const parsed = parseInt(hourRaw, 10);
      if (!Number.isFinite(parsed) || parsed < 0 || parsed > 23 || String(parsed) !== String(hourRaw).trim()) {
        res.status(400).json({ error: 'The backup hour must be a whole number between 0 and 23' });
        return;
      }
    }

    const keepRaw = body[BACKUP_KEEP_SETTING];
    if (keepRaw !== undefined) {
      const parsed = parseInt(keepRaw, 10);
      if (!Number.isFinite(parsed) || parsed < 1 || String(parsed) !== String(keepRaw).trim()) {
        res.status(400).json({ error: 'The number of backups to keep must be a positive whole number' });
        return;
      }
    }

    const enabledRaw = body[BACKUP_ENABLED_SETTING];
    if (enabledRaw !== undefined && !['true', 'false'].includes(String(enabledRaw).trim())) {
      res.status(400).json({ error: 'The backup enabled flag must be true or false' });
      return;
    }

    for (const key of keys) {
      setSetting(db, key, String(body[key]).trim());
    }
    res.json({ ok: true });
  });

  return router;
}
