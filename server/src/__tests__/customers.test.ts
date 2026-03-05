import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import type Database from 'better-sqlite3';
import type { Express } from 'express';
import { createTestDb, createTestApp, loginAsAdmin, createTestCustomerAndSite } from './helpers';

describe('Customer Routes', () => {
  let db: Database.Database;
  let app: Express;
  let cookie: string;

  beforeEach(async () => {
    db = createTestDb();
    app = createTestApp(db);
    cookie = await loginAsAdmin(app);
  });

  describe('GET /api/customers', () => {
    it('should return empty list initially', async () => {
      const res = await request(app).get('/api/customers').set('Cookie', cookie);
      expect(res.status).toBe(200);
      expect(res.body).toEqual([]);
    });

    it('should list active customers', async () => {
      db.prepare('INSERT INTO customers (name, is_active) VALUES (?, ?)').run('Active Co', 1);
      db.prepare('INSERT INTO customers (name, is_active) VALUES (?, ?)').run('Inactive Co', 0);

      const res = await request(app).get('/api/customers').set('Cookie', cookie);
      expect(res.status).toBe(200);
      expect(res.body.length).toBe(1);
      expect(res.body[0].name).toBe('Active Co');
    });

    it('should include inactive when requested', async () => {
      db.prepare('INSERT INTO customers (name, is_active) VALUES (?, ?)').run('Active Co', 1);
      db.prepare('INSERT INTO customers (name, is_active) VALUES (?, ?)').run('Inactive Co', 0);

      const res = await request(app).get('/api/customers?includeInactive=true').set('Cookie', cookie);
      expect(res.status).toBe(200);
      expect(res.body.length).toBe(2);
    });

    it('should reject unauthenticated', async () => {
      const res = await request(app).get('/api/customers');
      expect(res.status).toBe(401);
    });
  });

  describe('GET /api/customers/:id', () => {
    it('should get customer with sites', async () => {
      const { customerId } = createTestCustomerAndSite(db);

      const res = await request(app).get(`/api/customers/${customerId}`).set('Cookie', cookie);
      expect(res.status).toBe(200);
      expect(res.body.name).toBe('Test Customer');
      expect(res.body.sites).toBeInstanceOf(Array);
      expect(res.body.sites.length).toBe(1);
      expect(res.body.sites[0].address).toBe('123 Test St');
    });

    it('should return 404 for non-existent customer', async () => {
      const res = await request(app).get('/api/customers/999').set('Cookie', cookie);
      expect(res.status).toBe(404);
    });
  });

  describe('POST /api/customers', () => {
    it('should create a customer', async () => {
      const res = await request(app).post('/api/customers').set('Cookie', cookie).send({
        name: 'New Customer',
        contact_name: 'John',
        email: 'john@test.com',
        phone: '123456',
        address: '456 St',
      });
      expect(res.status).toBe(200);
      expect(res.body.id).toBeDefined();
      expect(res.body.name).toBe('New Customer');
      expect(res.body.contact_name).toBe('John');
    });

    it('should create customer with only name', async () => {
      const res = await request(app).post('/api/customers').set('Cookie', cookie).send({ name: 'Minimal Customer' });
      expect(res.status).toBe(200);
      expect(res.body.name).toBe('Minimal Customer');
    });

    it('should reject missing name', async () => {
      const res = await request(app).post('/api/customers').set('Cookie', cookie).send({ contact_name: 'Nobody' });
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('Name required');
    });
  });

  describe('PUT /api/customers/:id', () => {
    it('should update customer fields', async () => {
      const { customerId } = createTestCustomerAndSite(db);

      const res = await request(app)
        .put(`/api/customers/${customerId}`)
        .set('Cookie', cookie)
        .send({ name: 'Updated Customer', email: 'updated@test.com' });
      expect(res.status).toBe(200);

      const cust = db.prepare('SELECT name, email FROM customers WHERE id = ?').get(customerId) as any;
      expect(cust.name).toBe('Updated Customer');
      expect(cust.email).toBe('updated@test.com');
    });

    it('should handle empty update', async () => {
      const { customerId } = createTestCustomerAndSite(db);
      const res = await request(app).put(`/api/customers/${customerId}`).set('Cookie', cookie).send({});
      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
    });

    it('should deactivate a customer', async () => {
      const { customerId } = createTestCustomerAndSite(db);
      const res = await request(app)
        .put(`/api/customers/${customerId}`)
        .set('Cookie', cookie)
        .send({ is_active: false });
      expect(res.status).toBe(200);

      const cust = db.prepare('SELECT is_active FROM customers WHERE id = ?').get(customerId) as any;
      expect(cust.is_active).toBe(0);
    });
  });

  describe('Site Routes', () => {
    let customerId: number;

    beforeEach(() => {
      const result = createTestCustomerAndSite(db);
      customerId = result.customerId;
    });

    it('should list active sites', async () => {
      const res = await request(app).get(`/api/customers/${customerId}/sites`).set('Cookie', cookie);
      expect(res.status).toBe(200);
      expect(res.body.length).toBe(1);
    });

    it('should include inactive sites when requested', async () => {
      db.prepare('INSERT INTO customer_sites (customer_id, address, is_active) VALUES (?, ?, 0)').run(
        customerId,
        'Inactive Site',
      );

      const res = await request(app)
        .get(`/api/customers/${customerId}/sites?includeInactive=true`)
        .set('Cookie', cookie);
      expect(res.status).toBe(200);
      expect(res.body.length).toBe(2);
    });

    it('should create a site', async () => {
      const res = await request(app)
        .post(`/api/customers/${customerId}/sites`)
        .set('Cookie', cookie)
        .send({ address: '789 New St' });
      expect(res.status).toBe(200);
      expect(res.body.address).toBe('789 New St');
      expect(res.body.customer_id).toBe(customerId);
    });

    it('should reject site without address', async () => {
      const res = await request(app).post(`/api/customers/${customerId}/sites`).set('Cookie', cookie).send({});
      expect(res.status).toBe(400);
    });

    it('should update a site', async () => {
      const sites = db.prepare('SELECT id FROM customer_sites WHERE customer_id = ?').all(customerId) as any[];

      const res = await request(app)
        .put(`/api/customers/${customerId}/sites/${sites[0].id}`)
        .set('Cookie', cookie)
        .send({ address: 'Updated Address', is_active: false });
      expect(res.status).toBe(200);

      const site = db.prepare('SELECT * FROM customer_sites WHERE id = ?').get(sites[0].id) as any;
      expect(site.address).toBe('Updated Address');
      expect(site.is_active).toBe(0);
    });
  });
});
