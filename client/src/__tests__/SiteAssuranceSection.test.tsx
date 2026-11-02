import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi } from 'vitest';
import { SiteAssuranceSection } from '../components/SiteAssuranceSection';

describe('SiteAssuranceSection', () => {
  it('renders every question when not hidden', () => {
    render(<SiteAssuranceSection details={{}} setDetails={vi.fn()} hidden={false} onHiddenChange={vi.fn()} />);
    expect(screen.getByText('Undercover storage?')).toBeInTheDocument();
    expect(screen.getByText('Did you feel safe on site?')).toBeInTheDocument();
    expect(screen.getByLabelText('Last inspection date')).toBeInTheDocument();
  });

  it('hides the questions when the box is ticked', () => {
    render(<SiteAssuranceSection details={{}} setDetails={vi.fn()} hidden={true} onHiddenChange={vi.fn()} />);
    expect(screen.queryByText('Undercover storage?')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Site assurance not required for this customer')).toBeChecked();
  });

  it('reports a tick back to the parent', async () => {
    const onHiddenChange = vi.fn();
    render(<SiteAssuranceSection details={{}} setDetails={vi.fn()} hidden={false} onHiddenChange={onHiddenChange} />);
    await userEvent.click(screen.getByLabelText('Site assurance not required for this customer'));
    expect(onHiddenChange).toHaveBeenCalledWith(true);
  });

  it('renders blank rather than crashing when every answer is null', () => {
    const nulls = Object.fromEntries(
      ['undercover_storage', 'felt_safe_on_site', 'last_inspection_date'].map((f) => [f, null]),
    );
    render(<SiteAssuranceSection details={nulls} setDetails={vi.fn()} hidden={false} onHiddenChange={vi.fn()} />);
    expect((screen.getByLabelText('Last inspection date') as HTMLInputElement).value).toBe('');
  });
});
