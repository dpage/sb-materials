import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import React from 'react';
import { Audit, formatAuditTime, humaniseAuditTerm } from '../pages/Audit';

vi.mock('../api', () => ({
  api: {
    getAuditLog: vi.fn(),
    getAuditFilters: vi.fn(),
  },
}));

import { api } from '../api';

const entry = (over: Record<string, unknown> = {}) => ({
  id: 1,
  created_at: '2026-10-12 14:30:00',
  user_id: 1,
  username: 'admin',
  display_name: 'Administrator',
  current_display_name: 'Administrator',
  action: 'delete',
  entity_type: 'report',
  entity_id: 42,
  summary: 'PERN Audit, Acme Recycling Ltd',
  ...over,
});

const filters = {
  actions: ['create', 'delete', 'login-failed'],
  entityTypes: ['report', 'lookup_storage_modes'],
  users: [{ id: 1, display_name: 'Administrator' }],
};

describe('audit log helpers', () => {
  it('reads a stored UTC timestamp as UTC', () => {
    // Shown in the reader's own zone, so the test pins the parse rather than
    // the rendering: the same instant whatever TZ the suite runs in.
    expect(new Date('2026-10-12T14:30:00Z').getTime()).toBe(
      new Date(`${'2026-10-12 14:30:00'.replace(' ', 'T')}Z`).getTime(),
    );
    expect(formatAuditTime('2026-10-12 14:30:00')).toMatch(/12 Oct 2026/);
  });

  it('leaves an unparseable timestamp alone', () => {
    expect(formatAuditTime('not a date')).toBe('not a date');
  });

  it('turns an action or table name into words', () => {
    expect(humaniseAuditTerm('login-failed')).toBe('Login failed');
    expect(humaniseAuditTerm('travel-sheet')).toBe('Travel sheet');
    expect(humaniseAuditTerm('lookup_storage_modes')).toBe('Storage modes');
    expect(humaniseAuditTerm('report')).toBe('Report');
  });
});

describe('the audit log page', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (api.getAuditFilters as any).mockResolvedValue(filters);
    (api.getAuditLog as any).mockResolvedValue({ data: [entry()], total: 1, page: 1, limit: 50 });
  });

  it('lists the log', async () => {
    render(<Audit />);
    await waitFor(() => expect(screen.getByText('PERN Audit, Acme Recycling Ltd')).toBeInTheDocument());
    // Scoped to the row, since the same words appear in the filter dropdowns.
    const cells = Array.from(screen.getAllByRole('row')[1].querySelectorAll('td')).map((td) => td.textContent);
    expect(cells.slice(1)).toEqual(['Administrator', 'Delete', 'Report', 'PERN Audit, Acme Recycling Ltd']);
    expect(cells[0]).toMatch(/12 Oct 2026/);
    expect(api.getAuditLog).toHaveBeenCalledWith({ page: '1', limit: '50' });
  });

  it('falls back to the name recorded at the time, then the username', async () => {
    (api.getAuditLog as any).mockResolvedValue({
      data: [
        entry({ id: 1, current_display_name: null, display_name: 'Gone Person' }),
        entry({ id: 2, current_display_name: null, display_name: null, username: 'nobody' }),
        entry({ id: 3, current_display_name: null, display_name: null, username: null }),
      ],
      total: 3,
      page: 1,
      limit: 50,
    });

    render(<Audit />);
    await waitFor(() => expect(screen.getByText('Gone Person')).toBeInTheDocument());
    const who = screen
      .getAllByRole('row')
      .slice(1)
      .map((row) => row.querySelectorAll('td')[1].textContent);
    expect(who).toEqual(['Gone Person', 'nobody', 'Unknown']);
  });

  it('shows the record id when there is no description', async () => {
    (api.getAuditLog as any).mockResolvedValue({
      data: [entry({ summary: null })],
      total: 1,
      page: 1,
      limit: 50,
    });
    render(<Audit />);
    await waitFor(() => expect(screen.getByText('#42')).toBeInTheDocument());
  });

  it('offers only the values present in the log as filters', async () => {
    render(<Audit />);
    await waitFor(() => expect(api.getAuditFilters).toHaveBeenCalled());

    const actions = screen.getByLabelText('Action') as HTMLSelectElement;
    expect(Array.from(actions.options).map((o) => o.textContent)).toEqual([
      'All actions',
      'Create',
      'Delete',
      'Login failed',
    ]);
    const types = screen.getByLabelText('Type') as HTMLSelectElement;
    expect(Array.from(types.options).map((o) => o.textContent)).toEqual(['All types', 'Report', 'Storage modes']);
    const people = screen.getByLabelText('Person') as HTMLSelectElement;
    expect(Array.from(people.options).map((o) => o.textContent)).toEqual(['Everyone', 'Administrator']);
  });

  it('passes each filter through to the query', async () => {
    render(<Audit />);
    await waitFor(() => expect(api.getAuditLog).toHaveBeenCalled());

    fireEvent.change(screen.getByLabelText('Action'), { target: { value: 'delete' } });
    fireEvent.change(screen.getByLabelText('Type'), { target: { value: 'report' } });
    fireEvent.change(screen.getByLabelText('Person'), { target: { value: '1' } });
    fireEvent.change(screen.getByLabelText('From'), { target: { value: '2026-10-01' } });
    fireEvent.change(screen.getByLabelText('To'), { target: { value: '2026-10-31' } });
    fireEvent.change(screen.getByLabelText('Search'), { target: { value: '  Acme  ' } });

    await waitFor(() =>
      expect(api.getAuditLog).toHaveBeenLastCalledWith({
        page: '1',
        limit: '50',
        user_id: '1',
        action: 'delete',
        entity_type: 'report',
        date_from: '2026-10-01',
        date_to: '2026-10-31',
        search: 'Acme',
      }),
    );
  });

  it('pages through the log, and starts again when a filter changes', async () => {
    (api.getAuditLog as any).mockResolvedValue({ data: [entry()], total: 120, page: 1, limit: 50 });
    render(<Audit />);
    await waitFor(() => expect(screen.getByText('120 entries, page 1 of 3')).toBeInTheDocument());
    expect(screen.getByText('Previous')).toBeDisabled();

    fireEvent.click(screen.getByText('Next'));
    await waitFor(() => expect(api.getAuditLog).toHaveBeenLastCalledWith({ page: '2', limit: '50' }));

    fireEvent.change(screen.getByLabelText('Action'), { target: { value: 'delete' } });
    await waitFor(() => expect(api.getAuditLog).toHaveBeenLastCalledWith({ page: '1', limit: '50', action: 'delete' }));
  });

  it('says so when nothing matches', async () => {
    (api.getAuditLog as any).mockResolvedValue({ data: [], total: 0, page: 1, limit: 50 });
    render(<Audit />);
    await waitFor(() => expect(screen.getByText(/Nothing in the log matches/)).toBeInTheDocument());
  });

  it('reports a failure to load', async () => {
    (api.getAuditLog as any).mockRejectedValue(new Error('Forbidden'));
    render(<Audit />);
    await waitFor(() => expect(screen.getByText('Forbidden')).toBeInTheDocument());
  });
});
