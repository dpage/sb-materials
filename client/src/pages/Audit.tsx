import React, { useCallback, useEffect, useState } from 'react';
import { api } from '../api';
import { SHEET_STYLES } from './sheets-common';
import type { AuditEntry, AuditFilters } from '../types';

const PAGE_SIZE = 50;

/**
 * The log stores UTC (SQLite's `datetime('now')`), so the timestamp is marked
 * as such before it is shown in the reader's own time.
 */
export function formatAuditTime(createdAt: string): string {
  const when = new Date(`${createdAt.replace(' ', 'T')}Z`);
  if (Number.isNaN(when.getTime())) return createdAt;
  return when.toLocaleString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/** `login-failed` and `lookup_storage_modes` read better as words. */
export function humaniseAuditTerm(value: string): string {
  const words = value.replace(/^lookup_/, '').replace(/[-_]/g, ' ');
  return words.charAt(0).toUpperCase() + words.slice(1);
}

export function Audit() {
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [filters, setFilters] = useState<AuditFilters>({ actions: [], entityTypes: [], users: [] });
  const [userId, setUserId] = useState('');
  const [action, setAction] = useState('');
  const [entityType, setEntityType] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [search, setSearch] = useState('');

  useEffect(() => {
    api
      .getAuditFilters()
      .then(setFilters)
      .catch(() => undefined);
  }, []);

  const fetchEntries = useCallback(async () => {
    setLoading(true);
    const params: Record<string, string> = { page: String(page), limit: String(PAGE_SIZE) };
    if (userId) params.user_id = userId;
    if (action) params.action = action;
    if (entityType) params.entity_type = entityType;
    if (dateFrom) params.date_from = dateFrom;
    if (dateTo) params.date_to = dateTo;
    if (search.trim()) params.search = search.trim();

    try {
      const res = await api.getAuditLog(params);
      setEntries(res.data);
      setTotal(res.total);
      setError('');
    } catch (err: any) {
      setError(err?.message || 'Could not load the audit log');
    } finally {
      setLoading(false);
    }
  }, [page, userId, action, entityType, dateFrom, dateTo, search]);

  useEffect(() => {
    fetchEntries();
  }, [fetchEntries]);

  // Any change of filter starts again at the first page, since page 3 of the
  // old result set says nothing about the new one.
  const onFilterChange = (set: (value: string) => void) => (value: string) => {
    set(value);
    setPage(1);
  };

  const lastPage = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div>
      <style>{SHEET_STYLES}</style>

      <div className="sheet-header">
        <h2>Audit Log</h2>
      </div>

      <div className="sheet-controls">
        <select aria-label="Person" value={userId} onChange={(e) => onFilterChange(setUserId)(e.target.value)}>
          <option value="">Everyone</option>
          {filters.users.map((u) => (
            <option key={u.id} value={String(u.id)}>
              {u.display_name}
            </option>
          ))}
        </select>
        <select aria-label="Action" value={action} onChange={(e) => onFilterChange(setAction)(e.target.value)}>
          <option value="">All actions</option>
          {filters.actions.map((value) => (
            <option key={value} value={value}>
              {humaniseAuditTerm(value)}
            </option>
          ))}
        </select>
        <select aria-label="Type" value={entityType} onChange={(e) => onFilterChange(setEntityType)(e.target.value)}>
          <option value="">All types</option>
          {filters.entityTypes.map((value) => (
            <option key={value} value={value}>
              {humaniseAuditTerm(value)}
            </option>
          ))}
        </select>
        <input
          type="date"
          aria-label="From"
          value={dateFrom}
          onChange={(e) => onFilterChange(setDateFrom)(e.target.value)}
        />
        <input type="date" aria-label="To" value={dateTo} onChange={(e) => onFilterChange(setDateTo)(e.target.value)} />
        <input
          type="search"
          aria-label="Search"
          placeholder="Search..."
          value={search}
          onChange={(e) => onFilterChange(setSearch)(e.target.value)}
        />
      </div>

      {error && <div className="sheet-error">{error}</div>}

      {loading ? (
        <div className="empty-state">Loading...</div>
      ) : entries.length === 0 ? (
        <div className="empty-state">Nothing in the log matches those filters.</div>
      ) : (
        <>
          <div className="sheet-table-wrap">
            <table className="sheet-table">
              <thead>
                <tr>
                  <th>When</th>
                  <th>Who</th>
                  <th>Action</th>
                  <th>Type</th>
                  <th>What</th>
                </tr>
              </thead>
              <tbody>
                {entries.map((entry) => (
                  <tr key={entry.id}>
                    <td style={{ whiteSpace: 'nowrap' }}>{formatAuditTime(entry.created_at)}</td>
                    <td>{entry.current_display_name || entry.display_name || entry.username || 'Unknown'}</td>
                    <td>{humaniseAuditTerm(entry.action)}</td>
                    <td>{humaniseAuditTerm(entry.entity_type)}</td>
                    <td>{entry.summary || (entry.entity_id !== null ? `#${entry.entity_id}` : '')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="sheet-controls" style={{ marginTop: 14, justifyContent: 'flex-end' }}>
            <span style={{ fontSize: 13, color: '#7f8c8d' }}>
              {total} {total === 1 ? 'entry' : 'entries'}, page {page} of {lastPage}
            </span>
            <button className="action-btn" disabled={page <= 1} onClick={() => setPage(page - 1)}>
              Previous
            </button>
            <button className="action-btn" disabled={page >= lastPage} onClick={() => setPage(page + 1)}>
              Next
            </button>
          </div>
        </>
      )}
    </div>
  );
}
