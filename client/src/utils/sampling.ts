/**
 * The sampling block's arithmetic. A copy of server/src/utils/sampling.ts,
 * which the PDF generator uses, following the same convention as
 * client wording and server/src/utils/wording.ts: the two workspaces do not
 * share a package, so the pair must be kept in step.
 */

export const SAMPLING_PHOTO_LABEL = 'Sampling';

export const SAMPLING_COMPONENTS = [
  { key: 'in_scope_kg', label: 'Post Consumer Packaging In Scope' },
  { key: 'out_of_scope_kg', label: 'Post Consumer Packaging NOT In Scope' },
  { key: 'non_packaging_kg', label: 'Non-Packaging' },
  { key: 'contamination_kg', label: 'Contamination' },
  { key: 'prohibited_kg', label: 'Prohibited Items' },
] as const;

export type SamplingComponentKey = (typeof SAMPLING_COMPONENTS)[number]['key'];

/** Weights within this many kilograms of the sample size are treated as adding up. */
export const SAMPLING_BALANCE_TOLERANCE_KG = 0.1;

export function toWeight(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const num = typeof value === 'number' ? value : Number(String(value).trim());
  return Number.isFinite(num) ? num : null;
}

export function samplingPercent(value: unknown, sampleSize: unknown): number | null {
  const weight = toWeight(value);
  const total = toWeight(sampleSize);
  if (weight === null || total === null || total === 0) return null;
  return Math.round((weight / total) * 1000) / 10;
}

export function formatSamplingPercent(value: unknown, sampleSize: unknown): string {
  const pct = samplingPercent(value, sampleSize);
  return pct === null ? '' : `${pct.toFixed(1)}%`;
}

export interface SamplingTotals {
  accountedKg: number | null;
  accountedPercent: number | null;
  differenceKg: number | null;
  outOfBalance: boolean;
}

export function samplingTotals(sampling: Record<string, unknown> | null | undefined): SamplingTotals {
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
