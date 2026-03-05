import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import type Database from 'better-sqlite3';
import type { Express } from 'express';
import { createTestDb, createTestApp, loginAsAdmin, loginAsRegularUser } from './helpers';

describe('User Routes', () => {
  let db: Database.Database;
  let app: Express;
  let cookie: string;

  beforeEach(async () => {
    db = createTestDb();
    app = createTestApp(db);
    cookie = await loginAsAdmin(app);
  });

  describe('GET /api/users', () => {
    it('should list all users for superuser', async () => {
      const res = await request(app).get('/api/users').set('Cookie', cookie);
      expect(res.status).toBe(200);
      expect(res.body).toBeInstanceOf(Array);
      expect(res.body.length).toBe(1);
      expect(res.body[0]).toHaveProperty('username');
      expect(res.body[0]).not.toHaveProperty('password_hash');
    });

    it('should reject non-superuser', async () => {
      const regularCookie = await loginAsRegularUser(app, db);
      const res = await request(app).get('/api/users').set('Cookie', regularCookie);
      expect(res.status).toBe(403);
    });

    it('should reject unauthenticated', async () => {
      const res = await request(app).get('/api/users');
      expect(res.status).toBe(401);
    });
  });

  describe('GET /api/users/:id', () => {
    it('should get a specific user', async () => {
      const res = await request(app).get('/api/users/1').set('Cookie', cookie);
      expect(res.status).toBe(200);
      expect(res.body.username).toBe('admin');
    });

    it('should return 404 for non-existent user', async () => {
      const res = await request(app).get('/api/users/999').set('Cookie', cookie);
      expect(res.status).toBe(404);
    });
  });

  describe('POST /api/users', () => {
    it('should create a new user', async () => {
      const res = await request(app)
        .post('/api/users')
        .set('Cookie', cookie)
        .send({ username: 'newuser', password: 'pass123', display_name: 'New User' });
      expect(res.status).toBe(200);
      expect(res.body.id).toBeDefined();
    });

    it('should create a superuser', async () => {
      const res = await request(app)
        .post('/api/users')
        .set('Cookie', cookie)
        .send({ username: 'superuser2', password: 'pass123', display_name: 'Super User', is_superuser: true });
      expect(res.status).toBe(200);

      const user = db.prepare('SELECT is_superuser FROM users WHERE id = ?').get(res.body.id) as any;
      expect(user.is_superuser).toBe(1);
    });

    it('should reject duplicate username', async () => {
      const res = await request(app)
        .post('/api/users')
        .set('Cookie', cookie)
        .send({ username: 'admin', password: 'pass123', display_name: 'Another Admin' });
      expect(res.status).toBe(409);
      expect(res.body.error).toBe('Username already exists');
    });

    it('should reject missing required fields', async () => {
      const res = await request(app).post('/api/users').set('Cookie', cookie).send({ username: 'newuser' });
      expect(res.status).toBe(400);
    });
  });

  describe('PUT /api/users/:id', () => {
    it('should update user details', async () => {
      const res = await request(app).put('/api/users/1').set('Cookie', cookie).send({ display_name: 'Updated Admin' });
      expect(res.status).toBe(200);

      const user = db.prepare('SELECT display_name FROM users WHERE id = 1').get() as any;
      expect(user.display_name).toBe('Updated Admin');
    });

    it('should update user password', async () => {
      const res = await request(app).put('/api/users/1').set('Cookie', cookie).send({ password: 'newpassword' });
      expect(res.status).toBe(200);

      // Verify new password works
      const loginRes = await request(app).post('/api/auth/login').send({ username: 'admin', password: 'newpassword' });
      expect(loginRes.status).toBe(200);
    });

    it('should deactivate a user', async () => {
      // Create a second user to deactivate
      const bcrypt = await import('bcryptjs');
      const hash = bcrypt.hashSync('testpass', 10);
      const result = db.prepare('INSERT INTO users (username, password_hash, display_name, is_superuser) VALUES (?, ?, ?, 0)').run(
        'testuser', hash, 'Test User',
      );
      const userId = result.lastInsertRowid;

      const res = await request(app).put(`/api/users/${userId}`).set('Cookie', cookie).send({ is_active: false });
      expect(res.status).toBe(200);

      const user = db.prepare('SELECT is_active FROM users WHERE id = ?').get(userId) as any;
      expect(user.is_active).toBe(0);
    });

    it('should return 404 for non-existent user', async () => {
      const res = await request(app).put('/api/users/999').set('Cookie', cookie).send({ display_name: 'Nobody' });
      expect(res.status).toBe(404);
    });
  });
});
