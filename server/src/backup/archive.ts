import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import * as tar from 'tar';
import { BACKUP_FORMAT_VERSION, BackupKind, BackupManifest } from './manifest';
import { config } from '../config';

const FILENAME_RE = /^sb-materials-(scheduled|manual|pre-restore)-(\d{8})-(\d{6})\.tar\.gz$/;

export function computeSchemaFingerprint(db: Database.Database): Record<string, string[]> {
  const tables = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
    .all() as { name: string }[];

  const fingerprint: Record<string, string[]> = {};
  for (const { name } of tables) {
    const columns = db.prepare(`PRAGMA table_info(${name})`).all() as { name: string }[];
    fingerprint[name] = columns.map((c) => c.name).sort();
  }
  return fingerprint;
}

export function archiveFilename(kind: BackupKind, date: Date): string {
  const iso = date.toISOString();
  const stamp = `${iso.slice(0, 4)}${iso.slice(5, 7)}${iso.slice(8, 10)}-${iso.slice(11, 13)}${iso.slice(14, 16)}${iso.slice(17, 19)}`;
  return `sb-materials-${kind}-${stamp}.tar.gz`;
}

function sha256File(filePath: string): string {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

export async function createArchive(params: {
  db: Database.Database;
  backupsDir: string;
  uploadsDir: string;
  kind: BackupKind;
  now?: Date;
}): Promise<{ filename: string; path: string; manifest: BackupManifest }> {
  const { db, backupsDir, uploadsDir, kind } = params;
  const now = params.now ?? new Date();
  fs.mkdirSync(backupsDir, { recursive: true });

  const stagingRoot = fs.mkdtempSync(path.join(backupsDir, '.building-'));
  try {
    const dbStagingPath = path.join(stagingRoot, 'sb-materials.db');
    await db.backup(dbStagingPath);

    const uploadsStagingPath = path.join(stagingRoot, 'uploads');
    if (fs.existsSync(uploadsDir)) {
      fs.cpSync(uploadsDir, uploadsStagingPath, { recursive: true });
    } else {
      fs.mkdirSync(uploadsStagingPath, { recursive: true });
    }

    const reportCount = (db.prepare('SELECT COUNT(*) as n FROM reports').get() as { n: number }).n;
    const photoCount = (db.prepare('SELECT COUNT(*) as n FROM report_photos').get() as { n: number }).n;

    const manifest: BackupManifest = {
      formatVersion: BACKUP_FORMAT_VERSION,
      appVersion: config.appVersion,
      createdAt: now.toISOString(),
      kind,
      schemaFingerprint: computeSchemaFingerprint(db),
      reportCount,
      photoCount,
      dbSha256: sha256File(dbStagingPath),
    };
    fs.writeFileSync(path.join(stagingRoot, 'manifest.json'), JSON.stringify(manifest, null, 2));

    const filename = archiveFilename(kind, now);
    const destPath = path.join(backupsDir, filename);
    await tar.create({ gzip: true, file: destPath, cwd: stagingRoot }, ['manifest.json', 'sb-materials.db', 'uploads']);

    return { filename, path: destPath, manifest };
  } finally {
    fs.rmSync(stagingRoot, { recursive: true, force: true });
  }
}

export interface ArchiveListing {
  filename: string;
  kind: BackupKind;
  createdAt: string;
  sizeBytes: number;
  reportCount: number | null;
  photoCount: number | null;
}

async function readManifestFromArchive(archivePath: string): Promise<BackupManifest | null> {
  let manifest: BackupManifest | null = null;
  try {
    await tar.list({
      file: archivePath,
      filter: (entryPath) => entryPath === 'manifest.json',
      onReadEntry: (entry) => {
        const chunks: Buffer[] = [];
        entry.on('data', (chunk) => chunks.push(chunk));
        entry.on('end', () => {
          try {
            manifest = JSON.parse(Buffer.concat(chunks).toString('utf-8'));
          } catch {
            manifest = null;
          }
        });
      },
    });
  } catch {
    return null;
  }
  return manifest;
}

export async function listArchives(backupsDir: string): Promise<ArchiveListing[]> {
  if (!fs.existsSync(backupsDir)) return [];

  const out: ArchiveListing[] = [];
  for (const filename of fs.readdirSync(backupsDir)) {
    const match = filename.match(FILENAME_RE);
    if (!match) continue;
    const [, kind, ymd, hms] = match;
    const createdAt = `${ymd.slice(0, 4)}-${ymd.slice(4, 6)}-${ymd.slice(6, 8)}T${hms.slice(0, 2)}:${hms.slice(2, 4)}:${hms.slice(4, 6)}Z`;
    const archivePath = path.join(backupsDir, filename);
    const stat = fs.statSync(archivePath);
    const manifest = await readManifestFromArchive(archivePath);

    out.push({
      filename,
      kind: kind as BackupKind,
      createdAt,
      sizeBytes: stat.size,
      reportCount: manifest?.reportCount ?? null,
      photoCount: manifest?.photoCount ?? null,
    });
  }

  out.sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0));
  return out;
}

export function pruneRetention(backupsDir: string, keep: number): string[] {
  const removed: string[] = [];

  const all = fs
    .readdirSync(backupsDir)
    .map((filename) => {
      const match = filename.match(FILENAME_RE);
      if (!match) return null;
      const [, kind, ymd, hms] = match;
      return { filename, kind: kind as BackupKind, sortKey: `${ymd}${hms}` };
    })
    .filter((x): x is { filename: string; kind: BackupKind; sortKey: string } => x !== null)
    .sort((a, b) => (a.sortKey < b.sortKey ? 1 : a.sortKey > b.sortKey ? -1 : 0));

  const pruneGroup = (group: typeof all, limit: number) => {
    for (const archive of group.slice(limit)) {
      fs.unlinkSync(path.join(backupsDir, archive.filename));
      removed.push(archive.filename);
    }
  };

  pruneGroup(
    all.filter((a) => a.kind !== 'pre-restore'),
    keep,
  );
  pruneGroup(
    all.filter((a) => a.kind === 'pre-restore'),
    3,
  );

  return removed;
}
