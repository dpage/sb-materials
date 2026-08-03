import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent, within } from '@testing-library/react';
import React from 'react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { CollectionNotes } from '../pages/CollectionNotes';
import { CollectionNoteEdit } from '../pages/CollectionNoteEdit';
import { HelpProvider } from '../components/HelpContext';

// jsdom has no canvas backing, so stub out the signature pad as the report
// form's tests do.
vi.mock('react-signature-canvas', () => ({
  default: React.forwardRef((_props: any, ref: any) => {
    React.useImperativeHandle(ref, () => ({
      isEmpty: () => true,
      clear: () => {},
      toDataURL: () => 'data:image/png;base64,fake',
    }));
    return <canvas data-testid="signature-canvas" />;
  }),
}));

vi.mock('../api', () => ({
  api: {
    getCollectionNotes: vi.fn(),
    deleteCollectionNote: vi.fn(),
    getCustomers: vi.fn(),
    downloadCollectionNotePdf: (id: number) => `/api/pdf/collection-note/${id}`,
    getNextCollectionNoteReference: vi.fn(),
    getCollectionNote: vi.fn(),
    createCollectionNote: vi.fn(),
    updateCollectionNote: vi.fn(),
    getSites: vi.fn(),
    getUser: vi.fn(),
    uploadCollectionNoteSignature: vi.fn(),
    createSite: vi.fn(),
    createCustomer: vi.fn(),
    getPhotoUrl: (f: string) => `/api/photos/file/${f}`,
  },
}));

import { api } from '../api';

// Mock useAuth (consumed indirectly via components under test)
vi.mock('../App', () => ({
  useAuth: () => ({
    user: { id: 1, username: 'admin', displayName: 'Administrator', isSuperuser: true },
    loading: false,
    login: vi.fn(),
    logout: vi.fn(),
  }),
}));

function TestWrapper({ children, initialEntries = ['/'] }: { children: React.ReactNode; initialEntries?: string[] }) {
  return (
    <MemoryRouter initialEntries={initialEntries}>
      <HelpProvider>{children}</HelpProvider>
    </MemoryRouter>
  );
}

const note = {
  id: 1,
  reference: 'SBM1061',
  customer_id: 1,
  customer_name: 'Acme Recycling Ltd',
  collection_date: '2026-08-03',
  items_summary: 'Poly cup reels, Mixed paper bales',
  transport_company: 'Test Haulage',
};

describe('CollectionNotes list', () => {
  beforeEach(() => {
    vi.mocked(api.getCollectionNotes).mockResolvedValue({ data: [note as never], total: 1, page: 1, limit: 25 });
    vi.mocked(api.getCustomers).mockResolvedValue([]);
  });

  it('lists notes with reference, customer, and date', async () => {
    render(<CollectionNotes />, { wrapper: TestWrapper });
    await waitFor(() => expect(screen.getAllByText('SBM1061').length).toBeGreaterThan(0));
    expect(screen.getAllByText('Acme Recycling Ltd').length).toBeGreaterThan(0);
    expect(screen.getAllByText('03/08/2026').length).toBeGreaterThan(0);
  });

  it('shows an empty state when there are no notes', async () => {
    vi.mocked(api.getCollectionNotes).mockResolvedValue({ data: [], total: 0, page: 1, limit: 25 });
    render(<CollectionNotes />, { wrapper: TestWrapper });
    await waitFor(() => expect(screen.getByText(/no collection notes/i)).toBeInTheDocument());
  });

  it('searches when the user types', async () => {
    render(<CollectionNotes />, { wrapper: TestWrapper });
    await waitFor(() => expect(api.getCollectionNotes).toHaveBeenCalled());
    fireEvent.change(screen.getByPlaceholderText(/search/i), { target: { value: 'SBM1061' } });
    await waitFor(() =>
      expect(api.getCollectionNotes).toHaveBeenCalledWith(expect.objectContaining({ search: 'SBM1061' })),
    );
  });

  it('asks for confirmation before deleting', async () => {
    render(<CollectionNotes />, { wrapper: TestWrapper });
    await waitFor(() => expect(screen.getAllByText('SBM1061').length).toBeGreaterThan(0));
    const deleteButtons = screen.getAllByRole('button', { name: /delete/i });
    fireEvent.click(deleteButtons[0]);
    expect(await screen.findByText(/are you sure/i)).toBeInTheDocument();
    expect(api.deleteCollectionNote).not.toHaveBeenCalled();
  });

  it('offers a PDF link for each note', async () => {
    render(<CollectionNotes />, { wrapper: TestWrapper });
    await waitFor(() => expect(screen.getAllByText('SBM1061').length).toBeGreaterThan(0));
    const pdfLinks = screen.getAllByRole('link', { name: /pdf/i });
    expect(pdfLinks.length).toBeGreaterThan(0);
    pdfLinks.forEach((link) => expect(link).toHaveAttribute('href', '/api/pdf/collection-note/1'));
  });

  it('sorts by a column heading and reverses order on repeat click', async () => {
    render(<CollectionNotes />, { wrapper: TestWrapper });
    await waitFor(() => expect(api.getCollectionNotes).toHaveBeenCalled());

    fireEvent.click(within(screen.getByRole('table')).getByText(/^Reference/));
    await waitFor(() =>
      expect(api.getCollectionNotes).toHaveBeenCalledWith(
        expect.objectContaining({ sort: 'reference', order: 'DESC' }),
      ),
    );

    fireEvent.click(within(screen.getByRole('table')).getByText(/^Reference/));
    await waitFor(() =>
      expect(api.getCollectionNotes).toHaveBeenCalledWith(expect.objectContaining({ sort: 'reference', order: 'ASC' })),
    );
  });

  it('sorts by customer when the Customer heading is clicked', async () => {
    render(<CollectionNotes />, { wrapper: TestWrapper });
    await waitFor(() => expect(api.getCollectionNotes).toHaveBeenCalled());

    fireEvent.click(within(screen.getByRole('table')).getByText(/^Customer/));
    await waitFor(() =>
      expect(api.getCollectionNotes).toHaveBeenCalledWith(
        expect.objectContaining({ sort: 'customer_name', order: 'DESC' }),
      ),
    );
  });

  it('passes customer_id when a customer is chosen from the filter dropdown', async () => {
    vi.mocked(api.getCustomers).mockResolvedValue([{ id: 7, name: 'Acme Recycling Ltd' } as never]);
    render(<CollectionNotes />, { wrapper: TestWrapper });
    await waitFor(() => expect(api.getCollectionNotes).toHaveBeenCalled());
    await waitFor(() => expect(screen.getAllByText('Acme Recycling Ltd').length).toBeGreaterThan(0));

    fireEvent.change(screen.getByDisplayValue('All customers'), { target: { value: '7' } });
    await waitFor(() =>
      expect(api.getCollectionNotes).toHaveBeenCalledWith(expect.objectContaining({ customer_id: '7' })),
    );
  });
});

describe('CollectionNoteEdit form', () => {
  beforeEach(() => {
    // Each test's assertions about whether the API was called depend on a
    // clean call history; the mocks are shared vi.fn() instances across the
    // whole file, so clear them before re-arranging their resolved values.
    vi.clearAllMocks();
    vi.mocked(api.getNextCollectionNoteReference).mockResolvedValue({ reference: 'SBM1061', prefix: 'SBM' });
    vi.mocked(api.getCustomers).mockResolvedValue([
      {
        id: 1,
        name: 'Acme Recycling Ltd',
        contact_name: null,
        email: null,
        phone: null,
        address: '1 Test Way\nTestville TE5 7ST',
        is_active: 1,
      },
    ] as never);
    vi.mocked(api.getSites).mockResolvedValue([]);
    vi.mocked(api.createCollectionNote).mockResolvedValue({ id: 7, reference: 'SBM1061' });
    vi.mocked(api.updateCollectionNote).mockResolvedValue({ ok: true });
  });

  it('prefills the next reference on a new note', async () => {
    render(<CollectionNoteEdit />, { wrapper: TestWrapper });
    await waitFor(() => expect(screen.getByLabelText(/reference/i)).toHaveValue('SBM1061'));
  });

  it('lets the reference be overtyped', async () => {
    render(<CollectionNoteEdit />, { wrapper: TestWrapper });
    await waitFor(() => expect(screen.getByLabelText(/reference/i)).toHaveValue('SBM1061'));
    fireEvent.change(screen.getByLabelText(/reference/i), { target: { value: 'SBM2000' } });
    expect(screen.getByLabelText(/reference/i)).toHaveValue('SBM2000');
  });

  it('snapshots the customer address into the collect from field', async () => {
    render(<CollectionNoteEdit />, { wrapper: TestWrapper });
    await waitFor(() => expect(api.getCustomers).toHaveBeenCalled());
    fireEvent.change(screen.getByLabelText(/customer/i), { target: { value: '1' } });
    await waitFor(() =>
      expect(screen.getByLabelText(/collect from/i)).toHaveValue('Acme Recycling Ltd\n1 Test Way\nTestville TE5 7ST'),
    );
  });

  it('does not clobber a hand-edited collect from address', async () => {
    render(<CollectionNoteEdit />, { wrapper: TestWrapper });
    await waitFor(() => expect(api.getCustomers).toHaveBeenCalled());
    fireEvent.change(screen.getByLabelText(/collect from/i), { target: { value: 'Somewhere else entirely' } });
    fireEvent.change(screen.getByLabelText(/customer/i), { target: { value: '1' } });
    expect(screen.getByLabelText(/collect from/i)).toHaveValue('Somewhere else entirely');
  });

  it('adds and removes line items', async () => {
    render(<CollectionNoteEdit />, { wrapper: TestWrapper });
    await waitFor(() => expect(screen.getByLabelText(/reference/i)).toBeInTheDocument());
    const before = screen.getAllByLabelText(/description/i).length;
    fireEvent.click(screen.getByRole('button', { name: /add item/i }));
    expect(screen.getAllByLabelText(/description/i)).toHaveLength(before + 1);
    fireEvent.click(screen.getAllByRole('button', { name: /remove item/i })[0]);
    expect(screen.getAllByLabelText(/description/i)).toHaveLength(before);
  });

  it('surfaces a duplicate reference against the reference field', async () => {
    vi.mocked(api.createCollectionNote).mockRejectedValue(new Error('Reference SBM1061 is already in use'));
    render(<CollectionNoteEdit />, { wrapper: TestWrapper });
    await waitFor(() => expect(screen.getByLabelText(/reference/i)).toHaveValue('SBM1061'));
    fireEvent.change(screen.getByLabelText(/customer/i), { target: { value: '1' } });
    fireEvent.click(screen.getByRole('button', { name: /save/i }));
    expect(await screen.findByText(/already in use/i)).toBeInTheDocument();
  });

  it('will not save without a customer', async () => {
    render(<CollectionNoteEdit />, { wrapper: TestWrapper });
    await waitFor(() => expect(screen.getByLabelText(/reference/i)).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: /save/i }));
    expect(await screen.findByText(/customer is required/i)).toBeInTheDocument();
    expect(api.createCollectionNote).not.toHaveBeenCalled();
  });

  it('sends the items with the note', async () => {
    render(<CollectionNoteEdit />, { wrapper: TestWrapper });
    await waitFor(() => expect(screen.getByLabelText(/reference/i)).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText(/customer/i), { target: { value: '1' } });
    fireEvent.change(screen.getAllByLabelText(/quantity/i)[0], { target: { value: '1x' } });
    fireEvent.change(screen.getAllByLabelText(/description/i)[0], { target: { value: 'Poly cup reels' } });
    fireEvent.click(screen.getByRole('button', { name: /save/i }));
    await waitFor(() =>
      expect(api.createCollectionNote).toHaveBeenCalledWith(
        expect.objectContaining({
          reference: 'SBM1061',
          customer_id: 1,
          items: expect.arrayContaining([expect.objectContaining({ description: 'Poly cup reels' })]),
        }),
      ),
    );
  });

  it('will not save without a reference', async () => {
    render(<CollectionNoteEdit />, { wrapper: TestWrapper });
    await waitFor(() => expect(screen.getByLabelText(/reference/i)).toHaveValue('SBM1061'));
    fireEvent.change(screen.getByLabelText(/reference/i), { target: { value: '' } });
    fireEvent.change(screen.getByLabelText(/customer/i), { target: { value: '1' } });
    fireEvent.click(screen.getByRole('button', { name: /save/i }));
    expect(await screen.findByText(/reference is required/i)).toBeInTheDocument();
    expect(api.createCollectionNote).not.toHaveBeenCalled();
  });

  it('shows a generic error banner for an unexpected save failure', async () => {
    vi.mocked(api.createCollectionNote).mockRejectedValue(new Error('Network error'));
    render(<CollectionNoteEdit />, { wrapper: TestWrapper });
    await waitFor(() => expect(screen.getByLabelText(/reference/i)).toHaveValue('SBM1061'));
    fireEvent.change(screen.getByLabelText(/customer/i), { target: { value: '1' } });
    fireEvent.click(screen.getByRole('button', { name: /save/i }));
    expect(await screen.findByText('Network error')).toBeInTheDocument();
  });

  it('uses the site address once a site is chosen', async () => {
    vi.mocked(api.getSites).mockResolvedValue([
      { id: 9, customer_id: 1, address: '9 Depot Road\nTestville TE5 7ST', is_active: 1 },
    ] as never);
    render(<CollectionNoteEdit />, { wrapper: TestWrapper });
    await waitFor(() => expect(api.getCustomers).toHaveBeenCalled());
    fireEvent.change(screen.getByLabelText(/customer/i), { target: { value: '1' } });
    await waitFor(() => expect(screen.getByLabelText(/^site$/i)).not.toBeDisabled());
    fireEvent.change(screen.getByLabelText(/^site$/i), { target: { value: '9' } });
    await waitFor(() =>
      expect(screen.getByLabelText(/collect from/i)).toHaveValue('Acme Recycling Ltd\n9 Depot Road\nTestville TE5 7ST'),
    );
  });

  it('loads an existing note for editing, including items and signatures', async () => {
    vi.mocked(api.getCollectionNote).mockResolvedValue({
      id: 5,
      reference: 'SBM1050',
      customer_id: 1,
      site_id: null,
      collect_from_address: 'Acme Recycling Ltd\n1 Test Way\nTestville TE5 7ST',
      comments: 'Existing comments',
      contact_name: 'Test User',
      contact_phone: '07700 900123',
      po_number: 'PO-1',
      weight: '5 Tonnes',
      packing_list_no: 'PL-1',
      collection_date: '2026-07-01',
      transport_company: 'Test Haulage',
      dispatched_signature_path: 'collection-notes/5/dispatched.png',
      dispatched_signed_date: '2026-07-01',
      received_signature_path: 'collection-notes/5/received.png',
      received_signed_date: '2026-07-02',
      created_by_id: 1,
      created_at: '2026-07-01T00:00:00Z',
      updated_at: '2026-07-01T00:00:00Z',
      items: [{ id: 1, quantity: '2x', description: 'Poly cup reels', collection_point: 'Bay 1' }],
    } as never);

    render(
      <MemoryRouter initialEntries={['/collection-notes/5']}>
        <HelpProvider>
          <Routes>
            <Route path="/collection-notes/:id" element={<CollectionNoteEdit />} />
          </Routes>
        </HelpProvider>
      </MemoryRouter>,
    );

    await waitFor(() => expect(screen.getByLabelText(/reference/i)).toHaveValue('SBM1050'));
    expect(screen.getByLabelText(/collect from/i)).toHaveValue('Acme Recycling Ltd\n1 Test Way\nTestville TE5 7ST');
    expect(screen.getByLabelText(/description/i)).toHaveValue('Poly cup reels');
    expect(screen.getAllByText(/current signature/i).length).toBe(2);

    fireEvent.click(screen.getByRole('button', { name: /save/i }));
    await waitFor(() =>
      expect(api.updateCollectionNote).toHaveBeenCalledWith(5, expect.objectContaining({ reference: 'SBM1050' })),
    );
  });
});
