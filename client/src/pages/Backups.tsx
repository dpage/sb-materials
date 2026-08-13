import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useAuth } from '../App';
import { api } from '../api';
import type { Backup } from '../types';
import { ConfirmDialog } from '../components/ConfirmDialog';

function formatSize(bytes: number): string {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString('en-GB');
}

const RESTORE_CONFIRMATION_TEXT = 'RESTORE';

// The server answers the restore request before it exits, and stays alive for
// at least another turn of the event loop after that, so polling immediately
// would find the old process still answering and send the browser to a login
// page served by a process that is about to vanish. Waiting first, and then
// preferring to have actually seen the server go, keeps that from happening.
const RESTART_INITIAL_DELAY_MS = 2000;
const RESTART_POLL_INTERVAL_MS = 1500;
// If nothing has ever caught the server down by the time this has elapsed, it
// restarted faster than the polling could notice, so a success is taken at face
// value rather than waiting for a gap that has already been and gone.
const RESTART_DOWNTIME_GRACE_MS = 10000;
// And an escape hatch, so a service that never comes back leaves the operator
// with a message rather than a spinner polling until the tab is closed.
const RESTART_TIMEOUT_MS = 3 * 60 * 1000;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Resolves true once the server is answering again, or false on giving up. */
async function pollUntilServerIsBack(): Promise<boolean> {
  await delay(RESTART_INITIAL_DELAY_MS);

  const startedAt = Date.now();
  let sawServerDown = false;

  while (Date.now() - startedAt < RESTART_TIMEOUT_MS) {
    try {
      // During the gap fetch itself rejects; once it resolves, whatever the
      // status, something is listening again.
      await fetch('/api/auth/me', { credentials: 'include' });
      if (sawServerDown || Date.now() - startedAt >= RESTART_DOWNTIME_GRACE_MS) return true;
    } catch {
      sawServerDown = true;
    }
    await delay(RESTART_POLL_INTERVAL_MS);
  }

  return false;
}

export function Backups() {
  const { user } = useAuth();
  const [backups, setBackups] = useState<Backup[]>([]);
  const [loading, setLoading] = useState(true);
  const [settings, setSettings] = useState<{ enabled: boolean; hour: number; keep: number }>({
    enabled: true,
    hour: 2,
    keep: 14,
  });
  const [settingsLoaded, setSettingsLoaded] = useState(false);
  const [savingSettings, setSavingSettings] = useState(false);
  const [takingBackup, setTakingBackup] = useState(false);
  const [error, setError] = useState('');
  const [restoreTarget, setRestoreTarget] = useState<Backup | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Backup | null>(null);
  const [uploadRestoreFile, setUploadRestoreFile] = useState<File | null>(null);
  const [restarting, setRestarting] = useState(false);
  const [restartTimedOut, setRestartTimedOut] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const load = useCallback(() => {
    setLoading(true);
    Promise.all([api.getBackups(), api.getSettings()])
      .then(([backupList, appSettings]) => {
        setBackups(backupList);
        setSettings({
          enabled: (appSettings['backup.enabled'] ?? 'true') === 'true',
          hour: parseInt(appSettings['backup.hour'] ?? '2', 10),
          keep: parseInt(appSettings['backup.keep'] ?? '14', 10),
        });
        setSettingsLoaded(true);
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  if (!user?.isSuperuser) return <div style={{ padding: 40, textAlign: 'center' }}>Access denied</div>;

  const handleTakeBackupNow = async () => {
    setTakingBackup(true);
    setError('');
    try {
      await api.takeBackupNow();
      load();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setTakingBackup(false);
    }
  };

  const handleConfirmDelete = async () => {
    if (!deleteTarget) return;
    const filename = deleteTarget.filename;
    setDeleteTarget(null);
    try {
      await api.deleteBackup(filename);
      load();
    } catch (err: any) {
      setError(err.message);
    }
  };

  const beginRestart = () => {
    setRestarting(true);
    pollUntilServerIsBack().then((isBack) => {
      if (isBack) {
        window.location.href = '/login';
      } else {
        setRestartTimedOut(true);
      }
    });
  };

  const handleConfirmRestore = async () => {
    if (!restoreTarget) return;
    try {
      await api.restoreBackup(restoreTarget.filename);
      setRestoreTarget(null);
      beginRestart();
    } catch (err: any) {
      setError(err.message);
      setRestoreTarget(null);
    }
  };

  const handleConfirmUploadRestore = async () => {
    if (!uploadRestoreFile) return;
    try {
      await api.uploadAndRestoreBackup(uploadRestoreFile);
      setUploadRestoreFile(null);
      beginRestart();
    } catch (err: any) {
      setError(err.message);
      setUploadRestoreFile(null);
    }
  };

  const handleSaveSettings = async () => {
    setSavingSettings(true);
    setError('');
    try {
      await api.updateSettings({
        'backup.enabled': settings.enabled ? 'true' : 'false',
        'backup.hour': String(settings.hour),
        'backup.keep': String(settings.keep),
      });
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSavingSettings(false);
    }
  };

  if (restarting) {
    return (
      <div style={{ position: 'fixed', inset: 0, background: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 2000 }}>
        <div style={{ textAlign: 'center', maxWidth: 460, padding: 20 }}>
          <h2>Restoring backup&hellip;</h2>
          {restartTimedOut ? (
            <p style={{ color: '#c0392b' }}>
              The application is taking longer than expected to restart — check the server. The restore itself has
              already been staged, so it will be applied as soon as the service comes back up.
            </p>
          ) : (
            <p style={{ color: '#666' }}>
              The application is restarting. This page will return to the login screen automatically.
            </p>
          )}
        </div>
      </div>
    );
  }

  return (
    <div>
      {error && (
        <div style={{ background: '#fdf0ef', border: '1px solid #e74c3c', color: '#c0392b', padding: '8px 12px', borderRadius: 6, marginBottom: 16, fontSize: 13 }}>
          {error}
        </div>
      )}

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, flexWrap: 'wrap', gap: 12 }}>
        <h2 style={{ margin: 0, fontSize: 22, fontWeight: 700, color: '#2d3436' }}>Backups</h2>
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            onClick={handleTakeBackupNow}
            disabled={takingBackup}
            style={{ padding: '10px 22px', background: '#27ae60', color: '#fff', border: 'none', borderRadius: 8, fontSize: 15, fontWeight: 600, cursor: takingBackup ? 'not-allowed' : 'pointer' }}
          >
            {takingBackup ? 'Taking backup…' : 'Take backup now'}
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".tar.gz"
            style={{ display: 'none' }}
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) setUploadRestoreFile(file);
              e.target.value = '';
            }}
          />
          <button
            onClick={() => fileInputRef.current?.click()}
            style={{ padding: '10px 22px', background: '#fff', border: '1px solid #dde1e6', color: '#2d3436', borderRadius: 8, fontSize: 15, fontWeight: 600, cursor: 'pointer' }}
          >
            Upload and restore
          </button>
        </div>
      </div>

      <div style={{ background: '#fff', borderRadius: 10, padding: 20, marginBottom: 16, boxShadow: '0 1px 4px rgba(0,0,0,0.07)' }}>
        <h3 style={{ margin: '0 0 14px', fontSize: 17, fontWeight: 600, color: '#2d3436' }}>Schedule</h3>
        <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={settings.enabled}
              onChange={(e) => setSettings((s) => ({ ...s, enabled: e.target.checked }))}
            />
            <span>Enabled</span>
          </label>
          <div>
            <label style={{ display: 'block', marginBottom: 4, fontSize: 13, fontWeight: 500 }}>Hour (0-23, UTC)</label>
            <input
              type="number"
              min={0}
              max={23}
              value={settings.hour}
              onChange={(e) => setSettings((s) => ({ ...s, hour: parseInt(e.target.value, 10) || 0 }))}
              style={{ width: 80, padding: '8px 10px', border: '1px solid #dde1e6', borderRadius: 6 }}
            />
          </div>
          <div>
            <label style={{ display: 'block', marginBottom: 4, fontSize: 13, fontWeight: 500 }}>Keep how many</label>
            <input
              type="number"
              min={1}
              value={settings.keep}
              onChange={(e) => setSettings((s) => ({ ...s, keep: parseInt(e.target.value, 10) || 1 }))}
              style={{ width: 80, padding: '8px 10px', border: '1px solid #dde1e6', borderRadius: 6 }}
            />
          </div>
          <button
            onClick={handleSaveSettings}
            disabled={savingSettings || !settingsLoaded}
            style={{ padding: '8px 20px', background: '#2980b9', color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: 14, fontWeight: 600 }}
          >
            Save schedule
          </button>
        </div>
      </div>

      <div style={{ background: '#fff', borderRadius: 10, boxShadow: '0 1px 4px rgba(0,0,0,0.07)', overflow: 'hidden' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              <th style={thStyle}>Date</th>
              <th style={thStyle}>Kind</th>
              <th style={thStyle}>Size</th>
              <th style={thStyle}>Contents</th>
              <th style={thStyle}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {!loading && backups.length === 0 && (
              <tr>
                <td colSpan={5} style={{ padding: 20, textAlign: 'center', color: '#7f8c8d' }}>
                  No backups yet
                </td>
              </tr>
            )}
            {backups.map((b) => (
              <tr key={b.filename}>
                <td style={tdStyle}>{formatDate(b.createdAt)}</td>
                <td style={tdStyle}>{b.kind}</td>
                <td style={tdStyle}>{formatSize(b.sizeBytes)}</td>
                <td style={tdStyle}>
                  {b.reportCount !== null ? `${b.reportCount} reports, ${b.photoCount} photos` : '—'}
                </td>
                <td style={tdStyle}>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <a href={api.downloadBackupUrl(b.filename)} style={smallBtnStyle}>
                      Download
                    </a>
                    <button onClick={() => setRestoreTarget(b)} style={smallBtnStyle}>
                      Restore
                    </button>
                    <button onClick={() => setDeleteTarget(b)} style={smallBtnStyle}>
                      Delete
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <ConfirmDialog
        open={restoreTarget !== null}
        title="Restore backup"
        message={
          restoreTarget
            ? `This replaces all current reports, customers and photos with the contents of the backup taken ${formatDate(restoreTarget.createdAt)} (${restoreTarget.reportCount ?? '?'} reports, ${restoreTarget.photoCount ?? '?'} photos). The current data is snapshotted first, and the application will restart.`
            : ''
        }
        confirmLabel="Restore"
        requireTypedConfirmation={RESTORE_CONFIRMATION_TEXT}
        onConfirm={handleConfirmRestore}
        onCancel={() => setRestoreTarget(null)}
      />

      <ConfirmDialog
        open={deleteTarget !== null}
        title="Delete backup"
        message={
          deleteTarget
            ? `Delete the backup taken ${formatDate(deleteTarget.createdAt)}? The archive file is removed from the server and cannot be recovered.`
            : ''
        }
        onConfirm={handleConfirmDelete}
        onCancel={() => setDeleteTarget(null)}
      />

      <ConfirmDialog
        open={uploadRestoreFile !== null}
        title="Restore uploaded backup"
        message={
          uploadRestoreFile
            ? `This uploads "${uploadRestoreFile.name}" (${formatSize(uploadRestoreFile.size)}), validates it, replaces all current data with its contents, and restarts the application. The current data is snapshotted first.`
            : ''
        }
        confirmLabel="Restore"
        requireTypedConfirmation={RESTORE_CONFIRMATION_TEXT}
        onConfirm={handleConfirmUploadRestore}
        onCancel={() => setUploadRestoreFile(null)}
      />
    </div>
  );
}

const thStyle: React.CSSProperties = {
  padding: '11px 14px',
  fontSize: 12,
  fontWeight: 600,
  color: '#7f8c8d',
  textAlign: 'left',
  background: '#f8f9fa',
  textTransform: 'uppercase',
  letterSpacing: 0.3,
  whiteSpace: 'nowrap',
};

const tdStyle: React.CSSProperties = {
  padding: '10px 14px',
  fontSize: 14,
  borderTop: '1px solid #f0f0f0',
};

const smallBtnStyle: React.CSSProperties = {
  padding: '4px 10px',
  border: '1px solid #dde1e6',
  borderRadius: 4,
  background: '#fff',
  cursor: 'pointer',
  fontSize: 12,
  color: '#2980b9',
  textDecoration: 'none',
  display: 'inline-block',
};
