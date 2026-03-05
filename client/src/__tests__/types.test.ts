import { describe, it, expect } from 'vitest';
import { REPORT_TYPE_LABELS } from '../types';
import type { ReportType } from '../types';

describe('Types', () => {
  it('should have labels for all report types', () => {
    const types: ReportType[] = ['inspection_fibre', 'inspection_plastics', 'inspection_metals', 'pern_audit'];
    for (const t of types) {
      expect(REPORT_TYPE_LABELS[t]).toBeDefined();
      expect(typeof REPORT_TYPE_LABELS[t]).toBe('string');
    }
  });

  it('should have correct label values', () => {
    expect(REPORT_TYPE_LABELS.inspection_fibre).toContain('Fibre');
    expect(REPORT_TYPE_LABELS.inspection_plastics).toContain('Plastics');
    expect(REPORT_TYPE_LABELS.inspection_metals).toContain('Metals');
    expect(REPORT_TYPE_LABELS.pern_audit).toContain('PERN');
  });
});
