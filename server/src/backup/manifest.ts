export const BACKUP_FORMAT_VERSION = 1;

export type BackupKind = 'scheduled' | 'manual' | 'pre-restore';

export interface BackupManifest {
  formatVersion: number;
  appVersion: string;
  createdAt: string;
  kind: BackupKind;
  schemaFingerprint: Record<string, string[]>;
  reportCount: number;
  photoCount: number;
  collectionNoteCount: number;
  dbSha256: string;
}
