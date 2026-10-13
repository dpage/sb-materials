import Database from 'better-sqlite3';
import { getSetting } from './settings';

// Mileage and money arithmetic for the travel and expenses sheets. The client
// keeps a copy of the pure functions in client/src/utils/mileage.ts, because
// there is no shared package between the two workspaces; keep the two in step,
// as client/src/utils/sampling.ts and utils/sampling.ts already are.

// HMRC's approved mileage allowance payments: 55p a mile for the first 10,000
// business miles in a tax year and 25p thereafter. The 55p rate arrived for
// 2026/27, the first change since 2011, which is exactly why these are
// settings rather than constants.
export const MILEAGE_RATE_HIGH_SETTING = 'mileage_rate_high';
export const MILEAGE_RATE_LOW_SETTING = 'mileage_rate_low';
export const MILEAGE_BAND_SETTING = 'mileage_band_miles';

export const DEFAULT_MILEAGE_RATE_HIGH = 0.55;
export const DEFAULT_MILEAGE_RATE_LOW = 0.25;
export const DEFAULT_MILEAGE_BAND_MILES = 10000;

export interface MileageRates {
  high: number;
  low: number;
  bandMiles: number;
}

export const DEFAULT_MILEAGE_RATES: MileageRates = {
  high: DEFAULT_MILEAGE_RATE_HIGH,
  low: DEFAULT_MILEAGE_RATE_LOW,
  bandMiles: DEFAULT_MILEAGE_BAND_MILES,
};

/**
 * Coerce a typed number. The forms send whatever was typed, so a blank field,
 * a stray letter or an infinity all become null rather than NaN.
 */
export function toNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const parsed = typeof value === 'number' ? value : Number(String(value).trim());
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * The distance a journey is paid for: a round trip is entered once and counts
 * double, which is how Stew describes a there-and-back run.
 */
export function journeyMiles(journey: { miles?: unknown; round_trip?: unknown }): number {
  const miles = toNumber(journey.miles) ?? 0;
  return journey.round_trip ? miles * 2 : miles;
}

export function totalJourneyMiles(journeys: { miles?: unknown; round_trip?: unknown }[]): number {
  return journeys.reduce((sum, journey) => sum + journeyMiles(journey), 0);
}

/**
 * The UK tax year a month falls in, identified by the calendar year it starts
 * in: the year runs 6 April to 5 April, so January to March belong to the
 * previous April's year. Sheets are monthly, so the day of the month never
 * comes into it and April is taken as a whole.
 */
export function taxYearOfMonth(year: number, month: number): number {
  return month >= 4 ? year : year - 1;
}

/**
 * Whether one sheet's month precedes another's within a tax year, used to
 * decide which sheets count towards the miles brought forward.
 */
export function monthIsBefore(a: { year: number; month: number }, b: { year: number; month: number }): boolean {
  return a.year * 12 + a.month < b.year * 12 + b.month;
}

export interface MileagePayment {
  milesBroughtForward: number;
  miles: number;
  highMiles: number;
  lowMiles: number;
  highPay: number;
  lowPay: number;
  total: number;
}

/**
 * Price a sheet's miles, given how many the same person has already claimed
 * earlier in the same tax year. A sheet that crosses the 10,000 mile line is
 * split across the two rates, which is the whole reason the brought-forward
 * figure is carried at all.
 */
export function mileagePayment(
  milesBroughtForward: number,
  miles: number,
  rates: MileageRates = DEFAULT_MILEAGE_RATES,
): MileagePayment {
  const before = Math.max(0, milesBroughtForward);
  const claimed = Math.max(0, miles);
  const remainingAtHighRate = Math.max(0, rates.bandMiles - before);
  const highMiles = Math.min(claimed, remainingAtHighRate);
  const lowMiles = claimed - highMiles;
  const highPay = roundPence(highMiles * rates.high);
  const lowPay = roundPence(lowMiles * rates.low);
  return {
    milesBroughtForward: before,
    miles: claimed,
    highMiles,
    lowMiles,
    highPay,
    lowPay,
    total: roundPence(highPay + lowPay),
  };
}

/**
 * Round to pence. Money is held in pounds as REAL, so every figure that is
 * shown or totalled goes through here rather than carrying binary rounding
 * noise into the next sum.
 */
export function roundPence(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export function formatMoney(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return '';
  return `£${roundPence(value).toFixed(2)}`;
}

export function formatMiles(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return '';
  // Whole miles read better on a sheet, but a part mile entered deliberately
  // should not silently vanish.
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

export interface ExpenseTotals {
  gross: number;
  vat: number;
  net: number;
}

/**
 * Expense totals with the VAT split out, as Stew asked: the cost entered is
 * what was paid, and the VAT named within it is shown separately so the net
 * is what the business actually bore.
 */
export function expenseTotals(
  items: { cost?: unknown; vat_applicable?: unknown; vat_amount?: unknown }[],
): ExpenseTotals {
  let gross = 0;
  let vat = 0;
  for (const item of items) {
    gross += toNumber(item.cost) ?? 0;
    if (item.vat_applicable) vat += toNumber(item.vat_amount) ?? 0;
  }
  gross = roundPence(gross);
  vat = roundPence(vat);
  return { gross, vat, net: roundPence(gross - vat) };
}

/** The standard rate VAT within a gross figure, for the form's "work it out" button. */
export const STANDARD_VAT_RATE = 0.2;

export function vatWithinGross(cost: number | null, rate: number = STANDARD_VAT_RATE): number | null {
  if (cost === null || !Number.isFinite(cost)) return null;
  return roundPence((cost * rate) / (1 + rate));
}

export const MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

export function formatSheetMonth(year: number, month: number): string {
  const name = MONTH_NAMES[month - 1];
  return name ? `${name} ${year}` : `${year}-${String(month).padStart(2, '0')}`;
}

/**
 * The configured rates, falling back to HMRC's current figures. Read per
 * request rather than cached, so a correction on the settings page applies
 * without a restart.
 */
export function mileageRates(db: Database.Database): MileageRates {
  const read = (key: string, fallback: number) => {
    const parsed = toNumber(getSetting(db, key, String(fallback)));
    return parsed !== null && parsed >= 0 ? parsed : fallback;
  };
  return {
    high: read(MILEAGE_RATE_HIGH_SETTING, DEFAULT_MILEAGE_RATE_HIGH),
    low: read(MILEAGE_RATE_LOW_SETTING, DEFAULT_MILEAGE_RATE_LOW),
    bandMiles: read(MILEAGE_BAND_SETTING, DEFAULT_MILEAGE_BAND_MILES),
  };
}

/**
 * The miles this person has already claimed on earlier sheets in the same tax
 * year. Earlier means earlier by year and month, so a sheet filled in late
 * still prices against the months that actually preceded it.
 */
export function milesBroughtForward(
  db: Database.Database,
  userId: number,
  sheet: { id: number; year: number; month: number },
): number {
  const taxYear = taxYearOfMonth(sheet.year, sheet.month);
  const rows = db
    .prepare(
      `SELECT s.year AS year, s.month AS month, j.miles AS miles, j.round_trip AS round_trip
         FROM travel_sheets s
         JOIN travel_journeys j ON j.sheet_id = s.id
        WHERE s.user_id = ? AND s.id != ?`,
    )
    .all(userId, sheet.id) as { year: number; month: number; miles: number | null; round_trip: number | null }[];

  return rows
    .filter((row) => taxYearOfMonth(row.year, row.month) === taxYear && monthIsBefore(row, sheet))
    .reduce((sum, row) => sum + journeyMiles(row), 0);
}
