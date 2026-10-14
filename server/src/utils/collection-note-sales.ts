import type { Request } from 'express';

/**
 * The sale side of a collection note: the buyer, the two prices, and whether
 * the money has arrived. Visible to superusers alone, which is what SB
 * Materials asked for; a narrower per-user permission may follow, and this is
 * the one place that decision would have to change.
 */
export const SALE_FIELDS = ['buyer', 'buy_price', 'sale_price', 'is_paid', 'paid_date'] as const;

export function canSeeSale(req: Request): boolean {
  return !!req.session?.isSuperuser;
}

/**
 * Remove the sale fields from a note (or a list of notes) unless the caller is
 * allowed to see them. Done on the way out rather than by selecting different
 * columns, so there is a single place to check rather than one per query.
 */
export function stripSaleFields<T extends Record<string, unknown>>(row: T, allowed: boolean): T {
  if (allowed) return row;
  const copy = { ...row };
  for (const field of SALE_FIELDS) delete copy[field];
  return copy;
}

export function stripSaleFieldsFromAll<T extends Record<string, unknown>>(rows: T[], allowed: boolean): T[] {
  return allowed ? rows : rows.map((row) => stripSaleFields(row, allowed));
}

/** A price as stored: a number, or null for "not recorded". */
export function toPrice(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const num = typeof value === 'number' ? value : Number(String(value).trim().replace(/^£/, ''));
  return Number.isFinite(num) ? num : null;
}
