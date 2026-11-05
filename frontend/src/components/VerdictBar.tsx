import { useEffect, useState } from 'react';
import { Box, Stack, Text, Tooltip } from '@mantine/core';
import { useReducedMotion } from '@mantine/hooks';
import type { MetricEntry } from '../api/types';
import { isInformational } from '../metrics';
import classes from './VerdictBar.module.css';

export type SegmentStatus = 'pass' | 'partial' | 'fail' | 'skipped';

export interface VerdictSegment {
  key: string;
  /** Human label, e.g. "Memory safety". */
  label: string;
  /** Relative width; the bar normalises the weights. */
  weight: number;
  /** 0..1, or null when skipped. */
  score: number | null;
  status: SegmentStatus;
  /** Why it scored what it did (metric feedback). */
  reason?: string;
}

export interface VerdictBarProps {
  segments: VerdictSegment[];
  /** lg: 14px, focusable segments with tooltips (report header). sm: 6px, for lists. */
  size?: 'lg' | 'sm';
  /** Fill left to right on first mount. Defaults to true for lg. Reduced motion turns it off. */
  animate?: boolean;
  /** Overrides the generated screen-reader summary. */
  'aria-label'?: string;
  /** sm only: wrap in a tooltip that lists every segment (default true). */
  summaryTooltip?: boolean;
}

export function segmentStatus(score: number | null, skipped = false): SegmentStatus {
  if (skipped || score === null) return 'skipped';
  if (score >= 0.999) return 'pass';
  if (score <= 0.001) return 'fail';
  return 'partial';
}

const PRETTY: Record<string, string> = {
  io_tests: 'Correctness',
  hidden_tests: 'Hidden tests',
  memory_safety: 'Memory safety',
  valgrind: 'Memory safety',
  compiler_warnings: 'Compiler warnings',
  static_analysis: 'Static analysis',
  function_split: 'Structure',
  similarity_flag: 'Similarity review',
  codacy_review: 'Code quality',
  llm_review: 'Review',
  performance: 'Speed',
  complexity: 'Complexity',
};

export function metricLabel(m: { name: string; analyzer?: string; label?: string }): string {
  if (m.label) return m.label;
  const k = PRETTY[m.name] ?? (m.analyzer ? PRETTY[m.analyzer] : undefined);
  if (k) return k;
  const s = m.name.replace(/[_-]+/g, ' ').trim();
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** Report metrics -> bar segments. Metrics with weight 0 are left out. */
export function metricsToSegments(metrics: MetricEntry[]): VerdictSegment[] {
  return metrics
    .filter((m) => m.weight > 0 && !isInformational(m))
    .map((m) => {
      const skipped = m.status === 'skipped';
      return {
        key: m.name,
        label: metricLabel(m),
        weight: m.weight,
        score: skipped ? null : m.score,
        status: segmentStatus(skipped ? null : m.score, skipped),
        reason: m.feedback,
      };
    });
}

const STATUS_TEXT: Record<SegmentStatus, string> = {
  pass: 'full marks',
  partial: 'partial credit',
  fail: 'no marks',
  skipped: 'not graded',
};

function pct(x: number) {
  return `${Math.round(x * 100)}%`;
}

function summary(segments: VerdictSegment[]): string {
  return segments
    .map((s) => `${s.label}: ${s.score === null ? 'not graded' : pct(s.score)}`)
    .join('; ');
}

/** The verdict bar: one segment per metric, width = weight, fill = score. */
export function VerdictBar({ segments, size = 'lg', animate, 'aria-label': ariaLabel, summaryTooltip = true }: VerdictBarProps) {
  const reduced = useReducedMotion();
  const shouldAnimate = (animate ?? size === 'lg') && !reduced;
  const [filled, setFilled] = useState(!shouldAnimate);
  useEffect(() => {
    if (!shouldAnimate) return;
    const id = requestAnimationFrame(() => requestAnimationFrame(() => setFilled(true)));
    return () => cancelAnimationFrame(id);
  }, [shouldAnimate]);

  const total = segments.reduce((s, x) => s + Math.max(0, x.weight), 0) || 1;
  const label = ariaLabel ?? `Score by check. ${summary(segments)}`;
  const lg = size === 'lg';

  if (!segments.length) {
    return <Box className={classes.bar} data-size={size} data-empty role="img" aria-label="No checks to show" />;
  }

  const bar = (
    <div className={classes.bar} data-size={size} role={lg ? 'group' : 'img'} aria-label={label}>
      {segments.map((s, i) => {
        const fill = s.status === 'skipped' ? 0 : s.status === 'fail' ? 1 : Math.max(0, Math.min(1, s.score ?? 0));
        const seg = (
          <div
            key={s.key}
            className={classes.seg}
            data-status={s.status}
            style={{ flexGrow: Math.max(0, s.weight), flexBasis: 0 }}
            tabIndex={lg ? 0 : undefined}
            aria-label={lg ? `${s.label}: ${s.score === null ? 'not graded' : pct(s.score)}, weight ${Math.round((s.weight / total) * 100)}%` : undefined}
          >
            <div
              className={classes.fill}
              style={{
                transform: `scaleX(${filled ? fill : 0})`,
                transitionDelay: shouldAnimate ? `${120 + i * 70}ms` : undefined,
              }}
            />
          </div>
        );
        if (!lg) return seg;
        return (
          <Tooltip
            key={s.key}
            events={{ hover: true, focus: true, touch: true }}
            label={
              <Stack gap={2}>
                <Text size="sm" fw={600}>
                  {s.label}
                </Text>
                <Text size="sm" className="ag-num">
                  {s.score === null ? 'Not graded' : `${pct(s.score)}, ${STATUS_TEXT[s.status]}`}. Weight{' '}
                  {Math.round((s.weight / total) * 100)}% of the grade.
                </Text>
                {s.reason && (
                  <Text size="sm" c="dimmed" lineClamp={4}>
                    {s.reason}
                  </Text>
                )}
              </Stack>
            }
          >
            {seg}
          </Tooltip>
        );
      })}
    </div>
  );

  if (lg || !summaryTooltip) return bar;
  return (
    <Tooltip
      label={
        <Stack gap={0}>
          {segments.map((s) => (
            <Text key={s.key} size="xs" className="ag-num">
              {s.label}: {s.score === null ? 'not graded' : pct(s.score)}
            </Text>
          ))}
        </Stack>
      }
    >
      {bar}
    </Tooltip>
  );
}
