import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import React from 'react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { HelpProvider } from '../components/HelpContext';

// Mock signature canvas
vi.mock('react-signature-canvas', () => ({
  default: React.forwardRef((_props: any, ref: any) => {
    React.useImperativeHandle(ref, () => ({
      isEmpty: () => true,
      clear: () => {},
      toDataURL: () => 'data:image/png;base64,fake',
      getTrimmedCanvas: () => ({ toBlob: (cb: any) => cb(new Blob()) }),
    }));
    return <canvas data-testid="signature-canvas" />;
  }),
}));

// Mock API
vi.mock('../api', () => ({
  api: {
    getCustomers: vi.fn(),
    getSites: vi.fn(),
    getLookups: vi.fn(),
    getReport: vi.fn(),
    createReport: vi.fn(),
    updateReport: vi.fn(),
    createCustomer: vi.fn(),
    createSite: vi.fn(),
    createLookup: vi.fn(),
    uploadPhotos: vi.fn(),
    uploadSignature: vi.fn(),
    deletePhoto: vi.fn(),
    getPhotoUrl: vi.fn((f: string) => `/api/photos/file/${f}`),
  },
}));

const mockAuth = {
  user: { id: 1, username: 'admin', displayName: 'Administrator', isSuperuser: true },
  loading: false,
  login: vi.fn(),
  logout: vi.fn(),
};

vi.mock('../App', () => ({
  useAuth: () => mockAuth,
}));

import { api } from '../api';
import { ReportEdit } from '../pages/ReportEdit';

function renderNew() {
  return render(
    <MemoryRouter initialEntries={['/reports/new']}>
      <HelpProvider>
        <Routes>
          <Route path="/reports/new" element={<ReportEdit />} />
          <Route path="/reports/:id" element={<ReportEdit />} />
          <Route path="/" element={<div>Home</div>} />
        </Routes>
      </HelpProvider>
    </MemoryRouter>,
  );
}

function renderEdit() {
  return render(
    <MemoryRouter initialEntries={['/reports/1']}>
      <HelpProvider>
        <Routes>
          <Route path="/reports/new" element={<ReportEdit />} />
          <Route path="/reports/:id" element={<ReportEdit />} />
          <Route path="/" element={<div>Home</div>} />
        </Routes>
      </HelpProvider>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  (api.getCustomers as any).mockResolvedValue([
    {
      id: 1,
      name: 'Customer A',
      is_active: 1,
      contact_name: 'John',
      email: 'john@test.com',
      phone: '123',
      address: '456 St',
    },
  ]);
  (api.getSites as any).mockResolvedValue([{ id: 1, customer_id: 1, address: '123 Test St', is_active: 1 }]);
  (api.getLookups as any).mockResolvedValue([{ id: 1, value: 'OCC', report_type: 'loading_inspection', is_active: 1 }]);
  (api.createReport as any).mockResolvedValue({ id: 1, containerIds: [] });
  (api.updateReport as any).mockResolvedValue({ ok: true, containerIds: [] });
  (api.uploadPhotos as any).mockResolvedValue([]);
  (api.uploadSignature as any).mockResolvedValue({});
});

describe('ReportEdit - New Report', () => {
  it('should render the new report form with heading', async () => {
    renderNew();
    expect(await screen.findByText('New Report')).toBeInTheDocument();
  });

  it('should show save buttons', async () => {
    renderNew();
    expect(await screen.findByText('Save as Draft')).toBeInTheDocument();
    expect(screen.getByText('Save & Complete')).toBeInTheDocument();
    expect(screen.getByText('Cancel')).toBeInTheDocument();
  });

  it('should load customers on mount', async () => {
    renderNew();
    await waitFor(() => {
      expect(api.getCustomers).toHaveBeenCalled();
    });
  });

  it('should load lookups on mount', async () => {
    renderNew();
    await waitFor(() => {
      expect(api.getLookups).toHaveBeenCalled();
    });
  });

  it('should have a report type select', async () => {
    renderNew();
    await screen.findByText('New Report');
    const selects = document.querySelectorAll('select');
    expect(selects.length).toBeGreaterThan(0);
  });

  it('should show fibre-specific fields by default', async () => {
    renderNew();
    expect(await screen.findByText('Moisture Reading Low')).toBeInTheDocument();
    expect(screen.getByText('Moisture Reading High')).toBeInTheDocument();
  });

  it('defaults to loading_inspection and can switch to Quarterly PERN', async () => {
    renderNew();
    await screen.findByText('New Report');
    // Loading Reference is a loading_inspection-only field
    expect(await screen.findByText('Loading Reference')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Quarterly PERN Inspection'));
    expect(screen.queryByText('Loading Reference')).not.toBeInTheDocument();
  });

  it('should switch to PERN audit fields', async () => {
    renderNew();
    await screen.findByText('New Report');
    fireEvent.click(screen.getByText('PERN Audit'));
    expect(await screen.findByText(/Company Name/i)).toBeInTheDocument();
  });

  it('should load sites when customer is selected', async () => {
    renderNew();
    await screen.findByText('New Report');
    const selects = document.querySelectorAll('select');
    fireEvent.change(selects[0], { target: { value: '1' } });
    await waitFor(() => {
      expect(api.getSites).toHaveBeenCalledWith(1);
    });
  });

  it('should have signature canvas', async () => {
    renderNew();
    await screen.findByText('New Report');
    expect(screen.getByTestId('signature-canvas')).toBeInTheDocument();
  });

  it('should pre-fill inspector name from user', async () => {
    renderNew();
    await screen.findByText('New Report');
    const allInputs = document.querySelectorAll('input');
    const hasAdmin = Array.from(allInputs).some((input) => (input as HTMLInputElement).value === 'Administrator');
    expect(hasAdmin).toBe(true);
  });

  it('should show Report Type section', async () => {
    renderNew();
    expect(await screen.findByText('Report Type')).toBeInTheDocument();
  });

  it('should show Inspection Details section', async () => {
    renderNew();
    expect(await screen.findByText('Inspection Details')).toBeInTheDocument();
  });

  it('should show Product Details section', async () => {
    renderNew();
    expect(await screen.findByText('Product Details')).toBeInTheDocument();
  });

  it('should show Quality & Result section', async () => {
    renderNew();
    expect(await screen.findByText('Quality & Result')).toBeInTheDocument();
  });

  it('should show Signature section', async () => {
    renderNew();
    expect(await screen.findByText('Signature')).toBeInTheDocument();
  });

  it('should show Photos section', async () => {
    renderNew();
    expect(await screen.findByText('Photos')).toBeInTheDocument();
  });

  it('should show customer dropdown options', async () => {
    renderNew();
    await screen.findByText('New Report');
    expect(screen.getByText('Select customer...')).toBeInTheDocument();
    expect(screen.getByText('Customer A')).toBeInTheDocument();
  });

  it('should show Back to Reports link', async () => {
    renderNew();
    expect(await screen.findByText('Back to Reports')).toBeInTheDocument();
  });

  it('should show quick-add buttons (+) next to customer', async () => {
    renderNew();
    await screen.findByText('New Report');
    const plusBtns = screen.getAllByText('+');
    expect(plusBtns.length).toBeGreaterThanOrEqual(2); // customer and site
  });

  it('loads on-behalf-of clients and shows the dropdown', async () => {
    (api.getLookups as any).mockImplementation((table: string) =>
      Promise.resolve(
        table === 'lookup_clients'
          ? [{ id: 9, value: 'VISY Recycling UK', is_active: 1 }]
          : [{ id: 1, value: 'OCC', report_type: 'loading_inspection', is_active: 1 }],
      ),
    );
    renderNew();
    await screen.findByText('New Report');
    expect(await screen.findByText('On Behalf Of')).toBeInTheDocument();
  });

  it('should show date and time inputs', async () => {
    renderNew();
    await screen.findByText('New Report');
    expect(screen.getByText('Date of Inspection *')).toBeInTheDocument();
    expect(screen.getByText('Time of Inspection')).toBeInTheDocument();
  });

  it('should show status select', async () => {
    renderNew();
    await screen.findByText('New Report');
    expect(screen.getByText('Status')).toBeInTheDocument();
  });

  it('should show Product Grade field for fibre', async () => {
    renderNew();
    await screen.findByText('New Report');
    expect(screen.getByText('Product Grade')).toBeInTheDocument();
  });

  it('should show Mode of Storage for fibre', async () => {
    renderNew();
    await screen.findByText('New Report');
    expect(screen.getByText('Mode of Storage')).toBeInTheDocument();
  });

  it('should show stock & bale count for fibre', async () => {
    renderNew();
    await screen.findByText('New Report');
    expect(screen.getByText('Stock & Bale Count')).toBeInTheDocument();
  });

  it('should show quality score field', async () => {
    renderNew();
    await screen.findByText('New Report');
    expect(screen.getByText(/Quality Score/)).toBeInTheDocument();
  });

  it('should show inspection passed field', async () => {
    renderNew();
    await screen.findByText('New Report');
    expect(screen.getByText(/Inspection Passed/)).toBeInTheDocument();
  });

  it('should show other information section', async () => {
    renderNew();
    await screen.findByText('New Report');
    expect(screen.getByText('Other Information')).toBeInTheDocument();
  });

  it('should show Unwanted Materials section for fibre', async () => {
    renderNew();
    expect(await screen.findByText('Unwanted Materials')).toBeInTheDocument();
  });

  it('should show Contaminants section for fibre', async () => {
    renderNew();
    expect(await screen.findByText('Contaminants')).toBeInTheDocument();
  });

  it('should show clear signature button', async () => {
    renderNew();
    expect(await screen.findByText('Clear Signature')).toBeInTheDocument();
  });

  it('should show Number of Containers for loading inspection', async () => {
    renderNew();
    await screen.findByText('New Report');
    expect(await screen.findByText('Number of Containers')).toBeInTheDocument();
  });

  it('should show Add Container button for loading inspection', async () => {
    renderNew();
    await screen.findByText('New Report');
    expect(await screen.findByText('+ Add Container')).toBeInTheDocument();
  });

  it('should add a container for loading inspection', async () => {
    renderNew();
    await screen.findByText('New Report');
    await screen.findByText('+ Add Container');
    fireEvent.click(screen.getByText('+ Add Container'));
    expect(await screen.findByText('Container 1')).toBeInTheDocument();
  });

  it('should show PERN company details section', async () => {
    renderNew();
    await screen.findByText('New Report');
    fireEvent.click(screen.getByText('PERN Audit'));
    expect(await screen.findByText('Company Details')).toBeInTheDocument();
    expect(screen.getByText(/Company Name/i)).toBeInTheDocument();
    expect(screen.getByText(/Contact Name/i)).toBeInTheDocument();
    expect(screen.getByText(/Email/i)).toBeInTheDocument();
    expect(screen.getByText(/Phone/i)).toBeInTheDocument();
  });

  it('should show PERN site information section', async () => {
    renderNew();
    await screen.findByText('New Report');
    fireEvent.click(screen.getByText('PERN Audit'));
    expect(await screen.findByText('Site Information')).toBeInTheDocument();
    expect(screen.getByText('MRF')).toBeInTheDocument();
  });

  it('should show PERN safety & workers section', async () => {
    renderNew();
    await screen.findByText('New Report');
    fireEvent.click(screen.getByText('PERN Audit'));
    expect(await screen.findByText('Safety & Workers')).toBeInTheDocument();
  });

  it('should show PERN packaging & compliance section', async () => {
    renderNew();
    await screen.findByText('New Report');
    fireEvent.click(screen.getByText('PERN Audit'));
    expect(await screen.findByText('Packaging & Compliance')).toBeInTheDocument();
  });

  it('should show PERN training section', async () => {
    renderNew();
    await screen.findByText('New Report');
    fireEvent.click(screen.getByText('PERN Audit'));
    expect(await screen.findByText('Training')).toBeInTheDocument();
  });

  it('should show PERN results & follow-up section', async () => {
    renderNew();
    await screen.findByText('New Report');
    fireEvent.click(screen.getByText('PERN Audit'));
    expect(await screen.findByText('Results & Follow-up')).toBeInTheDocument();
  });

  it('should show PERN photo section', async () => {
    renderNew();
    await screen.findByText('New Report');
    fireEvent.click(screen.getByText('PERN Audit'));
    expect(await screen.findByText('Photos')).toBeInTheDocument();
  });

  it('should show Compliance section for fibre', async () => {
    renderNew();
    expect(await screen.findByText('Compliance')).toBeInTheDocument();
    expect(screen.getByText(/Does material originate in UK/)).toBeInTheDocument();
  });

  it('should show fibre packaging content checkboxes', async () => {
    renderNew();
    await screen.findByText('New Report');
    expect(await screen.findByText('Packaging Content')).toBeInTheDocument();
    expect(screen.getByText('Mixed Paper exceeds 34.5%')).toBeInTheDocument();
    expect(screen.getByText('OCC exceeds 80%')).toBeInTheDocument();
  });

  it('Quarterly PERN reveals bale-break fields when toggled on', async () => {
    renderNew();
    await screen.findByText('New Report');
    fireEvent.click(screen.getByText('Quarterly PERN Inspection'));
    const toggle = await screen.findByLabelText('Bale break performed?');
    expect(screen.queryByText('Bale Break Results')).not.toBeInTheDocument();
    fireEvent.click(toggle);
    expect(await screen.findByText('Bale Break Results')).toBeInTheDocument();
    expect(screen.getByText('OCC exceeds 97.5%')).toBeInTheDocument();
  });

  it('should save as draft', async () => {
    renderNew();
    await screen.findByText('New Report');

    // Fill required fields
    const selects = document.querySelectorAll('select');
    fireEvent.change(selects[0], { target: { value: '1' } }); // customer

    await waitFor(() => {
      expect(api.getSites).toHaveBeenCalledWith(1);
    });

    // Select site (after sites load)
    const allSelects = document.querySelectorAll('select');
    fireEvent.change(allSelects[1], { target: { value: '1' } }); // site

    fireEvent.click(screen.getByText('Save as Draft'));

    await waitFor(() => {
      expect(api.createReport).toHaveBeenCalledWith(
        expect.objectContaining({
          report_type: 'loading_inspection',
          customer_id: 1,
          site_id: 1,
          status: 'draft',
        }),
      );
    });
  });

  it('should save and complete', async () => {
    renderNew();
    await screen.findByText('New Report');

    const selects = document.querySelectorAll('select');
    fireEvent.change(selects[0], { target: { value: '1' } });

    await waitFor(() => {
      expect(api.getSites).toHaveBeenCalledWith(1);
    });

    const allSelects = document.querySelectorAll('select');
    fireEvent.change(allSelects[1], { target: { value: '1' } });

    fireEvent.click(screen.getByText('Save & Complete'));

    await waitFor(() => {
      expect(api.createReport).toHaveBeenCalled();
    });
  });

  it('should navigate home after save', async () => {
    renderNew();
    await screen.findByText('New Report');

    const selects = document.querySelectorAll('select');
    fireEvent.change(selects[0], { target: { value: '1' } });

    await waitFor(() => {
      expect(api.getSites).toHaveBeenCalledWith(1);
    });

    const allSelects = document.querySelectorAll('select');
    fireEvent.change(allSelects[1], { target: { value: '1' } });

    fireEvent.click(screen.getByText('Save as Draft'));

    await waitFor(() => {
      expect(screen.getByText('Home')).toBeInTheDocument();
    });
  });

  it('should navigate home on cancel', async () => {
    renderNew();
    await screen.findByText('New Report');
    fireEvent.click(screen.getByText('Cancel'));
    expect(screen.getByText('Home')).toBeInTheDocument();
  });

  it('should navigate home on back to reports', async () => {
    renderNew();
    await screen.findByText('New Report');
    fireEvent.click(screen.getByText('Back to Reports'));
    expect(screen.getByText('Home')).toBeInTheDocument();
  });

  it('renders an Other/Notes box under Unwanted Materials', async () => {
    renderNew();
    await screen.findByText('New Report');
    const labels = screen.getAllByText('Other / Notes');
    expect(labels.length).toBeGreaterThanOrEqual(2); // unwanted + contaminants
  });
});

describe('ReportEdit - Edit Report', () => {
  beforeEach(() => {
    (api.getReport as any).mockResolvedValue({
      id: 1,
      report_type: 'loading_inspection',
      customer_id: 1,
      site_id: 1,
      inspection_date: '2025-01-15',
      inspection_time: '10:00',
      inspector_id: 1,
      inspector_name: 'Inspector',
      quality_score: 4,
      inspection_passed: 1,
      other_information: 'Test notes',
      signature_path: null,
      date_completed: null,
      status: 'draft',
      customer_name: 'Customer A',
      site_address: '123 Test St',
      inspection_details: {
        product_grade: 'OCC',
        mode_of_storage: 'Bale Stacking Outside Storage',
        moisture_reading_low: '10',
        moisture_reading_high: '20',
        stock_bale_count: '50',
      },
      unwanted_materials: [{ material: 'Paper', notes: null }],
      contaminants: [{ contaminant: 'Metal', notes: null }],
      photos: [],
    });
  });

  it('should fetch report on mount', async () => {
    renderEdit();
    await waitFor(() => {
      expect(api.getReport).toHaveBeenCalledWith(1);
    });
  });

  it('should show Edit Report heading', async () => {
    renderEdit();
    expect(await screen.findByText('Edit Report')).toBeInTheDocument();
  });

  it('should pre-fill report data', async () => {
    renderEdit();
    await screen.findByText('Edit Report');
    const dateInput = document.querySelector('input[type="date"]') as HTMLInputElement;
    expect(dateInput?.value).toBe('2025-01-15');
  });

  it('should pre-fill time', async () => {
    renderEdit();
    await screen.findByText('Edit Report');
    const timeInput = document.querySelector('input[type="time"]') as HTMLInputElement;
    expect(timeInput?.value).toBe('10:00');
  });

  it('should load a plastics report with containers', async () => {
    (api.getReport as any).mockResolvedValue({
      id: 2,
      report_type: 'loading_inspection',
      customer_id: 1,
      site_id: 1,
      inspection_date: '2025-02-15',
      inspector_name: 'Inspector',
      status: 'draft',
      inspection_details: {
        product_description: 'PET',
        product_grade: '98/2',
        loading_reference: 'LR-001',
        number_of_containers: 1,
      },
      containers: [{ id: 1, container_number: 'C001', seal_number: 'S001', weight_info: '20t', sort_order: 0 }],
      unwanted_materials: [],
      contaminants: [],
      photos: [],
    });

    renderEdit();
    await screen.findByText('Edit Report');
    expect(await screen.findByText('Loading Reference')).toBeInTheDocument();
  });

  it('should load a PERN audit report', async () => {
    (api.getReport as any).mockResolvedValue({
      id: 3,
      report_type: 'pern_audit',
      customer_id: 1,
      site_id: 1,
      inspection_date: '2025-03-15',
      inspector_name: 'Auditor',
      status: 'draft',
      pern_details: {
        company_name_address: 'Test Co',
        contact_name: 'John',
        site_type: '["MRF"]',
      },
      photos: [],
    });

    renderEdit();
    await screen.findByText('Edit Report');
    expect(await screen.findByText(/Company Name/i)).toBeInTheDocument();
  });

  it('should update report on save', async () => {
    renderEdit();
    await screen.findByText('Edit Report');

    fireEvent.click(screen.getByText('Save as Draft'));

    await waitFor(() => {
      expect(api.updateReport).toHaveBeenCalledWith(
        1,
        expect.objectContaining({
          report_type: 'loading_inspection',
          customer_id: 1,
          site_id: 1,
          status: 'draft',
        }),
      );
    });
  });

  it('should show existing photos', async () => {
    (api.getReport as any).mockResolvedValue({
      id: 1,
      report_type: 'loading_inspection',
      customer_id: 1,
      site_id: 1,
      inspection_date: '2025-01-15',
      inspector_name: 'Inspector',
      status: 'draft',
      inspection_details: {},
      unwanted_materials: [],
      contaminants: [],
      photos: [{ id: 1, file_path: 'reports/1/photo1.jpg', photo_label: 'Front view', sort_order: 0 }],
    });

    renderEdit();
    await screen.findByText('Edit Report');

    await waitFor(() => {
      expect(screen.getByText('Front view')).toBeInTheDocument();
    });
  });

  it('should show existing signature', async () => {
    (api.getReport as any).mockResolvedValue({
      id: 1,
      report_type: 'loading_inspection',
      customer_id: 1,
      site_id: 1,
      inspection_date: '2025-01-15',
      inspector_name: 'Inspector',
      status: 'draft',
      signature_path: 'reports/1/signature.png',
      inspection_details: {},
      unwanted_materials: [],
      contaminants: [],
      photos: [],
    });

    renderEdit();
    await screen.findByText('Edit Report');

    await waitFor(() => {
      expect(screen.getByText(/Current signature/i)).toBeInTheDocument();
    });
  });

  it('should load report with Other unwanted material', async () => {
    (api.getReport as any).mockResolvedValue({
      id: 1,
      report_type: 'loading_inspection',
      customer_id: 1,
      site_id: 1,
      inspection_date: '2025-01-15',
      inspector_name: 'Inspector',
      status: 'draft',
      inspection_details: {},
      unwanted_materials: [
        { material: 'Paper', notes: null },
        { material: 'Other', notes: 'Custom material' },
      ],
      contaminants: [
        { contaminant: 'Metal', notes: null },
        { contaminant: 'Other', notes: 'Custom contaminant' },
      ],
      photos: [],
    });

    renderEdit();
    await screen.findByText('Edit Report');

    // The "Other" notes should be in the inputs
    const allInputs = document.querySelectorAll('input');
    const hasCustomMaterial = Array.from(allInputs).some(
      (input) => (input as HTMLInputElement).value === 'Custom material',
    );
    expect(hasCustomMaterial).toBe(true);
  });

  it('should delete an existing photo', async () => {
    (api.deletePhoto as any).mockResolvedValue({});
    (api.getReport as any).mockResolvedValue({
      id: 1,
      report_type: 'loading_inspection',
      customer_id: 1,
      site_id: 1,
      inspection_date: '2025-01-15',
      inspector_name: 'Inspector',
      status: 'draft',
      inspection_details: {},
      unwanted_materials: [],
      contaminants: [],
      photos: [{ id: 10, file_path: 'reports/1/photo1.jpg', photo_label: 'Test Photo', sort_order: 0 }],
    });

    renderEdit();
    await screen.findByText('Edit Report');

    await waitFor(() => {
      expect(screen.getByText('Test Photo')).toBeInTheDocument();
    });

    // Find and click the × button for the photo
    const deleteBtns = screen.getAllByText('×');
    fireEvent.click(deleteBtns[0]);

    await waitFor(() => {
      expect(api.deletePhoto).toHaveBeenCalledWith(10);
    });
  });

  it('shows split container weight fields', async () => {
    renderNew();
    await screen.findByText('New Report');
    fireEvent.click(await screen.findByText('+ Add Container'));
    expect(await screen.findByText('No. of Bales')).toBeInTheDocument();
    expect(screen.getByText('Weighbridge Ticket')).toBeInTheDocument();
    expect(screen.getByText('Weight')).toBeInTheDocument();
  });

  it('should add container for plastics edit', async () => {
    (api.getReport as any).mockResolvedValue({
      id: 2,
      report_type: 'loading_inspection',
      customer_id: 1,
      site_id: 1,
      inspection_date: '2025-02-15',
      inspector_name: 'Inspector',
      status: 'draft',
      inspection_details: {
        product_grade: '98/2',
        loading_reference: 'LR-001',
      },
      containers: [],
      unwanted_materials: [],
      contaminants: [],
      photos: [],
    });

    renderEdit();
    await screen.findByText('Edit Report');
    await screen.findByText('+ Add Container');
    fireEvent.click(screen.getByText('+ Add Container'));
    expect(await screen.findByText('Container 1')).toBeInTheDocument();
  });

  it('should load PERN report with all sections populated', async () => {
    (api.getReport as any).mockResolvedValue({
      id: 4,
      report_type: 'pern_audit',
      customer_id: 1,
      site_id: 1,
      inspection_date: '2025-03-15',
      inspector_name: 'Auditor',
      status: 'draft',
      pern_details: {
        company_name_address: 'Test Co',
        contact_name: 'John',
        email: 'john@test.com',
        phone: '123',
        site_type: '["MRF","RECYCLING CENTER"]',
        accreditations: '["ISO14001"]',
        site_facilities: '["WEIGHBRIDGE"]',
        waste_sources: '["COMMERCIAL & INDUSTRIAL"]',
        safety_equipment: '["SMOKE DETECTION"]',
        worker_recording: '["MANUAL BOOKING IN SHEET"]',
        training_types: '["TOOL BOX TALKS"]',
        training_recording: '["HARD COPIES"]',
        total_employees: '50',
        fire_risk_assessment: 'YES',
        quality_discussion: 'Good quality',
        follow_up_actions: 'None needed',
      },
      photos: [],
    });

    renderEdit();
    await screen.findByText('Edit Report');
    expect(await screen.findByText('Company Details')).toBeInTheDocument();
    expect(screen.getByText('Site Information')).toBeInTheDocument();
    expect(screen.getByText('Safety & Workers')).toBeInTheDocument();
    expect(screen.getByText('Training')).toBeInTheDocument();
    expect(screen.getByText('Results & Follow-up')).toBeInTheDocument();
  });

  it('should show Completion section', async () => {
    renderEdit();
    await screen.findByText('Edit Report');
    expect(screen.getByText('Completion')).toBeInTheDocument();
  });

  it('should remove a container', async () => {
    (api.getReport as any).mockResolvedValue({
      id: 2,
      report_type: 'loading_inspection',
      customer_id: 1,
      site_id: 1,
      inspection_date: '2025-02-15',
      inspector_name: 'Inspector',
      status: 'draft',
      inspection_details: {},
      containers: [{ id: 1, container_number: 'C001', seal_number: 'S001', weight_info: '20t', sort_order: 0 }],
      unwanted_materials: [],
      contaminants: [],
      photos: [],
    });

    renderEdit();
    await screen.findByText('Edit Report');
    expect(await screen.findByText('Container 1')).toBeInTheDocument();

    // Click Remove button on the container
    fireEvent.click(screen.getByText('Remove'));

    // Container should be gone
    await waitFor(() => {
      expect(screen.queryByText('Container 1')).not.toBeInTheDocument();
    });
  });

  it('should handle completed report with date_completed', async () => {
    (api.getReport as any).mockResolvedValue({
      id: 1,
      report_type: 'loading_inspection',
      customer_id: 1,
      site_id: 1,
      inspection_date: '2025-01-15',
      inspector_name: 'Inspector',
      status: 'completed',
      date_completed: '2025-01-16',
      inspection_details: {},
      unwanted_materials: [],
      contaminants: [],
      photos: [],
    });

    renderEdit();
    await screen.findByText('Edit Report');
    // Should have status set to completed
    const statusSelect = document.querySelectorAll('select');
    const completedSelect = Array.from(statusSelect).find((s) => (s as HTMLSelectElement).value === 'completed');
    expect(completedSelect).toBeTruthy();
  });
});
