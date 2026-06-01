import express from 'express';
import session from 'express-session';
import cors from 'cors';
import path from 'path';
import fs from 'fs';
import Database from 'better-sqlite3';
import SqliteStore from 'better-sqlite3-session-store';

import { config } from './config';
import { logger } from './utils/logger';
import { createSchema, migratePhotoSubdirs } from './db/schema';
import { seedData } from './db/seed';
import { migrateRefined } from './db/migrate-refined';
import { csrfProtection } from './middleware/csrf';
import { authRoutes } from './routes/auth';
import { userRoutes } from './routes/users';
import { customerRoutes } from './routes/customers';
import { lookupRoutes } from './routes/lookups';
import { reportRoutes } from './routes/reports';
import { photoRoutes } from './routes/photos';
import { pdfRoutes } from './routes/pdf';

// Ensure data directory exists
if (!fs.existsSync(config.dataDir)) {
  fs.mkdirSync(config.dataDir, { recursive: true });
}
if (!fs.existsSync(config.uploadsDir)) {
  fs.mkdirSync(config.uploadsDir, { recursive: true });
}

// Initialize database
const db = new Database(config.dbPath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

createSchema(db);
seedData(db);
migrateRefined(db);
migratePhotoSubdirs(db, config.uploadsDir);

// Initialize Express
const app = express();

// Session store
const SessionStore = SqliteStore(session);
const sessionDb = new Database(path.join(config.dataDir, 'sessions.db'));

app.use(
  cors({
    origin: process.env.ALLOWED_ORIGINS ? process.env.ALLOWED_ORIGINS.split(',') : ['http://localhost:5173'],
    credentials: true,
  }),
);
app.use(express.json({ limit: '50mb' }));

app.use(
  session({
    store: new SessionStore({
      client: sessionDb,
      expired: { clear: true, intervalMs: 900000 },
    }),
    secret: config.sessionSecret,
    resave: false,
    saveUninitialized: false,
    cookie: {
      maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
      httpOnly: true,
      sameSite: 'lax',
    },
  }),
);

// CSRF protection for API routes
app.use('/api', csrfProtection);

// API routes
app.use('/api/auth', authRoutes(db));
app.use('/api/users', userRoutes(db));
app.use('/api/customers', customerRoutes(db));
app.use('/api/lookups', lookupRoutes(db));
app.use('/api/reports', reportRoutes(db));
app.use('/api/photos', photoRoutes(db));
app.use('/api/pdf', pdfRoutes(db));

// Serve static frontend in production
const clientDist = path.join(__dirname, '../../client/dist');
if (fs.existsSync(clientDist)) {
  app.use(express.static(clientDist));
  app.get('*', (_req, res) => {
    res.sendFile(path.join(clientDist, 'index.html'));
  });
}

const server = app.listen(config.port, () => {
  logger.info(`SB Materials server running on port ${config.port}`);
  logger.info(`Data directory: ${config.dataDir}`);
});

process.on('SIGTERM', () => {
  server.close(() => {
    db.close();
    sessionDb.close();
    process.exit(0);
  });
});
