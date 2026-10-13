import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api } from '../api';
import { expenseTotals, formatMoney, formatSheetMonth, toNumber, vatWithinGross } from '../utils/mileage';
import { SHEET_STYLES } from './sheets-common';
import type { ExpenseItem, ExpensePhoto, ExpenseSheet } from '../types';

const emptyItem = (): ExpenseItem => ({
  item_date: new Date().toISOString().slice(0, 10),
  description: null,
  cost: null,
  vat_applicable: 0,
  vat_amount: null,
});

export function ExpenseEdit() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const fileInput = useRef<HTMLInputElement>(null);

  const [sheet, setSheet] = useState<ExpenseSheet | null>(null);
  const [items, setItems] = useState<ExpenseItem[]>([]);
  const [photos, setPhotos] = useState<ExpensePhoto[]>([]);
  const [notes, setNotes] = useState('');
  const [attachTo, setAttachTo] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');

  const load = (data: ExpenseSheet) => {
    setSheet(data);
    setItems(data.items ?? []);
    setPhotos(data.photos ?? []);
    setNotes(data.notes ?? '');
  };

  useEffect(() => {
    if (!id) return;
    api
      .getExpenseSheet(Number(id))
      .then(load)
      .catch((err: any) => setError(err?.message || 'Could not load the sheet'))
      .finally(() => setLoading(false));
  }, [id]);

  const totals = useMemo(() => expenseTotals(items), [items]);

  const updateItem = (index: number, patch: Partial<ExpenseItem>) => {
    setItems((prev) => prev.map((item, i) => (i === index ? { ...item, ...patch } : item)));
  };

  const save = async (): Promise<ExpenseSheet | null> => {
    if (!sheet) return null;
    setSaving(true);
    setError('');
    try {
      const saved = await api.saveExpenseSheet(sheet.id, { notes, items });
      load(saved);
      return saved;
    } catch (err: any) {
      setError(err?.message || 'Could not save the sheet');
      return null;
    } finally {
      setSaving(false);
    }
  };

  const handleSave = async () => {
    if (await save()) navigate('/expenses');
  };

  // A receipt is attached to an item by its id, so the sheet is saved first:
  // a row typed but not yet saved has no id for the photograph to point at.
  const handleUpload = async (files: FileList | null) => {
    if (!sheet || !files?.length) return;
    setUploading(true);
    setError('');
    try {
      const saved = await save();
      if (!saved) return;
      const itemId = attachTo ? Number(attachTo) : null;
      const list = Array.from(files);
      await api.uploadReceipts(
        sheet.id,
        list,
        list.map(() => itemId),
      );
      load(await api.getExpenseSheet(sheet.id));
    } catch (err: any) {
      setError(err?.message || 'Could not upload the receipt');
    } finally {
      setUploading(false);
      if (fileInput.current) fileInput.current.value = '';
    }
  };

  const handleDeletePhoto = async (photoId: number) => {
    if (!sheet) return;
    await api.deleteReceipt(sheet.id, photoId);
    setPhotos((prev) => prev.filter((p) => p.id !== photoId));
  };

  if (loading) return <div className="empty-state">Loading...</div>;
  if (!sheet) return <div className="sheet-error">{error || 'Expense sheet not found'}</div>;

  const savedItems = items.filter((item) => item.id !== undefined);

  return (
    <div>
      <style>{SHEET_STYLES}</style>

      <div className="sheet-header">
        <h2>
          Expenses: {formatSheetMonth(sheet.year, sheet.month)}
          {sheet.display_name ? ` (${sheet.display_name})` : ''}
        </h2>
        <div className="actions-row">
          <a className="action-btn" href={api.downloadExpenseSheetPdf(sheet.id)}>
            PDF
          </a>
          <button className="btn-new" disabled={saving} onClick={handleSave}>
            {saving ? 'Saving...' : 'Save'}
          </button>
        </div>
      </div>

      {error && <div className="sheet-error">{error}</div>}

      <div className="sheet-table-wrap">
        <table className="sheet-table">
          <thead>
            <tr>
              <th>Date</th>
              <th>What it was</th>
              <th>Cost</th>
              <th>VAT?</th>
              <th>VAT</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {items.map((item, index) => (
              <tr key={item.id ?? `new-${index}`}>
                <td>
                  <input
                    type="date"
                    aria-label={`Date, row ${index + 1}`}
                    value={item.item_date ?? ''}
                    onChange={(e) => updateItem(index, { item_date: e.target.value || null })}
                  />
                </td>
                <td>
                  <input
                    aria-label={`Description, row ${index + 1}`}
                    value={item.description ?? ''}
                    onChange={(e) => updateItem(index, { description: e.target.value })}
                  />
                </td>
                <td>
                  <input
                    type="number"
                    step="0.01"
                    aria-label={`Cost, row ${index + 1}`}
                    value={item.cost ?? ''}
                    onChange={(e) => updateItem(index, { cost: toNumber(e.target.value) })}
                  />
                </td>
                <td style={{ textAlign: 'center' }}>
                  <input
                    type="checkbox"
                    aria-label={`VAT applicable, row ${index + 1}`}
                    checked={Boolean(item.vat_applicable)}
                    onChange={(e) => updateItem(index, { vat_applicable: e.target.checked ? 1 : 0 })}
                    style={{ width: 'auto', minWidth: 0 }}
                  />
                </td>
                <td>
                  <div style={{ display: 'flex', gap: 4 }}>
                    <input
                      type="number"
                      step="0.01"
                      aria-label={`VAT amount, row ${index + 1}`}
                      disabled={!item.vat_applicable}
                      value={item.vat_amount ?? ''}
                      onChange={(e) => updateItem(index, { vat_amount: toNumber(e.target.value) })}
                    />
                    {/* Most receipts are standard rated, so the common case is
                        one click; the field stays editable for the ones that
                        are not. */}
                    <button
                      className="action-btn"
                      type="button"
                      title="Work out the VAT at the standard rate"
                      disabled={!item.vat_applicable}
                      onClick={() => updateItem(index, { vat_amount: vatWithinGross(toNumber(item.cost)) })}
                    >
                      20%
                    </button>
                  </div>
                </td>
                <td>
                  <button
                    className="action-btn delete"
                    type="button"
                    onClick={() => setItems((prev) => prev.filter((_, i) => i !== index))}
                  >
                    Remove
                  </button>
                </td>
              </tr>
            ))}
            {items.length === 0 && (
              <tr>
                <td colSpan={6} style={{ color: '#999' }}>
                  No expenses yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div style={{ marginTop: 12 }}>
        <button className="action-btn" type="button" onClick={() => setItems((prev) => [...prev, emptyItem()])}>
          + Add expense
        </button>
      </div>

      <div className="sheet-totals">
        <div>
          <span>Total spent</span>
          <span>{formatMoney(totals.gross)}</span>
        </div>
        <div>
          <span>VAT included</span>
          <span>{formatMoney(totals.vat)}</span>
        </div>
        <div className="grand">
          <span>Net of VAT</span>
          <span>{formatMoney(totals.net)}</span>
        </div>
      </div>

      <div style={{ marginTop: 20 }}>
        <h3 style={{ fontSize: 16, marginBottom: 8 }}>Receipts</h3>
        <div className="sheet-controls">
          <select aria-label="Attach receipt to" value={attachTo} onChange={(e) => setAttachTo(e.target.value)}>
            <option value="">Whole sheet</option>
            {savedItems.map((item) => (
              <option key={item.id} value={String(item.id)}>
                {item.description || `Item ${item.id}`}
              </option>
            ))}
          </select>
          <input
            ref={fileInput}
            type="file"
            accept="image/*"
            multiple
            aria-label="Add receipts"
            disabled={uploading}
            onChange={(e) => handleUpload(e.target.files)}
          />
          {uploading && <span style={{ fontSize: 13, color: '#636e72' }}>Uploading...</span>}
        </div>

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
          {photos.map((photo) => (
            <div key={photo.id} style={{ width: 140 }}>
              <a href={api.getReceiptUrl(sheet.id, photo.id)} target="_blank" rel="noreferrer">
                <img
                  src={api.getReceiptUrl(sheet.id, photo.id)}
                  alt="Receipt"
                  style={{ width: '100%', borderRadius: 6, display: 'block' }}
                />
              </a>
              <button
                className="action-btn delete"
                type="button"
                style={{ marginTop: 4 }}
                onClick={() => handleDeletePhoto(photo.id)}
              >
                Remove
              </button>
            </div>
          ))}
          {photos.length === 0 && <span style={{ fontSize: 14, color: '#999' }}>No receipts yet.</span>}
        </div>
      </div>

      <div style={{ marginTop: 16 }}>
        <label style={{ display: 'block', fontSize: 13, color: '#636e72', marginBottom: 4 }} htmlFor="expense-notes">
          Notes
        </label>
        <textarea
          id="expense-notes"
          className="sheet-notes"
          rows={3}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
        />
      </div>
    </div>
  );
}
