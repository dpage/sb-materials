import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';
import { ConfirmDialog } from '../components/ConfirmDialog';

describe('ConfirmDialog', () => {
  it('should render with title and message', () => {
    render(
      <ConfirmDialog
        open={true}
        title="Delete Report"
        message="Are you sure?"
        onConfirm={() => {}}
        onCancel={() => {}}
      />,
    );
    expect(screen.getByText('Delete Report')).toBeInTheDocument();
    expect(screen.getByText('Are you sure?')).toBeInTheDocument();
  });

  it('should not render when closed', () => {
    render(<ConfirmDialog open={false} title="Delete" message="Sure?" onConfirm={() => {}} onCancel={() => {}} />);
    expect(screen.queryByText('Delete')).not.toBeInTheDocument();
  });

  it('should call onConfirm when confirm button clicked', () => {
    const onConfirm = vi.fn();
    render(<ConfirmDialog open={true} title="Delete" message="Sure?" onConfirm={onConfirm} onCancel={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    expect(onConfirm).toHaveBeenCalled();
  });

  it('should call onCancel when cancel button clicked', () => {
    const onCancel = vi.fn();
    render(<ConfirmDialog open={true} title="Delete" message="Sure?" onConfirm={() => {}} onCancel={onCancel} />);
    fireEvent.click(screen.getByText('Cancel'));
    expect(onCancel).toHaveBeenCalled();
  });

  it('disables confirm until the required text is typed exactly', () => {
    const onConfirm = vi.fn();
    render(
      <ConfirmDialog
        open={true}
        title="Restore"
        message="This will replace all current data."
        confirmLabel="Restore"
        requireTypedConfirmation="RESTORE"
        onConfirm={onConfirm}
        onCancel={() => {}}
      />,
    );

    const confirmBtn = screen.getByRole('button', { name: 'Restore' });
    expect(confirmBtn).toBeDisabled();

    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'restore' } });
    expect(confirmBtn).toBeDisabled();

    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'RESTORE' } });
    expect(confirmBtn).not.toBeDisabled();

    fireEvent.click(confirmBtn);
    expect(onConfirm).toHaveBeenCalled();
  });

  it('uses a custom confirm label when provided, without requiring typed text', () => {
    render(
      <ConfirmDialog open={true} title="Take backup" message="Proceed?" confirmLabel="Take Backup" onConfirm={() => {}} onCancel={() => {}} />,
    );
    expect(screen.getByRole('button', { name: 'Take Backup' })).not.toBeDisabled();
  });
});
