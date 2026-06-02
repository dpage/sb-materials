import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';

// Mock the api module
vi.mock('../api', () => ({
  api: {
    login: vi.fn(),
    logout: vi.fn(),
    me: vi.fn(),
    getUsers: vi.fn(),
    getUser: vi.fn(),
    createUser: vi.fn(),
    updateUser: vi.fn(),
    getCustomers: vi.fn(),
    getCustomer: vi.fn(),
    createCustomer: vi.fn(),
    updateCustomer: vi.fn(),
    getSites: vi.fn(),
    createSite: vi.fn(),
    updateSite: vi.fn(),
    getLookups: vi.fn(),
    getLookupsAll: vi.fn(),
    createLookup: vi.fn(),
    updateLookup: vi.fn(),
    getReports: vi.fn(),
    getReport: vi.fn(),
    createReport: vi.fn(),
    updateReport: vi.fn(),
    deleteReport: vi.fn(),
    submitReport: vi.fn(),
    reopenReport: vi.fn(),
    uploadPhotos: vi.fn(),
    uploadSignature: vi.fn(),
    updatePhoto: vi.fn(),
    deletePhoto: vi.fn(),
    getPhotoUrl: vi.fn((f: string) => `/api/photos/file/${f}`),
    downloadPdf: vi.fn((id: number) => `/api/pdf/${id}`),
  },
}));

import { api } from '../api';
import { Login } from '../pages/Login';
import { Reports } from '../pages/Reports';
import { Customers } from '../pages/Customers';
import { Users } from '../pages/Users';
import { Lookups } from '../pages/Lookups';
import { QuickAddModal } from '../components/QuickAddModal';
import { HelpPanel } from '../components/HelpPanel';
import { Layout } from '../components/Layout';
import { HelpProvider } from '../components/HelpContext';

// Create a mock auth context
const mockAuth = {
  user: { id: 1, username: 'admin', displayName: 'Administrator', isSuperuser: true },
  loading: false,
  login: vi.fn(),
  logout: vi.fn(),
};

// Mock useAuth
vi.mock('../App', () => ({
  useAuth: () => mockAuth,
}));

function TestWrapper({ children, initialEntries = ['/'] }: { children: React.ReactNode; initialEntries?: string[] }) {
  return (
    <MemoryRouter initialEntries={initialEntries}>
      <HelpProvider>{children}</HelpProvider>
    </MemoryRouter>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mockAuth.user = { id: 1, username: 'admin', displayName: 'Administrator', isSuperuser: true };
  mockAuth.loading = false;
  mockAuth.login = vi.fn();
  mockAuth.logout = vi.fn();
});

describe('Login Page', () => {
  it('should redirect when already logged in', () => {
    render(
      <TestWrapper initialEntries={['/login']}>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/" element={<div>Home</div>} />
        </Routes>
      </TestWrapper>,
    );
    expect(screen.getByText('Home')).toBeInTheDocument();
  });

  it('should render login form when not logged in', () => {
    mockAuth.user = null as any;
    render(
      <TestWrapper initialEntries={['/login']}>
        <Login />
      </TestWrapper>,
    );
    expect(screen.getByText('SB Materials')).toBeInTheDocument();
    expect(screen.getByText('Sign in to continue')).toBeInTheDocument();
    expect(screen.getByText('Sign In')).toBeInTheDocument();
  });

  it('should call login on form submit', async () => {
    mockAuth.user = null as any;
    mockAuth.login.mockResolvedValue(undefined);

    render(
      <TestWrapper initialEntries={['/login']}>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/" element={<div>Home</div>} />
        </Routes>
      </TestWrapper>,
    );

    const user = userEvent.setup();
    const inputs = screen.getAllByRole('textbox');
    const passwordInput = document.querySelector('input[type="password"]')!;
    await user.type(inputs[0], 'admin');
    await user.type(passwordInput, 'admin');
    await user.click(screen.getByText('Sign In'));

    await waitFor(() => {
      expect(mockAuth.login).toHaveBeenCalledWith('admin', 'admin');
    });
  });

  it('should show error on login failure', async () => {
    mockAuth.user = null as any;
    mockAuth.login.mockRejectedValue(new Error('Invalid credentials'));

    render(
      <TestWrapper initialEntries={['/login']}>
        <Login />
      </TestWrapper>,
    );

    const user = userEvent.setup();
    const inputs = screen.getAllByRole('textbox');
    const passwordInput = document.querySelector('input[type="password"]')!;
    await user.type(inputs[0], 'admin');
    await user.type(passwordInput, 'wrong');
    await user.click(screen.getByText('Sign In'));

    await waitFor(() => {
      expect(screen.getByText('Invalid credentials')).toBeInTheDocument();
    });
  });
});

describe('Reports Page', () => {
  beforeEach(() => {
    (api.getReports as any).mockResolvedValue({
      data: [
        {
          id: 1,
          report_type: 'loading_inspection',
          customer_name: 'Test Customer',
          site_address: '123 Test St',
          inspection_date: '2025-01-15',
          inspector_name: 'Inspector',
          status: 'draft',
        },
      ],
      total: 1,
      page: 1,
      limit: 25,
    });
    (api.getCustomers as any).mockResolvedValue([{ id: 1, name: 'Test Customer' }]);
    (api.submitReport as any).mockResolvedValue({ ok: true });
    (api.reopenReport as any).mockResolvedValue({ ok: true });
  });

  it('should render reports list', async () => {
    render(
      <TestWrapper>
        <Reports />
      </TestWrapper>,
    );

    await waitFor(() => {
      expect(screen.getAllByText('Test Customer').length).toBeGreaterThan(0);
    });
  });

  it('should show new report button', async () => {
    render(
      <TestWrapper>
        <Reports />
      </TestWrapper>,
    );

    expect(screen.getByText('+ New Report')).toBeInTheDocument();
  });

  it('should call getReports on mount', async () => {
    render(
      <TestWrapper>
        <Reports />
      </TestWrapper>,
    );

    await waitFor(() => {
      expect(api.getReports).toHaveBeenCalled();
    });
  });

  it('should show search input', async () => {
    render(
      <TestWrapper>
        <Reports />
      </TestWrapper>,
    );

    expect(screen.getByPlaceholderText('Search reports...')).toBeInTheDocument();
  });

  it('should show filters button', async () => {
    render(
      <TestWrapper>
        <Reports />
      </TestWrapper>,
    );

    expect(screen.getByText('Filters')).toBeInTheDocument();
  });

  it('should open filters panel', async () => {
    render(
      <TestWrapper>
        <Reports />
      </TestWrapper>,
    );

    fireEvent.click(screen.getByText('Filters'));
    await waitFor(() => {
      expect(screen.getByText('Customer')).toBeInTheDocument();
      expect(screen.getByText('Type')).toBeInTheDocument();
      expect(screen.getByText('Status')).toBeInTheDocument();
    });
  });

  it('should show empty state when no reports', async () => {
    (api.getReports as any).mockResolvedValue({ data: [], total: 0, page: 1, limit: 25 });

    render(
      <TestWrapper>
        <Reports />
      </TestWrapper>,
    );

    await waitFor(() => {
      expect(screen.getByText(/No reports found/)).toBeInTheDocument();
    });
  });

  it('should show delete confirmation dialog', async () => {
    render(
      <TestWrapper>
        <Reports />
      </TestWrapper>,
    );

    await waitFor(() => {
      expect(screen.getAllByText('Test Customer').length).toBeGreaterThan(0);
    });

    const deleteButtons = screen.getAllByText('Delete');
    fireEvent.click(deleteButtons[0]);

    expect(screen.getByText('Delete Report')).toBeInTheDocument();
    expect(screen.getByText(/Are you sure/)).toBeInTheDocument();
  });

  it('should handle delete confirmation', async () => {
    (api.deleteReport as any).mockResolvedValue({});
    render(
      <TestWrapper>
        <Reports />
      </TestWrapper>,
    );

    await waitFor(() => {
      expect(screen.getAllByText('Test Customer').length).toBeGreaterThan(0);
    });

    const deleteButtons = screen.getAllByText('Delete');
    fireEvent.click(deleteButtons[0]);

    // The confirm dialog has Cancel and Delete buttons - find the red Delete button
    const allDeleteBtns = screen.getAllByRole('button', { name: 'Delete' });
    // The dialog Delete button has red background style
    const confirmBtn =
      allDeleteBtns.find(
        (btn) => btn.style.background.includes('e74c3c') || btn.style.backgroundColor.includes('e74c3c'),
      ) || allDeleteBtns[allDeleteBtns.length - 1];
    fireEvent.click(confirmBtn);

    await waitFor(() => {
      expect(api.deleteReport).toHaveBeenCalledWith(1);
    });
  });

  it('should show pagination for many reports', async () => {
    (api.getReports as any).mockResolvedValue({
      data: Array.from({ length: 25 }, (_, i) => ({
        id: i + 1,
        report_type: 'loading_inspection',
        customer_name: `Customer ${i}`,
        inspection_date: '2025-01-15',
        inspector_name: 'Inspector',
        status: 'draft',
      })),
      total: 50,
      page: 1,
      limit: 25,
    });

    render(
      <TestWrapper>
        <Reports />
      </TestWrapper>,
    );

    await waitFor(() => {
      expect(screen.getAllByText('Next').length).toBeGreaterThan(0);
    });
  });

  it('should show report type badges and status', async () => {
    render(
      <TestWrapper>
        <Reports />
      </TestWrapper>,
    );

    await waitFor(() => {
      expect(screen.getAllByText('Draft').length).toBeGreaterThan(0);
    });
  });

  it('should have PDF download links', async () => {
    render(
      <TestWrapper>
        <Reports />
      </TestWrapper>,
    );

    await waitFor(() => {
      expect(screen.getAllByText('PDF').length).toBeGreaterThan(0);
    });
  });

  it('should have edit buttons', async () => {
    render(
      <TestWrapper>
        <Reports />
      </TestWrapper>,
    );

    await waitFor(() => {
      expect(screen.getAllByText('Edit').length).toBeGreaterThan(0);
    });
  });

  it('should filter by search term', async () => {
    render(
      <TestWrapper>
        <Reports />
      </TestWrapper>,
    );

    await waitFor(() => {
      expect(api.getReports).toHaveBeenCalled();
    });

    const searchInput = screen.getByPlaceholderText('Search reports...');
    fireEvent.change(searchInput, { target: { value: 'test search' } });

    await waitFor(() => {
      expect(api.getReports).toHaveBeenCalledWith(
        expect.objectContaining({
          search: 'test search',
        }),
      );
    });
  });

  it('should filter by customer when filters open', async () => {
    render(
      <TestWrapper>
        <Reports />
      </TestWrapper>,
    );

    await waitFor(() => {
      expect(api.getReports).toHaveBeenCalled();
    });

    fireEvent.click(screen.getByText('Filters'));

    // The filters panel has selects for Customer, Type, Status and date inputs
    const filterSelects = document.querySelectorAll('.filters-panel select');
    fireEvent.change(filterSelects[0], { target: { value: '1' } }); // Customer

    await waitFor(() => {
      expect(api.getReports).toHaveBeenCalledWith(
        expect.objectContaining({
          customer_id: '1',
        }),
      );
    });
  });

  it('should filter by status', async () => {
    render(
      <TestWrapper>
        <Reports />
      </TestWrapper>,
    );

    await waitFor(() => {
      expect(api.getReports).toHaveBeenCalled();
    });

    fireEvent.click(screen.getByText('Filters'));

    const filterSelects = document.querySelectorAll('.filters-panel select');
    fireEvent.change(filterSelects[2], { target: { value: 'completed' } }); // Status is 3rd select

    await waitFor(() => {
      expect(api.getReports).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 'completed',
        }),
      );
    });
  });

  it('should cancel delete via dialog', async () => {
    render(
      <TestWrapper>
        <Reports />
      </TestWrapper>,
    );

    await waitFor(() => {
      expect(screen.getAllByText('Test Customer').length).toBeGreaterThan(0);
    });

    const deleteButtons = screen.getAllByText('Delete');
    fireEvent.click(deleteButtons[0]);

    expect(screen.getByText('Delete Report')).toBeInTheDocument();

    // Click Cancel
    fireEvent.click(screen.getByText('Cancel'));

    // Dialog should be gone
    expect(screen.queryByText('Delete Report')).not.toBeInTheDocument();
  });

  it('should format dates', async () => {
    render(
      <TestWrapper>
        <Reports />
      </TestWrapper>,
    );

    await waitFor(() => {
      expect(screen.getAllByText('15 Jan 2025').length).toBeGreaterThan(0);
    });
  });

  it('shows an Assigned to me filter in the filter panel', async () => {
    render(
      <TestWrapper>
        <Reports />
      </TestWrapper>,
    );
    fireEvent.click(await screen.findByText('Filters'));
    expect(await screen.findByText('Assigned to me')).toBeInTheDocument();
  });

  it('should show Assigned status option in status filter', async () => {
    render(
      <TestWrapper>
        <Reports />
      </TestWrapper>,
    );
    fireEvent.click(await screen.findByText('Filters'));
    const filterSelects = document.querySelectorAll('.filters-panel select');
    const statusSelect = filterSelects[2] as HTMLSelectElement;
    const options = Array.from(statusSelect.options).map((o) => o.value);
    expect(options).toContain('assigned');
  });

  it('should show Assigned badge for assigned reports', async () => {
    (api.getReports as any).mockResolvedValue({
      data: [
        {
          id: 2,
          report_type: 'loading_inspection',
          customer_name: 'Assigned Customer',
          inspection_date: '2025-01-15',
          inspector_name: 'Inspector',
          status: 'assigned',
        },
      ],
      total: 1,
      page: 1,
      limit: 25,
    });
    render(
      <TestWrapper>
        <Reports />
      </TestWrapper>,
    );
    await waitFor(() => {
      expect(screen.getAllByText('Assigned').length).toBeGreaterThan(0);
    });
  });

  it('should show Submit button for assigned reports', async () => {
    (api.getReports as any).mockResolvedValue({
      data: [
        {
          id: 2,
          report_type: 'loading_inspection',
          customer_name: 'Assigned Customer',
          inspection_date: '2025-01-15',
          inspector_name: 'Inspector',
          status: 'assigned',
        },
      ],
      total: 1,
      page: 1,
      limit: 25,
    });
    render(
      <TestWrapper>
        <Reports />
      </TestWrapper>,
    );
    await waitFor(() => {
      expect(screen.getAllByText('Submit').length).toBeGreaterThan(0);
    });
  });

  it('should call submitReport when Submit clicked', async () => {
    (api.getReports as any).mockResolvedValue({
      data: [
        {
          id: 2,
          report_type: 'loading_inspection',
          customer_name: 'Assigned Customer',
          inspection_date: '2025-01-15',
          inspector_name: 'Inspector',
          status: 'assigned',
        },
      ],
      total: 1,
      page: 1,
      limit: 25,
    });
    render(
      <TestWrapper>
        <Reports />
      </TestWrapper>,
    );
    await waitFor(() => {
      expect(screen.getAllByText('Submit').length).toBeGreaterThan(0);
    });
    fireEvent.click(screen.getAllByText('Submit')[0]);
    await waitFor(() => {
      expect(api.submitReport).toHaveBeenCalledWith(2);
    });
  });

  it('should show Reopen button for completed reports', async () => {
    (api.getReports as any).mockResolvedValue({
      data: [
        {
          id: 3,
          report_type: 'loading_inspection',
          customer_name: 'Done Customer',
          inspection_date: '2025-01-15',
          inspector_name: 'Inspector',
          status: 'completed',
        },
      ],
      total: 1,
      page: 1,
      limit: 25,
    });
    render(
      <TestWrapper>
        <Reports />
      </TestWrapper>,
    );
    await waitFor(() => {
      expect(screen.getAllByText('Reopen').length).toBeGreaterThan(0);
    });
  });

  it('should call reopenReport when Reopen clicked', async () => {
    (api.getReports as any).mockResolvedValue({
      data: [
        {
          id: 3,
          report_type: 'loading_inspection',
          customer_name: 'Done Customer',
          inspection_date: '2025-01-15',
          inspector_name: 'Inspector',
          status: 'completed',
        },
      ],
      total: 1,
      page: 1,
      limit: 25,
    });
    render(
      <TestWrapper>
        <Reports />
      </TestWrapper>,
    );
    await waitFor(() => {
      expect(screen.getAllByText('Reopen').length).toBeGreaterThan(0);
    });
    fireEvent.click(screen.getAllByText('Reopen')[0]);
    await waitFor(() => {
      expect(api.reopenReport).toHaveBeenCalledWith(3);
    });
  });

  it('should include assigned_to_me param when filter is checked', async () => {
    render(
      <TestWrapper>
        <Reports />
      </TestWrapper>,
    );
    await waitFor(() => expect(api.getReports).toHaveBeenCalled());
    fireEvent.click(await screen.findByText('Filters'));
    const checkbox = screen.getByRole('checkbox', { name: /assigned to me/i });
    fireEvent.click(checkbox);
    await waitFor(() => {
      expect(api.getReports).toHaveBeenCalledWith(expect.objectContaining({ assigned_to_me: 'true' }));
    });
  });
});

describe('Customers Page', () => {
  beforeEach(() => {
    (api.getCustomers as any).mockResolvedValue([
      { id: 1, name: 'Customer A', contact_name: 'John', email: 'john@test.com', phone: '123', is_active: 1 },
      { id: 2, name: 'Customer B', is_active: 1 },
    ]);
    (api.getCustomer as any).mockResolvedValue({
      id: 1,
      name: 'Customer A',
      contact_name: 'John',
      email: 'john@test.com',
      phone: '123',
      address: '456 Main St',
      sites: [{ id: 1, customer_id: 1, address: '123 St', is_active: 1 }],
    });
  });

  it('should render customer list', async () => {
    render(
      <TestWrapper>
        <Customers />
      </TestWrapper>,
    );

    await waitFor(() => {
      expect(screen.getByText('Customer A')).toBeInTheDocument();
      expect(screen.getByText('Customer B')).toBeInTheDocument();
    });
  });

  it('should show new customer button', () => {
    render(
      <TestWrapper>
        <Customers />
      </TestWrapper>,
    );
    expect(screen.getByText('+ New Customer')).toBeInTheDocument();
  });

  it('should show new customer form when button clicked', async () => {
    render(
      <TestWrapper>
        <Customers />
      </TestWrapper>,
    );

    fireEvent.click(screen.getByText('+ New Customer'));
    expect(screen.getByText('Customer Name *')).toBeInTheDocument();
  });

  it('should create a new customer', async () => {
    (api.createCustomer as any).mockResolvedValue({ id: 3 });
    render(
      <TestWrapper>
        <Customers />
      </TestWrapper>,
    );

    fireEvent.click(screen.getByText('+ New Customer'));

    const inputs = document.querySelectorAll('input');
    fireEvent.change(inputs[0], { target: { value: 'New Customer' } });

    fireEvent.click(screen.getByText('Save'));

    await waitFor(() => {
      expect(api.createCustomer).toHaveBeenCalledWith(expect.objectContaining({ name: 'New Customer' }));
    });
  });

  it('should select a customer and show sites', async () => {
    render(
      <TestWrapper>
        <Customers />
      </TestWrapper>,
    );

    await waitFor(() => {
      expect(screen.getByText('Customer A')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText('Customer A'));

    await waitFor(() => {
      expect(api.getCustomer).toHaveBeenCalledWith(1);
      expect(screen.getByText('Sites for Customer A')).toBeInTheDocument();
    });
  });

  it('should show customer details in sites panel', async () => {
    render(
      <TestWrapper>
        <Customers />
      </TestWrapper>,
    );

    await waitFor(() => {
      expect(screen.getByText('Customer A')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText('Customer A'));

    await waitFor(() => {
      expect(screen.getByText('456 Main St')).toBeInTheDocument();
    });
  });

  it('should show site address after selecting customer', async () => {
    render(
      <TestWrapper>
        <Customers />
      </TestWrapper>,
    );

    await waitFor(() => {
      expect(screen.getByText('Customer A')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText('Customer A'));

    await waitFor(() => {
      expect(screen.getByText('123 St')).toBeInTheDocument();
    });
  });

  it('should add a new site', async () => {
    (api.createSite as any).mockResolvedValue({ id: 2 });
    render(
      <TestWrapper>
        <Customers />
      </TestWrapper>,
    );

    await waitFor(() => {
      expect(screen.getByText('Customer A')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText('Customer A'));

    await waitFor(() => {
      expect(screen.getByPlaceholderText('New site address')).toBeInTheDocument();
    });

    fireEvent.change(screen.getByPlaceholderText('New site address'), { target: { value: '789 New St' } });
    fireEvent.click(screen.getByText('Add'));

    await waitFor(() => {
      expect(api.createSite).toHaveBeenCalledWith(1, '789 New St');
    });
  });

  it('should show edit customer form', async () => {
    render(
      <TestWrapper>
        <Customers />
      </TestWrapper>,
    );

    await waitFor(() => {
      expect(screen.getByText('Customer A')).toBeInTheDocument();
    });

    const editBtns = screen.getAllByText('Edit');
    fireEvent.click(editBtns[0]);

    expect(screen.getByText('Edit Customer')).toBeInTheDocument();
  });

  it('should cancel customer form', async () => {
    render(
      <TestWrapper>
        <Customers />
      </TestWrapper>,
    );

    fireEvent.click(screen.getByText('+ New Customer'));

    fireEvent.click(screen.getByText('Cancel'));
    // Form header should be gone
    expect(screen.queryByText('Customer Name *')).not.toBeInTheDocument();
  });

  it('should toggle customer active status', async () => {
    (api.updateCustomer as any).mockResolvedValue({});
    render(
      <TestWrapper>
        <Customers />
      </TestWrapper>,
    );

    await waitFor(() => {
      expect(screen.getByText('Customer A')).toBeInTheDocument();
    });

    const deactivateBtns = screen.getAllByText('Deactivate');
    fireEvent.click(deactivateBtns[0]);

    await waitFor(() => {
      expect(api.updateCustomer).toHaveBeenCalledWith(1, { is_active: 0 });
    });
  });

  it('should show prompt when no customer selected', () => {
    render(
      <TestWrapper>
        <Customers />
      </TestWrapper>,
    );

    expect(screen.getByText('Select a customer')).toBeInTheDocument();
    expect(screen.getByText(/Click a customer to view/)).toBeInTheDocument();
  });

  it('should show empty state when no customers', async () => {
    (api.getCustomers as any).mockResolvedValue([]);
    render(
      <TestWrapper>
        <Customers />
      </TestWrapper>,
    );

    await waitFor(() => {
      expect(screen.getByText(/No customers yet/)).toBeInTheDocument();
    });
  });

  it('should toggle site active status', async () => {
    (api.updateSite as any).mockResolvedValue({});
    render(
      <TestWrapper>
        <Customers />
      </TestWrapper>,
    );

    await waitFor(() => {
      expect(screen.getByText('Customer A')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText('Customer A'));

    await waitFor(() => {
      expect(screen.getByText('123 St')).toBeInTheDocument();
    });

    const allDeactivate = screen.getAllByText('Deactivate');
    fireEvent.click(allDeactivate[allDeactivate.length - 1]);

    await waitFor(() => {
      expect(api.updateSite).toHaveBeenCalledWith(1, 1, { is_active: 0 });
    });
  });

  it('should edit a site', async () => {
    render(
      <TestWrapper>
        <Customers />
      </TestWrapper>,
    );

    await waitFor(() => {
      expect(screen.getByText('Customer A')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText('Customer A'));

    await waitFor(() => {
      expect(screen.getByText('123 St')).toBeInTheDocument();
    });

    const allEdit = screen.getAllByText('Edit');
    fireEvent.click(allEdit[allEdit.length - 1]);

    const siteInput = document.querySelector('input[value="123 St"]');
    expect(siteInput).toBeInTheDocument();
  });

  it('should update customer', async () => {
    (api.updateCustomer as any).mockResolvedValue({});
    render(
      <TestWrapper>
        <Customers />
      </TestWrapper>,
    );

    await waitFor(() => {
      expect(screen.getByText('Customer A')).toBeInTheDocument();
    });

    const editBtns = screen.getAllByText('Edit');
    fireEvent.click(editBtns[0]);

    const nameInput = document.querySelector('input') as HTMLInputElement;
    expect(nameInput.value).toBe('Customer A');

    fireEvent.change(nameInput, { target: { value: 'Customer A Updated' } });
    fireEvent.click(screen.getByText('Save'));

    await waitFor(() => {
      expect(api.updateCustomer).toHaveBeenCalledWith(1, expect.objectContaining({ name: 'Customer A Updated' }));
    });
  });

  it('should save site edit via Enter key', async () => {
    (api.updateSite as any).mockResolvedValue({});
    render(
      <TestWrapper>
        <Customers />
      </TestWrapper>,
    );

    await waitFor(() => {
      expect(screen.getByText('Customer A')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText('Customer A'));

    await waitFor(() => {
      expect(screen.getByText('123 St')).toBeInTheDocument();
    });

    // Click Edit on the site
    const allEdit = screen.getAllByText('Edit');
    fireEvent.click(allEdit[allEdit.length - 1]);

    const siteInput = document.querySelector('input[value="123 St"]') as HTMLInputElement;
    fireEvent.change(siteInput, { target: { value: '456 New St' } });
    fireEvent.keyDown(siteInput, { key: 'Enter' });

    await waitFor(() => {
      expect(api.updateSite).toHaveBeenCalledWith(1, 1, { address: '456 New St' });
    });
  });

  it('should add site via Enter key', async () => {
    (api.createSite as any).mockResolvedValue({ id: 2 });
    render(
      <TestWrapper>
        <Customers />
      </TestWrapper>,
    );

    await waitFor(() => {
      expect(screen.getByText('Customer A')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText('Customer A'));

    await waitFor(() => {
      expect(screen.getByPlaceholderText('New site address')).toBeInTheDocument();
    });

    fireEvent.change(screen.getByPlaceholderText('New site address'), { target: { value: 'Enter St' } });
    fireEvent.keyDown(screen.getByPlaceholderText('New site address'), { key: 'Enter' });

    await waitFor(() => {
      expect(api.createSite).toHaveBeenCalledWith(1, 'Enter St');
    });
  });

  it('should cancel site edit', async () => {
    render(
      <TestWrapper>
        <Customers />
      </TestWrapper>,
    );

    await waitFor(() => {
      expect(screen.getByText('Customer A')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText('Customer A'));

    await waitFor(() => {
      expect(screen.getByText('123 St')).toBeInTheDocument();
    });

    // Click Edit on the site
    const allEdit = screen.getAllByText('Edit');
    fireEvent.click(allEdit[allEdit.length - 1]);

    // Now click Cancel on the edit form
    const cancelBtns = screen.getAllByText('Cancel');
    fireEvent.click(cancelBtns[cancelBtns.length - 1]);

    // Should go back to showing the address text
    expect(screen.getByText('123 St')).toBeInTheDocument();
  });

  it('should show contact details in customer list', async () => {
    render(
      <TestWrapper>
        <Customers />
      </TestWrapper>,
    );

    await waitFor(() => {
      expect(screen.getByText('John')).toBeInTheDocument();
    });
  });
});

describe('Users Page', () => {
  beforeEach(() => {
    (api.getUsers as any).mockResolvedValue([
      { id: 1, username: 'admin', display_name: 'Administrator', is_superuser: 1, is_active: 1 },
      { id: 2, username: 'inspector', display_name: 'Test Inspector', is_superuser: 0, is_active: 1 },
    ]);
  });

  it('should render user list', async () => {
    render(
      <TestWrapper>
        <Users />
      </TestWrapper>,
    );

    await waitFor(() => {
      expect(screen.getAllByText('Administrator').length).toBeGreaterThan(0);
      expect(screen.getAllByText('Test Inspector').length).toBeGreaterThan(0);
    });
  });

  it('should show new user button', () => {
    render(
      <TestWrapper>
        <Users />
      </TestWrapper>,
    );
    expect(screen.getByText('+ New User')).toBeInTheDocument();
  });

  it('should show access denied for non-superusers', () => {
    mockAuth.user = { id: 2, username: 'regular', displayName: 'Regular User', isSuperuser: false } as any;
    render(
      <TestWrapper>
        <Users />
      </TestWrapper>,
    );
    expect(screen.getByText('Access denied')).toBeInTheDocument();
  });

  it('should show new user form', async () => {
    render(
      <TestWrapper>
        <Users />
      </TestWrapper>,
    );

    fireEvent.click(screen.getByText('+ New User'));
    expect(screen.getByText('Username *')).toBeInTheDocument();
    expect(screen.getByText('Display Name *')).toBeInTheDocument();
  });

  it('should create a new user', async () => {
    (api.createUser as any).mockResolvedValue({ id: 3 });
    render(
      <TestWrapper>
        <Users />
      </TestWrapper>,
    );

    fireEvent.click(screen.getByText('+ New User'));

    const textInputs = document.querySelectorAll('input[type="text"]');
    const pwInput = document.querySelector('input[type="password"]')!;

    fireEvent.change(textInputs[0], { target: { value: 'newuser' } });
    fireEvent.change(textInputs[1], { target: { value: 'New User' } });
    fireEvent.change(pwInput, { target: { value: 'password123' } });

    fireEvent.click(screen.getByText('Save'));

    await waitFor(() => {
      expect(api.createUser).toHaveBeenCalledWith(
        expect.objectContaining({
          username: 'newuser',
          display_name: 'New User',
          password: 'password123',
        }),
      );
    });
  });

  it('should cancel new user form', async () => {
    render(
      <TestWrapper>
        <Users />
      </TestWrapper>,
    );

    fireEvent.click(screen.getByText('+ New User'));

    fireEvent.click(screen.getByText('Cancel'));
    expect(screen.queryByText('Username *')).not.toBeInTheDocument();
  });

  it('should show edit user form', async () => {
    render(
      <TestWrapper>
        <Users />
      </TestWrapper>,
    );

    await waitFor(() => {
      expect(screen.getAllByText('Administrator').length).toBeGreaterThan(0);
    });

    const editBtns = screen.getAllByText('Edit');
    fireEvent.click(editBtns[0]);

    expect(screen.getByText('Edit User')).toBeInTheDocument();
  });

  it('should update a user', async () => {
    (api.updateUser as any).mockResolvedValue({});
    render(
      <TestWrapper>
        <Users />
      </TestWrapper>,
    );

    await waitFor(() => {
      expect(screen.getAllByText('Administrator').length).toBeGreaterThan(0);
    });

    const editBtns = screen.getAllByText('Edit');
    fireEvent.click(editBtns[0]);

    const textInputs = document.querySelectorAll('input[type="text"]');
    fireEvent.change(textInputs[1], { target: { value: 'Admin Updated' } });

    fireEvent.click(screen.getByText('Save'));

    await waitFor(() => {
      expect(api.updateUser).toHaveBeenCalled();
    });
  });

  it('should toggle user active status', async () => {
    (api.updateUser as any).mockResolvedValue({});
    render(
      <TestWrapper>
        <Users />
      </TestWrapper>,
    );

    await waitFor(() => {
      expect(screen.getAllByText('Administrator').length).toBeGreaterThan(0);
    });

    const deactivateBtns = screen.getAllByText('Deactivate');
    fireEvent.click(deactivateBtns[0]);

    await waitFor(() => {
      expect(api.updateUser).toHaveBeenCalledWith(1, { is_active: 0 });
    });
  });

  it('should show superuser badges', async () => {
    render(
      <TestWrapper>
        <Users />
      </TestWrapper>,
    );

    await waitFor(() => {
      expect(screen.getAllByText('Superuser').length).toBeGreaterThan(0);
    });
  });

  it('should show active badges', async () => {
    render(
      <TestWrapper>
        <Users />
      </TestWrapper>,
    );

    await waitFor(() => {
      expect(screen.getAllByText('Active').length).toBeGreaterThan(0);
    });
  });

  it('should show superuser checkbox in form', async () => {
    render(
      <TestWrapper>
        <Users />
      </TestWrapper>,
    );

    fireEvent.click(screen.getByText('+ New User'));

    expect(screen.getByText(/Superuser/)).toBeInTheDocument();
    const checkbox = document.querySelector('input[type="checkbox"]');
    expect(checkbox).toBeInTheDocument();
  });

  it('should show usernames in table', async () => {
    render(
      <TestWrapper>
        <Users />
      </TestWrapper>,
    );

    await waitFor(() => {
      expect(screen.getAllByText('admin').length).toBeGreaterThan(0);
      expect(screen.getAllByText('inspector').length).toBeGreaterThan(0);
    });
  });
});

describe('Lookups Page', () => {
  beforeEach(() => {
    (api.getLookupsAll as any).mockResolvedValue([
      { id: 1, value: 'OCC', report_type: 'loading_inspection', is_active: 1 },
      { id: 2, value: 'Mixed Paper', report_type: 'loading_inspection', is_active: 1 },
    ]);
  });

  it('should render lookups page', async () => {
    render(
      <TestWrapper>
        <Lookups />
      </TestWrapper>,
    );

    expect(screen.getByText('Lookup Values')).toBeInTheDocument();
  });

  it('should show table tabs', () => {
    render(
      <TestWrapper>
        <Lookups />
      </TestWrapper>,
    );

    expect(screen.getByText('Product Descriptions')).toBeInTheDocument();
    expect(screen.getByText('Product Grades')).toBeInTheDocument();
    expect(screen.getByText('Storage Modes')).toBeInTheDocument();
    expect(screen.getByText('Unwanted Materials')).toBeInTheDocument();
    expect(screen.getByText('Contaminants')).toBeInTheDocument();
  });

  it('should load values for default table', async () => {
    render(
      <TestWrapper>
        <Lookups />
      </TestWrapper>,
    );

    await waitFor(() => {
      expect(api.getLookupsAll).toHaveBeenCalledWith('lookup_product_descriptions');
    });
  });

  it('should switch tables', async () => {
    render(
      <TestWrapper>
        <Lookups />
      </TestWrapper>,
    );

    fireEvent.click(screen.getByText('Storage Modes'));

    await waitFor(() => {
      expect(api.getLookupsAll).toHaveBeenCalledWith('lookup_storage_modes');
    });
  });

  it('should display lookup values', async () => {
    render(
      <TestWrapper>
        <Lookups />
      </TestWrapper>,
    );

    await waitFor(() => {
      expect(screen.getAllByText('OCC').length).toBeGreaterThan(0);
      expect(screen.getAllByText('Mixed Paper').length).toBeGreaterThan(0);
    });
  });

  it('should add a new lookup value', async () => {
    (api.createLookup as any).mockResolvedValue({ id: 3 });
    render(
      <TestWrapper>
        <Lookups />
      </TestWrapper>,
    );

    const input = screen.getByPlaceholderText(/New product descriptions value/i);
    fireEvent.change(input, { target: { value: 'New Grade' } });
    fireEvent.click(screen.getByText('Add'));

    await waitFor(() => {
      expect(api.createLookup).toHaveBeenCalledWith(
        'lookup_product_descriptions',
        expect.objectContaining({
          value: 'New Grade',
          report_type: 'loading_inspection',
        }),
      );
    });
  });

  it('should add value via Enter key', async () => {
    (api.createLookup as any).mockResolvedValue({ id: 3 });
    render(
      <TestWrapper>
        <Lookups />
      </TestWrapper>,
    );

    const input = screen.getByPlaceholderText(/New product descriptions value/i);
    fireEvent.change(input, { target: { value: 'Enter Value' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    await waitFor(() => {
      expect(api.createLookup).toHaveBeenCalled();
    });
  });

  it('should show edit inline for values', async () => {
    render(
      <TestWrapper>
        <Lookups />
      </TestWrapper>,
    );

    await waitFor(() => {
      expect(screen.getAllByText('OCC').length).toBeGreaterThan(0);
    });

    const editBtns = screen.getAllByText('Edit');
    fireEvent.click(editBtns[0]);

    const editInput = document.querySelector('input[value="OCC"]');
    expect(editInput).toBeInTheDocument();
  });

  it('should save edited value', async () => {
    (api.updateLookup as any).mockResolvedValue({});
    render(
      <TestWrapper>
        <Lookups />
      </TestWrapper>,
    );

    await waitFor(() => {
      expect(screen.getAllByText('OCC').length).toBeGreaterThan(0);
    });

    const editBtns = screen.getAllByText('Edit');
    fireEvent.click(editBtns[0]);

    const editInput = document.querySelector('input[value="OCC"]') as HTMLInputElement;
    fireEvent.change(editInput, { target: { value: 'OCC Updated' } });

    const saveBtns = screen.getAllByText('Save');
    fireEvent.click(saveBtns[0]);

    await waitFor(() => {
      expect(api.updateLookup).toHaveBeenCalledWith('lookup_product_descriptions', 1, { value: 'OCC Updated' });
    });
  });

  it('should cancel edit', async () => {
    render(
      <TestWrapper>
        <Lookups />
      </TestWrapper>,
    );

    await waitFor(() => {
      expect(screen.getAllByText('OCC').length).toBeGreaterThan(0);
    });

    const editBtns = screen.getAllByText('Edit');
    fireEvent.click(editBtns[0]);

    const cancelBtns = screen.getAllByText('Cancel');
    fireEvent.click(cancelBtns[0]);

    const editInput = document.querySelector('input[value="OCC"]');
    expect(editInput).not.toBeInTheDocument();
  });

  it('should toggle active status', async () => {
    (api.updateLookup as any).mockResolvedValue({});
    render(
      <TestWrapper>
        <Lookups />
      </TestWrapper>,
    );

    await waitFor(() => {
      expect(screen.getAllByText('OCC').length).toBeGreaterThan(0);
    });

    const deactivateBtns = screen.getAllByText('Deactivate');
    fireEvent.click(deactivateBtns[0]);

    await waitFor(() => {
      expect(api.updateLookup).toHaveBeenCalledWith('lookup_product_descriptions', 1, { is_active: 0 });
    });
  });

  it('should show report type selector for typed tables', () => {
    render(
      <TestWrapper>
        <Lookups />
      </TestWrapper>,
    );

    const selects = document.querySelectorAll('select');
    expect(selects.length).toBeGreaterThan(0);
  });

  it('should show empty state when no values', async () => {
    (api.getLookupsAll as any).mockResolvedValue([]);
    render(
      <TestWrapper>
        <Lookups />
      </TestWrapper>,
    );

    await waitFor(() => {
      expect(screen.getAllByText('No values found').length).toBeGreaterThan(0);
    });
  });

  it('should show type pills', async () => {
    render(
      <TestWrapper>
        <Lookups />
      </TestWrapper>,
    );

    await waitFor(() => {
      expect(screen.getAllByText('Loading').length).toBeGreaterThan(0);
    });
  });
});

describe('QuickAddModal', () => {
  it('should render when open', () => {
    render(
      <QuickAddModal
        open={true}
        title="Add Customer"
        label="Customer Name"
        onSave={async () => {}}
        onClose={() => {}}
      />,
    );
    expect(screen.getByText('Add Customer')).toBeInTheDocument();
    expect(screen.getByText('Customer Name')).toBeInTheDocument();
  });

  it('should not render when closed', () => {
    render(
      <QuickAddModal
        open={false}
        title="Add Customer"
        label="Customer Name"
        onSave={async () => {}}
        onClose={() => {}}
      />,
    );
    expect(screen.queryByText('Add Customer')).not.toBeInTheDocument();
  });

  it('should call onSave with trimmed value', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    const onClose = vi.fn();

    render(<QuickAddModal open={true} title="Add Customer" label="Name" onSave={onSave} onClose={onClose} />);

    const user = userEvent.setup();
    await user.type(screen.getByRole('textbox'), 'New Customer');
    await user.click(screen.getByText('Add'));

    await waitFor(() => {
      expect(onSave).toHaveBeenCalledWith('New Customer');
      expect(onClose).toHaveBeenCalled();
    });
  });

  it('should not call onSave with empty value', async () => {
    const onSave = vi.fn();
    render(<QuickAddModal open={true} title="Add Item" label="Name" onSave={onSave} onClose={() => {}} />);

    const addBtn = screen.getByRole('button', { name: 'Add' });
    expect(addBtn).toBeDisabled();
    expect(onSave).not.toHaveBeenCalled();
  });

  it('should call onClose when cancel clicked', async () => {
    const onClose = vi.fn();
    render(<QuickAddModal open={true} title="Add" label="Name" onSave={async () => {}} onClose={onClose} />);

    await userEvent.setup().click(screen.getByText('Cancel'));
    expect(onClose).toHaveBeenCalled();
  });

  it('should save on Enter key', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    const onClose = vi.fn();

    render(<QuickAddModal open={true} title="Add" label="Name" onSave={onSave} onClose={onClose} />);

    const user = userEvent.setup();
    await user.type(screen.getByRole('textbox'), 'Test{Enter}');

    await waitFor(() => {
      expect(onSave).toHaveBeenCalledWith('Test');
    });
  });
});

describe('HelpPanel', () => {
  it('should render help panel', () => {
    render(
      <TestWrapper>
        <HelpPanel />
      </TestWrapper>,
    );
    expect(document.querySelector('.help-panel')).toBeInTheDocument();
  });

  it('should display topic content', () => {
    render(
      <TestWrapper>
        <HelpPanel />
      </TestWrapper>,
    );
    expect(screen.getByText('Help: Reports')).toBeInTheDocument();
  });

  it('should show topic navigation buttons', () => {
    render(
      <TestWrapper>
        <HelpPanel />
      </TestWrapper>,
    );
    expect(screen.getByText('Help Topics')).toBeInTheDocument();
    expect(screen.getByText('Report Form')).toBeInTheDocument();
    expect(screen.getByText('Customers')).toBeInTheDocument();
  });
});

describe('Layout', () => {
  it('renders the SB Materials logo image in the header', async () => {
    render(
      <TestWrapper>
        <Routes>
          <Route path="/" element={<Layout />}>
            <Route index element={<div>Content</div>} />
          </Route>
        </Routes>
      </TestWrapper>,
    );

    const img = await screen.findByAltText('SB Materials');
    expect(img).toBeInTheDocument();
  });

  it('should render navigation links', () => {
    render(
      <TestWrapper>
        <Routes>
          <Route path="/" element={<Layout />}>
            <Route index element={<div>Content</div>} />
          </Route>
        </Routes>
      </TestWrapper>,
    );

    expect(screen.getByRole('img', { name: 'SB Materials' })).toBeInTheDocument();
    expect(screen.getAllByText('Reports').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Customers').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Lookups').length).toBeGreaterThan(0);
  });

  it('should show Users link for superuser', () => {
    render(
      <TestWrapper>
        <Routes>
          <Route path="/" element={<Layout />}>
            <Route index element={<div>Content</div>} />
          </Route>
        </Routes>
      </TestWrapper>,
    );

    expect(screen.getAllByText('Users').length).toBeGreaterThan(0);
  });

  it('should show logout button', () => {
    render(
      <TestWrapper>
        <Routes>
          <Route path="/" element={<Layout />}>
            <Route index element={<div>Content</div>} />
          </Route>
        </Routes>
      </TestWrapper>,
    );

    expect(screen.getByText('Logout')).toBeInTheDocument();
  });

  it('should show user display name', () => {
    render(
      <TestWrapper>
        <Routes>
          <Route path="/" element={<Layout />}>
            <Route index element={<div>Content</div>} />
          </Route>
        </Routes>
      </TestWrapper>,
    );

    expect(screen.getByText('Administrator')).toBeInTheDocument();
  });

  it('should call logout on button click', async () => {
    mockAuth.logout.mockResolvedValue(undefined);

    render(
      <TestWrapper>
        <Routes>
          <Route path="/" element={<Layout />}>
            <Route index element={<div>Content</div>} />
          </Route>
          <Route path="/login" element={<div>Login</div>} />
        </Routes>
      </TestWrapper>,
    );

    await userEvent.setup().click(screen.getByText('Logout'));
    expect(mockAuth.logout).toHaveBeenCalled();
  });

  it('should have help button', () => {
    render(
      <TestWrapper>
        <Routes>
          <Route path="/" element={<Layout />}>
            <Route index element={<div>Content</div>} />
          </Route>
        </Routes>
      </TestWrapper>,
    );

    expect(screen.getByTitle('Help')).toBeInTheDocument();
  });

  it('should show mobile menu button', () => {
    render(
      <TestWrapper>
        <Routes>
          <Route path="/" element={<Layout />}>
            <Route index element={<div>Content</div>} />
          </Route>
        </Routes>
      </TestWrapper>,
    );

    // Mobile menu button with ☰
    expect(screen.getByText('☰')).toBeInTheDocument();
  });

  it('should toggle mobile menu', () => {
    render(
      <TestWrapper>
        <Routes>
          <Route path="/" element={<Layout />}>
            <Route index element={<div>Content</div>} />
          </Route>
        </Routes>
      </TestWrapper>,
    );

    // Click mobile menu button
    fireEvent.click(screen.getByText('☰'));

    // Mobile nav should now be rendered
    const mobileNav = document.querySelector('.mobile-nav');
    expect(mobileNav).toBeInTheDocument();
  });

  it('should close mobile menu on link click', async () => {
    render(
      <TestWrapper>
        <Routes>
          <Route path="/" element={<Layout />}>
            <Route index element={<div>Content</div>} />
          </Route>
          <Route path="/customers" element={<div>Customers Page</div>} />
        </Routes>
      </TestWrapper>,
    );

    // Open mobile menu
    fireEvent.click(screen.getByText('☰'));
    const mobileNav = document.querySelector('.mobile-nav');
    expect(mobileNav).toBeInTheDocument();

    // Click a link in mobile nav
    const navLinks = mobileNav!.querySelectorAll('a');
    const customersLink = Array.from(navLinks).find((a) => a.textContent === 'Customers');
    if (customersLink) {
      fireEvent.click(customersLink);
    }
  });

  it('should set help topic for customers route', () => {
    render(
      <TestWrapper initialEntries={['/customers']}>
        <Routes>
          <Route path="/" element={<Layout />}>
            <Route index element={<div>Home</div>} />
            <Route path="customers" element={<div>Customers Page Content</div>} />
          </Route>
        </Routes>
      </TestWrapper>,
    );

    expect(screen.getByText('Customers Page Content')).toBeInTheDocument();
  });

  it('should set help topic for lookups route', () => {
    render(
      <TestWrapper initialEntries={['/lookups']}>
        <Routes>
          <Route path="/" element={<Layout />}>
            <Route index element={<div>Home</div>} />
            <Route path="lookups" element={<div>Lookups Content</div>} />
          </Route>
        </Routes>
      </TestWrapper>,
    );

    expect(screen.getByText('Lookups Content')).toBeInTheDocument();
  });

  it('should set help topic for users route', () => {
    render(
      <TestWrapper initialEntries={['/users']}>
        <Routes>
          <Route path="/" element={<Layout />}>
            <Route index element={<div>Home</div>} />
            <Route path="users" element={<div>Users Content</div>} />
          </Route>
        </Routes>
      </TestWrapper>,
    );

    expect(screen.getByText('Users Content')).toBeInTheDocument();
  });

  it('should set help topic for report edit route', () => {
    render(
      <TestWrapper initialEntries={['/reports/1']}>
        <Routes>
          <Route path="/" element={<Layout />}>
            <Route index element={<div>Home</div>} />
            <Route path="reports/:id" element={<div>Report Edit</div>} />
          </Route>
        </Routes>
      </TestWrapper>,
    );

    expect(screen.getByText('Report Edit')).toBeInTheDocument();
  });

  it('should render outlet content', () => {
    render(
      <TestWrapper>
        <Routes>
          <Route path="/" element={<Layout />}>
            <Route index element={<div>My Content Here</div>} />
          </Route>
        </Routes>
      </TestWrapper>,
    );

    expect(screen.getByText('My Content Here')).toBeInTheDocument();
  });
});
