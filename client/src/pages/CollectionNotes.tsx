import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api';
import { ConfirmDialog } from '../components/ConfirmDialog';
import type { CollectionNote, Customer } from '../types';

function formatUkDate(value: string | null): string {
  if (!value) return '';
  const match = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?/.exec(value);
  if (!match) return value;
  const [, year, month, day, hour, minute] = match;
  const date = `${day}/${month}/${year}`;
  return hour !== undefined ? `${date} ${hour}:${minute}` : date;
}

type SortField = 'collection_date' | 'reference' | 'created_at' | 'customer_name';

export function CollectionNotes() {
  const navigate = useNavigate();
  const [notes, setNotes] = useState<CollectionNote[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [loading, setLoading] = useState(true);

  const [customerId, setCustomerId] = useState('');
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<SortField>('collection_date');
  const [order, setOrder] = useState<'ASC' | 'DESC'>('DESC');

  const [deleteId, setDeleteId] = useState<number | null>(null);
  const [copyingId, setCopyingId] = useState<number | null>(null);
  const [copyError, setCopyError] = useState('');

  const limit = 25;

  const fetchNotes = useCallback(async () => {
    setLoading(true);
    try {
      const params: Record<string, string> = {
        page: page.toString(),
        limit: limit.toString(),
        sort,
        order,
      };
      if (customerId) params.customer_id = customerId;
      if (search) params.search = search;
      const res = await api.getCollectionNotes(params);
      setNotes(res.data);
      setTotal(res.total);
    } finally {
      setLoading(false);
    }
  }, [page, customerId, search, sort, order]);

  useEffect(() => {
    fetchNotes();
  }, [fetchNotes]);

  useEffect(() => {
    api
      .getCustomers()
      .then(setCustomers)
      .catch((err) => console.error('Failed to load customers:', err));
  }, []);

  const handleDelete = async () => {
    if (deleteId === null) return;
    await api.deleteCollectionNote(deleteId);
    setDeleteId(null);
    fetchNotes();
  };

  // The same load often goes out repeatedly, so a copy is deliberately a
  // single click that leaves you on the list: the new note takes the next
  // reference and today's date, and can be opened afterwards if anything needs
  // changing.
  const handleCopy = async (id: number) => {
    if (copyingId !== null) return;
    setCopyingId(id);
    setCopyError('');
    try {
      await api.duplicateCollectionNote(id);
      await fetchNotes();
    } catch (err: any) {
      setCopyError(err?.message || 'Could not copy the collection note');
    } finally {
      setCopyingId(null);
    }
  };

  const handleSort = (field: SortField) => {
    if (sort === field) {
      setOrder((o) => (o === 'ASC' ? 'DESC' : 'ASC'));
    } else {
      setSort(field);
      setOrder('DESC');
    }
    setPage(1);
  };

  const sortIndicator = (field: SortField) => (sort === field ? (order === 'ASC' ? ' ▲' : ' ▼') : '');

  const totalPages = Math.ceil(total / limit);

  return (
    <div>
      <style>{`
        .cn-header {
          display: flex; justify-content: space-between; align-items: center;
          margin-bottom: 16px; flex-wrap: wrap; gap: 12px;
        }
        .cn-header h2 { margin: 0; font-size: 22px; font-weight: 700; color: #2d3436; }
        .btn-new {
          padding: 10px 22px; background: #27ae60; color: #fff; border: none;
          border-radius: 8px; font-size: 15px; font-weight: 600; cursor: pointer;
          white-space: nowrap;
        }
        .btn-new:active { background: #219a52; }

        .search-row {
          display: flex; gap: 8px; margin-bottom: 12px; align-items: stretch;
        }
        .search-input {
          flex: 1; padding: 10px 12px; border: 1px solid #dde1e6;
          border-radius: 8px; font-size: 15px; min-width: 0;
        }
        .filter-group { display: flex; flex-direction: column; }
        .filter-group select {
          padding: 9px 12px; border: 1px solid #dde1e6; border-radius: 6px;
          font-size: 14px; background: #fff; box-sizing: border-box;
        }

        .cn-table-wrap {
          background: #fff; border-radius: 10px;
          box-shadow: 0 1px 4px rgba(0,0,0,0.07); overflow: hidden;
        }
        .cn-table { width: 100%; border-collapse: collapse; }
        .cn-table th {
          padding: 11px 14px; font-size: 12px; font-weight: 600; color: #7f8c8d;
          text-align: left; background: #f8f9fa; white-space: nowrap;
          text-transform: uppercase; letter-spacing: 0.3px; cursor: pointer;
        }
        .cn-table td { padding: 10px 14px; font-size: 14px; border-top: 1px solid #f0f0f0; }
        .cn-table tbody tr:hover { background: #f8fbff; }

        .action-btn {
          padding: 4px 12px; border: 1px solid #ddd; border-radius: 4px;
          background: #fff; cursor: pointer; font-size: 13px; color: #2980b9;
          text-decoration: none; display: inline-block;
        }
        .action-btn.delete { color: #e74c3c; }
        .action-btn:disabled, .cn-card-action-btn:disabled { opacity: 0.5; cursor: default; }
        .actions-row { display: flex; gap: 6px; }

        .copy-error {
          background: #fdf0ef; border: 1px solid #e74c3c; color: #c0392b;
          padding: 10px 14px; border-radius: 8px; margin-bottom: 12px; font-size: 14px;
        }

        /* Mobile cards */
        .cn-cards { display: none; }
        .cn-card {
          background: #fff; border-radius: 10px; padding: 14px 16px;
          box-shadow: 0 1px 4px rgba(0,0,0,0.07); margin-bottom: 10px;
        }
        .cn-card-top {
          display: flex; justify-content: space-between; align-items: flex-start;
          margin-bottom: 8px;
        }
        .cn-card-date { font-size: 13px; color: #7f8c8d; font-weight: 500; }
        .cn-card-customer { font-size: 16px; font-weight: 600; color: #2d3436; margin-bottom: 2px; }
        .cn-card-reference { font-size: 13px; color: #636e72; margin-bottom: 6px; }
        .cn-card-meta {
          display: flex; flex-wrap: wrap; gap: 8px; align-items: center;
          margin-bottom: 10px; font-size: 13px; color: #636e72;
        }
        .cn-card-actions {
          display: flex; gap: 8px; border-top: 1px solid #f0f0f0; padding-top: 10px;
        }
        .cn-card-action-btn {
          flex: 1; padding: 8px 0; border: 1px solid #dde1e6; border-radius: 6px;
          background: #fff; cursor: pointer; font-size: 13px; font-weight: 500;
          color: #2980b9; text-align: center; text-decoration: none;
          display: flex; align-items: center; justify-content: center;
        }
        .cn-card-action-btn.delete { color: #e74c3c; }

        .pagination {
          display: flex; justify-content: center; padding: 14px; gap: 8px;
        }
        .page-btn {
          padding: 6px 16px; border: 1px solid #ddd; border-radius: 6px;
          background: #fff; cursor: pointer; font-size: 14px;
        }
        .page-btn:disabled { opacity: 0.4; cursor: default; }
        .page-info { padding: 6px 12px; font-size: 14px; color: #636e72; }

        .empty-state {
          padding: 40px 20px; text-align: center; color: #999; font-size: 15px;
        }

        /* Responsive: cards on mobile, table on desktop */
        @media (max-width: 768px) {
          .cn-table-wrap { display: none; }
          .cn-cards { display: block; }
        }
      `}</style>

      <div className="cn-header">
        <h2>
          Collection Notes{' '}
          {!loading && <span style={{ fontSize: 14, fontWeight: 400, color: '#95a5a6' }}>({total})</span>}
        </h2>
        <button className="btn-new" onClick={() => navigate('/collection-notes/new')}>
          + New Collection Note
        </button>
      </div>

      <div className="search-row">
        <input
          className="search-input"
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setPage(1);
          }}
          placeholder="Search reference, customer, or description"
        />
        <div className="filter-group">
          <select
            value={customerId}
            onChange={(e) => {
              setCustomerId(e.target.value);
              setPage(1);
            }}
          >
            <option value="">All customers</option>
            {customers.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      {copyError && <div className="copy-error">{copyError}</div>}

      {loading ? (
        <div className="empty-state">Loading...</div>
      ) : notes.length === 0 ? (
        <div className="empty-state">No collection notes yet.</div>
      ) : (
        <>
          {/* Desktop: Table */}
          <div className="cn-table-wrap">
            <table className="cn-table">
              <thead>
                <tr>
                  <th onClick={() => handleSort('reference')}>Reference{sortIndicator('reference')}</th>
                  <th onClick={() => handleSort('collection_date')}>Date{sortIndicator('collection_date')}</th>
                  <th onClick={() => handleSort('customer_name')}>Customer{sortIndicator('customer_name')}</th>
                  <th>Items</th>
                  <th>Transport</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {notes.map((n) => (
                  <tr key={n.id}>
                    <td>{n.reference}</td>
                    <td style={{ whiteSpace: 'nowrap' }}>{formatUkDate(n.collection_date)}</td>
                    <td>{n.customer_name}</td>
                    <td
                      style={{
                        maxWidth: 260,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {n.items_summary}
                    </td>
                    <td>{n.transport_company}</td>
                    <td>
                      <div className="actions-row">
                        <button className="action-btn" onClick={() => navigate(`/collection-notes/${n.id}`)}>
                          Edit
                        </button>
                        <button className="action-btn" disabled={copyingId !== null} onClick={() => handleCopy(n.id)}>
                          {copyingId === n.id ? 'Copying...' : 'Copy'}
                        </button>
                        <a className="action-btn" href={api.downloadCollectionNotePdf(n.id)}>
                          PDF
                        </a>
                        <button className="action-btn delete" onClick={() => setDeleteId(n.id)}>
                          Delete
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {totalPages > 1 && (
              <div className="pagination">
                <button className="page-btn" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
                  Prev
                </button>
                <span className="page-info">
                  Page {page} of {totalPages}
                </span>
                <button className="page-btn" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>
                  Next
                </button>
              </div>
            )}
          </div>

          {/* Mobile: Cards */}
          <div className="cn-cards">
            {notes.map((n) => (
              <div className="cn-card" key={n.id}>
                <div className="cn-card-top">
                  <div>
                    <div className="cn-card-customer">{n.customer_name}</div>
                    <div className="cn-card-reference">{n.reference}</div>
                  </div>
                  <div className="cn-card-date">{formatUkDate(n.collection_date)}</div>
                </div>
                <div className="cn-card-meta">
                  <span>{n.items_summary}</span>
                </div>
                <div className="cn-card-meta">
                  <span>{n.transport_company}</span>
                </div>
                <div className="cn-card-actions">
                  <button className="cn-card-action-btn" onClick={() => navigate(`/collection-notes/${n.id}`)}>
                    Edit
                  </button>
                  <button className="cn-card-action-btn" disabled={copyingId !== null} onClick={() => handleCopy(n.id)}>
                    {copyingId === n.id ? 'Copying...' : 'Copy'}
                  </button>
                  <a className="cn-card-action-btn" href={api.downloadCollectionNotePdf(n.id)}>
                    PDF
                  </a>
                  <button className="cn-card-action-btn delete" onClick={() => setDeleteId(n.id)}>
                    Delete
                  </button>
                </div>
              </div>
            ))}
            {totalPages > 1 && (
              <div className="pagination">
                <button className="page-btn" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
                  Prev
                </button>
                <span className="page-info">
                  Page {page} of {totalPages}
                </span>
                <button className="page-btn" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>
                  Next
                </button>
              </div>
            )}
          </div>
        </>
      )}

      <ConfirmDialog
        open={deleteId !== null}
        title="Delete Collection Note"
        message="Are you sure you want to delete this collection note? This cannot be undone."
        onConfirm={handleDelete}
        onCancel={() => setDeleteId(null)}
      />
    </div>
  );
}
