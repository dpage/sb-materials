import React, { useEffect, useState } from 'react';
import { api } from '../api';
import { MONTH_NAMES } from '../utils/mileage';
import type { UserRecord } from '../types';

// Shared furniture for the travel and expenses sheets: the two list pages and
// the two editors look the same by design, so the styles and the month and
// person pickers live here rather than being written out four times.

export const SHEET_STYLES = `
  .sheet-header {
    display: flex; justify-content: space-between; align-items: center;
    margin-bottom: 16px; flex-wrap: wrap; gap: 12px;
  }
  .sheet-header h2 { margin: 0; font-size: 22px; font-weight: 700; color: #2d3436; }
  .sheet-controls { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; margin-bottom: 14px; }
  .sheet-controls select, .sheet-controls input {
    padding: 9px 12px; border: 1px solid #dde1e6; border-radius: 6px;
    font-size: 14px; background: #fff; box-sizing: border-box;
  }
  .btn-new {
    padding: 10px 22px; background: #27ae60; color: #fff; border: none;
    border-radius: 8px; font-size: 15px; font-weight: 600; cursor: pointer;
    white-space: nowrap;
  }
  .btn-new:active { background: #219a52; }
  .btn-new:disabled { opacity: 0.6; cursor: default; }
  .sheet-table-wrap {
    background: #fff; border-radius: 10px;
    box-shadow: 0 1px 4px rgba(0,0,0,0.07); overflow-x: auto;
  }
  .sheet-table { width: 100%; border-collapse: collapse; }
  .sheet-table th {
    padding: 11px 12px; font-size: 12px; font-weight: 600; color: #7f8c8d;
    text-align: left; background: #f8f9fa; white-space: nowrap;
    text-transform: uppercase; letter-spacing: 0.3px;
  }
  .sheet-table td { padding: 8px 12px; font-size: 14px; border-top: 1px solid #f0f0f0; vertical-align: top; }
  .sheet-table input, .sheet-table select {
    width: 100%; padding: 7px 8px; border: 1px solid #dde1e6; border-radius: 6px;
    font-size: 14px; box-sizing: border-box; min-width: 70px;
  }
  .sheet-table .num { text-align: right; }
  .action-btn {
    padding: 4px 12px; border: 1px solid #ddd; border-radius: 4px;
    background: #fff; cursor: pointer; font-size: 13px; color: #2980b9;
    text-decoration: none; display: inline-block;
  }
  .action-btn.delete { color: #e74c3c; }
  .actions-row { display: flex; gap: 6px; flex-wrap: wrap; }
  .sheet-totals {
    background: #fff; border-radius: 10px; padding: 14px 16px; margin-top: 16px;
    box-shadow: 0 1px 4px rgba(0,0,0,0.07);
  }
  .sheet-totals div { display: flex; justify-content: space-between; padding: 4px 0; font-size: 14px; }
  .sheet-totals .grand { font-weight: 700; border-top: 1px solid #f0f0f0; margin-top: 6px; padding-top: 8px; }
  .sheet-error {
    background: #fdf0ef; border: 1px solid #e74c3c; color: #c0392b;
    padding: 10px 14px; border-radius: 8px; margin-bottom: 12px; font-size: 14px;
  }
  .empty-state { padding: 40px 20px; text-align: center; color: #999; font-size: 15px; }
  .sheet-notes {
    width: 100%; padding: 10px 12px; border: 1px solid #dde1e6; border-radius: 8px;
    font-size: 14px; font-family: inherit; box-sizing: border-box;
  }
`;

/** The years offered when opening a sheet: the current one and its neighbours. */
export function sheetYears(today = new Date()): number[] {
  const year = today.getFullYear();
  return [year - 1, year, year + 1];
}

interface MonthPickerProps {
  year: number;
  month: number;
  onChange: (year: number, month: number) => void;
}

export function MonthPicker({ year, month, onChange }: MonthPickerProps) {
  return (
    <>
      <select aria-label="Month" value={month} onChange={(e) => onChange(year, parseInt(e.target.value, 10))}>
        {MONTH_NAMES.map((name, index) => (
          <option key={name} value={index + 1}>
            {name}
          </option>
        ))}
      </select>
      <select aria-label="Year" value={year} onChange={(e) => onChange(parseInt(e.target.value, 10), month)}>
        {sheetYears().map((value) => (
          <option key={value} value={value}>
            {value}
          </option>
        ))}
      </select>
    </>
  );
}

interface PersonFilterProps {
  value: string;
  onChange: (value: string) => void;
}

/**
 * The superuser's person filter. "all" is a value of its own rather than the
 * empty default, because a superuser's own sheets are what they see first and
 * everybody's is a deliberate choice.
 */
export function PersonFilter({ value, onChange }: PersonFilterProps) {
  const [users, setUsers] = useState<UserRecord[]>([]);

  useEffect(() => {
    api
      .getUsers()
      .then(setUsers)
      .catch(() => setUsers([]));
  }, []);

  return (
    <select aria-label="Person" value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">My sheets</option>
      <option value="all">Everyone</option>
      {users.map((u) => (
        <option key={u.id} value={String(u.id)}>
          {u.display_name}
        </option>
      ))}
    </select>
  );
}

/** Turn the person filter's value into the query the sheet endpoints expect. */
export function personParams(filter: string): Record<string, string> {
  if (filter === 'all') return { all: '1' };
  if (filter) return { user_id: filter };
  return {};
}
