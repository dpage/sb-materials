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
import { seedData, ensureReferenceData } from './db/seed';
import { migrateRefined } from './db/migrate-refined';
import { csrfProtection } from './middleware/csrf';
import { authRoutes } from './routes/auth';
import { userRoutes } from './routes/users';
import { customerRoutes } from './routes/customers';
import { lookupRoutes } from './routes/lookups';
import { reportRoutes } from './routes/reports';
import { photoRoutes } from './routes/photos';
import { pdfRoutes } from './routes/pdf';
import { collectionNoteRoutes } from './routes/collection-notes';
import { settingsRoutes } from './routes/settings';
import { backupRoutes } from './routes/backups';
import { BackupCoordinator } from './backup/scheduler';
import { recoverInterruptedRestore } from './backup/restore';

// Complete any restore that was interrupted by a crash. This MUST run before
// anything else touches the data directory: applySwap's crash-recovery logic
// classifies each item (the database, uploads/) by whether a staged copy is
// still present versus already swapped in, and that classification is only
// valid if nothing else has created or recreated sb-materials.db or uploads/
// first. Creating an empty uploads/ (or opening/creating the database) ahead
// of this call would make an interrupted restore look "already complete" and
// cause applySwap's final cleanup to delete the one remaining copy of the
// data. recoverInterruptedRestore is safe to call even when config.dataDir
// itself does not exist yet (it just finds no marker and returns 'none').
const restoreRecovery = recoverInterruptedRestore(config.dataDir);
if (restoreRecovery === 'completed') {
  logger.info('Completed a restore that was interrupted by a previous shutdown');
}

// Ensure data directory exists
if (!fs.existsSync(config.dataDir)) {
  fs.mkdirSync(config.dataDir, { recursive: true });
}
if (!fs.existsSync(config.uploadsDir)) {
  fs.mkdirSync(config.uploadsDir, { recursive: true });
}
if (!fs.existsSync(config.backupsDir)) {
  fs.mkdirSync(config.backupsDir, { recursive: true });
}

// Initialize database
const db = new Database(config.dbPath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

createSchema(db);
seedData(db);
migrateRefined(db);
ensureReferenceData(db);
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
app.use('/api/collection-notes', collectionNoteRoutes(db));
app.use('/api/settings', settingsRoutes(db));

const backupCoordinator = new BackupCoordinator(db, config.backupsDir, config.uploadsDir);
app.use(
  '/api/backups',
  backupRoutes(db, {
    dataDir: config.dataDir,
    backupsDir: config.backupsDir,
    uploadsDir: config.uploadsDir,
    coordinator: backupCoordinator,
    closeAndRestart: () => {
      db.close();
      sessionDb.close();
      process.exit(0);
    },
  }),
);

const BACKUP_TICK_INTERVAL_MS = 5 * 60 * 1000;
setInterval(() => {
  backupCoordinator.tick().catch((err) => logger.error('Scheduled backup failed:', err));
}, BACKUP_TICK_INTERVAL_MS);

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
