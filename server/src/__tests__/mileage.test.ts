import { describe, it, expect, beforeEach } from 'vitest';
import type Database from 'better-sqlite3';
import { createTestDb } from './helpers';
import {
  DEFAULT_MILEAGE_RATES,
  MILEAGE_BAND_SETTING,
  MILEAGE_RATE_HIGH_SETTING,
  MILEAGE_RATE_LOW_SETTING,
  expenseTotals,
  formatMiles,
  formatMoney,
  formatSheetMonth,
  journeyMiles,
  mileagePayment,
  mileageRates,
  milesBroughtForward,
  monthIsBefore,
  roundPence,
  taxYearOfMonth,
  toNumber,
  totalJourneyMiles,
  vatWithinGross,
} from '../utils/mileage';
import { setSetting } from '../utils/settings';

describe('mileage arithmetic', () => {
  it('reads a number from whatever the form sent', () => {
    expect(toNumber(42)).toBe(42);
    expect(toNumber('42.5')).toBe(42.5);
    expect(toNumber(' 42.5 ')).toBe(42.5);
    expect(toNumber('')).toBeNull();
    expect(toNumber(null)).toBeNull();
    expect(toNumber(undefined)).toBeNull();
    expect(toNumber('forty')).toBeNull();
  });

  it('counts a round trip twice', () => {
    expect(journeyMiles({ miles: 48, round_trip: 0 })).toBe(48);
    expect(journeyMiles({ miles: 48, round_trip: 1 })).toBe(96);
    expect(journeyMiles({ miles: '48', round_trip: true })).toBe(96);
    expect(journeyMiles({ miles: null, round_trip: 1 })).toBe(0);
  });

  it('totals a day of legs, round trips included', () => {
    // Wxm-Derby-Wxm as Stew would enter it: one leg out, one leg back.
    expect(totalJourneyMiles([{ miles: 86 }, { miles: 86 }])).toBe(172);
    expect(totalJourneyMiles([{ miles: 86, round_trip: 1 }])).toBe(172);
  });

  it('places a month in the tax year that began on the preceding 6 April', () => {
    expect(taxYearOfMonth(2026, 4)).toBe(2026);
    expect(taxYearOfMonth(2026, 12)).toBe(2026);
    expect(taxYearOfMonth(2027, 3)).toBe(2026);
    expect(taxYearOfMonth(2027, 4)).toBe(2027);
  });

  it('orders sheets by year and month', () => {
    expect(monthIsBefore({ year: 2026, month: 9 }, { year: 2026, month: 10 })).toBe(true);
    expect(monthIsBefore({ year: 2026, month: 12 }, { year: 2027, month: 1 })).toBe(true);
    expect(monthIsBefore({ year: 2026, month: 10 }, { year: 2026, month: 10 })).toBe(false);
    expect(monthIsBefore({ year: 2027, month: 1 }, { year: 2026, month: 12 })).toBe(false);
  });
});

describe('mileagePayment', () => {
  it('prices a sheet wholly within the first 10,000 miles at the higher rate', () => {
    const pay = mileagePayment(0, 420);
    expect(pay.highMiles).toBe(420);
    expect(pay.lowMiles).toBe(0);
    expect(pay.highPay).toBe(231);
    expect(pay.total).toBe(231);
  });

  it('prices a sheet wholly beyond the threshold at the lower rate', () => {
    const pay = mileagePayment(10_400, 300);
    expect(pay.highMiles).toBe(0);
    expect(pay.lowMiles).toBe(300);
    expect(pay.lowPay).toBe(75);
    expect(pay.total).toBe(75);
  });

  it('splits a sheet that crosses the threshold across both rates', () => {
    const pay = mileagePayment(9_800, 500);
    expect(pay.highMiles).toBe(200);
    expect(pay.lowMiles).toBe(300);
    expect(pay.highPay).toBe(110);
    expect(pay.lowPay).toBe(75);
    expect(pay.total).toBe(185);
  });

  it('honours changed rates and a changed threshold', () => {
    const pay = mileagePayment(0, 1_000, { high: 0.45, low: 0.25, bandMiles: 600 });
    expect(pay.highPay).toBe(270);
    expect(pay.lowPay).toBe(100);
    expect(pay.total).toBe(370);
  });

  it('treats negative input as nothing claimed', () => {
    expect(mileagePayment(-50, -10).total).toBe(0);
  });

  it('rounds money to pence rather than carrying binary noise', () => {
    expect(roundPence(0.1 + 0.2)).toBe(0.3);
    expect(mileagePayment(0, 33.3).total).toBe(18.32);
    expect(formatMoney(18.315)).toBe('£18.32');
    expect(formatMoney(null)).toBe('');
  });

  it('formats miles whole where they are whole', () => {
    expect(formatMiles(86)).toBe('86');
    expect(formatMiles(86.5)).toBe('86.5');
    expect(formatMiles(null)).toBe('');
  });

  it('names the month on the sheet', () => {
    expect(formatSheetMonth(2026, 10)).toBe('October 2026');
    expect(formatSheetMonth(2026, 13)).toBe('2026-13');
  });
});

describe('expense totals', () => {
  it('splits the VAT out of the gross', () => {
    const totals = expenseTotals([
      { cost: 24, vat_applicable: 1, vat_amount: 4 },
      { cost: 10.5, vat_applicable: 0, vat_amount: null },
    ]);
    expect(totals.gross).toBe(34.5);
    expect(totals.vat).toBe(4);
    expect(totals.net).toBe(30.5);
  });

  it('ignores a VAT amount on an item marked as having none', () => {
    const totals = expenseTotals([{ cost: 24, vat_applicable: 0, vat_amount: 4 }]);
    expect(totals.vat).toBe(0);
    expect(totals.net).toBe(24);
  });

  it('works out the standard rate VAT within a gross figure', () => {
    expect(vatWithinGross(24)).toBe(4);
    expect(vatWithinGross(9.99)).toBe(1.67);
    expect(vatWithinGross(null)).toBeNull();
  });
});

describe('mileage settings', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = createTestDb();
  });

  it('falls back to HMRC 2026/27 rates when nothing is configured', () => {
    expect(mileageRates(db)).toEqual(DEFAULT_MILEAGE_RATES);
  });

  it('reads configured rates', () => {
    setSetting(db, MILEAGE_RATE_HIGH_SETTING, '0.6');
    setSetting(db, MILEAGE_RATE_LOW_SETTING, '0.3');
    setSetting(db, MILEAGE_BAND_SETTING, '8000');
    expect(mileageRates(db)).toEqual({ high: 0.6, low: 0.3, bandMiles: 8000 });
  });

  it('ignores a nonsense setting rather than pricing at NaN', () => {
    setSetting(db, MILEAGE_RATE_HIGH_SETTING, 'fifty pence');
    setSetting(db, MILEAGE_RATE_LOW_SETTING, '-1');
    expect(mileageRates(db)).toEqual(DEFAULT_MILEAGE_RATES);
  });
});

describe('milesBroughtForward', () => {
  let db: Database.Database;

  const addSheet = (userId: number, year: number, month: number, miles: number[]): number => {
    const sheetId = db
      .prepare('INSERT INTO travel_sheets (user_id, year, month) VALUES (?, ?, ?)')
      .run(userId, year, month).lastInsertRowid as number;
    for (const value of miles) {
      db.prepare('INSERT INTO travel_journeys (sheet_id, miles, round_trip) VALUES (?, ?, 0)').run(sheetId, value);
    }
    return sheetId;
  };

  beforeEach(() => {
    db = createTestDb();
  });

  it('sums earlier sheets in the same tax year only', () => {
    addSheet(1, 2026, 4, [1000]);
    addSheet(1, 2026, 9, [500]);
    const current = addSheet(1, 2026, 10, [120]);
    // March 2027 is later than October 2026, so it does not count towards it.
    addSheet(1, 2027, 3, [900]);
    // April 2027 opens the next tax year and never counts towards this one.
    addSheet(1, 2027, 4, [700]);

    expect(milesBroughtForward(db, 1, { id: current, year: 2026, month: 10 })).toBe(1500);
  });

  it('counts January to March against the previous April', () => {
    addSheet(1, 2026, 11, [200]);
    const current = addSheet(1, 2027, 2, [50]);
    expect(milesBroughtForward(db, 1, { id: current, year: 2027, month: 2 })).toBe(200);
  });

  it('counts a round trip twice and leaves other people out of it', () => {
    const otherUser = db
      .prepare(
        "INSERT INTO users (username, password_hash, display_name, is_superuser) VALUES ('otheruser', 'x', 'Other User', 0)",
      )
      .run().lastInsertRowid as number;
    const sheetId = db.prepare('INSERT INTO travel_sheets (user_id, year, month) VALUES (?, 2026, 9)').run(otherUser)
      .lastInsertRowid as number;
    db.prepare('INSERT INTO travel_journeys (sheet_id, miles, round_trip) VALUES (?, 400, 0)').run(sheetId);

    db.prepare('INSERT INTO travel_sheets (user_id, year, month) VALUES (1, 2026, 9)').run();
    const mine = db.prepare('SELECT id FROM travel_sheets WHERE user_id = 1').get() as { id: number };
    db.prepare('INSERT INTO travel_journeys (sheet_id, miles, round_trip) VALUES (?, 86, 1)').run(mine.id);

    const current = addSheet(1, 2026, 10, []);
    expect(milesBroughtForward(db, 1, { id: current, year: 2026, month: 10 })).toBe(172);
  });

  it('ignores the sheet being priced, even when it is saved already', () => {
    const current = addSheet(1, 2026, 10, [300]);
    expect(milesBroughtForward(db, 1, { id: current, year: 2026, month: 10 })).toBe(0);
  });
});
