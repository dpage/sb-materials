import React, { useState, useEffect } from 'react';
import { api } from '../api';
import type { Customer, CustomerSite } from '../types';

export function Customers() {
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [selected, setSelected] = useState<(Customer & { sites: CustomerSite[] }) | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [editId, setEditId] = useState<number | null>(null);
  const [form, setForm] = useState({ name: '', contact_name: '', email: '', phone: '', address: '' });
  const [newSite, setNewSite] = useState('');
  const [editSiteId, setEditSiteId] = useState<number | null>(null);
  const [editSiteAddr, setEditSiteAddr] = useState('');
  const [formError, setFormError] = useState('');

  const load = () => api.getCustomers(true).then(setCustomers);
  useEffect(() => {
    load();
  }, []);

  const selectCustomer = async (id: number) => {
    const data = await api.getCustomer(id);
    setSelected(data);
  };

  const resetForm = () => {
    setForm({ name: '', contact_name: '', email: '', phone: '', address: '' });
    setEditId(null);
    setShowForm(false);
  };

  const handleSave = async () => {
    if (!form.name.trim()) {
      setFormError('Customer name is required');
      return;
    }
    setFormError('');
    if (editId) {
      await api.updateCustomer(editId, form);
      if (selected?.id === editId) selectCustomer(editId);
    } else {
      await api.createCustomer(form);
    }
    resetForm();
    load();
  };

  const startEdit = (c: Customer) => {
    setEditId(c.id);
    setForm({
      name: c.name,
      contact_name: c.contact_name || '',
      email: c.email || '',
      phone: c.phone || '',
      address: c.address || '',
    });
    setShowForm(true);
  };

  const toggleActive = async (c: Customer) => {
    await api.updateCustomer(c.id, { is_active: c.is_active ? 0 : 1 });
    load();
  };

  const addSite = async () => {
    if (!newSite.trim() || !selected) return;
    await api.createSite(selected.id, newSite.trim());
    setNewSite('');
    selectCustomer(selected.id);
  };

  const saveSiteEdit = async () => {
    if (editSiteId === null || !editSiteAddr.trim() || !selected) return;
    await api.updateSite(selected.id, editSiteId, { address: editSiteAddr.trim() });
    setEditSiteId(null);
    selectCustomer(selected.id);
  };

  const toggleSiteActive = async (s: CustomerSite) => {
    if (!selected) return;
    await api.updateSite(selected.id, s.id, { is_active: s.is_active ? 0 : 1 });
    selectCustomer(selected.id);
  };

  return (
    <div>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: 16,
          flexWrap: 'wrap',
          gap: 12,
        }}
      >
        <h2 style={{ margin: 0 }}>Customers</h2>
        <button
          onClick={() => {
            resetForm();
            setShowForm(true);
          }}
          style={primaryBtn}
        >
          + New Customer
        </button>
      </div>

      {/* Add/Edit Form */}
      {showForm && (
        <div style={card}>
          <h3 style={{ marginBottom: 16 }}>{editId ? 'Edit Customer' : 'New Customer'}</h3>
          {formError && (
            <div
              style={{
                background: '#fdf0ef',
                border: '1px solid #e74c3c',
                color: '#c0392b',
                padding: '8px 12px',
                borderRadius: 6,
                marginBottom: 12,
                fontSize: 13,
              }}
            >
              {formError}
            </div>
          )}
          <div style={formGrid}>
            <div>
              <label style={labelStyle}>Customer Name *</label>
              <input
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                autoFocus
                style={inputStyle}
              />
            </div>
            <div>
              <label style={labelStyle}>Contact Name</label>
              <input
                value={form.contact_name}
                onChange={(e) => setForm((f) => ({ ...f, contact_name: e.target.value }))}
                style={inputStyle}
              />
            </div>
            <div>
              <label style={labelStyle}>Email</label>
              <input
                type="email"
                value={form.email}
                onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
                style={inputStyle}
              />
            </div>
            <div>
              <label style={labelStyle}>Phone</label>
              <input
                value={form.phone}
                onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
                style={inputStyle}
              />
            </div>
            <div style={{ gridColumn: '1 / -1' }}>
              <label style={labelStyle}>Address</label>
              <input
                value={form.address}
                onChange={(e) => setForm((f) => ({ ...f, address: e.target.value }))}
                style={inputStyle}
              />
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
            <button onClick={handleSave} style={{ ...primaryBtn, background: '#2980b9' }}>
              Save
            </button>
            <button onClick={resetForm} style={outlineBtn}>
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Customer list + Sites - stacks on mobile */}
      <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap' }}>
        {/* Customer list */}
        <div style={{ ...card, flex: '1 1 340px', minWidth: 0 }}>
          <h3 style={{ marginBottom: 12 }}>Customer List</h3>
          {customers.length === 0 ? (
            <p style={{ color: '#999', padding: 12 }}>No customers yet. Add one above.</p>
          ) : (
            <div style={{ maxHeight: 600, overflowY: 'auto' }}>
              {customers.map((c) => (
                <div
                  key={c.id}
                  onClick={() => selectCustomer(c.id)}
                  style={{
                    padding: '12px 14px',
                    borderBottom: '1px solid #eee',
                    cursor: 'pointer',
                    background: selected?.id === c.id ? '#ebf5fb' : 'transparent',
                    opacity: c.is_active ? 1 : 0.5,
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontWeight: 600, fontSize: 14 }}>{c.name}</div>
                      {c.contact_name && (
                        <div style={{ fontSize: 13, color: '#666', marginTop: 2 }}>{c.contact_name}</div>
                      )}
                      {(c.email || c.phone) && (
                        <div style={{ fontSize: 12, color: '#999', marginTop: 2 }}>
                          {[c.email, c.phone].filter(Boolean).join(' · ')}
                        </div>
                      )}
                    </div>
                    <div style={{ display: 'flex', gap: 4, flexShrink: 0 }} onClick={(e) => e.stopPropagation()}>
                      <button onClick={() => startEdit(c)} style={smallBtn}>
                        Edit
                      </button>
                      <button onClick={() => toggleActive(c)} style={smallBtn}>
                        {c.is_active ? 'Deactivate' : 'Activate'}
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Sites panel */}
        <div style={{ ...card, flex: '1 1 340px', minWidth: 0 }}>
          <h3 style={{ marginBottom: 12 }}>{selected ? `Sites for ${selected.name}` : 'Select a customer'}</h3>
          {selected ? (
            <>
              {/* Customer details summary */}
              {(selected.address || selected.contact_name || selected.email || selected.phone) && (
                <div
                  style={{
                    background: '#f8f9fa',
                    borderRadius: 8,
                    padding: 12,
                    marginBottom: 16,
                    fontSize: 13,
                    color: '#555',
                    lineHeight: 1.6,
                  }}
                >
                  {selected.address && <div>{selected.address}</div>}
                  {selected.contact_name && <div>{selected.contact_name}</div>}
                  {selected.email && <div>{selected.email}</div>}
                  {selected.phone && <div>{selected.phone}</div>}
                </div>
              )}

              <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
                <input
                  value={newSite}
                  onChange={(e) => setNewSite(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && addSite()}
                  placeholder="New site address"
                  style={{ ...inputStyle, flex: 1 }}
                />
                <button onClick={addSite} style={{ ...primaryBtn, padding: '8px 16px' }}>
                  Add
                </button>
              </div>

              {selected.sites.length === 0 ? (
                <p style={{ color: '#999', padding: 12 }}>No sites yet. Add one above.</p>
              ) : (
                selected.sites.map((s) => (
                  <div
                    key={s.id}
                    style={{
                      padding: '10px 12px',
                      borderBottom: '1px solid #eee',
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      gap: 8,
                      opacity: s.is_active ? 1 : 0.5,
                    }}
                  >
                    {editSiteId === s.id ? (
                      <div style={{ display: 'flex', gap: 6, flex: 1, flexWrap: 'wrap' }}>
                        <input
                          value={editSiteAddr}
                          onChange={(e) => setEditSiteAddr(e.target.value)}
                          onKeyDown={(e) => e.key === 'Enter' && saveSiteEdit()}
                          autoFocus
                          style={{ ...inputStyle, flex: '1 1 200px' }}
                        />
                        <button onClick={saveSiteEdit} style={smallBtn}>
                          Save
                        </button>
                        <button onClick={() => setEditSiteId(null)} style={smallBtn}>
                          Cancel
                        </button>
                      </div>
                    ) : (
                      <>
                        <span style={{ fontSize: 14, minWidth: 0, wordBreak: 'break-word' }}>{s.address}</span>
                        <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
                          <button
                            onClick={() => {
                              setEditSiteId(s.id);
                              setEditSiteAddr(s.address);
                            }}
                            style={smallBtn}
                          >
                            Edit
                          </button>
                          <button onClick={() => toggleSiteActive(s)} style={smallBtn}>
                            {s.is_active ? 'Deactivate' : 'Activate'}
                          </button>
                        </div>
                      </>
                    )}
                  </div>
                ))
              )}
            </>
          ) : (
            <p style={{ color: '#999', padding: 12 }}>Click a customer to view and manage their sites.</p>
          )}
        </div>
      </div>
    </div>
  );
}

const card: React.CSSProperties = {
  background: '#fff',
  borderRadius: 10,
  padding: 20,
  boxShadow: '0 1px 4px rgba(0,0,0,0.08)',
  marginBottom: 16,
};
const formGrid: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))',
  gap: 12,
};
const labelStyle: React.CSSProperties = {
  display: 'block',
  marginBottom: 4,
  fontWeight: 500,
  fontSize: 13,
  color: '#2c3e50',
};
const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '9px 12px',
  border: '1px solid #dde',
  borderRadius: 6,
  fontSize: 14,
  boxSizing: 'border-box',
};
const primaryBtn: React.CSSProperties = {
  padding: '10px 24px',
  background: '#27ae60',
  color: '#fff',
  border: 'none',
  borderRadius: 8,
  fontSize: 14,
  fontWeight: 600,
  cursor: 'pointer',
};
const outlineBtn: React.CSSProperties = {
  padding: '10px 24px',
  border: '1px solid #dde',
  borderRadius: 8,
  background: '#fff',
  cursor: 'pointer',
  fontSize: 14,
};
const smallBtn: React.CSSProperties = {
  padding: '4px 10px',
  border: '1px solid #dde',
  borderRadius: 4,
  background: '#fff',
  cursor: 'pointer',
  fontSize: 12,
  whiteSpace: 'nowrap',
};
