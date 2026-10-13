import express from 'express';
import zlib from 'zlib';
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
import { collectionNoteRoutes } from '../routes/collection-notes';
import { settingsRoutes } from '../routes/settings';
import { appInfoRoutes } from '../routes/app-info';
import { travelRoutes } from '../routes/travel';
import { expenseRoutes } from '../routes/expenses';

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

  app.use('/api/app-info', appInfoRoutes({ testDeployment: false, deploymentLabel: 'TEST', appVersion: '0.0.0-test' }));
  app.use('/api/auth', authRoutes(db));
  app.use('/api/users', userRoutes(db));
  app.use('/api/customers', customerRoutes(db));
  app.use('/api/lookups', lookupRoutes(db));
  app.use('/api/reports', reportRoutes(db));
  app.use('/api/photos', photoRoutes(db));
  app.use('/api/pdf', pdfRoutes(db));
  app.use('/api/collection-notes', collectionNoteRoutes(db));
  app.use('/api/settings', settingsRoutes(db));
  app.use('/api/travel', travelRoutes(db));
  app.use('/api/expenses', expenseRoutes(db));

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
  db.prepare(
    'INSERT INTO users (username, password_hash, display_name, phone, is_superuser) VALUES (?, ?, ?, ?, 0)',
  ).run('regularuser', hash, 'Regular User', '07700 900123');

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

/**
 * Inflate every FlateDecode stream in a PDF and decode the hex-encoded text
 * runs (e.g. `[<4f6e20> 0] TJ`) so tests can assert on rendered text. pdfmake
 * emits one run per word with the trailing space inside the hex, so plain
 * concatenation reconstructs the visible text. Image streams fail to inflate
 * and are skipped.
 */
export function extractPdfText(buf: Buffer): string {
  const out: string[] = [];
  let idx = 0;
  while ((idx = buf.indexOf('stream', idx)) !== -1) {
    const start = buf.indexOf('\n', idx) + 1;
    const end = buf.indexOf('endstream', start);
    if (end === -1) break;
    let content = '';
    try {
      content = zlib.inflateSync(buf.subarray(start, end)).toString('latin1');
    } catch {
      // not a deflate stream (e.g. an image) - skip
    }
    for (const m of content.matchAll(/<([0-9a-fA-F]+)>/g)) {
      out.push(Buffer.from(m[1], 'hex').toString('latin1'));
    }
    idx = end + 'endstream'.length;
  }
  return out.join('');
}
