import { describe, it, expect } from 'vitest';
import { REPORT_TYPE_LABELS, TYPE_SHORT } from '../types';
import type { ReportType } from '../types';

describe('Types', () => {
  it('should have labels for all report types', () => {
    const types: ReportType[] = ['loading_inspection', 'quarterly_pern', 'pern_audit'];
    for (const t of types) {
      expect(REPORT_TYPE_LABELS[t]).toBeDefined();
      expect(typeof REPORT_TYPE_LABELS[t]).toBe('string');
    }
  });

  it('should have correct label values', () => {
    expect(REPORT_TYPE_LABELS.loading_inspection).toContain('Loading');
    expect(REPORT_TYPE_LABELS.quarterly_pern).toContain('PERN');
    expect(REPORT_TYPE_LABELS.pern_audit).toContain('PERN');
  });
});

describe('refined report types', () => {
  it('has the three refined types', () => {
    expect(REPORT_TYPE_LABELS.loading_inspection).toBe('Loading & Inspection');
    expect(REPORT_TYPE_LABELS.quarterly_pern).toBe('Quarterly PERN Inspection');
    expect(REPORT_TYPE_LABELS.pern_audit).toBe('PERN Audit');
    expect(TYPE_SHORT.quarterly_pern).toBeDefined();
  });
});
