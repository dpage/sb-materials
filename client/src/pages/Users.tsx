import React, { useState, useEffect } from 'react';
import { useAuth } from '../App';
import { api } from '../api';
import type { UserRecord } from '../types';

export function Users() {
  const { user } = useAuth();
  const [users, setUsers] = useState<UserRecord[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [editId, setEditId] = useState<number | null>(null);
  const [form, setForm] = useState({ username: '', password: '', display_name: '', is_superuser: false });
  const [formError, setFormError] = useState('');

  const load = () => api.getUsers().then(setUsers);
  useEffect(() => {
    load();
  }, []);

  if (!user?.isSuperuser) return <div style={{ padding: 40, textAlign: 'center' }}>Access denied</div>;

  const handleSave = async () => {
    if (!form.username || !form.display_name || (!editId && !form.password)) {
      setFormError('Please fill in all required fields');
      return;
    }
    setFormError('');
    if (editId) {
      const data: any = { username: form.username, display_name: form.display_name, is_superuser: form.is_superuser };
      if (form.password) data.password = form.password;
      await api.updateUser(editId, data);
    } else {
      await api.createUser(form);
    }
    setShowForm(false);
    setEditId(null);
    setForm({ username: '', password: '', display_name: '', is_superuser: false });
    load();
  };

  const toggleActive = async (u: UserRecord) => {
    await api.updateUser(u.id, { is_active: u.is_active ? 0 : 1 });
    load();
  };

  const startEdit = (u: UserRecord) => {
    setEditId(u.id);
    setForm({ username: u.username, password: '', display_name: u.display_name, is_superuser: !!u.is_superuser });
    setShowForm(true);
  };

  return (
    <div>
      <style>{`
        .users-header {
          display: flex; justify-content: space-between; align-items: center;
          margin-bottom: 16px; flex-wrap: wrap; gap: 12px;
        }
        .users-header h2 { margin: 0; font-size: 22px; font-weight: 700; color: #2d3436; }
        .btn-new-user {
          padding: 10px 22px; background: #27ae60; color: #fff; border: none;
          border-radius: 8px; font-size: 15px; font-weight: 600; cursor: pointer;
          white-space: nowrap;
        }
        .btn-new-user:active { background: #219a52; }

        /* Form card */
        .user-form-card {
          background: #fff; border-radius: 10px; padding: 20px; margin-bottom: 16px;
          box-shadow: 0 1px 4px rgba(0,0,0,0.07);
        }
        .user-form-card h3 { margin: 0 0 14px; font-size: 17px; font-weight: 600; color: #2d3436; }
        .user-form-grid {
          display: grid; grid-template-columns: 1fr 1fr; gap: 12px; max-width: 600px;
        }
        .form-field label {
          display: block; margin-bottom: 4px; font-weight: 500; font-size: 13px; color: #2d3436;
        }
        .form-field input[type="text"],
        .form-field input[type="password"],
        .form-field select {
          width: 100%; padding: 9px 12px; border: 1px solid #dde1e6;
          border-radius: 6px; font-size: 14px; box-sizing: border-box;
        }
        .form-actions { display: flex; gap: 8px; margin-top: 16px; }
        .btn-save {
          padding: 8px 20px; background: #2980b9; color: #fff; border: none;
          border-radius: 6px; cursor: pointer; font-size: 14px; font-weight: 600;
        }
        .btn-cancel {
          padding: 8px 20px; border: 1px solid #dde1e6; border-radius: 6px;
          background: #fff; cursor: pointer; font-size: 14px; color: #636e72;
        }

        /* Badges */
        .badge-superuser {
          padding: 2px 9px; border-radius: 12px; font-size: 11px; font-weight: 600;
          background: #fdebd0; color: #e67e22; display: inline-block;
        }
        .badge-active {
          padding: 2px 9px; border-radius: 12px; font-size: 11px; font-weight: 600;
          display: inline-block;
        }
        .badge-active.yes { background: #d5f5e3; color: #27ae60; }
        .badge-active.no { background: #fadbd8; color: #e74c3c; }

        /* Desktop table */
        .users-table-wrap {
          background: #fff; border-radius: 10px;
          box-shadow: 0 1px 4px rgba(0,0,0,0.07); overflow: hidden;
        }
        .users-table { width: 100%; border-collapse: collapse; }
        .users-table th {
          padding: 11px 14px; font-size: 12px; font-weight: 600; color: #7f8c8d;
          text-align: left; background: #f8f9fa; text-transform: uppercase;
          letter-spacing: 0.3px; white-space: nowrap;
        }
        .users-table td { padding: 10px 14px; font-size: 14px; border-top: 1px solid #f0f0f0; }
        .users-table tbody tr:hover { background: #f8fbff; }
        .users-table tr.inactive { opacity: 0.45; }
        .small-btn {
          padding: 4px 10px; border: 1px solid #dde1e6; border-radius: 4px;
          background: #fff; cursor: pointer; font-size: 12px; color: #2980b9;
        }

        /* Mobile cards */
        .user-cards { display: none; }
        .user-card {
          background: #fff; border-radius: 10px; padding: 14px 16px;
          box-shadow: 0 1px 4px rgba(0,0,0,0.07); margin-bottom: 10px;
        }
        .user-card.inactive { opacity: 0.45; }
        .user-card-top {
          display: flex; justify-content: space-between; align-items: flex-start;
          margin-bottom: 6px;
        }
        .user-card-name { font-size: 16px; font-weight: 600; color: #2d3436; }
        .user-card-username { font-size: 13px; color: #7f8c8d; }
        .user-card-badges { display: flex; gap: 6px; flex-wrap: wrap; margin: 8px 0 10px; }
        .user-card-actions {
          display: flex; gap: 8px; border-top: 1px solid #f0f0f0; padding-top: 10px;
        }
        .card-action-btn {
          flex: 1; padding: 8px 0; border: 1px solid #dde1e6; border-radius: 6px;
          background: #fff; cursor: pointer; font-size: 13px; font-weight: 500;
          color: #2980b9; text-align: center;
        }

        @media (max-width: 640px) {
          .users-table-wrap { display: none; }
          .user-cards { display: block; }
          .user-form-grid { grid-template-columns: 1fr; }
        }
      `}</style>

      <div className="users-header">
        <h2>Users</h2>
        <button
          className="btn-new-user"
          onClick={() => {
            setShowForm(true);
            setEditId(null);
            setForm({ username: '', password: '', display_name: '', is_superuser: false });
          }}
        >
          + New User
        </button>
      </div>

      {showForm && (
        <div className="user-form-card">
          <h3>{editId ? 'Edit User' : 'New User'}</h3>
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
          <div className="user-form-grid">
            <div className="form-field">
              <label>Username *</label>
              <input
                type="text"
                value={form.username}
                onChange={(e) => setForm((f) => ({ ...f, username: e.target.value }))}
              />
            </div>
            <div className="form-field">
              <label>Display Name *</label>
              <input
                type="text"
                value={form.display_name}
                onChange={(e) => setForm((f) => ({ ...f, display_name: e.target.value }))}
              />
            </div>
            <div className="form-field">
              <label>{editId ? 'New Password (leave blank to keep)' : 'Password *'}</label>
              <input
                type="password"
                value={form.password}
                onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
              />
            </div>
            <div className="form-field" style={{ display: 'flex', alignItems: 'end', paddingBottom: 4 }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', marginBottom: 0 }}>
                <input
                  type="checkbox"
                  checked={form.is_superuser}
                  onChange={(e) => setForm((f) => ({ ...f, is_superuser: e.target.checked }))}
                />
                <span style={{ fontSize: 14 }}>Superuser (admin access)</span>
              </label>
            </div>
          </div>
          <div className="form-actions">
            <button className="btn-save" onClick={handleSave}>
              Save
            </button>
            <button
              className="btn-cancel"
              onClick={() => {
                setShowForm(false);
                setEditId(null);
              }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Desktop: Table */}
      <div className="users-table-wrap">
        <table className="users-table">
          <thead>
            <tr>
              <th>Username</th>
              <th>Display Name</th>
              <th>Role</th>
              <th>Status</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id} className={u.is_active ? '' : 'inactive'}>
                <td>{u.username}</td>
                <td>{u.display_name}</td>
                <td>
                  {u.is_superuser ? (
                    <span className="badge-superuser">Superuser</span>
                  ) : (
                    <span style={{ fontSize: 13, color: '#7f8c8d' }}>User</span>
                  )}
                </td>
                <td>
                  <span className={`badge-active ${u.is_active ? 'yes' : 'no'}`}>
                    {u.is_active ? 'Active' : 'Inactive'}
                  </span>
                </td>
                <td>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <button className="small-btn" onClick={() => startEdit(u)}>
                      Edit
                    </button>
                    <button className="small-btn" onClick={() => toggleActive(u)}>
                      {u.is_active ? 'Deactivate' : 'Activate'}
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Mobile: Cards */}
      <div className="user-cards">
        {users.map((u) => (
          <div key={u.id} className={`user-card ${u.is_active ? '' : 'inactive'}`}>
            <div className="user-card-top">
              <div>
                <div className="user-card-name">{u.display_name}</div>
                <div className="user-card-username">@{u.username}</div>
              </div>
            </div>
            <div className="user-card-badges">
              {u.is_superuser && <span className="badge-superuser">Superuser</span>}
              <span className={`badge-active ${u.is_active ? 'yes' : 'no'}`}>
                {u.is_active ? 'Active' : 'Inactive'}
              </span>
            </div>
            <div className="user-card-actions">
              <button className="card-action-btn" onClick={() => startEdit(u)}>
                Edit
              </button>
              <button className="card-action-btn" onClick={() => toggleActive(u)}>
                {u.is_active ? 'Deactivate' : 'Activate'}
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
