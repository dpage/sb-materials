import React, { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api';
import { useAuth } from '../App';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { formatMoney, formatSheetMonth } from '../utils/mileage';
import { MonthPicker, PersonFilter, SHEET_STYLES, personParams } from './sheets-common';
import type { ExpenseSheet } from '../types';

export function Expenses() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const today = new Date();

  const [sheets, setSheets] = useState<ExpenseSheet[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [person, setPerson] = useState('');
  const [year, setYear] = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth() + 1);
  const [opening, setOpening] = useState(false);
  const [deleteId, setDeleteId] = useState<number | null>(null);

  const fetchSheets = useCallback(async () => {
    setLoading(true);
    try {
      setSheets(await api.getExpenseSheets(personParams(person)));
    } catch (err: any) {
      setError(err?.message || 'Could not load the expense sheets');
    } finally {
      setLoading(false);
    }
  }, [person]);

  useEffect(() => {
    fetchSheets();
  }, [fetchSheets]);

  const handleOpen = async () => {
    setOpening(true);
    setError('');
    try {
      const sheet = await api.openExpenseSheet(year, month, person && person !== 'all' ? Number(person) : undefined);
      navigate(`/expenses/${sheet.id}`);
    } catch (err: any) {
      setError(err?.message || 'Could not open the sheet');
    } finally {
      setOpening(false);
    }
  };

  const handleDelete = async () => {
    if (deleteId === null) return;
    await api.deleteExpenseSheet(deleteId);
    setDeleteId(null);
    fetchSheets();
  };

  return (
    <div>
      <style>{SHEET_STYLES}</style>

      <div className="sheet-header">
        <h2>Expenses</h2>
      </div>

      <div className="sheet-controls">
        <MonthPicker
          year={year}
          month={month}
          onChange={(y, m) => {
            setYear(y);
            setMonth(m);
          }}
        />
        <button className="btn-new" disabled={opening} onClick={handleOpen}>
          {opening ? 'Opening...' : 'Open sheet'}
        </button>
        {user?.isSuperuser && <PersonFilter value={person} onChange={setPerson} />}
      </div>

      {error && <div className="sheet-error">{error}</div>}

      {loading ? (
        <div className="empty-state">Loading...</div>
      ) : sheets.length === 0 ? (
        <div className="empty-state">No expense sheets yet. Pick a month above to start one.</div>
      ) : (
        <div className="sheet-table-wrap">
          <table className="sheet-table">
            <thead>
              <tr>
                <th>Month</th>
                {person === 'all' && <th>Person</th>}
                <th>Items</th>
                <th>Total</th>
                <th>VAT</th>
                <th>Net</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {sheets.map((sheet) => (
                <tr key={sheet.id}>
                  <td style={{ whiteSpace: 'nowrap' }}>{formatSheetMonth(sheet.year, sheet.month)}</td>
                  {person === 'all' && <td>{sheet.display_name}</td>}
                  <td className="num">{sheet.item_count ?? 0}</td>
                  <td className="num">{formatMoney(sheet.totals.gross)}</td>
                  <td className="num">{formatMoney(sheet.totals.vat)}</td>
                  <td className="num">{formatMoney(sheet.totals.net)}</td>
                  <td>
                    <div className="actions-row">
                      <button className="action-btn" onClick={() => navigate(`/expenses/${sheet.id}`)}>
                        Edit
                      </button>
                      <a className="action-btn" href={api.downloadExpenseSheetPdf(sheet.id)}>
                        PDF
                      </a>
                      <button className="action-btn delete" onClick={() => setDeleteId(sheet.id)}>
                        Delete
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <ConfirmDialog
        open={deleteId !== null}
        title="Delete Expense Sheet"
        message="Are you sure you want to delete this expense sheet, its items and its receipts? This cannot be undone."
        onConfirm={handleDelete}
        onCancel={() => setDeleteId(null)}
      />
    </div>
  );
}
