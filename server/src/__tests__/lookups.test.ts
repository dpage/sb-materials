import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import type Database from 'better-sqlite3';
import type { Express } from 'express';
import { createTestDb, createTestApp, loginAsAdmin } from './helpers';

describe('Lookup Routes', () => {
  let db: Database.Database;
  let app: Express;
  let cookie: string;

  beforeEach(async () => {
    db = createTestDb();
    app = createTestApp(db);
    cookie = await loginAsAdmin(app);
  });

  describe('GET /api/lookups/:table', () => {
    it('should get product descriptions', async () => {
      const res = await request(app).get('/api/lookups/lookup_product_descriptions').set('Cookie', cookie);
      expect(res.status).toBe(200);
      expect(res.body).toBeInstanceOf(Array);
      expect(res.body.length).toBeGreaterThan(0);
    });

    it('should filter by report type', async () => {
      const res = await request(app)
        .get('/api/lookups/lookup_product_grades?report_type=inspection_fibre')
        .set('Cookie', cookie);
      expect(res.status).toBe(200);
      const values = res.body.map((r: any) => r.value);
      expect(values).toContain('OCC');
      expect(values).not.toContain('98/2');
    });

    it('should get storage modes (no report_type filter)', async () => {
      const res = await request(app).get('/api/lookups/lookup_storage_modes').set('Cookie', cookie);
      expect(res.status).toBe(200);
      expect(res.body.length).toBeGreaterThan(0);
    });

    it('should get unwanted materials', async () => {
      const res = await request(app)
        .get('/api/lookups/lookup_unwanted_materials?report_type=inspection_fibre')
        .set('Cookie', cookie);
      expect(res.status).toBe(200);
      expect(res.body.length).toBeGreaterThan(0);
    });

    it('should get contaminants', async () => {
      const res = await request(app)
        .get('/api/lookups/lookup_contaminants?report_type=inspection_fibre')
        .set('Cookie', cookie);
      expect(res.status).toBe(200);
      expect(res.body.length).toBeGreaterThan(0);
    });

    it('should include inactive when requested', async () => {
      // Deactivate one
      db.prepare('UPDATE lookup_storage_modes SET is_active = 0 WHERE id = 1').run();

      const activeOnly = await request(app).get('/api/lookups/lookup_storage_modes').set('Cookie', cookie);
      const withInactive = await request(app)
        .get('/api/lookups/lookup_storage_modes?includeInactive=true')
        .set('Cookie', cookie);
      expect(withInactive.body.length).toBeGreaterThan(activeOnly.body.length);
    });

    it('should reject invalid table name', async () => {
      const res = await request(app).get('/api/lookups/invalid_table').set('Cookie', cookie);
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('Invalid lookup table');
    });

    it('should reject unauthenticated', async () => {
      const res = await request(app).get('/api/lookups/lookup_storage_modes');
      expect(res.status).toBe(401);
    });
  });

  describe('POST /api/lookups/:table', () => {
    it('should create a storage mode', async () => {
      const res = await request(app)
        .post('/api/lookups/lookup_storage_modes')
        .set('Cookie', cookie)
        .send({ value: 'New Storage Mode' });
      expect(res.status).toBe(200);
      expect(res.body.id).toBeDefined();
      expect(res.body.value).toBe('New Storage Mode');
    });

    it('should create a product description with report_type', async () => {
      const res = await request(app)
        .post('/api/lookups/lookup_product_descriptions')
        .set('Cookie', cookie)
        .send({ value: 'New Product', report_type: 'inspection_fibre' });
      expect(res.status).toBe(200);
      expect(res.body.report_type).toBe('inspection_fibre');
    });

    it('should reject missing value', async () => {
      const res = await request(app).post('/api/lookups/lookup_storage_modes').set('Cookie', cookie).send({});
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('Value required');
    });

    it('should reject missing report_type for non-storage tables', async () => {
      const res = await request(app)
        .post('/api/lookups/lookup_product_descriptions')
        .set('Cookie', cookie)
        .send({ value: 'Test' });
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('report_type required');
    });

    it('should reject invalid table', async () => {
      const res = await request(app).post('/api/lookups/invalid_table').set('Cookie', cookie).send({ value: 'Test' });
      expect(res.status).toBe(400);
    });

    it('lists and creates lookup_clients without report_type', async () => {
      const db = createTestDb();
      const app = createTestApp(db);
      const cookie = await loginAsAdmin(app);

      const created = await request(app).post('/api/lookups/lookup_clients').set('Cookie', cookie).send({ value: 'New Co' });
      expect(created.status).toBe(200);
      expect(created.body.value).toBe('New Co');

      const list = await request(app).get('/api/lookups/lookup_clients').set('Cookie', cookie);
      expect(list.status).toBe(200);
      expect(list.body.map((r: any) => r.value)).toContain('New Co');
    });
  });

  describe('PUT /api/lookups/:table/:id', () => {
    it('should update a lookup value', async () => {
      const res = await request(app)
        .put('/api/lookups/lookup_storage_modes/1')
        .set('Cookie', cookie)
        .send({ value: 'Updated Mode' });
      expect(res.status).toBe(200);

      const row = db.prepare('SELECT value FROM lookup_storage_modes WHERE id = 1').get() as any;
      expect(row.value).toBe('Updated Mode');
    });

    it('should deactivate a lookup value', async () => {
      const res = await request(app)
        .put('/api/lookups/lookup_storage_modes/1')
        .set('Cookie', cookie)
        .send({ is_active: false });
      expect(res.status).toBe(200);

      const row = db.prepare('SELECT is_active FROM lookup_storage_modes WHERE id = 1').get() as any;
      expect(row.is_active).toBe(0);
    });

    it('should reject invalid table', async () => {
      const res = await request(app).put('/api/lookups/invalid_table/1').set('Cookie', cookie).send({ value: 'Test' });
      expect(res.status).toBe(400);
    });
  });
});
