import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import request from 'supertest';
import express from 'express';
import session from 'express-session';
import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import os from 'os';
import sharp from 'sharp';
import { createSchema } from '../db/schema';
import { seedData } from '../db/seed';
import { authRoutes } from '../routes/auth';
import { expenseRoutes } from '../routes/expenses';
import { pdfRoutes } from '../routes/pdf';
import { extractPdfText } from './helpers';

// The uploads directory is mocked the same way the report photo tests mock it:
// config.uploadsDir is a getter, so a global is the only way to point it at a
// temporary directory after the module has been hoisted.
vi.mock('../config', () => ({
  config: {
    get uploadsDir() {
      return (globalThis as any).__testUploadsDir || '/tmp/sb-test-uploads';
    },
  },
}));

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
);

describe('expense receipts', () => {
  let db: Database.Database;
  let app: express.Express;
  let cookie: string;
  let tmpDir: string;
  let uploadsDir: string;
  let sheetId: number;

  beforeEach(async () => {
    db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    createSchema(db);
    seedData(db);

    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-receipt-test-'));
    uploadsDir = path.join(tmpDir, 'uploads');
    fs.mkdirSync(uploadsDir, { recursive: true });
    (globalThis as any).__testUploadsDir = uploadsDir;

    app = express();
    app.use(express.json());
    app.use(session({ secret: 'test', resave: false, saveUninitialized: false }));
    app.use('/api/auth', authRoutes(db));
    app.use('/api/expenses', expenseRoutes(db));
    app.use('/api/pdf', pdfRoutes(db));

    const login = await request(app).post('/api/auth/login').send({ username: 'admin', password: 'admin' });
    const cookies = login.headers['set-cookie'];
    cookie = Array.isArray(cookies) ? cookies[0] : cookies;

    const sheet = await request(app).post('/api/expenses').set('Cookie', cookie).send({ year: 2026, month: 10 });
    sheetId = sheet.body.id;
  });

  afterEach(() => {
    if (fs.existsSync(tmpDir)) fs.rmSync(tmpDir, { recursive: true });
  });

  const upload = (extra?: (req: request.Test) => request.Test) => {
    let req = request(app).post(`/api/expenses/${sheetId}/photos`).set('Cookie', cookie);
    if (extra) req = extra(req);
    return req.attach('photos', PNG, 'receipt.png');
  };

  it('stores a receipt as an archival JPEG under the sheet', async () => {
    const res = await upload();
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);

    const relPath = res.body[0].file_path as string;
    expect(relPath.startsWith(`expenses/${sheetId}/`)).toBe(true);
    const stored = path.join(uploadsDir, relPath);
    expect(fs.existsSync(stored)).toBe(true);
    expect((await sharp(fs.readFileSync(stored)).metadata()).format).toBe('jpeg');
  });

  it('attaches a receipt to the item it was uploaded against', async () => {
    const saved = await request(app)
      .put(`/api/expenses/${sheetId}`)
      .set('Cookie', cookie)
      .send({ items: [{ description: 'Diesel', cost: 72 }] });
    const itemId = saved.body.items[0].id as number;

    const res = await upload((req) => req.field('item_ids', String(itemId)));
    expect(res.body[0].item_id).toBe(itemId);

    const read = await request(app).get(`/api/expenses/${sheetId}`).set('Cookie', cookie);
    expect(read.body.photos[0].item_id).toBe(itemId);
  });

  it('leaves a receipt on the sheet when its item is deleted', async () => {
    const saved = await request(app)
      .put(`/api/expenses/${sheetId}`)
      .set('Cookie', cookie)
      .send({ items: [{ description: 'Diesel', cost: 72 }] });
    const itemId = saved.body.items[0].id as number;
    await upload((req) => req.field('item_ids', String(itemId)));

    const after = await request(app).put(`/api/expenses/${sheetId}`).set('Cookie', cookie).send({ items: [] });
    expect(after.body.items).toHaveLength(0);
    // ON DELETE SET NULL: the receipt is still there, just unattached.
    expect(after.body.photos).toHaveLength(1);
    expect(after.body.photos[0].item_id).toBeNull();
  });

  it('serves a receipt to its owner and refuses one that is not there', async () => {
    const res = await upload();
    const file = await request(app).get(`/api/expenses/${sheetId}/photos/${res.body[0].id}/file`).set('Cookie', cookie);
    expect(file.status).toBe(200);
    expect(file.headers['content-type']).toContain('image/jpeg');

    expect((await request(app).get(`/api/expenses/${sheetId}/photos/9999/file`).set('Cookie', cookie)).status).toBe(
      404,
    );
  });

  it('deletes a receipt and removes the file from disk', async () => {
    const res = await upload();
    const stored = path.join(uploadsDir, res.body[0].file_path);

    const del = await request(app).delete(`/api/expenses/${sheetId}/photos/${res.body[0].id}`).set('Cookie', cookie);
    expect(del.status).toBe(200);
    expect(fs.existsSync(stored)).toBe(false);
    expect(db.prepare('SELECT COUNT(*) AS n FROM expense_photos').get()).toEqual({ n: 0 });
  });

  it('takes the receipt directory with the sheet', async () => {
    await upload();
    const dir = path.join(uploadsDir, 'expenses', String(sheetId));
    expect(fs.existsSync(dir)).toBe(true);

    await request(app).delete(`/api/expenses/${sheetId}`).set('Cookie', cookie);
    expect(fs.existsSync(dir)).toBe(false);
    expect(db.prepare('SELECT COUNT(*) AS n FROM expense_photos').get()).toEqual({ n: 0 });
  });

  it('paints the receipts onto the expense sheet PDF, captioned with their item', async () => {
    const saved = await request(app)
      .put(`/api/expenses/${sheetId}`)
      .set('Cookie', cookie)
      .send({ items: [{ description: 'Diesel', cost: 72 }] });
    await upload((req) => req.field('item_ids', String(saved.body.items[0].id)));

    const res = await request(app).get(`/api/pdf/expenses/${sheetId}`).set('Cookie', cookie);
    expect(res.status).toBe(200);
    const text = extractPdfText(res.body);
    expect(text).toContain('Receipts');
    // The caption identifies which line the photograph belongs to.
    expect(text.match(/Diesel/g) || []).toHaveLength(2);
  });

  it('refuses an upload with no files', async () => {
    const res = await request(app).post(`/api/expenses/${sheetId}/photos`).set('Cookie', cookie);
    expect(res.status).toBe(400);
  });

  it('writes nothing to disk for an upload against somebody elses sheet', async () => {
    const otherUser = db
      .prepare(
        "INSERT INTO users (username, password_hash, display_name, is_superuser) VALUES ('other', 'x', 'Other User', 0)",
      )
      .run().lastInsertRowid as number;
    const theirSheet = db
      .prepare('INSERT INTO expense_sheets (user_id, year, month) VALUES (?, 2026, 10)')
      .run(otherUser).lastInsertRowid as number;

    // The admin is a superuser, so the caller has to be somebody who is not.
    const bcrypt = (await import('bcryptjs')).default;
    const mortal = db
      .prepare(
        "INSERT INTO users (username, password_hash, display_name, is_superuser) VALUES ('mortal', ?, 'Mortal User', 0)",
      )
      .run(bcrypt.hashSync('pw', 10)).lastInsertRowid as number;
    expect(mortal).toBeGreaterThan(0);
    const login = await request(app).post('/api/auth/login').send({ username: 'mortal', password: 'pw' });
    const cookies = login.headers['set-cookie'];
    const mortalCookie = Array.isArray(cookies) ? cookies[0] : cookies;

    const res = await request(app)
      .post(`/api/expenses/${theirSheet}/photos`)
      .set('Cookie', mortalCookie)
      .attach('photos', PNG, 'receipt.png');

    expect(res.status).toBe(404);
    expect(fs.existsSync(path.join(uploadsDir, 'expenses', String(theirSheet)))).toBe(false);
  });
});
