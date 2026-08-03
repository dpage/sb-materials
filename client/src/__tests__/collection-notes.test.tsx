import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
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
    await waitFor(() => expect(screen.getByText('SBM1061')).toBeInTheDocument());
    expect(screen.getByText('Acme Recycling Ltd')).toBeInTheDocument();
    expect(screen.getByText('03/08/2026')).toBeInTheDocument();
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
    await waitFor(() => expect(screen.getByText('SBM1061')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: /delete/i }));
    expect(await screen.findByText(/are you sure/i)).toBeInTheDocument();
    expect(api.deleteCollectionNote).not.toHaveBeenCalled();
  });

  it('offers a PDF link for each note', async () => {
    render(<CollectionNotes />, { wrapper: TestWrapper });
    await waitFor(() => expect(screen.getByText('SBM1061')).toBeInTheDocument());
    expect(screen.getByRole('link', { name: /pdf/i })).toHaveAttribute('href', '/api/pdf/collection-note/1');
  });
});
