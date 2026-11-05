export function fmtGrade(g: number | null | undefined): string {
  if (g === null || g === undefined || Number.isNaN(g)) return '-';
  return Number.isInteger(g) ? String(g) : g.toFixed(1);
}

export function gradeColor(g: number | null | undefined): string {
  if (g === null || g === undefined) return 'gray';
  if (g >= 85) return 'green';
  if (g >= 65) return 'lime';
  if (g >= 45) return 'yellow';
  if (g >= 25) return 'orange';
  return 'red';
}

export function scoreColor(s: number): string {
  return gradeColor(s * 100);
}

export function fmtPct(s: number | null | undefined): string {
  if (s === null || s === undefined) return '-';
  return `${Math.round(s * 100)}%`;
}

export function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '-';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

/** "in 2 days", "3 hours ago" */
export function fmtRelative(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return '';
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return '';
  const diff = t - now;
  const abs = Math.abs(diff);
  const units: [number, string][] = [
    [86_400_000, 'day'],
    [3_600_000, 'hour'],
    [60_000, 'minute'],
  ];
  for (const [ms, name] of units) {
    if (abs >= ms) {
      const n = Math.floor(abs / ms);
      const s = `${n} ${name}${n === 1 ? '' : 's'}`;
      return diff > 0 ? `in ${s}` : `${s} ago`;
    }
  }
  return diff > 0 ? 'in under a minute' : 'just now';
}

export function isPast(iso: string | null | undefined): boolean {
  return !!iso && new Date(iso).getTime() < Date.now();
}
