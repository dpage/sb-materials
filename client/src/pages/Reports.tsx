import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api';
import { ConfirmDialog } from '../components/ConfirmDialog';
import type { Report, Customer } from '../types';
import { REPORT_TYPE_LABELS, TYPE_COLORS, TYPE_SHORT } from '../types';

export function Reports() {
  const navigate = useNavigate();
  const [reports, setReports] = useState<Report[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [loading, setLoading] = useState(true);
  const [filtersOpen, setFiltersOpen] = useState(false);

  const [customerId, setCustomerId] = useState('');
  const [reportType, setReportType] = useState('');
  const [status, setStatus] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [search, setSearch] = useState('');

  const [deleteId, setDeleteId] = useState<number | null>(null);

  const limit = 25;

  const activeFilterCount = [customerId, reportType, status, dateFrom, dateTo].filter(Boolean).length;

  const fetchReports = useCallback(async () => {
    setLoading(true);
    try {
      const params: Record<string, string> = { page: page.toString(), limit: limit.toString() };
      if (customerId) params.customer_id = customerId;
      if (reportType) params.report_type = reportType;
      if (status) params.status = status;
      if (dateFrom) params.date_from = dateFrom;
      if (dateTo) params.date_to = dateTo;
      if (search) params.search = search;
      const res = await api.getReports(params);
      setReports(res.data);
      setTotal(res.total);
    } finally {
      setLoading(false);
    }
  }, [page, customerId, reportType, status, dateFrom, dateTo, search]);

  useEffect(() => {
    fetchReports();
  }, [fetchReports]);

  useEffect(() => {
    api
      .getCustomers()
      .then(setCustomers)
      .catch((err) => console.error('Failed to load customers:', err));
  }, []);

  const handleDelete = async () => {
    if (deleteId === null) return;
    await api.deleteReport(deleteId);
    setDeleteId(null);
    fetchReports();
  };

  const totalPages = Math.ceil(total / limit);

  const formatDate = (d: string) => {
    try {
      const dt = new Date(d + 'T00:00:00');
      return dt.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
    } catch {
      return d;
    }
  };

  return (
    <div>
      <style>{`
        .reports-header {
          display: flex; justify-content: space-between; align-items: center;
          margin-bottom: 16px; flex-wrap: wrap; gap: 12px;
        }
        .reports-header h2 { margin: 0; font-size: 22px; font-weight: 700; color: #2d3436; }
        .btn-new {
          padding: 10px 22px; background: #27ae60; color: #fff; border: none;
          border-radius: 8px; font-size: 15px; font-weight: 600; cursor: pointer;
          white-space: nowrap;
        }
        .btn-new:active { background: #219a52; }

        /* Search + filter toggle row */
        .search-row {
          display: flex; gap: 8px; margin-bottom: 12px; align-items: stretch;
        }
        .search-input {
          flex: 1; padding: 10px 12px; border: 1px solid #dde1e6;
          border-radius: 8px; font-size: 15px; min-width: 0;
        }
        .btn-filter-toggle {
          padding: 10px 14px; border: 1px solid #dde1e6; border-radius: 8px;
          background: #fff; cursor: pointer; font-size: 14px; font-weight: 500;
          color: #636e72; white-space: nowrap; position: relative;
        }
        .btn-filter-toggle.active { border-color: #2e86de; color: #2e86de; }
        .filter-badge {
          position: absolute; top: -6px; right: -6px;
          background: #e74c3c; color: #fff; font-size: 11px; font-weight: 700;
          width: 18px; height: 18px; border-radius: 50%;
          display: flex; align-items: center; justify-content: center;
        }

        /* Filters panel */
        .filters-panel {
          background: #fff; border-radius: 10px; padding: 14px;
          margin-bottom: 14px; box-shadow: 0 1px 4px rgba(0,0,0,0.07);
          display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 10px;
        }
        .filter-group { display: flex; flex-direction: column; }
        .filter-group label {
          font-size: 11px; font-weight: 600; color: #7f8c8d;
          margin-bottom: 3px; text-transform: uppercase; letter-spacing: 0.3px;
        }
        .filter-group select, .filter-group input {
          padding: 9px 12px; border: 1px solid #dde1e6; border-radius: 6px;
          font-size: 14px; background: #fff; box-sizing: border-box;
        }

        /* Desktop table */
        .report-table-wrap {
          background: #fff; border-radius: 10px;
          box-shadow: 0 1px 4px rgba(0,0,0,0.07); overflow: hidden;
        }
        .report-table { width: 100%; border-collapse: collapse; }
        .report-table th {
          padding: 11px 14px; font-size: 12px; font-weight: 600; color: #7f8c8d;
          text-align: left; background: #f8f9fa; white-space: nowrap;
          text-transform: uppercase; letter-spacing: 0.3px;
        }
        .report-table td { padding: 10px 14px; font-size: 14px; border-top: 1px solid #f0f0f0; }
        .report-table tbody tr:hover { background: #f8fbff; }

        /* Type badge */
        .type-badge {
          padding: 3px 10px; border-radius: 12px; font-size: 12px; font-weight: 600;
          white-space: nowrap; display: inline-block;
        }
        .status-badge {
          padding: 3px 10px; border-radius: 12px; font-size: 12px; font-weight: 600;
          display: inline-block;
        }
        .status-completed { background: #d5f5e3; color: #27ae60; }
        .status-draft { background: #fef9e7; color: #f39c12; }

        /* Action buttons */
        .action-btn {
          padding: 4px 12px; border: 1px solid #ddd; border-radius: 4px;
          background: #fff; cursor: pointer; font-size: 13px; color: #2980b9;
          text-decoration: none; display: inline-block;
        }
        .action-btn.delete { color: #e74c3c; }
        .actions-row { display: flex; gap: 6px; }

        /* Mobile cards */
        .report-cards { display: none; }
        .report-card {
          background: #fff; border-radius: 10px; padding: 14px 16px;
          box-shadow: 0 1px 4px rgba(0,0,0,0.07); margin-bottom: 10px;
        }
        .card-top {
          display: flex; justify-content: space-between; align-items: flex-start;
          margin-bottom: 8px;
        }
        .card-date { font-size: 13px; color: #7f8c8d; font-weight: 500; }
        .card-customer { font-size: 16px; font-weight: 600; color: #2d3436; margin-bottom: 6px; }
        .card-meta {
          display: flex; flex-wrap: wrap; gap: 8px; align-items: center;
          margin-bottom: 10px; font-size: 13px; color: #636e72;
        }
        .card-meta .sep { color: #ddd; }
        .card-actions {
          display: flex; gap: 8px; border-top: 1px solid #f0f0f0; padding-top: 10px;
        }
        .card-action-btn {
          flex: 1; padding: 8px 0; border: 1px solid #dde1e6; border-radius: 6px;
          background: #fff; cursor: pointer; font-size: 13px; font-weight: 500;
          color: #2980b9; text-align: center; text-decoration: none;
          display: flex; align-items: center; justify-content: center;
        }
        .card-action-btn.delete { color: #e74c3c; }

        /* Pagination */
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
          .report-table-wrap { display: none; }
          .report-cards { display: block; }
          .filters-panel { grid-template-columns: 1fr 1fr; }
        }
        @media (max-width: 480px) {
          .filters-panel { grid-template-columns: 1fr; }
        }
      `}</style>

      <div className="reports-header">
        <h2>
          Reports {!loading && <span style={{ fontSize: 14, fontWeight: 400, color: '#95a5a6' }}>({total})</span>}
        </h2>
        <button className="btn-new" onClick={() => navigate('/reports/new')}>
          + New Report
        </button>
      </div>

      {/* Search + filter toggle */}
      <div className="search-row">
        <input
          className="search-input"
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setPage(1);
          }}
          placeholder="Search reports..."
        />
        <button
          className={`btn-filter-toggle ${filtersOpen || activeFilterCount ? 'active' : ''}`}
          onClick={() => setFiltersOpen((f) => !f)}
        >
          Filters
          {activeFilterCount > 0 && <span className="filter-badge">{activeFilterCount}</span>}
        </button>
      </div>

      {/* Collapsible filters */}
      {filtersOpen && (
        <div className="filters-panel">
          <div className="filter-group">
            <label>Customer</label>
            <select
              value={customerId}
              onChange={(e) => {
                setCustomerId(e.target.value);
                setPage(1);
              }}
            >
              <option value="">All</option>
              {customers.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
          <div className="filter-group">
            <label>Type</label>
            <select
              value={reportType}
              onChange={(e) => {
                setReportType(e.target.value);
                setPage(1);
              }}
            >
              <option value="">All</option>
              {Object.entries(REPORT_TYPE_LABELS).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
          </div>
          <div className="filter-group">
            <label>Status</label>
            <select
              value={status}
              onChange={(e) => {
                setStatus(e.target.value);
                setPage(1);
              }}
            >
              <option value="">All</option>
              <option value="draft">Draft</option>
              <option value="completed">Completed</option>
            </select>
          </div>
          <div className="filter-group">
            <label>From</label>
            <input
              type="date"
              value={dateFrom}
              onChange={(e) => {
                setDateFrom(e.target.value);
                setPage(1);
              }}
            />
          </div>
          <div className="filter-group">
            <label>To</label>
            <input
              type="date"
              value={dateTo}
              onChange={(e) => {
                setDateTo(e.target.value);
                setPage(1);
              }}
            />
          </div>
        </div>
      )}

      {loading ? (
        <div className="report-table-wrap">
          <div className="empty-state">Loading...</div>
        </div>
      ) : reports.length === 0 ? (
        <div className="report-table-wrap">
          <div className="empty-state">No reports found. Click "+ New Report" to create one.</div>
        </div>
      ) : (
        <>
          {/* Desktop: Table */}
          <div className="report-table-wrap">
            <table className="report-table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Customer</th>
                  <th>Type</th>
                  <th>Inspector</th>
                  <th>Status</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {reports.map((r) => (
                  <tr key={r.id}>
                    <td style={{ whiteSpace: 'nowrap' }}>{formatDate(r.inspection_date)}</td>
                    <td>{r.customer_name}</td>
                    <td>
                      <span
                        className="type-badge"
                        style={{
                          background: (TYPE_COLORS[r.report_type] || '#999') + '18',
                          color: TYPE_COLORS[r.report_type] || '#999',
                        }}
                      >
                        {REPORT_TYPE_LABELS[r.report_type] || r.report_type}
                      </span>
                    </td>
                    <td>{r.inspector_name}</td>
                    <td>
                      <span
                        className={`status-badge ${r.status === 'completed' ? 'status-completed' : 'status-draft'}`}
                      >
                        {r.status.charAt(0).toUpperCase() + r.status.slice(1)}
                      </span>
                    </td>
                    <td>
                      <div className="actions-row">
                        <button className="action-btn" onClick={() => navigate(`/reports/${r.id}`)}>
                          Edit
                        </button>
                        <a className="action-btn" href={api.downloadPdf(r.id)}>
                          PDF
                        </a>
                        <button className="action-btn delete" onClick={() => setDeleteId(r.id)}>
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
          <div className="report-cards">
            {reports.map((r) => (
              <div className="report-card" key={r.id}>
                <div className="card-top">
                  <div>
                    <div className="card-customer">{r.customer_name}</div>
                    <div className="card-meta">
                      <span
                        className="type-badge"
                        style={{
                          background: (TYPE_COLORS[r.report_type] || '#999') + '18',
                          color: TYPE_COLORS[r.report_type] || '#999',
                        }}
                      >
                        {TYPE_SHORT[r.report_type] || r.report_type}
                      </span>
                      <span
                        className={`status-badge ${r.status === 'completed' ? 'status-completed' : 'status-draft'}`}
                      >
                        {r.status.charAt(0).toUpperCase() + r.status.slice(1)}
                      </span>
                    </div>
                  </div>
                  <div className="card-date">{formatDate(r.inspection_date)}</div>
                </div>
                <div className="card-meta">
                  <span>{r.inspector_name}</span>
                </div>
                <div className="card-actions">
                  <button className="card-action-btn" onClick={() => navigate(`/reports/${r.id}`)}>
                    Edit
                  </button>
                  <a className="card-action-btn" href={api.downloadPdf(r.id)}>
                    PDF
                  </a>
                  <button className="card-action-btn delete" onClick={() => setDeleteId(r.id)}>
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
        title="Delete Report"
        message="Are you sure you want to delete this report? This cannot be undone."
        onConfirm={handleDelete}
        onCancel={() => setDeleteId(null)}
      />
    </div>
  );
}
