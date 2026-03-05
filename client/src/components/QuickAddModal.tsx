import React, { useState } from 'react';

interface Props {
  open: boolean;
  title: string;
  label: string;
  onSave: (value: string) => Promise<void>;
  onClose: () => void;
}

export function QuickAddModal({ open, title, label, onSave, onClose }: Props) {
  const [value, setValue] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  if (!open) return null;

  const handleSave = async () => {
    if (!value.trim()) return;
    setSaving(true);
    setError('');
    try {
      await onSave(value.trim());
      setValue('');
      onClose();
    } catch (err: any) {
      setError(err.message || 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.5)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1000,
      }}
      onClick={onClose}
    >
      <div
        style={{
          background: '#fff',
          borderRadius: 12,
          padding: 24,
          maxWidth: 450,
          width: '90%',
          boxShadow: '0 20px 60px rgba(0,0,0,0.3)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <h3 style={{ marginBottom: 16 }}>{title}</h3>
        {error && (
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
            {error}
          </div>
        )}
        <label style={{ display: 'block', marginBottom: 6, fontWeight: 500, fontSize: 14 }}>{label}</label>
        <input
          type="text"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleSave()}
          autoFocus
          style={inputStyle}
        />
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 16 }}>
          <button onClick={onClose} style={btnStyle}>
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={saving || !value.trim()}
            style={{
              ...btnStyle,
              background: '#2980b9',
              color: '#fff',
              border: 'none',
              opacity: saving || !value.trim() ? 0.6 : 1,
            }}
          >
            {saving ? 'Saving...' : 'Add'}
          </button>
        </div>
      </div>
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '9px 12px',
  border: '1px solid #dde',
  borderRadius: 6,
  fontSize: 14,
  boxSizing: 'border-box',
};

const btnStyle: React.CSSProperties = {
  padding: '8px 20px',
  border: '1px solid #ddd',
  borderRadius: 6,
  background: '#fff',
  cursor: 'pointer',
  fontSize: 14,
};
