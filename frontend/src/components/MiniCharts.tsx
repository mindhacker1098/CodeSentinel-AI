import { Box, Tooltip } from '@mantine/core';

/**
 * Light SVG charts for stat cards and the gradebook (no chart library needed).
 * For larger charts, @mantine/charts + recharts are installed.
 */

export interface HistogramProps {
  /** Counts per bucket, e.g. 10 grade buckets 0-9 ... 90-100. */
  bins: number[];
  height?: number;
  /** Bucket label for tooltips; default "0-9", ..., "90-100" for 10 bins. */
  binLabel?: (i: number) => string;
  /** Colour by bucket position: low = fail, mid = warn, high = pass (for grade histograms). */
  graded?: boolean;
  'aria-label'?: string;
}

const gradeBin = (i: number, n: number) => {
  const lo = Math.round((i * 100) / n);
  const hi = i === n - 1 ? 100 : Math.round(((i + 1) * 100) / n) - 1;
  return `${lo}-${hi}`;
};

export function Histogram({ bins, height = 40, binLabel, graded = true, 'aria-label': ariaLabel }: HistogramProps) {
  const max = Math.max(1, ...bins);
  const n = bins.length || 1;
  const label = (i: number) => (binLabel ? binLabel(i) : gradeBin(i, n));
  const color = (i: number) => {
    if (!graded) return 'var(--ag-iris)';
    const mid = ((i + 0.5) * 100) / n;
    return mid >= 80 ? 'var(--ag-pass)' : mid >= 40 ? 'var(--ag-warn)' : 'var(--ag-fail)';
  };
  return (
    <Box
      role="img"
      aria-label={ariaLabel ?? `Distribution: ${bins.map((b, i) => `${label(i)}: ${b}`).join(', ')}`}
      style={{ display: 'flex', alignItems: 'flex-end', gap: 2, height }}
    >
      {bins.map((b, i) => (
        <Tooltip key={i} label={`${label(i)}: ${b}`} openDelay={0}>
          <div
            style={{
              flex: 1,
              height: b ? Math.max(2, (b / max) * height) : 1,
              background: b ? color(i) : 'var(--ag-line)',
              opacity: b ? 0.85 : 1,
              borderRadius: '2px 2px 0 0',
            }}
          />
        </Tooltip>
      ))}
    </Box>
  );
}

export interface SparklineProps {
  values: number[];
  width?: number;
  height?: number;
  color?: string;
  'aria-label'?: string;
}

export function Sparkline({ values, width = 120, height = 28, color = 'var(--ag-iris)', 'aria-label': ariaLabel }: SparklineProps) {
  if (values.length < 2) return <svg width={width} height={height} aria-hidden />;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const pts = values.map((v, i) => [(i / (values.length - 1)) * (width - 2) + 1, height - 2 - ((v - min) / span) * (height - 4)]);
  const d = pts.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`).join(' ');
  const [lx, ly] = pts[pts.length - 1];
  return (
    <svg width={width} height={height} role="img" aria-label={ariaLabel ?? `Trend, latest ${values[values.length - 1]}`}>
      <path d={d} fill="none" stroke={color} strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={lx} cy={ly} r={2.2} fill={color} />
    </svg>
  );
}
