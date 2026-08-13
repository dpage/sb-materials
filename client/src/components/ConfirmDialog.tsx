import React, { useEffect, useState } from 'react';

interface Props {
  open: boolean;
  title: string;
  message: string;
  onConfirm: () => void;
  onCancel: () => void;
  confirmLabel?: string;
  requireTypedConfirmation?: string;
}

export function ConfirmDialog({
  open,
  title,
  message,
  onConfirm,
  onCancel,
  confirmLabel = 'Delete',
  requireTypedConfirmation,
}: Props) {
  const [typedValue, setTypedValue] = useState('');

  useEffect(() => {
    if (open) setTypedValue('');
  }, [open]);

  if (!open) return null;

  const confirmDisabled = !!requireTypedConfirmation && typedValue !== requireTypedConfirmation;

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
      onClick={onCancel}
    >
      <div
        style={{
          background: '#fff',
          borderRadius: 12,
          padding: 24,
          maxWidth: 400,
          width: '90%',
          boxShadow: '0 20px 60px rgba(0,0,0,0.3)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <h3 style={{ marginBottom: 12 }}>{title}</h3>
        <p style={{ marginBottom: requireTypedConfirmation ? 12 : 20, color: '#666' }}>{message}</p>
        {requireTypedConfirmation && (
          <div style={{ marginBottom: 20 }}>
            <label style={{ display: 'block', fontSize: 13, color: '#666', marginBottom: 6 }}>
              Type <strong>{requireTypedConfirmation}</strong> to confirm
            </label>
            <input
              type="text"
              value={typedValue}
              onChange={(e) => setTypedValue(e.target.value)}
              style={{ width: '100%', padding: '8px 10px', border: '1px solid #ddd', borderRadius: 6, boxSizing: 'border-box' }}
            />
          </div>
        )}
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button onClick={onCancel} style={btnStyle}>
            Cancel
          </button>
          <button
            onClick={onConfirm}
            disabled={confirmDisabled}
            style={{
              ...btnStyle,
              background: confirmDisabled ? '#f5a9a1' : '#e74c3c',
              color: '#fff',
              cursor: confirmDisabled ? 'not-allowed' : 'pointer',
            }}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

const btnStyle: React.CSSProperties = {
  padding: '8px 20px',
  border: '1px solid #ddd',
  borderRadius: 6,
  background: '#fff',
  cursor: 'pointer',
  fontSize: 14,
};
