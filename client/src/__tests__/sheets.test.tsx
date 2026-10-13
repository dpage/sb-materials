import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import React from 'react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { Travel } from '../pages/Travel';
import { TravelEdit } from '../pages/TravelEdit';
import { Expenses } from '../pages/Expenses';
import { ExpenseEdit } from '../pages/ExpenseEdit';
import { personParams, sheetYears } from '../pages/sheets-common';

vi.mock('../api', () => ({
  api: {
    getTravelSheets: vi.fn(),
    getTravelSheet: vi.fn(),
    openTravelSheet: vi.fn(),
    saveTravelSheet: vi.fn(),
    deleteTravelSheet: vi.fn(),
    downloadTravelSheetPdf: (id: number) => `/api/pdf/travel/${id}`,
    getExpenseSheets: vi.fn(),
    getExpenseSheet: vi.fn(),
    openExpenseSheet: vi.fn(),
    saveExpenseSheet: vi.fn(),
    deleteExpenseSheet: vi.fn(),
    downloadExpenseSheetPdf: (id: number) => `/api/pdf/expenses/${id}`,
    uploadReceipts: vi.fn(),
    deleteReceipt: vi.fn(),
    getReceiptUrl: (sheetId: number, photoId: number) => `/api/expenses/${sheetId}/photos/${photoId}/file`,
    getCustomers: vi.fn(),
    createCustomer: vi.fn(),
    getUsers: vi.fn(),
  },
}));

import { api } from '../api';

const authUser = { id: 1, username: 'admin', displayName: 'Administrator', phone: null, isSuperuser: true };

vi.mock('../App', () => ({
  useAuth: () => ({ user: authUser, loading: false, login: vi.fn(), logout: vi.fn() }),
}));

const mileageTotals = {
  miles: 500,
  milesBroughtForward: 9800,
  highMiles: 200,
  lowMiles: 300,
  highPay: 110,
  lowPay: 75,
  total: 185,
};

const travelSheet = {
  id: 7,
  user_id: 1,
  display_name: 'Administrator',
  year: 2026,
  month: 10,
  notes: null,
  journey_count: 2,
  rates: { high: 0.55, low: 0.25, bandMiles: 10000 },
  totals: mileageTotals,
  journeys: [
    {
      id: 1,
      journey_date: '2026-10-12',
      customer_id: 3,
      customer_name: 'Acme Recycling Ltd',
      job: 'Loading inspection',
      from_location: 'Wrexham',
      to_location: 'Derby',
      miles: 250,
      round_trip: 1,
    },
  ],
};

const expenseSheet = {
  id: 9,
  user_id: 1,
  display_name: 'Administrator',
  year: 2026,
  month: 10,
  notes: null,
  item_count: 2,
  totals: { gross: 76.5, vat: 12, net: 64.5 },
  items: [
    { id: 11, item_date: '2026-10-12', description: 'Diesel', cost: 72, vat_applicable: 1, vat_amount: 12 },
    { id: 12, item_date: '2026-10-13', description: 'Parking', cost: 4.5, vat_applicable: 0, vat_amount: null },
  ],
  photos: [{ id: 21, item_id: 11, file_path: 'expenses/9/one.jpg', sort_order: 0 }],
};

function wrapper({ children }: { children: React.ReactNode }) {
  return <MemoryRouter>{children}</MemoryRouter>;
}

describe('sheets-common', () => {
  it('offers the current year and its neighbours', () => {
    expect(sheetYears(new Date('2026-10-13'))).toEqual([2025, 2026, 2027]);
  });

  it('turns the person filter into the query the endpoints expect', () => {
    expect(personParams('')).toEqual({});
    expect(personParams('all')).toEqual({ all: '1' });
    expect(personParams('4')).toEqual({ user_id: '4' });
  });
});

describe('Travel list', () => {
  beforeEach(() => {
    vi.mocked(api.getTravelSheets).mockResolvedValue([travelSheet as never]);
    vi.mocked(api.getUsers).mockResolvedValue([]);
  });

  it('lists a sheet with its month, journeys, miles and claim', async () => {
    render(<Travel />, { wrapper });
    expect(await screen.findByText('October 2026')).toBeInTheDocument();
    expect(screen.getByText('2')).toBeInTheDocument();
    expect(screen.getByText('500')).toBeInTheDocument();
    expect(screen.getByText('£185.00')).toBeInTheDocument();
  });

  it('shows an empty state when there are no sheets', async () => {
    vi.mocked(api.getTravelSheets).mockResolvedValue([]);
    render(<Travel />, { wrapper });
    expect(await screen.findByText(/no travel sheets yet/i)).toBeInTheDocument();
  });

  it('opens the chosen month and goes to the sheet', async () => {
    vi.mocked(api.openTravelSheet).mockResolvedValue({ id: 7 } as never);
    render(<Travel />, { wrapper });
    await waitFor(() => expect(api.getTravelSheets).toHaveBeenCalled());

    fireEvent.change(screen.getByLabelText('Month'), { target: { value: '10' } });
    fireEvent.change(screen.getByLabelText('Year'), { target: { value: String(new Date().getFullYear()) } });
    fireEvent.click(screen.getByRole('button', { name: /open sheet/i }));

    await waitFor(() => expect(api.openTravelSheet).toHaveBeenCalledWith(new Date().getFullYear(), 10, undefined));
  });

  it('asks the server for everyones sheets when a superuser picks Everyone', async () => {
    render(<Travel />, { wrapper });
    await waitFor(() => expect(api.getTravelSheets).toHaveBeenCalledWith({}));

    fireEvent.change(screen.getByLabelText('Person'), { target: { value: 'all' } });
    await waitFor(() => expect(api.getTravelSheets).toHaveBeenCalledWith({ all: '1' }));
    // The person column only earns its place when more than one person's
    // sheets are on screen.
    expect(await screen.findByText('Person')).toBeInTheDocument();
  });

  it('asks for confirmation before deleting', async () => {
    render(<Travel />, { wrapper });
    await screen.findByText('October 2026');
    fireEvent.click(screen.getByRole('button', { name: /^delete$/i }));
    expect(await screen.findByText(/are you sure/i)).toBeInTheDocument();
    expect(api.deleteTravelSheet).not.toHaveBeenCalled();
  });

  it('links each sheet to its PDF', async () => {
    render(<Travel />, { wrapper });
    await screen.findByText('October 2026');
    expect(screen.getByRole('link', { name: /pdf/i })).toHaveAttribute('href', '/api/pdf/travel/7');
  });
});

describe('TravelEdit', () => {
  beforeEach(() => {
    vi.mocked(api.getTravelSheet).mockResolvedValue(travelSheet as never);
    vi.mocked(api.getCustomers).mockResolvedValue([{ id: 3, name: 'Acme Recycling Ltd' } as never]);
    vi.mocked(api.saveTravelSheet).mockResolvedValue(travelSheet as never);
  });

  const renderEdit = () =>
    render(
      <MemoryRouter initialEntries={['/travel/7']}>
        <Routes>
          <Route path="/travel/:id" element={<TravelEdit />} />
          <Route path="/travel" element={<div>Travel list</div>} />
        </Routes>
      </MemoryRouter>,
    );

  it('loads the legs into the table', async () => {
    renderEdit();
    expect(await screen.findByDisplayValue('Loading inspection')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Wrexham')).toBeInTheDocument();
    expect(screen.getByLabelText('Round trip, row 1')).toBeChecked();
  });

  it('totals as you type, doubling a round trip and using the brought forward miles', async () => {
    renderEdit();
    await screen.findByDisplayValue('Loading inspection');
    // 250 doubled is 500: 200 miles left in the band at 55p, then 300 at 25p.
    expect(screen.getByText('£110.00')).toBeInTheDocument();
    expect(screen.getByText('£75.00')).toBeInTheDocument();
    expect(screen.getByText('£185.00')).toBeInTheDocument();

    // Unticking the round trip halves it back to 250: 200 at 55p plus 50 at 25p.
    fireEvent.click(screen.getByLabelText('Round trip, row 1'));
    await waitFor(() => expect(screen.getByText('£122.50')).toBeInTheDocument());
  });

  it('adds and removes a leg', async () => {
    renderEdit();
    await screen.findByDisplayValue('Loading inspection');

    fireEvent.click(screen.getByRole('button', { name: /add journey/i }));
    expect(await screen.findByLabelText('Job, row 2')).toBeInTheDocument();

    fireEvent.click(screen.getAllByRole('button', { name: /remove/i })[1]);
    await waitFor(() => expect(screen.queryByLabelText('Job, row 2')).toBeNull());
  });

  it('saves the legs and the notes, then returns to the list', async () => {
    renderEdit();
    await screen.findByDisplayValue('Loading inspection');

    fireEvent.change(screen.getByLabelText('Notes'), { target: { value: 'Busy week' } });
    fireEvent.click(screen.getByRole('button', { name: /^save$/i }));

    await waitFor(() =>
      expect(api.saveTravelSheet).toHaveBeenCalledWith(
        7,
        expect.objectContaining({ notes: 'Busy week', journeys: expect.any(Array) }),
      ),
    );
    expect(await screen.findByText('Travel list')).toBeInTheDocument();
  });

  it('keeps the customer name alongside the id, so a rename does not rewrite history', async () => {
    renderEdit();
    await screen.findByDisplayValue('Loading inspection');

    fireEvent.change(screen.getByLabelText('Customer, row 1'), { target: { value: '3' } });
    fireEvent.click(screen.getByRole('button', { name: /^save$/i }));

    await waitFor(() => expect(api.saveTravelSheet).toHaveBeenCalled());
    const [, body] = vi.mocked(api.saveTravelSheet).mock.calls[0];
    expect((body as any).journeys[0]).toMatchObject({ customer_id: 3, customer_name: 'Acme Recycling Ltd' });
  });
});

describe('Expenses list', () => {
  beforeEach(() => {
    vi.mocked(api.getExpenseSheets).mockResolvedValue([expenseSheet as never]);
    vi.mocked(api.getUsers).mockResolvedValue([]);
  });

  it('lists a sheet with its total, VAT and net', async () => {
    render(<Expenses />, { wrapper });
    expect(await screen.findByText('October 2026')).toBeInTheDocument();
    expect(screen.getByText('£76.50')).toBeInTheDocument();
    expect(screen.getByText('£12.00')).toBeInTheDocument();
    expect(screen.getByText('£64.50')).toBeInTheDocument();
  });

  it('shows an empty state when there are no sheets', async () => {
    vi.mocked(api.getExpenseSheets).mockResolvedValue([]);
    render(<Expenses />, { wrapper });
    expect(await screen.findByText(/no expense sheets yet/i)).toBeInTheDocument();
  });

  it('opens the chosen month', async () => {
    vi.mocked(api.openExpenseSheet).mockResolvedValue({ id: 9 } as never);
    render(<Expenses />, { wrapper });
    await waitFor(() => expect(api.getExpenseSheets).toHaveBeenCalled());

    fireEvent.change(screen.getByLabelText('Month'), { target: { value: '10' } });
    fireEvent.click(screen.getByRole('button', { name: /open sheet/i }));
    await waitFor(() => expect(api.openExpenseSheet).toHaveBeenCalledWith(new Date().getFullYear(), 10, undefined));
  });
});

describe('ExpenseEdit', () => {
  beforeEach(() => {
    vi.mocked(api.getExpenseSheet).mockResolvedValue(expenseSheet as never);
    vi.mocked(api.saveExpenseSheet).mockResolvedValue(expenseSheet as never);
    vi.mocked(api.uploadReceipts).mockResolvedValue([] as never);
    vi.mocked(api.deleteReceipt).mockResolvedValue({ ok: true } as never);
  });

  const renderEdit = () =>
    render(
      <MemoryRouter initialEntries={['/expenses/9']}>
        <Routes>
          <Route path="/expenses/:id" element={<ExpenseEdit />} />
          <Route path="/expenses" element={<div>Expenses list</div>} />
        </Routes>
      </MemoryRouter>,
    );

  it('loads the items into the table', async () => {
    renderEdit();
    expect(await screen.findByDisplayValue('Diesel')).toBeInTheDocument();
    expect(screen.getByLabelText('VAT applicable, row 1')).toBeChecked();
    expect(screen.getByLabelText('VAT applicable, row 2')).not.toBeChecked();
  });

  it('totals the gross, the VAT and the net as you type', async () => {
    renderEdit();
    await screen.findByDisplayValue('Diesel');
    expect(screen.getByText('£76.50')).toBeInTheDocument();
    expect(screen.getByText('£12.00')).toBeInTheDocument();
    expect(screen.getByText('£64.50')).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Cost, row 2'), { target: { value: '10' } });
    await waitFor(() => expect(screen.getByText('£82.00')).toBeInTheDocument());
  });

  it('works the VAT out of the cost at the standard rate', async () => {
    renderEdit();
    await screen.findByDisplayValue('Diesel');

    fireEvent.change(screen.getByLabelText('Cost, row 1'), { target: { value: '120' } });
    fireEvent.click(screen.getAllByRole('button', { name: '20%' })[0]);
    await waitFor(() => expect(screen.getByLabelText('VAT amount, row 1')).toHaveValue(20));
  });

  it('will not take a VAT figure for an item with no VAT on it', async () => {
    renderEdit();
    await screen.findByDisplayValue('Diesel');
    expect(screen.getByLabelText('VAT amount, row 2')).toBeDisabled();
    expect(screen.getAllByRole('button', { name: '20%' })[1]).toBeDisabled();
  });

  it('saves the items and the notes, then returns to the list', async () => {
    renderEdit();
    await screen.findByDisplayValue('Diesel');

    fireEvent.change(screen.getByLabelText('Notes'), { target: { value: 'October spending' } });
    fireEvent.click(screen.getByRole('button', { name: /^save$/i }));

    await waitFor(() =>
      expect(api.saveExpenseSheet).toHaveBeenCalledWith(
        9,
        expect.objectContaining({ notes: 'October spending', items: expect.any(Array) }),
      ),
    );
    expect(await screen.findByText('Expenses list')).toBeInTheDocument();
  });

  it('shows the receipts already on the sheet and can remove one', async () => {
    renderEdit();
    await screen.findByDisplayValue('Diesel');

    const image = screen.getByAltText('Receipt');
    expect(image).toHaveAttribute('src', '/api/expenses/9/photos/21/file');

    const removeButtons = screen.getAllByRole('button', { name: /remove/i });
    fireEvent.click(removeButtons[removeButtons.length - 1]);
    await waitFor(() => expect(api.deleteReceipt).toHaveBeenCalledWith(9, 21));
    await waitFor(() => expect(screen.queryByAltText('Receipt')).toBeNull());
  });

  it('saves before uploading, so the receipt can attach to the chosen item', async () => {
    renderEdit();
    await screen.findByDisplayValue('Diesel');

    fireEvent.change(screen.getByLabelText('Attach receipt to'), { target: { value: '11' } });
    const file = new File(['x'], 'receipt.jpg', { type: 'image/jpeg' });
    fireEvent.change(screen.getByLabelText('Add receipts'), { target: { files: [file] } });

    await waitFor(() => expect(api.saveExpenseSheet).toHaveBeenCalled());
    await waitFor(() => expect(api.uploadReceipts).toHaveBeenCalledWith(9, [file], [11]));
  });

  it('attaches a receipt to the whole sheet when no item is chosen', async () => {
    renderEdit();
    await screen.findByDisplayValue('Diesel');

    const file = new File(['x'], 'receipt.jpg', { type: 'image/jpeg' });
    fireEvent.change(screen.getByLabelText('Add receipts'), { target: { files: [file] } });

    await waitFor(() => expect(api.uploadReceipts).toHaveBeenCalledWith(9, [file], [null]));
  });
});
