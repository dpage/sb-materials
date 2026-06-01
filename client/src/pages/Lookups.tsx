import React, { useState, useEffect } from 'react';
import { api } from '../api';
import type { LookupValue } from '../types';
import { TYPE_COLORS, TYPE_SHORT } from '../types';

const TABLES = [
  { key: 'lookup_product_descriptions', label: 'Product Descriptions', hasType: true },
  { key: 'lookup_product_grades', label: 'Product Grades', hasType: true },
  { key: 'lookup_storage_modes', label: 'Storage Modes', hasType: false },
  { key: 'lookup_unwanted_materials', label: 'Unwanted Materials', hasType: true },
  { key: 'lookup_contaminants', label: 'Contaminants', hasType: true },
];

const REPORT_TYPES = [
  { key: 'loading_inspection', label: 'Loading & Inspection' },
  { key: 'quarterly_pern', label: 'Quarterly PERN Inspection' },
  { key: 'pern_audit', label: 'PERN Audit' },
];

export function Lookups() {
  const [activeTable, setActiveTable] = useState(TABLES[0]);
  const [values, setValues] = useState<LookupValue[]>([]);
  const [newValue, setNewValue] = useState('');
  const [newType, setNewType] = useState('loading_inspection');
  const [editId, setEditId] = useState<number | null>(null);
  const [editValue, setEditValue] = useState('');

  const load = () => {
    api.getLookupsAll(activeTable.key).then(setValues);
  };

  useEffect(() => {
    load();
  }, [activeTable]);

  const add = async () => {
    if (!newValue.trim()) return;
    const data: any = { value: newValue.trim() };
    if (activeTable.hasType) data.report_type = newType;
    await api.createLookup(activeTable.key, data);
    setNewValue('');
    load();
  };

  const saveEdit = async () => {
    if (editId === null || !editValue.trim()) return;
    await api.updateLookup(activeTable.key, editId, { value: editValue.trim() });
    setEditId(null);
    load();
  };

  const toggleActive = async (v: LookupValue) => {
    await api.updateLookup(activeTable.key, v.id, { is_active: v.is_active ? 0 : 1 });
    load();
  };

  return (
    <div>
      <style>{`
        .lookups-heading { margin-bottom: 16px; font-size: 22px; font-weight: 700; color: #2d3436; }

        .table-tabs {
          display: flex; gap: 6px; margin-bottom: 16px; flex-wrap: wrap;
        }
        .table-tab {
          padding: 8px 16px; border-radius: 8px; border: 2px solid #dde1e6;
          background: #fff; color: #666; font-weight: 400;
          cursor: pointer; font-size: 14px; white-space: nowrap;
        }
        .table-tab.active {
          border-color: #2980b9; background: #ebf5fb; color: #2980b9; font-weight: 600;
        }

        .lookups-card {
          background: #fff; border-radius: 10px; padding: 16px;
          box-shadow: 0 1px 4px rgba(0,0,0,0.07);
        }

        .add-row {
          display: flex; gap: 8px; margin-bottom: 16px; flex-wrap: wrap;
        }
        .add-input {
          flex: 1; padding: 9px 12px; border: 1px solid #dde1e6;
          border-radius: 6px; font-size: 14px; min-width: 160px;
          box-sizing: border-box;
        }
        .add-select {
          padding: 9px 12px; border: 1px solid #dde1e6; border-radius: 6px;
          font-size: 14px; box-sizing: border-box;
        }
        .add-btn {
          padding: 8px 20px; background: #27ae60; color: #fff; border: none;
          border-radius: 6px; cursor: pointer; font-size: 14px; font-weight: 600;
          white-space: nowrap;
        }

        /* Type pill */
        .type-pill {
          padding: 2px 10px; border-radius: 12px; font-size: 12px; font-weight: 600;
          white-space: nowrap; display: inline-block;
        }

        /* Desktop table */
        .lookup-table { width: 100%; border-collapse: collapse; }
        .lookup-table th {
          padding: 10px 14px; font-size: 12px; font-weight: 600; color: #7f8c8d;
          text-align: left; background: #f8f9fa; text-transform: uppercase;
          letter-spacing: 0.3px; white-space: nowrap;
        }
        .lookup-table td { padding: 8px 14px; font-size: 14px; border-top: 1px solid #f0f0f0; }
        .lookup-table tbody tr:hover { background: #f8fbff; }
        .lookup-table tr.inactive { opacity: 0.45; }

        .small-btn {
          padding: 4px 10px; border: 1px solid #dde1e6; border-radius: 4px;
          background: #fff; cursor: pointer; font-size: 12px; color: #2980b9;
        }
        .edit-inline { display: flex; gap: 6px; }
        .edit-inline input {
          flex: 1; padding: 4px 8px; border: 1px solid #dde1e6;
          border-radius: 4px; font-size: 14px; min-width: 0;
        }

        /* Desktop table wrapper */
        .lookup-table-wrap { display: block; }

        /* Mobile list */
        .lookup-items { display: none; }
        .lookup-item {
          padding: 12px 0; border-bottom: 1px solid #f0f0f0;
        }
        .lookup-item:last-child { border-bottom: none; }
        .lookup-item.inactive { opacity: 0.45; }
        .lookup-item-top {
          display: flex; justify-content: space-between; align-items: flex-start;
          gap: 8px; margin-bottom: 6px;
        }
        .lookup-item-value { font-size: 15px; font-weight: 500; color: #2d3436; flex: 1; min-width: 0; word-break: break-word; }
        .lookup-item-actions {
          display: flex; gap: 6px; flex-shrink: 0;
        }
        .lookup-item-meta {
          display: flex; gap: 8px; align-items: center; font-size: 13px; color: #7f8c8d;
        }

        .empty-state { padding: 30px 16px; text-align: center; color: #999; font-size: 14px; }

        @media (max-width: 640px) {
          .lookup-table-wrap { display: none; }
          .lookup-items { display: block; }
          .table-tab { padding: 7px 12px; font-size: 13px; }
        }
      `}</style>

      <h2 className="lookups-heading">Lookup Values</h2>

      <div className="table-tabs">
        {TABLES.map((t) => (
          <button
            key={t.key}
            onClick={() => setActiveTable(t)}
            className={`table-tab ${activeTable.key === t.key ? 'active' : ''}`}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="lookups-card">
        {/* Add new */}
        <div className="add-row">
          <input
            className="add-input"
            value={newValue}
            onChange={(e) => setNewValue(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && add()}
            placeholder={`New ${activeTable.label.toLowerCase()} value...`}
          />
          {activeTable.hasType && (
            <select className="add-select" value={newType} onChange={(e) => setNewType(e.target.value)}>
              {REPORT_TYPES.map((t) => (
                <option key={t.key} value={t.key}>
                  {t.label}
                </option>
              ))}
            </select>
          )}
          <button className="add-btn" onClick={add}>
            Add
          </button>
        </div>

        {/* Desktop: Table */}
        <div className="lookup-table-wrap">
          <table className="lookup-table">
            <thead>
              <tr>
                <th>Value</th>
                {activeTable.hasType && <th>Type</th>}
                <th>Active</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {values.map((v) => (
                <tr key={v.id} className={v.is_active ? '' : 'inactive'}>
                  <td>
                    {editId === v.id ? (
                      <div className="edit-inline">
                        <input
                          value={editValue}
                          onChange={(e) => setEditValue(e.target.value)}
                          onKeyDown={(e) => e.key === 'Enter' && saveEdit()}
                          autoFocus
                        />
                        <button className="small-btn" onClick={saveEdit}>
                          Save
                        </button>
                        <button className="small-btn" onClick={() => setEditId(null)}>
                          Cancel
                        </button>
                      </div>
                    ) : (
                      v.value
                    )}
                  </td>
                  {activeTable.hasType && (
                    <td>
                      <span
                        className="type-pill"
                        style={{
                          background: (TYPE_COLORS[v.report_type || ''] || '#999') + '18',
                          color: TYPE_COLORS[v.report_type || ''] || '#999',
                        }}
                      >
                        {TYPE_SHORT[v.report_type || ''] || v.report_type}
                      </span>
                    </td>
                  )}
                  <td>{v.is_active ? 'Yes' : 'No'}</td>
                  <td>
                    <div style={{ display: 'flex', gap: 6 }}>
                      <button
                        className="small-btn"
                        onClick={() => {
                          setEditId(v.id);
                          setEditValue(v.value);
                        }}
                      >
                        Edit
                      </button>
                      <button className="small-btn" onClick={() => toggleActive(v)}>
                        {v.is_active ? 'Deactivate' : 'Activate'}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {values.length === 0 && (
                <tr>
                  <td colSpan={4} className="empty-state">
                    No values found
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Mobile: List */}
        <div className="lookup-items">
          {values.map((v) => (
            <div key={v.id} className={`lookup-item ${v.is_active ? '' : 'inactive'}`}>
              {editId === v.id ? (
                <div className="edit-inline" style={{ marginBottom: 6 }}>
                  <input
                    value={editValue}
                    onChange={(e) => setEditValue(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && saveEdit()}
                    autoFocus
                  />
                  <button className="small-btn" onClick={saveEdit}>
                    Save
                  </button>
                  <button className="small-btn" onClick={() => setEditId(null)}>
                    Cancel
                  </button>
                </div>
              ) : (
                <div className="lookup-item-top">
                  <span className="lookup-item-value">{v.value}</span>
                  <div className="lookup-item-actions">
                    <button
                      className="small-btn"
                      onClick={() => {
                        setEditId(v.id);
                        setEditValue(v.value);
                      }}
                    >
                      Edit
                    </button>
                    <button className="small-btn" onClick={() => toggleActive(v)}>
                      {v.is_active ? 'Deactivate' : 'Activate'}
                    </button>
                  </div>
                </div>
              )}
              <div className="lookup-item-meta">
                {activeTable.hasType && (
                  <span
                    className="type-pill"
                    style={{
                      background: (TYPE_COLORS[v.report_type || ''] || '#999') + '18',
                      color: TYPE_COLORS[v.report_type || ''] || '#999',
                    }}
                  >
                    {TYPE_SHORT[v.report_type || ''] || v.report_type}
                  </span>
                )}
                {!v.is_active && <span style={{ color: '#e74c3c', fontSize: 12, fontWeight: 600 }}>Inactive</span>}
              </div>
            </div>
          ))}
          {values.length === 0 && <div className="empty-state">No values found</div>}
        </div>
      </div>
    </div>
  );
}
