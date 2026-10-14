import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import React from 'react';
import { MemoryRouter } from 'react-router-dom';
import { Sales, formatMoney, formatSaleDate } from '../pages/Sales';

vi.mock('../api', () => ({
  api: {
    getSales: vi.fn(),
    setSalePaid: vi.fn(),
  },
}));

const navigate = vi.fn();
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return { ...actual, useNavigate: () => navigate };
});

import { api } from '../api';

const sale = (overrides: Record<string, unknown> = {}) => ({
  id: 5,
  reference: 'SBM1061',
  collection_date: '2026-08-03',
  customer_name: 'Acme Recycling Ltd',
  buyer: 'Test Buyer',
  buy_price: 100,
  sale_price: 150,
  is_paid: 0,
  paid_date: null,
  ...overrides,
});

function renderSales() {
  return render(
    <MemoryRouter>
      <Sales />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  (api.getSales as any).mockResolvedValue({ data: [sale()], outstanding: 150 });
  (api.setSalePaid as any).mockResolvedValue({ is_paid: 1, paid_date: '2026-10-14' });
});

describe('sales helpers', () => {
  it('shows a date the way it is written in the UK, and leaves anything else alone', () => {
    expect(formatSaleDate('2026-08-03')).toBe('03/08/2026');
    expect(formatSaleDate('2026-08-03T09:30')).toBe('03/08/2026');
    expect(formatSaleDate(null)).toBe('');
    expect(formatSaleDate('not a date')).toBe('not a date');
  });

  it('shows a price in pounds, and nothing at all where none was recorded', () => {
    expect(formatMoney(150)).toBe('£150.00');
    expect(formatMoney(150.5)).toBe('£150.50');
    expect(formatMoney(0)).toBe('£0.00');
    expect(formatMoney(null)).toBe('');
  });
});

describe('the sales page', () => {
  it('lists a line per consignment with its prices, and asks for the unpaid ones', async () => {
    renderSales();
    await waitFor(() => expect(api.getSales).toHaveBeenCalledWith({ status: 'unpaid' }));
    expect(await screen.findByText('SBM1061')).toBeInTheDocument();
    expect(screen.getByText('Acme Recycling Ltd')).toBeInTheDocument();
    expect(screen.getByText('Test Buyer')).toBeInTheDocument();
    expect(screen.getByText('£100.00')).toBeInTheDocument();
    expect(screen.getByText('£150.00')).toBeInTheDocument();
    expect(screen.getByLabelText('Outstanding total')).toHaveTextContent('Outstanding: £150.00');
  });

  it('ticks a sale as paid and reloads, so it drops off the list', async () => {
    renderSales();
    const tick = await screen.findByLabelText('Paid, SBM1061');
    (api.getSales as any).mockResolvedValue({ data: [], outstanding: 0 });
    fireEvent.click(tick);
    await waitFor(() => expect(api.setSalePaid).toHaveBeenCalledWith(5, true));
    expect(await screen.findByText(/Nothing outstanding/i)).toBeInTheDocument();
  });

  it('takes a tick back off a sale that was marked paid by mistake', async () => {
    (api.getSales as any).mockResolvedValue({ data: [sale({ is_paid: 1, paid_date: '2026-10-14' })], outstanding: 0 });
    renderSales();
    const tick = await screen.findByLabelText('Paid, SBM1061');
    expect(tick).toBeChecked();
    fireEvent.click(tick);
    await waitFor(() => expect(api.setSalePaid).toHaveBeenCalledWith(5, false));
  });

  it('switches between the unpaid, paid and complete lists', async () => {
    renderSales();
    await waitFor(() => expect(api.getSales).toHaveBeenCalledWith({ status: 'unpaid' }));
    fireEvent.change(screen.getByLabelText('Paid status'), { target: { value: 'paid' } });
    await waitFor(() => expect(api.getSales).toHaveBeenCalledWith({ status: 'paid' }));
    fireEvent.change(screen.getByLabelText('Paid status'), { target: { value: 'all' } });
    await waitFor(() => expect(api.getSales).toHaveBeenCalledWith({ status: 'all' }));
  });

  it('searches, trimming what was typed', async () => {
    renderSales();
    await waitFor(() => expect(api.getSales).toHaveBeenCalled());
    fireEvent.change(screen.getByLabelText('Search sales'), { target: { value: '  Acme  ' } });
    await waitFor(() => expect(api.getSales).toHaveBeenCalledWith({ status: 'unpaid', search: 'Acme' }));
  });

  it('opens the collection note behind a line', async () => {
    renderSales();
    fireEvent.click(await screen.findByText('Open'));
    expect(navigate).toHaveBeenCalledWith('/collection-notes/5');
  });

  it('reports a failure rather than showing an empty list', async () => {
    (api.getSales as any).mockRejectedValue(new Error('Superuser access required'));
    renderSales();
    expect(await screen.findByText('Superuser access required')).toBeInTheDocument();
  });

  it('says so when a tick could not be saved', async () => {
    renderSales();
    const tick = await screen.findByLabelText('Paid, SBM1061');
    (api.setSalePaid as any).mockRejectedValue(new Error('Collection note not found'));
    fireEvent.click(tick);
    expect(await screen.findByText('Collection note not found')).toBeInTheDocument();
  });
});
