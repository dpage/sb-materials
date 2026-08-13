export const BACKUP_FORMAT_VERSION = 1;

export type BackupKind = 'scheduled' | 'manual' | 'pre-restore';

export interface BackupManifest {
  formatVersion: number;
  appVersion: string;
  createdAt: string;
  kind: BackupKind;
  // The DB_SCHEMA_VERSION (server/src/db/schema.ts) the archive was taken
  // under. This is what restore actually gates on; see the comment there.
  // Absent on an archive taken before this field existed, which restore
  // treats as version 0 (the oldest possible, always restorable).
  dbSchemaVersion?: number;
  // The actual table/column shape at backup time. No longer used to decide
  // whether a restore is allowed (see dbSchemaVersion) — kept because it's
  // the kind of thing worth having on hand when diagnosing a restore issue
  // by hand, exactly as it was used to diagnose the bug that led to
  // dbSchemaVersion existing in the first place.
  schemaFingerprint: Record<string, string[]>;
  reportCount: number;
  photoCount: number;
  collectionNoteCount: number;
  dbSha256: string;
}
