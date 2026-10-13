import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent, within } from '@testing-library/react';
import React from 'react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { HelpProvider } from '../components/HelpContext';
import { samplingPercent, samplingTotals, toWeight } from '../utils/sampling';

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

vi.mock('../api', () => ({
  api: {
    getCustomers: vi.fn(),
    getSites: vi.fn(),
    getLookups: vi.fn(),
    getReport: vi.fn(),
    getUsers: vi.fn(),
    submitReport: vi.fn(),
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

vi.mock('../App', () => ({
  useAuth: () => ({
    user: { id: 1, username: 'admin', displayName: 'Administrator', isSuperuser: true },
    loading: false,
    login: vi.fn(),
    logout: vi.fn(),
  }),
}));

import { api } from '../api';
import { ReportEdit } from '../pages/ReportEdit';

function renderNew() {
  return render(
    <MemoryRouter initialEntries={['/reports/new']}>
      <HelpProvider>
        <Routes>
          <Route path="/reports/new" element={<ReportEdit />} />
          <Route path="/" element={<div>Home</div>} />
        </Routes>
      </HelpProvider>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  (api.getCustomers as any).mockResolvedValue([
    { id: 1, name: 'Customer A', is_active: 1, contact_name: null, email: null, phone: null, address: null },
  ]);
  (api.getSites as any).mockResolvedValue([{ id: 1, customer_id: 1, address: '123 Test St', is_active: 1 }]);
  (api.getLookups as any).mockResolvedValue([]);
  (api.createReport as any).mockResolvedValue({ id: 1, containerIds: [] });
  (api.getUsers as any).mockResolvedValue([]);
});

describe('sampling arithmetic (client copy)', () => {
  it('matches the server: a component as a percentage of the sample size', () => {
    expect(samplingPercent('25', '100')).toBe(25);
    expect(samplingPercent(1, 3)).toBe(33.3);
    expect(samplingPercent(25, 0)).toBeNull();
    expect(samplingPercent('', 100)).toBeNull();
    expect(toWeight('12.5')).toBe(12.5);
  });

  it('flags weights that do not add up to the sample size', () => {
    expect(samplingTotals({ sample_size_kg: '100', in_scope_kg: '60' }).outOfBalance).toBe(true);
    expect(samplingTotals({ sample_size_kg: '100', in_scope_kg: '60', out_of_scope_kg: '40' }).outOfBalance).toBe(
      false,
    );
  });
});

describe('sampling section', () => {
  it('appears on every report type', async () => {
    renderNew();
    await screen.findByText('New Report');
    for (const label of [
      'Loading & Inspection',
      'Quarterly PERN Inspection',
      'PERN Audit',
      'Loading & Qtr PERN',
      'Sampling',
    ]) {
      fireEvent.click(screen.getAllByText(label)[0]);
      expect(await screen.findByLabelText('Sample Size (kg)')).toBeInTheDocument();
      expect(screen.getByLabelText('Sampling not carried out')).toBeInTheDocument();
    }
  });

  it('works out each weight as a percentage of the sample size as it is typed', async () => {
    renderNew();
    await screen.findByText('New Report');

    fireEvent.change(await screen.findByLabelText('Sample Size (kg)'), { target: { value: '500' } });
    fireEvent.change(screen.getByLabelText('Post Consumer Packaging In Scope (kg)'), { target: { value: '440' } });
    fireEvent.change(screen.getByLabelText('Contamination (kg)'), { target: { value: '25' } });

    expect(screen.getByLabelText('Post Consumer Packaging In Scope percentage')).toHaveTextContent('88.0%');
    expect(screen.getByLabelText('Contamination percentage')).toHaveTextContent('5.0%');
    expect(screen.getByLabelText('Total accounted for')).toHaveTextContent('465 kg');
    expect(screen.getByLabelText('Total accounted for percentage')).toHaveTextContent('93.0%');
  });

  it('counts the non-packaging weight alongside the other components', async () => {
    renderNew();
    await screen.findByText('New Report');

    fireEvent.change(await screen.findByLabelText('Sample Size (kg)'), { target: { value: '100' } });
    fireEvent.change(screen.getByLabelText('Post Consumer Packaging In Scope (kg)'), { target: { value: '90' } });
    fireEvent.change(screen.getByLabelText('Non-Packaging (kg)'), { target: { value: '10' } });

    expect(screen.getByLabelText('Non-Packaging percentage')).toHaveTextContent('10.0%');
    expect(screen.getByLabelText('Total accounted for')).toHaveTextContent('100 kg');
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('offers a product description and grade, from the lookups, on the standalone sampling form', async () => {
    (api.getLookups as any).mockImplementation((table: string) =>
      Promise.resolve(
        table === 'lookup_product_descriptions'
          ? [{ id: 1, value: 'Mixed paper', is_active: 1 }]
          : table === 'lookup_product_grades'
            ? [{ id: 2, value: 'Grade A', is_active: 1 }]
            : [],
      ),
    );

    renderNew();
    await screen.findByText('New Report');
    fireEvent.click(screen.getAllByText('Sampling')[0]);

    const description = await screen.findByLabelText('Sampling Product Description');
    const grade = screen.getByLabelText('Sampling Product Grade');
    await waitFor(() => expect(within(description).getByRole('option', { name: 'Mixed paper' })).toBeInTheDocument());
    expect(within(grade).getByRole('option', { name: 'Grade A' })).toBeInTheDocument();
  });

  it('sends the sampling product description, grade and non-packaging weight', async () => {
    renderNew();
    await screen.findByText('New Report');
    fireEvent.click(screen.getAllByText('Sampling')[0]);

    const selects = document.querySelectorAll('select');
    fireEvent.change(selects[0], { target: { value: '1' } });
    await waitFor(() => expect(api.getSites).toHaveBeenCalledWith(1));
    fireEvent.change(document.querySelectorAll('select')[1], { target: { value: '1' } });

    fireEvent.change(screen.getByLabelText('Sample Size (kg)'), { target: { value: '100' } });
    fireEvent.change(screen.getByLabelText('Non-Packaging (kg)'), { target: { value: '10' } });
    fireEvent.click(screen.getByText('Save as Draft'));

    await waitFor(() => expect(api.createReport).toHaveBeenCalled());
    expect((api.createReport as any).mock.calls[0][0].sampling).toMatchObject({ non_packaging_kg: '10' });
  });

  it('warns when the weights do not add up to the sample size, without blocking', async () => {
    renderNew();
    await screen.findByText('New Report');

    fireEvent.change(await screen.findByLabelText('Sample Size (kg)'), { target: { value: '100' } });
    fireEvent.change(screen.getByLabelText('Contamination (kg)'), { target: { value: '60' } });

    const warning = await screen.findByRole('status');
    expect(warning).toHaveTextContent('40 kg less than the sample size');
    expect(screen.getByText('Save as Draft')).toBeEnabled();
  });

  it('hides the weights when sampling was not carried out, and asks why', async () => {
    renderNew();
    await screen.findByText('New Report');

    fireEvent.click(await screen.findByLabelText('Sampling not carried out'));
    expect(await screen.findByText('Why not?')).toBeInTheDocument();
    expect(screen.queryByLabelText('Sample Size (kg)')).not.toBeInTheDocument();
  });

  it('sends the sampling block when the report is saved', async () => {
    renderNew();
    await screen.findByText('New Report');

    const selects = document.querySelectorAll('select');
    fireEvent.change(selects[0], { target: { value: '1' } });
    await waitFor(() => expect(api.getSites).toHaveBeenCalledWith(1));
    fireEvent.change(document.querySelectorAll('select')[1], { target: { value: '1' } });

    fireEvent.change(screen.getByLabelText('Sample Size (kg)'), { target: { value: '500' } });
    fireEvent.change(screen.getByLabelText('Prohibited Items (kg)'), { target: { value: '5' } });
    fireEvent.change(screen.getByLabelText('PERN/PRN % Claimed'), { target: { value: '95' } });
    fireEvent.change(screen.getByLabelText('Contamination Maximum Limit %'), { target: { value: '4' } });

    fireEvent.click(screen.getByText('Save as Draft'));

    await waitFor(() => expect(api.createReport).toHaveBeenCalled());
    const body = (api.createReport as any).mock.calls[0][0];
    expect(body.sampling).toMatchObject({
      sample_size_kg: '500',
      prohibited_kg: '5',
      pern_prn_claimed_percent: '95',
      contamination_limit_percent: '4',
    });
  });
});

describe('the four report types', () => {
  it('offers all four plus the standalone sampling form', async () => {
    renderNew();
    await screen.findByText('New Report');
    expect(screen.getByText('Loading & Inspection')).toBeInTheDocument();
    expect(screen.getByText('Quarterly PERN Inspection')).toBeInTheDocument();
    expect(screen.getByText('PERN Audit')).toBeInTheDocument();
    expect(screen.getByText('Loading & Qtr PERN')).toBeInTheDocument();
    expect(screen.getAllByText('Sampling').length).toBeGreaterThan(0);
  });

  it('shows the loading and quarterly sections together on the combined form', async () => {
    renderNew();
    await screen.findByText('New Report');
    fireEvent.click(screen.getByText('Loading & Qtr PERN'));

    expect(await screen.findByText('Time Of Inspection / First Loading')).toBeInTheDocument();
    expect(screen.getByText('Loading Reference Number')).toBeInTheDocument();
    expect(screen.getByText('Containers')).toBeInTheDocument();
    expect(screen.getByText('Compliance')).toBeInTheDocument();
    expect(screen.getByText('Unwanted Materials')).toBeInTheDocument();
  });

  it('merges the lookup lists of both types on the combined form', async () => {
    (api.getLookups as any).mockImplementation((table: string, type?: string) =>
      Promise.resolve(
        table === 'lookup_product_grades'
          ? type === 'loading_inspection'
            ? [{ id: 1, value: 'OCC', report_type: type, is_active: 1 }]
            : [
                { id: 2, value: 'occ', report_type: type, is_active: 1 },
                { id: 3, value: 'Mixed Paper', report_type: type, is_active: 1 },
              ]
          : [],
      ),
    );

    renderNew();
    await screen.findByText('New Report');
    fireEvent.click(screen.getByText('Loading & Qtr PERN'));

    await waitFor(() => {
      expect(api.getLookups).toHaveBeenCalledWith('lookup_product_grades', 'loading_inspection');
      expect(api.getLookups).toHaveBeenCalledWith('lookup_product_grades', 'quarterly_pern');
    });

    await waitFor(() => {
      // The sampling block has a product grade select of its own, reading
      // every grade regardless of report type, so only the per-type selects
      // are counted here.
      const grades = screen
        .getAllByRole('option')
        .filter((o) => ['OCC', 'occ'].includes(o.textContent || ''))
        .filter((o) => !o.closest('select')?.getAttribute('aria-label')?.startsWith('Sampling Product'));
      expect(grades).toHaveLength(1);
    });
  });

  it('reduces the standalone sampling form to the header, the block and the notes', async () => {
    renderNew();
    await screen.findByText('New Report');
    fireEvent.click(screen.getAllByText('Sampling')[0]);

    expect(await screen.findByLabelText('Sample Size (kg)')).toBeInTheDocument();
    expect(screen.getByText('Other Information')).toBeInTheDocument();
    expect(screen.getByText('Signature')).toBeInTheDocument();
    expect(screen.queryByText('Compliance')).not.toBeInTheDocument();
    expect(screen.queryByText('Unwanted Materials')).not.toBeInTheDocument();
    expect(screen.queryByText('Containers')).not.toBeInTheDocument();
  });
});

describe('PERN audit material fields', () => {
  it('offers a material description and grade', async () => {
    renderNew();
    await screen.findByText('New Report');
    fireEvent.click(screen.getByText('PERN Audit'));

    expect(await screen.findByText('Material Description')).toBeInTheDocument();
    expect(screen.getByText('Material Grade')).toBeInTheDocument();
    expect(screen.queryByText('Bale Split Results')).not.toBeInTheDocument();
  });
});
