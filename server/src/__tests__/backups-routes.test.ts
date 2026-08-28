import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import request from 'supertest';
import express from 'express';
import session from 'express-session';
import Database from 'better-sqlite3';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { createSchema } from '../db/schema';
import { seedData } from '../db/seed';
import { authRoutes } from '../routes/auth';
import { backupRoutes } from '../routes/backups';
import { BackupCoordinator, BACKUP_KEEP_SETTING } from '../backup/scheduler';
import { createArchive } from '../backup/archive';
import { restorePaths, readMarker } from '../backup/restore';
import { setSetting } from '../utils/settings';

describe('Backup Routes', () => {
  let db: Database.Database;
  let app: express.Express;
  let cookie: string;
  let tmpDir: string;
  let dataDir: string;
  let backupsDir: string;
  let uploadsDir: string;
  let coordinator: BackupCoordinator;
  let closeAndRestart: ReturnType<typeof vi.fn<() => void>>;

  beforeEach(async () => {
    db = new Database(':memory:');
    db.pragma('journal_mode = WAL');
    createSchema(db);
    seedData(db);

    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-backup-routes-test-'));
    dataDir = path.join(tmpDir, 'data');
    backupsDir = path.join(dataDir, 'backups');
    uploadsDir = path.join(dataDir, 'uploads');
    fs.mkdirSync(uploadsDir, { recursive: true });

    coordinator = new BackupCoordinator(db, backupsDir, uploadsDir);
    closeAndRestart = vi.fn();

    app = express();
    app.use(express.json());
    app.use(session({ secret: 'test', resave: false, saveUninitialized: false }));
    app.use('/api/auth', authRoutes(db));
    app.use('/api/backups', backupRoutes(db, { dataDir, backupsDir, uploadsDir, coordinator, closeAndRestart }));

    const loginRes = await request(app).post('/api/auth/login').send({ username: 'admin', password: 'admin' });
    const cookies = loginRes.headers['set-cookie'];
    cookie = Array.isArray(cookies) ? cookies[0] : cookies;
  });

  afterEach(() => {
    db.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('authorisation', () => {
    it('rejects an unauthenticated request to every endpoint', async () => {
      expect((await request(app).get('/api/backups')).status).toBe(401);
      expect((await request(app).post('/api/backups')).status).toBe(401);
      expect((await request(app).get('/api/backups/foo/download')).status).toBe(401);
      expect((await request(app).delete('/api/backups/foo')).status).toBe(401);
      expect((await request(app).post('/api/backups/foo/restore')).status).toBe(401);
      expect((await request(app).post('/api/backups/restore/upload')).status).toBe(401);
    });

    it('rejects a non-superuser at every endpoint', async () => {
      const bcrypt = await import('bcryptjs');
      db.prepare('INSERT INTO users (username, password_hash, display_name, is_superuser) VALUES (?, ?, ?, 0)').run(
        'regular',
        bcrypt.hashSync('password123', 10),
        'Regular User',
      );
      const loginRes = await request(app)
        .post('/api/auth/login')
        .send({ username: 'regular', password: 'password123' });
      const regularCookie = Array.isArray(loginRes.headers['set-cookie'])
        ? loginRes.headers['set-cookie'][0]
        : loginRes.headers['set-cookie'];

      expect((await request(app).get('/api/backups').set('Cookie', regularCookie)).status).toBe(403);
      expect((await request(app).post('/api/backups').set('Cookie', regularCookie)).status).toBe(403);
      expect((await request(app).get('/api/backups/foo/download').set('Cookie', regularCookie)).status).toBe(403);
      expect((await request(app).delete('/api/backups/foo').set('Cookie', regularCookie)).status).toBe(403);
      expect((await request(app).post('/api/backups/foo/restore').set('Cookie', regularCookie)).status).toBe(403);
      expect((await request(app).post('/api/backups/restore/upload').set('Cookie', regularCookie)).status).toBe(403);
    });
  });

  it('GET / lists no archives initially, then the one just taken', async () => {
    expect((await request(app).get('/api/backups').set('Cookie', cookie)).body).toEqual([]);

    await request(app).post('/api/backups').set('Cookie', cookie).expect(200);

    const listRes = await request(app).get('/api/backups').set('Cookie', cookie);
    expect(listRes.body).toHaveLength(1);
    expect(listRes.body[0].kind).toBe('manual');
  });

  it('DELETE removes an archive', async () => {
    const postRes = await request(app).post('/api/backups').set('Cookie', cookie);
    const filename = postRes.body.filename;

    await request(app).delete(`/api/backups/${filename}`).set('Cookie', cookie).expect(200);
    expect((await request(app).get('/api/backups').set('Cookie', cookie)).body).toEqual([]);
  });

  it('DELETE removes the manifest sidecar along with the archive', async () => {
    const postRes = await request(app).post('/api/backups').set('Cookie', cookie);
    const filename = postRes.body.filename;
    expect(fs.existsSync(path.join(backupsDir, `${filename}.manifest.json`))).toBe(true);

    await request(app).delete(`/api/backups/${filename}`).set('Cookie', cookie).expect(200);

    expect(fs.readdirSync(backupsDir)).toEqual([]);
  });

  it('DELETE returns 404 for a filename that is not in the directory listing, refusing traversal attempts', async () => {
    const res = await request(app)
      .delete('/api/backups/' + encodeURIComponent('../../etc/passwd'))
      .set('Cookie', cookie);
    expect(res.status).toBe(404);
  });

  it('refuses to resolve anything in the backups directory that is not an archive', async () => {
    // A staging directory of the sort createArchive holds open whilst building an
    // archive, and a manifest sidecar: neither should be reachable as :file, and
    // in particular DELETE must not take fs.unlinkSync to a directory.
    fs.mkdirSync(path.join(backupsDir, '.building-abc123'), { recursive: true });
    const postRes = await request(app).post('/api/backups').set('Cookie', cookie);
    const sidecar = `${postRes.body.filename}.manifest.json`;

    for (const name of ['.building-abc123', sidecar]) {
      expect((await request(app).delete(`/api/backups/${name}`).set('Cookie', cookie)).status).toBe(404);
      expect((await request(app).get(`/api/backups/${name}/download`).set('Cookie', cookie)).status).toBe(404);
      expect((await request(app).post(`/api/backups/${name}/restore`).set('Cookie', cookie)).status).toBe(404);
    }
    expect(fs.existsSync(path.join(backupsDir, '.building-abc123'))).toBe(true);
    expect(fs.existsSync(path.join(backupsDir, sidecar))).toBe(true);
  });

  it('GET download streams an existing archive and 404s for an unknown one', async () => {
    const postRes = await request(app).post('/api/backups').set('Cookie', cookie);
    const filename = postRes.body.filename;

    const okRes = await request(app).get(`/api/backups/${filename}/download`).set('Cookie', cookie);
    expect(okRes.status).toBe(200);

    const missingRes = await request(app).get('/api/backups/does-not-exist.tar.gz/download').set('Cookie', cookie);
    expect(missingRes.status).toBe(404);
  });

  describe('restore', () => {
    it('restores from an on-disk archive: validates, snapshots, stages, marks, responds, then restarts', async () => {
      const postRes = await request(app).post('/api/backups').set('Cookie', cookie);
      const filename = postRes.body.filename;

      const restoreRes = await request(app).post(`/api/backups/${filename}/restore`).set('Cookie', cookie);
      expect(restoreRes.status).toBe(200);

      // A pre-restore snapshot was taken before the swap.
      const listRes = await request(app).get('/api/backups').set('Cookie', cookie);
      expect(listRes.body.some((a: any) => a.kind === 'pre-restore')).toBe(true);

      // The marker was written before responding, so it should exist right after the response...
      const paths = restorePaths(dataDir);
      expect(readMarker(paths.markerPath)).not.toBeNull();

      // ...and closeAndRestart is called (asynchronously) rather than process.exit being invoked directly.
      await new Promise((resolve) => setImmediate(resolve));
      expect(closeAndRestart).toHaveBeenCalled();
    });

    it('rejects a restore of an unknown filename with 404', async () => {
      const res = await request(app).post('/api/backups/does-not-exist.tar.gz/restore').set('Cookie', cookie);
      expect(res.status).toBe(404);
    });

    it('rejects restoring an archive that requires a newer schema version than this build supports, with 400, touching nothing', async () => {
      const badArchive = await createArchive({ db, backupsDir, uploadsDir, kind: 'manual' });

      // Forge a schema version this build has no migrations for.
      const tar = await import('tar');
      const extractDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-forge-'));
      await tar.extract({ file: badArchive.path, cwd: extractDir });
      const manifestPath = path.join(extractDir, 'manifest.json');
      const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
      manifest.dbSchemaVersion = 999999;
      fs.writeFileSync(manifestPath, JSON.stringify(manifest));
      fs.unlinkSync(badArchive.path);
      await tar.create({ gzip: true, file: badArchive.path, cwd: extractDir }, [
        'manifest.json',
        'sb-materials.db',
        'uploads',
      ]);
      fs.rmSync(extractDir, { recursive: true, force: true });

      const res = await request(app).post(`/api/backups/${badArchive.filename}/restore`).set('Cookie', cookie);
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/schema version/);
      expect(closeAndRestart).not.toHaveBeenCalled();

      const paths = restorePaths(dataDir);
      expect(readMarker(paths.markerPath)).toBeNull();
    });

    it('rejects restore/upload with 400 when no file is attached', async () => {
      const res = await request(app).post('/api/backups/restore/upload').set('Cookie', cookie);
      expect(res.status).toBe(400);
    });

    it('restores from an uploaded archive', async () => {
      const postRes = await request(app).post('/api/backups').set('Cookie', cookie);
      const filename = postRes.body.filename;
      const archiveBytes = fs.readFileSync(path.join(backupsDir, filename));

      const res = await request(app)
        .post('/api/backups/restore/upload')
        .set('Cookie', cookie)
        .attach('archive', archiveBytes, 'upload.tar.gz');

      expect(res.status).toBe(200);
      await new Promise((resolve) => setImmediate(resolve));
      expect(closeAndRestart).toHaveBeenCalled();
    });

    it('keeps all of its scratch space under the data directory, and cleans it up', async () => {
      const postRes = await request(app).post('/api/backups').set('Cookie', cookie);
      const archiveBytes = fs.readFileSync(path.join(backupsDir, postRes.body.filename));

      const res = await request(app)
        .post('/api/backups/restore/upload')
        .set('Cookie', cookie)
        .attach('archive', archiveBytes, 'upload.tar.gz');
      expect(res.status).toBe(200);

      // The uploaded archive, the validation extract and the scratch copy of the
      // source all go here rather than into os.tmpdir(), which under a unit with
      // PrivateTmp=yes is a tmpfs far smaller than the volume sized for the data.
      const scratchDir = restorePaths(dataDir).scratchDir;
      expect(fs.existsSync(scratchDir)).toBe(true);
      expect(fs.readdirSync(scratchDir)).toEqual([]);
    });

    it('returns 500, not a crash, when an unexpected error occurs after the pre-restore snapshot', async () => {
      const postRes = await request(app).post('/api/backups').set('Cookie', cookie);
      const filename = postRes.body.filename;

      // Simulate something going wrong while taking the pre-restore safety
      // snapshot (e.g. disk full mid-archive) rather than a validation failure.
      vi.spyOn(coordinator, 'takeBackupNow').mockRejectedValueOnce(new Error('disk full'));

      const res = await request(app).post(`/api/backups/${filename}/restore`).set('Cookie', cookie);

      // The request fails cleanly instead of hanging or taking the process down,
      // and no restart is triggered for a restore that never actually happened.
      expect(res.status).toBe(500);
      expect(closeAndRestart).not.toHaveBeenCalled();

      const paths = restorePaths(dataDir);
      expect(readMarker(paths.markerPath)).toBeNull();
    });

    it('clears the staged copy when the restore fails before the marker is written', async () => {
      const postRes = await request(app).post('/api/backups').set('Cookie', cookie);
      const filename = postRes.body.filename;
      const paths = restorePaths(dataDir);

      // Fail the marker's final rename, which is the last step of a restore and
      // the point after which startup recovery would take responsibility for the
      // staged copy. Anything failing before it leaves that copy, the size of the
      // entire photo tree, with nothing that will ever come back for it.
      const realRename = fs.renameSync;
      const renameSpy = vi.spyOn(fs, 'renameSync').mockImplementation((from, to) => {
        if (String(to).endsWith('.restore-marker.json')) throw new Error('rename failed');
        return realRename(from as string, to as string);
      });

      try {
        const res = await request(app).post(`/api/backups/${filename}/restore`).set('Cookie', cookie);
        expect(res.status).toBe(500);
      } finally {
        renameSpy.mockRestore();
      }

      expect(readMarker(paths.markerPath)).toBeNull();
      expect(fs.existsSync(paths.stagingDir)).toBe(false);
      expect(closeAndRestart).not.toHaveBeenCalled();
    });

    it('leaves the staged copy in place on the success path, for startup recovery to apply', async () => {
      const postRes = await request(app).post('/api/backups').set('Cookie', cookie);

      const res = await request(app).post(`/api/backups/${postRes.body.filename}/restore`).set('Cookie', cookie);

      expect(res.status).toBe(200);
      const paths = restorePaths(dataDir);
      expect(readMarker(paths.markerPath)).not.toBeNull();
      expect(fs.existsSync(paths.stagingDir)).toBe(true);
    });

    it('restores from an on-disk archive even when the pre-restore snapshot would otherwise prune it away', async () => {
      // Two manual archives on disk, built directly (rather than via the route)
      // so their timestamps, and therefore prune ordering, are under control.
      const older = await createArchive({
        db,
        backupsDir,
        uploadsDir,
        kind: 'manual',
        now: new Date('2026-01-01T00:00:00Z'),
      });
      await createArchive({
        db,
        backupsDir,
        uploadsDir,
        kind: 'manual',
        now: new Date('2026-01-02T00:00:00Z'),
      });

      // Lower `backup.keep` below the number of manual archives already on disk,
      // as if the admin changed the setting after `older` was created. Restoring
      // from `older` triggers a pre-restore snapshot, whose retention pruning
      // would otherwise delete `older` (now beyond the limit) before it's staged.
      setSetting(db, BACKUP_KEEP_SETTING, '1');

      const restoreRes = await request(app).post(`/api/backups/${older.filename}/restore`).set('Cookie', cookie);
      expect(restoreRes.status).toBe(200);

      await new Promise((resolve) => setImmediate(resolve));
      expect(closeAndRestart).toHaveBeenCalled();

      // Confirm the scenario actually exercised the prune: `older` no longer
      // exists in `backupsDir` by the time the restore has finished, because
      // pruning did delete the original — the restore succeeded only because it
      // was working from a scratch copy taken before pruning ran.
      const listing = await request(app).get('/api/backups').set('Cookie', cookie);
      expect(listing.body.some((a: any) => a.filename === older.filename)).toBe(false);
    });
  });
});
