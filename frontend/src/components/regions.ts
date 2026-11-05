import type { Region } from '../api/types';

export const REGION_COLORS = ['#ffec99', '#a5d8ff', '#b2f2bb', '#ffc9c9', '#d0bfff', '#ffd8a8'];

/** Accepts {a_start,a_end,b_start,b_end} or {a:[s,e], b:[s,e]}. Lines are 1-based. */
export function normalizeRegion(r: unknown): Region | null {
  if (!r || typeof r !== 'object') return null;
  const o = r as Record<string, unknown>;
  if (Array.isArray(o.a) && Array.isArray(o.b)) {
    return { a_start: Number(o.a[0]), a_end: Number(o.a[1]), b_start: Number(o.b[0]), b_end: Number(o.b[1]) };
  }
  if (typeof o.a_start === 'number' && typeof o.b_start === 'number') {
    return {
      a_start: o.a_start,
      a_end: Number(o.a_end ?? o.a_start),
      b_start: o.b_start,
      b_end: Number(o.b_end ?? o.b_start),
    };
  }
  return null;
}
