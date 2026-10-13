import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import {
  DEFAULT_MILEAGE_RATES,
  expenseTotals,
  formatMiles,
  formatMoney,
  formatSheetMonth,
  journeyMiles,
  mileagePayment,
  monthIsBefore,
  taxYearOfMonth,
  totalJourneyMiles,
  vatWithinGross,
} from '../utils/mileage';

describe('mileage helpers', () => {
  it('doubles the miles of a round trip', () => {
    expect(journeyMiles({ miles: 86, round_trip: 1 })).toBe(172);
    expect(journeyMiles({ miles: 86, round_trip: 0 })).toBe(86);
    expect(journeyMiles({ miles: null })).toBe(0);
    expect(totalJourneyMiles([{ miles: 10, round_trip: true }, { miles: 5 }])).toBe(25);
  });

  it('puts the tax year boundary at 6 April', () => {
    expect(taxYearOfMonth(2026, 3)).toBe(2025);
    expect(taxYearOfMonth(2026, 4)).toBe(2026);
    expect(monthIsBefore({ year: 2026, month: 9 }, { year: 2026, month: 10 })).toBe(true);
    expect(monthIsBefore({ year: 2026, month: 10 }, { year: 2026, month: 10 })).toBe(false);
  });

  it('prices the first 10,000 miles of the tax year at the higher rate', () => {
    const totals = mileagePayment(9800, 500, DEFAULT_MILEAGE_RATES);
    expect(totals.highMiles).toBe(200);
    expect(totals.lowMiles).toBe(300);
    expect(totals.total).toBe(185);
  });

  it('splits VAT out of the expense totals', () => {
    const totals = expenseTotals([
      { cost: 72, vat_applicable: 1, vat_amount: 12 },
      { cost: 4.5, vat_applicable: 0, vat_amount: 0.75 },
    ]);
    expect(totals.gross).toBe(76.5);
    expect(totals.vat).toBe(12);
    expect(totals.net).toBe(64.5);
  });

  it('works the standard rate VAT out of a gross figure', () => {
    expect(vatWithinGross(120)).toBe(20);
    expect(vatWithinGross(null)).toBeNull();
  });

  it('formats money, miles and months the way the sheets print them', () => {
    expect(formatMoney(185)).toBe('£185.00');
    expect(formatMiles(9800)).toBe('9800');
    expect(formatMiles(12.5)).toBe('12.5');
    expect(formatSheetMonth(2026, 10)).toBe('October 2026');
  });
});

describe('the client copy of the mileage helpers', () => {
  // These helpers are duplicated rather than shared, there being no shared
  // package, so a drift between the two copies would show up as the client
  // totalling differently from the server. Compare the bodies, allowing for
  // the different headers and for the server-only settings lookup.
  it('still matches the server copy', () => {
    const read = (p: string) => fs.readFileSync(path.join(__dirname, p), 'utf8');
    const client = read('../utils/mileage.ts');
    const server = read('../../../server/src/utils/mileage.ts');

    for (const fn of [
      'export function journeyMiles',
      'export function mileagePayment',
      'export function expenseTotals',
    ]) {
      const extract = (src: string) => src.slice(src.indexOf(fn), src.indexOf('\n}', src.indexOf(fn)));
      expect(client.includes(fn)).toBe(true);
      expect(extract(client)).toBe(extract(server));
    }
  });
});
