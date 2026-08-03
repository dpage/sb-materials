import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent, within } from '@testing-library/react';
import React from 'react';
import { MemoryRouter } from 'react-router-dom';
import { CollectionNotes } from '../pages/CollectionNotes';
import { HelpProvider } from '../components/HelpContext';

vi.mock('../api', () => ({
  api: {
    getCollectionNotes: vi.fn(),
    deleteCollectionNote: vi.fn(),
    getCustomers: vi.fn(),
    downloadCollectionNotePdf: (id: number) => `/api/pdf/collection-note/${id}`,
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
