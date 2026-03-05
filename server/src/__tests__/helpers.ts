import express from 'express';
import session from 'express-session';
import Database from 'better-sqlite3';
import { createSchema } from '../db/schema';
import { seedData } from '../db/seed';
import { authRoutes } from '../routes/auth';
import { userRoutes } from '../routes/users';
import { customerRoutes } from '../routes/customers';
import { lookupRoutes } from '../routes/lookups';
import { reportRoutes } from '../routes/reports';
import { photoRoutes } from '../routes/photos';
import { pdfRoutes } from '../routes/pdf';

export function createTestDb(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  createSchema(db);
  seedData(db);
  return db;
}

export function createTestApp(db: Database.Database) {
  const app = express();
  app.use(express.json({ limit: '50mb' }));

  app.use(
    session({
      secret: 'test-secret',
      resave: false,
      saveUninitialized: false,
    }),
  );

  app.use('/api/auth', authRoutes(db));
  app.use('/api/users', userRoutes(db));
  app.use('/api/customers', customerRoutes(db));
  app.use('/api/lookups', lookupRoutes(db));
  app.use('/api/reports', reportRoutes(db));
  app.use('/api/photos', photoRoutes(db));
  app.use('/api/pdf', pdfRoutes(db));

  return app;
}

/**
 * Login as admin and return the session cookie string.
 */
export async function loginAsAdmin(app: express.Express): Promise<string> {
  const supertest = (await import('supertest')).default;
  const res = await supertest(app).post('/api/auth/login').send({ username: 'admin', password: 'admin' });
  const cookies = res.headers['set-cookie'];
  return Array.isArray(cookies) ? cookies[0] : cookies;
}

/**
 * Create a non-superuser and login, returning cookie.
 */
export async function loginAsRegularUser(app: express.Express, db: Database.Database): Promise<string> {
  const bcrypt = await import('bcryptjs');
  const hash = bcrypt.hashSync('regular123', 10);
  db.prepare('INSERT INTO users (username, password_hash, display_name, is_superuser) VALUES (?, ?, ?, 0)').run(
    'regularuser',
    hash,
    'Regular User',
  );

  const supertest = (await import('supertest')).default;
  const res = await supertest(app).post('/api/auth/login').send({ username: 'regularuser', password: 'regular123' });
  const cookies = res.headers['set-cookie'];
  return Array.isArray(cookies) ? cookies[0] : cookies;
}

/**
 * Create a customer and site for testing reports.
 */
export function createTestCustomerAndSite(db: Database.Database): { customerId: number; siteId: number } {
  const cust = db.prepare('INSERT INTO customers (name) VALUES (?)').run('Test Customer');
  const site = db
    .prepare('INSERT INTO customer_sites (customer_id, address) VALUES (?, ?)')
    .run(cust.lastInsertRowid, '123 Test St');
  return { customerId: cust.lastInsertRowid as number, siteId: site.lastInsertRowid as number };
}
