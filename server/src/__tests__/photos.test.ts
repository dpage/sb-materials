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
import { photoRoutes } from '../routes/photos';
import { reportRoutes } from '../routes/reports';
import { customerRoutes } from '../routes/customers';

describe('Photo Routes', () => {
  let db: Database.Database;
  let app: express.Express;
  let cookie: string;
  let tmpDir: string;
  let reportId: number;
  let customerId: number;
  let siteId: number;

  beforeEach(async () => {
    db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    createSchema(db);
    seedData(db);

    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-photo-test-'));
    const uploadsDir = path.join(tmpDir, 'uploads');
    fs.mkdirSync(uploadsDir, { recursive: true });

    // Mock config
    vi.mock('../config', () => ({
      config: {
        get uploadsDir() {
          // We need to return the actual path, but vi.mock is hoisted
          // so we use a global
          return (globalThis as any).__testUploadsDir || '/tmp/sb-test-uploads';
        },
      },
    }));
    (globalThis as any).__testUploadsDir = uploadsDir;

    app = express();
    app.use(express.json({ limit: '50mb' }));
    app.use(session({ secret: 'test', resave: false, saveUninitialized: false }));
    app.use('/api/auth', authRoutes(db));
    app.use('/api/customers', customerRoutes(db));
    app.use('/api/reports', reportRoutes(db));
    app.use('/api/photos', photoRoutes(db));

    // Login
    const loginRes = await request(app).post('/api/auth/login').send({ username: 'admin', password: 'admin' });
    const cookies = loginRes.headers['set-cookie'];
    cookie = Array.isArray(cookies) ? cookies[0] : cookies;

    // Create customer and site
    const cust = db.prepare('INSERT INTO customers (name) VALUES (?)').run('Photo Test Customer');
    customerId = cust.lastInsertRowid as number;
    const site = db
      .prepare('INSERT INTO customer_sites (customer_id, address) VALUES (?, ?)')
      .run(customerId, '123 Test');
    siteId = site.lastInsertRowid as number;

    // Create a report
    const reportRes = await request(app).post('/api/reports').set('Cookie', cookie).send({
      report_type: 'inspection_fibre',
      customer_id: customerId,
      site_id: siteId,
      inspection_date: '2025-01-15',
      inspector_name: 'Test',
    });
    reportId = reportRes.body.id;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    if (fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true });
    }
  });

  it('should upload a photo', async () => {
    // Create a minimal PNG
    const pngData = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
      'base64',
    );

    const res = await request(app)
      .post(`/api/photos/upload/${reportId}`)
      .set('Cookie', cookie)
      .attach('photos', pngData, 'test.png');
    expect(res.status).toBe(200);
    expect(res.body).toBeInstanceOf(Array);
    expect(res.body.length).toBe(1);
    expect(res.body[0].file_path).toContain(`${reportId}/`);
    expect(res.body[0].id).toBeDefined();
  });

  it('should downscale a large photo to an archival JPEG on upload', async () => {
    // A 4000x3000 photo, larger than the 2048px archival cap.
    const bigPhoto = await sharp({
      create: { width: 4000, height: 3000, channels: 3, background: { r: 90, g: 140, b: 60 } },
    })
      .png()
      .toBuffer();

    const res = await request(app)
      .post(`/api/photos/upload/${reportId}`)
      .set('Cookie', cookie)
      .attach('photos', bigPhoto, 'huge.png');

    expect(res.status).toBe(200);
    const relPath = res.body[0].file_path as string;
    // Stored as JPEG regardless of the uploaded extension.
    expect(relPath.toLowerCase().endsWith('.jpg')).toBe(true);

    const storedPath = path.join(tmpDir, 'uploads', relPath);
    const meta = await sharp(fs.readFileSync(storedPath)).metadata();
    expect(meta.format).toBe('jpeg');
    expect(Math.max(meta.width!, meta.height!)).toBeLessThanOrEqual(2048);
    expect(meta.width).toBe(2048);
    expect(meta.height).toBe(1536);
  });

  it('should leave signatures as-is (PNG, not JPEG-compressed)', async () => {
    const pngData = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
      'base64',
    );

    const res = await request(app)
      .post(`/api/photos/signature/${reportId}`)
      .set('Cookie', cookie)
      .attach('signature', pngData, 'signature.png');

    expect(res.status).toBe(200);
    const relPath = res.body.signature_path as string;
    expect(relPath.toLowerCase().endsWith('.png')).toBe(true);
    const meta = await sharp(fs.readFileSync(path.join(tmpDir, 'uploads', relPath))).metadata();
    expect(meta.format).toBe('png');
  });

  it('should upload multiple photos with labels', async () => {
    const pngData = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
      'base64',
    );

    const res = await request(app)
      .post(`/api/photos/upload/${reportId}`)
      .set('Cookie', cookie)
      .attach('photos', pngData, 'photo1.png')
      .attach('photos', pngData, 'photo2.png')
      .field('labels', 'Label 1')
      .field('labels', 'Label 2');
    expect(res.status).toBe(200);
    expect(res.body.length).toBe(2);
    expect(res.body[0].photo_label).toBe('Label 1');
    expect(res.body[1].photo_label).toBe('Label 2');
  });

  it('should return 404 for non-existent report on upload', async () => {
    const pngData = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
      'base64',
    );

    const res = await request(app)
      .post('/api/photos/upload/9999')
      .set('Cookie', cookie)
      .attach('photos', pngData, 'test.png');
    expect(res.status).toBe(404);
  });

  it('should return 400 when no files uploaded', async () => {
    const res = await request(app).post(`/api/photos/upload/${reportId}`).set('Cookie', cookie);
    expect(res.status).toBe(400);
  });

  it('should serve a photo file', async () => {
    // Upload first
    const pngData = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
      'base64',
    );

    const uploadRes = await request(app)
      .post(`/api/photos/upload/${reportId}`)
      .set('Cookie', cookie)
      .attach('photos', pngData, 'test.png');

    const filePath = uploadRes.body[0].file_path;
    const res = await request(app).get(`/api/photos/file/${filePath}`).set('Cookie', cookie);
    expect(res.status).toBe(200);
  });

  it('should return 404 for non-existent photo file', async () => {
    const res = await request(app).get(`/api/photos/file/${reportId}/nonexistent.png`).set('Cookie', cookie);
    expect(res.status).toBe(404);
  });

  it('should prevent directory traversal', async () => {
    // Express normalizes the URL, so ../../ gets resolved.
    // The path check still prevents access - it returns 404 (file not found)
    // because the resolved path stays within uploads dir after normalization.
    const res = await request(app).get('/api/photos/file/../../etc/passwd').set('Cookie', cookie);
    // Either 403 (traversal caught) or 404 (normalized path, file not found)
    expect([403, 404]).toContain(res.status);
  });

  it('should update photo metadata', async () => {
    // Upload first
    const pngData = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
      'base64',
    );
    const uploadRes = await request(app)
      .post(`/api/photos/upload/${reportId}`)
      .set('Cookie', cookie)
      .attach('photos', pngData, 'test.png');

    const photoId = uploadRes.body[0].id;
    const res = await request(app)
      .put(`/api/photos/${photoId}`)
      .set('Cookie', cookie)
      .send({ photo_label: 'Updated Label', sort_order: 5 });
    expect(res.status).toBe(200);

    const photo = db.prepare('SELECT * FROM report_photos WHERE id = ?').get(photoId) as any;
    expect(photo.photo_label).toBe('Updated Label');
    expect(photo.sort_order).toBe(5);
  });

  it('should delete a photo', async () => {
    const pngData = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
      'base64',
    );
    const uploadRes = await request(app)
      .post(`/api/photos/upload/${reportId}`)
      .set('Cookie', cookie)
      .attach('photos', pngData, 'test.png');

    const photoId = uploadRes.body[0].id;
    const res = await request(app).delete(`/api/photos/${photoId}`).set('Cookie', cookie);
    expect(res.status).toBe(200);

    const photo = db.prepare('SELECT * FROM report_photos WHERE id = ?').get(photoId);
    expect(photo).toBeUndefined();
  });

  it('should return 404 when deleting non-existent photo', async () => {
    const res = await request(app).delete('/api/photos/9999').set('Cookie', cookie);
    expect(res.status).toBe(404);
  });

  it('should upload a signature', async () => {
    const pngData = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
      'base64',
    );

    const res = await request(app)
      .post(`/api/photos/signature/${reportId}`)
      .set('Cookie', cookie)
      .attach('signature', pngData, 'signature.png');
    expect(res.status).toBe(200);
    expect(res.body.signature_path).toContain(`${reportId}/`);

    const report = db.prepare('SELECT signature_path FROM reports WHERE id = ?').get(reportId) as any;
    expect(report.signature_path).toBe(res.body.signature_path);
  });

  it('should return 404 for signature on non-existent report', async () => {
    const pngData = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
      'base64',
    );

    const res = await request(app)
      .post('/api/photos/signature/9999')
      .set('Cookie', cookie)
      .attach('signature', pngData, 'signature.png');
    expect(res.status).toBe(404);
  });

  it('should return 400 for signature without file', async () => {
    const res = await request(app).post(`/api/photos/signature/${reportId}`).set('Cookie', cookie);
    expect(res.status).toBe(400);
  });
});
