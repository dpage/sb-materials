import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api';
import type { Sale } from '../types';

/** A stored date (YYYY-MM-DD, optionally with a time) as day/month/year. */
export function formatSaleDate(value: string | null): string {
  if (!value) return '';
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  return match ? `${match[3]}/${match[2]}/${match[1]}` : value;
}

/** A price in pounds, or an empty cell when none has been recorded. */
export function formatMoney(value: number | null): string {
  if (value === null || value === undefined) return '';
  return `£${value.toFixed(2)}`;
}

type Status = 'unpaid' | 'paid' | 'all';

export function Sales() {
  const navigate = useNavigate();
  const [sales, setSales] = useState<Sale[]>([]);
  const [outstanding, setOutstanding] = useState(0);
  const [status, setStatus] = useState<Status>('unpaid');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  // The line currently being ticked, so its box cannot be clicked twice while
  // the save is in flight.
  const [savingId, setSavingId] = useState<number | null>(null);

  const fetchSales = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const params: Record<string, string> = { status };
      if (search.trim()) params.search = search.trim();
      const res = await api.getSales(params);
      setSales(res.data);
      setOutstanding(res.outstanding);
    } catch (err: any) {
      setError(err?.message || 'Could not load the sales list');
    } finally {
      setLoading(false);
    }
  }, [status, search]);

  useEffect(() => {
    fetchSales();
  }, [fetchSales]);

  // Ticking a sale as paid takes it off the unpaid list, which is the whole
  // point of the screen, so the list is reloaded rather than patched in place.
  const togglePaid = async (sale: Sale) => {
    if (savingId !== null) return;
    setSavingId(sale.id);
    setError('');
    try {
      await api.setSalePaid(sale.id, !sale.is_paid);
      await fetchSales();
    } catch (err: any) {
      setError(err?.message || 'Could not update the sale');
    } finally {
      setSavingId(null);
    }
  };

  return (
    <div>
      <style>{`
        .sales-header {
          display: flex; justify-content: space-between; align-items: center;
          margin-bottom: 16px; flex-wrap: wrap; gap: 12px;
        }
        .sales-header h2 { margin: 0; font-size: 22px; font-weight: 700; color: #2d3436; }
        .sales-outstanding { font-size: 14px; color: #636e72; }
        .sales-filters { display: flex; gap: 8px; margin-bottom: 12px; }
        .sales-filters input {
          flex: 1; padding: 10px 12px; border: 1px solid #dde1e6;
          border-radius: 8px; font-size: 15px; min-width: 0;
        }
        .sales-filters select {
          padding: 9px 28px 9px 12px; border: 1px solid #dde1e6; border-radius: 6px;
          font-size: 14px; background-color: #fff;
        }
        .sales-table-wrap {
          background: #fff; border-radius: 10px;
          box-shadow: 0 1px 4px rgba(0,0,0,0.07); overflow-x: auto;
        }
        .sales-table { width: 100%; border-collapse: collapse; }
        .sales-table th {
          padding: 11px 14px; font-size: 12px; font-weight: 600; color: #7f8c8d;
          text-align: left; background: #f8f9fa; white-space: nowrap;
          text-transform: uppercase; letter-spacing: 0.3px;
        }
        .sales-table td { padding: 10px 14px; font-size: 14px; border-top: 1px solid #f0f0f0; }
        .sales-table tbody tr:hover { background: #f8fbff; }
        .sales-error {
          background: #fdf0ef; border: 1px solid #e74c3c; color: #c0392b;
          padding: 10px 14px; border-radius: 8px; margin-bottom: 12px; font-size: 14px;
        }
        .sales-empty { padding: 40px 20px; text-align: center; color: #999; font-size: 15px; }
        .sales-link {
          background: none; border: none; padding: 0; color: #2980b9;
          cursor: pointer; font-size: 14px; text-decoration: underline;
        }
      `}</style>

      <div className="sales-header">
        <h2>
          Sales {!loading && <span style={{ fontSize: 14, fontWeight: 400, color: '#95a5a6' }}>({sales.length})</span>}
        </h2>
        <div className="sales-outstanding" aria-label="Outstanding total">
          Outstanding: {formatMoney(outstanding)}
        </div>
      </div>

      <div className="sales-filters">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search reference, customer, or buyer"
          aria-label="Search sales"
        />
        <select value={status} onChange={(e) => setStatus(e.target.value as Status)} aria-label="Paid status">
          <option value="unpaid">Unpaid</option>
          <option value="paid">Paid</option>
          <option value="all">All</option>
        </select>
      </div>

      {error && <div className="sales-error">{error}</div>}

      {loading ? (
        <div className="sales-empty">Loading...</div>
      ) : sales.length === 0 ? (
        <div className="sales-empty">
          {status === 'unpaid' ? 'Nothing outstanding: every sale has been paid.' : 'No sales to show.'}
        </div>
      ) : (
        <div className="sales-table-wrap">
          <table className="sales-table">
            <thead>
              <tr>
                <th>Paid</th>
                <th>Reference</th>
                <th>Date</th>
                <th>Customer</th>
                <th>Buyer</th>
                <th>Buy</th>
                <th>Sale</th>
                <th>Note</th>
              </tr>
            </thead>
            <tbody>
              {sales.map((sale) => (
                <tr key={sale.id}>
                  <td>
                    <input
                      type="checkbox"
                      checked={!!sale.is_paid}
                      disabled={savingId !== null}
                      onChange={() => togglePaid(sale)}
                      aria-label={`Paid, ${sale.reference}`}
                    />
                  </td>
                  <td>{sale.reference}</td>
                  <td style={{ whiteSpace: 'nowrap' }}>{formatSaleDate(sale.collection_date)}</td>
                  <td>{sale.customer_name}</td>
                  <td>{sale.buyer}</td>
                  <td style={{ whiteSpace: 'nowrap' }}>{formatMoney(sale.buy_price)}</td>
                  <td style={{ whiteSpace: 'nowrap' }}>{formatMoney(sale.sale_price)}</td>
                  <td>
                    <button className="sales-link" onClick={() => navigate(`/collection-notes/${sale.id}`)}>
                      Open
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
