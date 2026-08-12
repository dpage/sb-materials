import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent, within } from '@testing-library/react';
import React from 'react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { CollectionNotes } from '../pages/CollectionNotes';
import { CollectionNoteEdit } from '../pages/CollectionNoteEdit';
import { HelpProvider } from '../components/HelpContext';

// jsdom has no canvas backing, so stub out the signature pad as the report
// form's tests do. The pad's "drawn on" state is controllable per test via
// signatureCanvasState, keyed by the canvas's position in the DOM (the form
// renders only the dispatched pad, so index 0). Each component instance is
// assigned a stable index on its first render (via a ref) and releases it on
// unmount, rather than incrementing on every render, since the surrounding
// form re-renders far more often than the pads themselves mount; releasing on
// unmount keeps the numbering fresh for each test now that testing-library
// auto-unmounts between tests.
const signatureCanvasState: { isEmpty: boolean[] } = { isEmpty: [true] };

vi.mock('react-signature-canvas', () => {
  let instanceCount = 0;
  return {
    default: React.forwardRef((_props: any, ref: any) => {
      const indexRef = React.useRef<number | null>(null);
      if (indexRef.current === null) {
        indexRef.current = instanceCount++;
      }
      const index = indexRef.current;
      React.useEffect(() => {
        return () => {
          instanceCount -= 1;
        };
      }, []);
      React.useImperativeHandle(ref, () => ({
        isEmpty: () => signatureCanvasState.isEmpty[index] ?? true,
        clear: () => {},
        // Must be valid base64 - jsdom's fetch (Node's undici) rejects a
        // malformed data: URL outright, before the component even reaches
        // the upload call.
        toDataURL: () => `data:image/png;base64,${Buffer.from(`fake-signature-${index}`).toString('base64')}`,
      }));
      return <canvas data-testid="signature-canvas" />;
    }),
  };
});

vi.mock('../api', () => ({
  api: {
    getCollectionNotes: vi.fn(),
    deleteCollectionNote: vi.fn(),
    duplicateCollectionNote: vi.fn(),
    getCustomers: vi.fn(),
    getLookups: vi.fn(),
    createLookup: vi.fn(),
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
    user: { id: 1, username: 'admin', displayName: 'Administrator', phone: '07700 900123', isSuperuser: true },
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
    const empty = await screen.findByText(/no collection notes/i);
    expect(empty).toBeInTheDocument();
    // .cn-table-wrap is display:none below 768px, so a mobile user (the
    // primary platform here) must not have the empty state buried inside it.
    expect(empty.closest('.cn-table-wrap')).toBeNull();
  });

  it('shows the loading state outside the desktop-only table wrapper', () => {
    vi.mocked(api.getCollectionNotes).mockReturnValue(new Promise(() => {}));
    render(<CollectionNotes />, { wrapper: TestWrapper });
    const loading = screen.getByText('Loading...');
    expect(loading).toBeInTheDocument();
    expect(loading.closest('.cn-table-wrap')).toBeNull();
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

  it('copies a note and refreshes the list, without asking for confirmation', async () => {
    vi.mocked(api.duplicateCollectionNote).mockResolvedValue({ id: 2, reference: 'SBM1062' });
    render(<CollectionNotes />, { wrapper: TestWrapper });
    await waitFor(() => expect(screen.getAllByText('SBM1061').length).toBeGreaterThan(0));
    const callsBefore = vi.mocked(api.getCollectionNotes).mock.calls.length;

    fireEvent.click(screen.getAllByRole('button', { name: /^copy/i })[0]);

    await waitFor(() => expect(api.duplicateCollectionNote).toHaveBeenCalledWith(1));
    await waitFor(() => expect(vi.mocked(api.getCollectionNotes).mock.calls.length).toBeGreaterThan(callsBefore));
  });

  it('reports a failed copy rather than failing silently', async () => {
    vi.mocked(api.duplicateCollectionNote).mockRejectedValue(new Error('Could not reach the server'));
    render(<CollectionNotes />, { wrapper: TestWrapper });
    await waitFor(() => expect(screen.getAllByText('SBM1061').length).toBeGreaterThan(0));

    fireEvent.click(screen.getAllByRole('button', { name: /^copy/i })[0]);

    expect(await screen.findByText('Could not reach the server')).toBeInTheDocument();
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
    signatureCanvasState.isEmpty = [true];
    vi.mocked(api.getNextCollectionNoteReference).mockResolvedValue({ reference: 'SBM1061', prefix: 'SBM' });
    vi.mocked(api.getLookups).mockResolvedValue([
      { id: 1, value: 'Poly cup reels', is_active: 1 },
      { id: 2, value: 'Mixed paper bales', is_active: 1 },
    ] as never);
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
    await waitFor(() => expect(screen.getByLabelText(/^reference$/i)).toHaveValue('SBM1061'));
  });

  it('prefills contact name and phone from the logged-in user, without calling the users API', async () => {
    // The phone must come from useAuth(), not from api.getUser: that endpoint
    // is superuser-only, so calling it is what silently left the field blank
    // for every ordinary inspector.
    render(<CollectionNoteEdit />, { wrapper: TestWrapper });
    await waitFor(() => expect(screen.getByLabelText(/contact name/i)).toHaveValue('Administrator'));
    expect(screen.getByLabelText(/contact phone/i)).toHaveValue('07700 900123');
    expect(api.getUser).not.toHaveBeenCalled();
  });

  it('lets the reference be overtyped', async () => {
    render(<CollectionNoteEdit />, { wrapper: TestWrapper });
    await waitFor(() => expect(screen.getByLabelText(/^reference$/i)).toHaveValue('SBM1061'));
    fireEvent.change(screen.getByLabelText(/^reference$/i), { target: { value: 'SBM2000' } });
    expect(screen.getByLabelText(/^reference$/i)).toHaveValue('SBM2000');
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
    await waitFor(() => expect(screen.getByLabelText(/^reference$/i)).toBeInTheDocument());
    const before = screen.getAllByLabelText(/^description$/i).length;
    fireEvent.click(screen.getByRole('button', { name: /add item/i }));
    expect(screen.getAllByLabelText(/^description$/i)).toHaveLength(before + 1);
    fireEvent.click(screen.getAllByRole('button', { name: /remove item/i })[0]);
    expect(screen.getAllByLabelText(/^description$/i)).toHaveLength(before);
  });

  it('surfaces a duplicate reference against the reference field', async () => {
    vi.mocked(api.createCollectionNote).mockRejectedValue(new Error('Reference SBM1061 is already in use'));
    render(<CollectionNoteEdit />, { wrapper: TestWrapper });
    await waitFor(() => expect(screen.getByLabelText(/^reference$/i)).toHaveValue('SBM1061'));
    fireEvent.change(screen.getByLabelText(/customer/i), { target: { value: '1' } });
    fireEvent.click(screen.getByRole('button', { name: /save/i }));
    expect(await screen.findByText(/already in use/i)).toBeInTheDocument();
  });

  it('will not save without a customer', async () => {
    render(<CollectionNoteEdit />, { wrapper: TestWrapper });
    await waitFor(() => expect(screen.getByLabelText(/^reference$/i)).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: /save/i }));
    expect(await screen.findByText(/customer is required/i)).toBeInTheDocument();
    expect(api.createCollectionNote).not.toHaveBeenCalled();
  });

  it('sends the items with the note', async () => {
    render(<CollectionNoteEdit />, { wrapper: TestWrapper });
    await waitFor(() => expect(screen.getByLabelText(/^reference$/i)).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText(/customer/i), { target: { value: '1' } });
    // The description is chosen from the product description lookup, so wait
    // for that list to arrive before selecting from it.
    await waitFor(() => expect(screen.getAllByRole('option', { name: 'Poly cup reels' }).length).toBe(1));
    fireEvent.change(screen.getAllByLabelText(/quantity/i)[0], { target: { value: '1x' } });
    fireEvent.change(screen.getAllByLabelText(/^description$/i)[0], { target: { value: 'Poly cup reels' } });
    fireEvent.change(screen.getAllByLabelText(/nett weight/i)[0], { target: { value: '1250' } });
    fireEvent.click(screen.getByRole('button', { name: /save/i }));
    await waitFor(() =>
      expect(api.createCollectionNote).toHaveBeenCalledWith(
        expect.objectContaining({
          reference: 'SBM1061',
          customer_id: 1,
          items: expect.arrayContaining([
            expect.objectContaining({ description: 'Poly cup reels', nett_weight: '1250' }),
          ]),
        }),
      ),
    );
  });

  it('adds a product description from the form and selects it into the item', async () => {
    vi.mocked(api.createLookup).mockResolvedValue({ id: 3, value: 'Baled PET', is_active: 1 } as never);
    render(<CollectionNoteEdit />, { wrapper: TestWrapper });
    await waitFor(() => expect(screen.getByLabelText(/^reference$/i)).toBeInTheDocument());

    fireEvent.click(screen.getAllByRole('button', { name: /add product description/i })[0]);
    // The quick-add modal's label is not associated with its input, so reach
    // the field through the modal itself rather than by label.
    const modal = screen.getByText('Add New Product Description').closest('div')!;
    fireEvent.change(within(modal).getByRole('textbox'), { target: { value: 'Baled PET' } });
    fireEvent.click(within(modal).getByRole('button', { name: /^add$/i }));

    await waitFor(() =>
      expect(api.createLookup).toHaveBeenCalledWith('lookup_product_descriptions', {
        value: 'Baled PET',
        report_type: 'loading_inspection',
      }),
    );
    await waitFor(() => expect(screen.getAllByLabelText(/^description$/i)[0]).toHaveValue('Baled PET'));
  });

  it('will not save without a reference', async () => {
    render(<CollectionNoteEdit />, { wrapper: TestWrapper });
    await waitFor(() => expect(screen.getByLabelText(/^reference$/i)).toHaveValue('SBM1061'));
    fireEvent.change(screen.getByLabelText(/^reference$/i), { target: { value: '' } });
    fireEvent.change(screen.getByLabelText(/customer/i), { target: { value: '1' } });
    fireEvent.click(screen.getByRole('button', { name: /save/i }));
    expect(await screen.findByText(/reference is required/i)).toBeInTheDocument();
    expect(api.createCollectionNote).not.toHaveBeenCalled();
  });

  it('shows a generic error banner for an unexpected save failure', async () => {
    vi.mocked(api.createCollectionNote).mockRejectedValue(new Error('Network error'));
    render(<CollectionNoteEdit />, { wrapper: TestWrapper });
    await waitFor(() => expect(screen.getByLabelText(/^reference$/i)).toHaveValue('SBM1061'));
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
      buyer_reference: 'BR-1',
      weight: '5 Tonnes',
      minimum_weight: '24 Tonnes',
      collection_date: '2026-07-01',
      transport_company: 'Test Haulage',
      dispatched_signature_path: 'collection-notes/5/dispatched.png',
      dispatched_signed_date: '2026-07-01',
      created_by_id: 1,
      created_at: '2026-07-01T00:00:00Z',
      updated_at: '2026-07-01T00:00:00Z',
      items: [{ id: 1, quantity: '2x', description: 'Poly cup reels', nett_weight: '1250', collection_point: 'Bay 1' }],
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

    await waitFor(() => expect(screen.getByLabelText(/^reference$/i)).toHaveValue('SBM1050'));
    expect(screen.getByLabelText(/collect from/i)).toHaveValue('Acme Recycling Ltd\n1 Test Way\nTestville TE5 7ST');
    expect(screen.getByLabelText(/^description$/i)).toHaveValue('Poly cup reels');
    expect(screen.getByLabelText(/buyer reference/i)).toHaveValue('BR-1');
    expect(screen.getByLabelText(/minimum weight/i)).toHaveValue('24 Tonnes');
    expect(screen.getByLabelText(/nett weight/i)).toHaveValue('1250');
    expect(screen.getAllByText(/current signature/i).length).toBe(1);

    fireEvent.click(screen.getByRole('button', { name: /save/i }));
    await waitFor(() =>
      expect(api.updateCollectionNote).toHaveBeenCalledWith(5, expect.objectContaining({ reference: 'SBM1050' })),
    );
  });

  it('keeps deriving the collect from address across two consecutive customer changes', async () => {
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
      {
        id: 2,
        name: 'Test Metals Ltd',
        contact_name: null,
        email: null,
        phone: null,
        address: '2 Foundry Road\nTestville TE5 7ST',
        is_active: 1,
      },
    ] as never);

    render(<CollectionNoteEdit />, { wrapper: TestWrapper });
    await waitFor(() => expect(api.getCustomers).toHaveBeenCalled());

    fireEvent.change(screen.getByLabelText(/customer/i), { target: { value: '1' } });
    await waitFor(() =>
      expect(screen.getByLabelText(/collect from/i)).toHaveValue('Acme Recycling Ltd\n1 Test Way\nTestville TE5 7ST'),
    );

    // A second, immediate customer change: the field still holds the value
    // we derived a moment ago, so it remains safe to overwrite.
    fireEvent.change(screen.getByLabelText(/customer/i), { target: { value: '2' } });
    await waitFor(() =>
      expect(screen.getByLabelText(/collect from/i)).toHaveValue('Test Metals Ltd\n2 Foundry Road\nTestville TE5 7ST'),
    );
  });

  it('preserves the note-saved address on customer change when it no longer matches the customer record on file', async () => {
    // The note was saved with an address that no longer matches what the
    // customer record on file would derive today (e.g. the customer's
    // address has since changed, or the address was hand-typed at save
    // time). Loading the note must not treat that stored text as merely a
    // stale "derived" snapshot that is fair game to overwrite.
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
      {
        id: 2,
        name: 'Test Metals Ltd',
        contact_name: null,
        email: null,
        phone: null,
        address: '2 Foundry Road\nTestville TE5 7ST',
        is_active: 1,
      },
    ] as never);
    vi.mocked(api.getCollectionNote).mockResolvedValue({
      id: 5,
      reference: 'SBM1050',
      customer_id: 1,
      site_id: null,
      collect_from_address: 'Acme Recycling Ltd\nOld Yard, No Longer On File',
      comments: null,
      contact_name: null,
      contact_phone: null,
      buyer_reference: null,
      weight: null,
      minimum_weight: null,
      collection_date: '2026-07-01',
      transport_company: null,
      dispatched_signature_path: null,
      dispatched_signed_date: null,
      created_by_id: 1,
      created_at: '2026-07-01T00:00:00Z',
      updated_at: '2026-07-01T00:00:00Z',
      items: [],
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

    await waitFor(() => expect(screen.getByLabelText(/^reference$/i)).toHaveValue('SBM1050'));
    expect(screen.getByLabelText(/collect from/i)).toHaveValue('Acme Recycling Ltd\nOld Yard, No Longer On File');

    fireEvent.change(screen.getByLabelText(/customer/i), { target: { value: '2' } });
    expect(screen.getByLabelText(/collect from/i)).toHaveValue('Acme Recycling Ltd\nOld Yard, No Longer On File');
  });

  it('preserves repeated hand-edits to the collect from address across customer changes', async () => {
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
      {
        id: 2,
        name: 'Test Metals Ltd',
        contact_name: null,
        email: null,
        phone: null,
        address: '2 Foundry Road\nTestville TE5 7ST',
        is_active: 1,
      },
    ] as never);

    render(<CollectionNoteEdit />, { wrapper: TestWrapper });
    await waitFor(() => expect(api.getCustomers).toHaveBeenCalled());

    fireEvent.change(screen.getByLabelText(/customer/i), { target: { value: '1' } });
    await waitFor(() =>
      expect(screen.getByLabelText(/collect from/i)).toHaveValue('Acme Recycling Ltd\n1 Test Way\nTestville TE5 7ST'),
    );

    fireEvent.change(screen.getByLabelText(/collect from/i), { target: { value: 'Hand edited address one' } });
    fireEvent.change(screen.getByLabelText(/customer/i), { target: { value: '2' } });
    expect(screen.getByLabelText(/collect from/i)).toHaveValue('Hand edited address one');

    fireEvent.change(screen.getByLabelText(/collect from/i), { target: { value: 'Hand edited address two' } });
    fireEvent.change(screen.getByLabelText(/customer/i), { target: { value: '1' } });
    expect(screen.getByLabelText(/collect from/i)).toHaveValue('Hand edited address two');
  });

  it('creates the note before uploading the signature', async () => {
    signatureCanvasState.isEmpty = [false];
    const callOrder: string[] = [];
    vi.mocked(api.createCollectionNote).mockImplementation(async (data: any) => {
      callOrder.push('create');
      return { id: 42, reference: data.reference };
    });
    vi.mocked(api.uploadCollectionNoteSignature).mockImplementation(async (noteId: any, kind: any) => {
      callOrder.push(`upload:${kind}:${noteId}`);
      return {} as never;
    });

    render(<CollectionNoteEdit />, { wrapper: TestWrapper });
    await waitFor(() => expect(screen.getByLabelText(/^reference$/i)).toHaveValue('SBM1061'));
    fireEvent.change(screen.getByLabelText(/customer/i), { target: { value: '1' } });
    fireEvent.click(screen.getByRole('button', { name: /save/i }));

    await waitFor(() => expect(api.uploadCollectionNoteSignature).toHaveBeenCalledTimes(1));

    expect(api.createCollectionNote).toHaveBeenCalledTimes(1);
    expect(api.uploadCollectionNoteSignature).toHaveBeenCalledWith(42, 'dispatched', expect.anything());
    // Records actual invocation order rather than merely checking both were
    // called, so a regression that issues an upload before the note id
    // exists (or races the create call) is caught.
    expect(callOrder).toEqual(['create', 'upload:dispatched:42']);
  });

  it('does not upload any signature when the pad has not been drawn on', async () => {
    signatureCanvasState.isEmpty = [true];
    render(<CollectionNoteEdit />, { wrapper: TestWrapper });
    await waitFor(() => expect(screen.getByLabelText(/^reference$/i)).toHaveValue('SBM1061'));
    fireEvent.change(screen.getByLabelText(/customer/i), { target: { value: '1' } });
    fireEvent.click(screen.getByRole('button', { name: /save/i }));

    await waitFor(() => expect(api.createCollectionNote).toHaveBeenCalledTimes(1));
    expect(api.uploadCollectionNoteSignature).not.toHaveBeenCalled();
  });

  it('still saves the note and keeps the user on the form when a signature upload fails', async () => {
    signatureCanvasState.isEmpty = [false];
    vi.mocked(api.uploadCollectionNoteSignature).mockRejectedValue(new Error('Signature upload failed'));

    render(<CollectionNoteEdit />, { wrapper: TestWrapper });
    await waitFor(() => expect(screen.getByLabelText(/^reference$/i)).toHaveValue('SBM1061'));
    fireEvent.change(screen.getByLabelText(/customer/i), { target: { value: '1' } });
    fireEvent.click(screen.getByRole('button', { name: /save/i }));

    await waitFor(() => expect(api.createCollectionNote).toHaveBeenCalledTimes(1));
    expect(api.uploadCollectionNoteSignature).toHaveBeenCalledTimes(1);

    // The user is told something went wrong, and crucially they are not
    // navigated away: the form (and its Save button) is still on screen,
    // which is what actually matters to someone stuck in a yard.
    expect(screen.getByRole('button', { name: /save/i })).toBeInTheDocument();
    expect(screen.getByLabelText(/^reference$/i)).toHaveValue('SBM1061');

    // Retrying must update the note the create already produced, not create
    // it again (which would trip the server's unique-reference check), and
    // must re-attempt the signature upload against that same id.
    vi.mocked(api.uploadCollectionNoteSignature).mockResolvedValue({} as never);
    fireEvent.click(screen.getByRole('button', { name: /save/i }));

    await waitFor(() => expect(api.updateCollectionNote).toHaveBeenCalledWith(7, expect.anything()));
    expect(api.createCollectionNote).toHaveBeenCalledTimes(1);
    expect(api.uploadCollectionNoteSignature).toHaveBeenLastCalledWith(7, 'dispatched', expect.anything());

    // The retry succeeded, so the earlier error is no longer shown.
    await waitFor(() => expect(screen.queryByText(/signature upload failed/i)).not.toBeInTheDocument());
  });
});
