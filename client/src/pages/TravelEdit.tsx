import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api } from '../api';
import { QuickAddModal } from '../components/QuickAddModal';
import {
  formatMiles,
  formatMoney,
  formatSheetMonth,
  mileagePayment,
  toNumber,
  totalJourneyMiles,
  DEFAULT_MILEAGE_RATES,
} from '../utils/mileage';
import { SHEET_STYLES } from './sheets-common';
import type { Customer, MileageRates, TravelJourney, TravelSheet } from '../types';

const emptyJourney = (): TravelJourney => ({
  journey_date: new Date().toISOString().slice(0, 10),
  customer_id: null,
  customer_name: null,
  job: null,
  from_location: null,
  to_location: null,
  miles: null,
  round_trip: 0,
});

export function TravelEdit() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const [sheet, setSheet] = useState<TravelSheet | null>(null);
  const [journeys, setJourneys] = useState<TravelJourney[]>([]);
  const [notes, setNotes] = useState('');
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [rates, setRates] = useState<MileageRates>(DEFAULT_MILEAGE_RATES);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [quickAddRow, setQuickAddRow] = useState<number | null>(null);

  useEffect(() => {
    if (!id) return;
    api
      .getTravelSheet(Number(id))
      .then((data) => {
        setSheet(data);
        setJourneys(data.journeys ?? []);
        setNotes(data.notes ?? '');
        if (data.rates) setRates(data.rates);
      })
      .catch((err: any) => setError(err?.message || 'Could not load the sheet'))
      .finally(() => setLoading(false));
  }, [id]);

  useEffect(() => {
    api
      .getCustomers()
      .then(setCustomers)
      .catch(() => setCustomers([]));
  }, []);

  // Totalled here as well as on the server so the figures move as you type;
  // the brought-forward miles come from the sheet, since only the server can
  // know what the rest of the tax year holds.
  const totals = useMemo(
    () => mileagePayment(sheet?.totals.milesBroughtForward ?? 0, totalJourneyMiles(journeys), rates),
    [journeys, rates, sheet],
  );

  const updateJourney = (index: number, patch: Partial<TravelJourney>) => {
    setJourneys((prev) => prev.map((journey, i) => (i === index ? { ...journey, ...patch } : journey)));
  };

  const handleSave = async () => {
    if (!sheet) return;
    setSaving(true);
    setError('');
    try {
      const saved = await api.saveTravelSheet(sheet.id, { notes, journeys });
      setSheet(saved);
      setJourneys(saved.journeys ?? []);
      navigate('/travel');
    } catch (err: any) {
      setError(err?.message || 'Could not save the sheet');
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <div className="empty-state">Loading...</div>;
  if (!sheet) return <div className="sheet-error">{error || 'Travel sheet not found'}</div>;

  return (
    <div>
      <style>{SHEET_STYLES}</style>

      <div className="sheet-header">
        <h2>
          Travel &amp; Mileage: {formatSheetMonth(sheet.year, sheet.month)}
          {sheet.display_name ? ` (${sheet.display_name})` : ''}
        </h2>
        <div className="actions-row">
          <a className="action-btn" href={api.downloadTravelSheetPdf(sheet.id)}>
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
              <th>Job</th>
              <th>From</th>
              <th>To</th>
              <th>Customer</th>
              <th>Miles</th>
              <th>Return</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {journeys.map((journey, index) => (
              <tr key={index}>
                <td>
                  <input
                    type="date"
                    aria-label={`Date, row ${index + 1}`}
                    value={journey.journey_date ?? ''}
                    onChange={(e) => updateJourney(index, { journey_date: e.target.value || null })}
                  />
                </td>
                <td>
                  <input
                    aria-label={`Job, row ${index + 1}`}
                    value={journey.job ?? ''}
                    onChange={(e) => updateJourney(index, { job: e.target.value })}
                  />
                </td>
                <td>
                  <input
                    aria-label={`From, row ${index + 1}`}
                    value={journey.from_location ?? ''}
                    onChange={(e) => updateJourney(index, { from_location: e.target.value })}
                  />
                </td>
                <td>
                  <input
                    aria-label={`To, row ${index + 1}`}
                    value={journey.to_location ?? ''}
                    onChange={(e) => updateJourney(index, { to_location: e.target.value })}
                  />
                </td>
                <td>
                  <div style={{ display: 'flex', gap: 4 }}>
                    <select
                      aria-label={`Customer, row ${index + 1}`}
                      value={journey.customer_id ?? ''}
                      onChange={(e) => {
                        const customerId = e.target.value ? Number(e.target.value) : null;
                        // The name is stored alongside the id so a sheet still
                        // reads correctly if the customer is later renamed or
                        // retired.
                        const customer = customers.find((c) => c.id === customerId);
                        updateJourney(index, { customer_id: customerId, customer_name: customer?.name ?? null });
                      }}
                    >
                      <option value="">None</option>
                      {customers.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                        </option>
                      ))}
                    </select>
                    <button
                      className="action-btn"
                      title="Add a new customer"
                      onClick={() => setQuickAddRow(index)}
                      type="button"
                    >
                      +
                    </button>
                  </div>
                </td>
                <td>
                  <input
                    type="number"
                    step="0.1"
                    aria-label={`Miles, row ${index + 1}`}
                    value={journey.miles ?? ''}
                    onChange={(e) => updateJourney(index, { miles: toNumber(e.target.value) })}
                  />
                </td>
                <td style={{ textAlign: 'center' }}>
                  <input
                    type="checkbox"
                    aria-label={`Round trip, row ${index + 1}`}
                    checked={Boolean(journey.round_trip)}
                    onChange={(e) => updateJourney(index, { round_trip: e.target.checked ? 1 : 0 })}
                    style={{ width: 'auto', minWidth: 0 }}
                  />
                </td>
                <td>
                  <button
                    className="action-btn delete"
                    type="button"
                    onClick={() => setJourneys((prev) => prev.filter((_, i) => i !== index))}
                  >
                    Remove
                  </button>
                </td>
              </tr>
            ))}
            {journeys.length === 0 && (
              <tr>
                <td colSpan={8} style={{ color: '#999' }}>
                  No journeys yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div style={{ marginTop: 12 }}>
        <button className="action-btn" type="button" onClick={() => setJourneys((prev) => [...prev, emptyJourney()])}>
          + Add journey
        </button>
      </div>

      <div className="sheet-totals">
        <div>
          <span>Miles this month</span>
          <span>{formatMiles(totals.miles)}</span>
        </div>
        <div>
          <span>Miles earlier this tax year</span>
          <span>{formatMiles(totals.milesBroughtForward)}</span>
        </div>
        <div>
          <span>
            At {formatMoney(rates.high)} a mile ({formatMiles(totals.highMiles)} miles)
          </span>
          <span>{formatMoney(totals.highPay)}</span>
        </div>
        <div>
          <span>
            At {formatMoney(rates.low)} a mile ({formatMiles(totals.lowMiles)} miles)
          </span>
          <span>{formatMoney(totals.lowPay)}</span>
        </div>
        <div className="grand">
          <span>Total claimed</span>
          <span>{formatMoney(totals.total)}</span>
        </div>
      </div>

      <div style={{ marginTop: 16 }}>
        <label style={{ display: 'block', fontSize: 13, color: '#636e72', marginBottom: 4 }} htmlFor="travel-notes">
          Notes
        </label>
        <textarea
          id="travel-notes"
          className="sheet-notes"
          rows={3}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
        />
      </div>

      <QuickAddModal
        open={quickAddRow !== null}
        title="Add New Customer"
        label="Customer Name"
        onSave={async (name) => {
          const result = await api.createCustomer(name);
          setCustomers((prev) => [
            ...prev,
            { ...result, is_active: 1, contact_name: null, email: null, phone: null, address: null },
          ]);
          if (quickAddRow !== null) updateJourney(quickAddRow, { customer_id: result.id, customer_name: name });
        }}
        onClose={() => setQuickAddRow(null)}
      />
    </div>
  );
}
