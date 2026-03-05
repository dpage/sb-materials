import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import type Database from 'better-sqlite3';
import type { Express } from 'express';
import { createTestDb, createTestApp, loginAsAdmin } from './helpers';

describe('Auth Routes', () => {
  let db: Database.Database;
  let app: Express;

  beforeEach(() => {
    db = createTestDb();
    app = createTestApp(db);
  });

  describe('POST /api/auth/login', () => {
    it('should login with valid credentials', async () => {
      const res = await request(app).post('/api/auth/login').send({ username: 'admin', password: 'admin' });
      expect(res.status).toBe(200);
      expect(res.body.username).toBe('admin');
      expect(res.body.displayName).toBe('Administrator');
      expect(res.body.isSuperuser).toBe(true);
      expect(res.body.id).toBeDefined();
    });

    it('should reject invalid password', async () => {
      const res = await request(app).post('/api/auth/login').send({ username: 'admin', password: 'wrong' });
      expect(res.status).toBe(401);
      expect(res.body.error).toBe('Invalid credentials');
    });

    it('should reject non-existent user', async () => {
      const res = await request(app).post('/api/auth/login').send({ username: 'nonexistent', password: 'anything' });
      expect(res.status).toBe(401);
    });

    it('should reject missing username', async () => {
      const res = await request(app).post('/api/auth/login').send({ password: 'admin' });
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('Username and password required');
    });

    it('should reject missing password', async () => {
      const res = await request(app).post('/api/auth/login').send({ username: 'admin' });
      expect(res.status).toBe(400);
    });

    it('should reject inactive user', async () => {
      db.prepare('UPDATE users SET is_active = 0 WHERE username = ?').run('admin');
      const res = await request(app).post('/api/auth/login').send({ username: 'admin', password: 'admin' });
      expect(res.status).toBe(401);
    });
  });

  describe('POST /api/auth/logout', () => {
    it('should logout successfully', async () => {
      const cookie = await loginAsAdmin(app);
      const res = await request(app).post('/api/auth/logout').set('Cookie', cookie);
      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
    });
  });

  describe('GET /api/auth/me', () => {
    it('should return current user when authenticated', async () => {
      const cookie = await loginAsAdmin(app);
      const res = await request(app).get('/api/auth/me').set('Cookie', cookie);
      expect(res.status).toBe(200);
      expect(res.body.username).toBe('admin');
      expect(res.body.isSuperuser).toBe(true);
    });

    it('should return 401 when not authenticated', async () => {
      const res = await request(app).get('/api/auth/me');
      expect(res.status).toBe(401);
    });
  });
});
