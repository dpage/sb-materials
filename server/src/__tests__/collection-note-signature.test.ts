import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import request from 'supertest';
import express from 'express';
import session from 'express-session';
import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { createSchema } from '../db/schema';
import { seedData } from '../db/seed';
import { authRoutes } from '../routes/auth';
import { customerRoutes } from '../routes/customers';
import { collectionNoteRoutes } from '../routes/collection-notes';

// Mirrors the config-mocking pattern in photos.test.ts: multer's storage
// destination reads config.uploadsDir at request time, so the mocked getter
// must resolve to a fresh temp directory per test via a global.
vi.mock('../config', () => ({
  config: {
    get uploadsDir() {
      return (globalThis as any).__testUploadsDir || '/tmp/sb-test-uploads';
    },
  },
}));

const PNG_DATA = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
);

describe('Collection note signature upload', () => {
  let db: Database.Database;
  let app: express.Express;
  let cookie: string;
  let tmpDir: string;
  let uploadsDir: string;
  let noteId: number;

  beforeEach(async () => {
    db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    createSchema(db);
    seedData(db);

    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-signature-test-'));
    uploadsDir = path.join(tmpDir, 'uploads');
    fs.mkdirSync(uploadsDir, { recursive: true });
    (globalThis as any).__testUploadsDir = uploadsDir;

    app = express();
    app.use(express.json());
    app.use(session({ secret: 'test', resave: false, saveUninitialized: false }));
    app.use('/api/auth', authRoutes(db));
    app.use('/api/customers', customerRoutes(db));
    app.use('/api/collection-notes', collectionNoteRoutes(db));

    const loginRes = await request(app).post('/api/auth/login').send({ username: 'admin', password: 'admin' });
    const cookies = loginRes.headers['set-cookie'];
    cookie = Array.isArray(cookies) ? cookies[0] : cookies;

    const cust = db.prepare('INSERT INTO customers (name) VALUES (?)').run('Acme Recycling Ltd');
    const note = db
      .prepare('INSERT INTO collection_notes (reference, customer_id, collection_date) VALUES (?, ?, ?)')
      .run('SBM1061', cust.lastInsertRowid, '2026-08-03');
    noteId = note.lastInsertRowid as number;
  });

  afterEach(() => {
    if (fs.existsSync(tmpDir)) fs.rmSync(tmpDir, { recursive: true });
  });

  it('stores a signature at the path it actually wrote to', async () => {
    const res = await request(app)
      .post(`/api/collection-notes/${noteId}/signature/dispatched`)
      .set('Cookie', cookie)
      .attach('signature', PNG_DATA, 'signature.png');

    expect(res.status).toBe(200);
    const relPath = res.body.signature_path as string;
    expect(fs.existsSync(path.join(uploadsDir, relPath))).toBe(true);

    const row = db.prepare('SELECT dispatched_signature_path FROM collection_notes WHERE id = ?').get(noteId) as {
      dispatched_signature_path: string;
    };
    expect(row.dispatched_signature_path).toBe(relPath);
  });

  it('rejects a non-numeric id without writing a file anywhere under uploads', async () => {
    const res = await request(app)
      .post('/api/collection-notes/1x/signature/dispatched')
      .set('Cookie', cookie)
      .attach('signature', PNG_DATA, 'signature.png');

    expect(res.status).toBe(404);

    // Nothing should have been written under uploads at all - neither a
    // "misc" fallback directory nor anything else.
    const walk = (dir: string): string[] => {
      if (!fs.existsSync(dir)) return [];
      return fs.readdirSync(dir).flatMap((entry) => {
        const full = path.join(dir, entry);
        return fs.statSync(full).isDirectory() ? walk(full) : [full];
      });
    };
    expect(walk(uploadsDir)).toEqual([]);

    // And note 1's stored path (if any) must be untouched.
    const row = db.prepare('SELECT dispatched_signature_path FROM collection_notes WHERE id = ?').get(noteId) as {
      dispatched_signature_path: string | null;
    };
    expect(row.dispatched_signature_path).toBeNull();
  });

  it('rejects an invalid kind without writing a file to disk', async () => {
    const res = await request(app)
      .post(`/api/collection-notes/${noteId}/signature/bogus`)
      .set('Cookie', cookie)
      .attach('signature', PNG_DATA, 'signature.png');

    expect(res.status).toBe(400);

    const walk = (dir: string): string[] => {
      if (!fs.existsSync(dir)) return [];
      return fs.readdirSync(dir).flatMap((entry) => {
        const full = path.join(dir, entry);
        return fs.statSync(full).isDirectory() ? walk(full) : [full];
      });
    };
    expect(walk(uploadsDir)).toEqual([]);
  });

  it('returns 404 for a well-formed id that does not exist, without writing a file', async () => {
    const res = await request(app)
      .post('/api/collection-notes/999999/signature/dispatched')
      .set('Cookie', cookie)
      .attach('signature', PNG_DATA, 'signature.png');

    expect(res.status).toBe(404);

    const walk = (dir: string): string[] => {
      if (!fs.existsSync(dir)) return [];
      return fs.readdirSync(dir).flatMap((entry) => {
        const full = path.join(dir, entry);
        return fs.statSync(full).isDirectory() ? walk(full) : [full];
      });
    };
    expect(walk(uploadsDir)).toEqual([]);
  });
});
