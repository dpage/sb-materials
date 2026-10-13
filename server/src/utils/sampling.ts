/**
 * The sampling block: the bale break reworked as weights in kilograms with a
 * percentage of the sample size alongside each one. Shared by the API, the PDF
 * generator and (through the client's own copy of the type) the form, so the
 * arithmetic exists in exactly one place.
 */

export interface SamplingRow {
  report_id?: number;
  not_carried_out?: number | null;
  not_carried_out_reason?: string | null;
  sample_size_kg?: number | null;
  in_scope_kg?: number | null;
  out_of_scope_kg?: number | null;
  non_packaging_kg?: number | null;
  contamination_kg?: number | null;
  prohibited_kg?: number | null;
  prohibited_items?: string | null;
  product_description?: string | null;
  product_grade?: string | null;
  pern_prn_claimed_percent?: number | null;
  contamination_limit_percent?: number | null;
  comments?: string | null;
}

/** The component weights, in the order they are shown and printed. */
export const SAMPLING_COMPONENTS = [
  { key: 'in_scope_kg', label: 'Post Consumer Packaging In Scope' },
  { key: 'out_of_scope_kg', label: 'Post Consumer Packaging NOT In Scope' },
  { key: 'non_packaging_kg', label: 'Non-Packaging' },
  { key: 'contamination_kg', label: 'Contamination' },
  { key: 'prohibited_kg', label: 'Prohibited Items' },
] as const;

export type SamplingComponentKey = (typeof SAMPLING_COMPONENTS)[number]['key'];

/**
 * A weight as it arrives from the form, which sends whatever was typed. Returns
 * null for anything that is not a finite number, so an empty or half-typed box
 * is stored as absent rather than as zero.
 */
export function toWeight(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const num = typeof value === 'number' ? value : Number(String(value).trim());
  return Number.isFinite(num) ? num : null;
}

/**
 * A component weight as a percentage of the sample size, or null when there is
 * nothing to divide by. Rounded to one decimal place, which is as fine as a set
 * of scales and a bale break warrant.
 */
export function samplingPercent(
  value: number | null | undefined,
  sampleSize: number | null | undefined,
): number | null {
  const weight = toWeight(value);
  const total = toWeight(sampleSize);
  if (weight === null || total === null || total === 0) return null;
  return Math.round((weight / total) * 1000) / 10;
}

/** A percentage for display: "12.5%", or an empty string when it cannot be worked out. */
export function formatSamplingPercent(value: number | null | undefined, sampleSize: number | null | undefined): string {
  const pct = samplingPercent(value, sampleSize);
  return pct === null ? '' : `${pct.toFixed(1)}%`;
}

/**
 * Weights within this many kilograms of the sample size are treated as adding
 * up. Entry is by hand off a set of scales, so insisting on exactness would
 * cry wolf over rounding.
 */
export const SAMPLING_BALANCE_TOLERANCE_KG = 0.1;

export interface SamplingTotals {
  /** The component weights summed, or null when none of them is filled in. */
  accountedKg: number | null;
  /** That sum as a percentage of the sample size. */
  accountedPercent: number | null;
  /** Sum minus sample size: positive means more was weighed than was sampled. */
  differenceKg: number | null;
  /** True when the sum and the sample size differ by more than the tolerance. */
  outOfBalance: boolean;
}

export function samplingTotals(sampling: SamplingRow | null | undefined): SamplingTotals {
  const empty: SamplingTotals = { accountedKg: null, accountedPercent: null, differenceKg: null, outOfBalance: false };
  if (!sampling) return empty;

  const weights = SAMPLING_COMPONENTS.map((c) => toWeight(sampling[c.key])).filter((w): w is number => w !== null);
  if (!weights.length) return empty;

  const accountedKg = Math.round(weights.reduce((sum, w) => sum + w, 0) * 1000) / 1000;
  const sampleSize = toWeight(sampling.sample_size_kg);
  const differenceKg = sampleSize === null ? null : Math.round((accountedKg - sampleSize) * 1000) / 1000;

  return {
    accountedKg,
    accountedPercent: samplingPercent(accountedKg, sampleSize),
    differenceKg,
    outOfBalance: differenceKg !== null && Math.abs(differenceKg) > SAMPLING_BALANCE_TOLERANCE_KG,
  };
}

/** True when the row holds nothing worth saving or printing. */
export function isSamplingEmpty(sampling: SamplingRow | null | undefined): boolean {
  if (!sampling) return true;
  if (sampling.not_carried_out) return false;
  const fields: (keyof SamplingRow)[] = [
    'not_carried_out_reason',
    'sample_size_kg',
    'in_scope_kg',
    'out_of_scope_kg',
    'non_packaging_kg',
    'contamination_kg',
    'prohibited_kg',
    'prohibited_items',
    'product_description',
    'product_grade',
    'pern_prn_claimed_percent',
    'contamination_limit_percent',
    'comments',
  ];
  return fields.every((f) => {
    const value = sampling[f];
    return value === null || value === undefined || value === '';
  });
}

/**
 * Reserved photo_label grouping the sampling evidence photos, in the same way
 * 'Moisture Readings' groups the moisture ones.
 */
export const SAMPLING_PHOTO_LABEL = 'Sampling';

export const SAMPLING_HEADING = 'Sampling';
export const SAMPLING_NOT_CARRIED_OUT_LABEL = 'Sampling not carried out';
export const SAMPLING_SAMPLE_SIZE_LABEL = 'Sample Size';
export const SAMPLING_TOTAL_LABEL = 'Total Accounted For';
export const SAMPLING_PRODUCT_DESCRIPTION_LABEL = 'Product Description';
export const SAMPLING_PRODUCT_GRADE_LABEL = 'Product Grade';
export const SAMPLING_PROHIBITED_ITEMS_LABEL = 'Prohibited Items Found';
export const SAMPLING_CLAIMED_LABEL = 'PERN/PRN % Claimed';
export const SAMPLING_LIMIT_LABEL = 'Contamination Maximum Limit %';
export const SAMPLING_COMMENTS_LABEL = 'Sampling Comments';
