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
});
