// Shared helpers for the staff grading, integrity and system pages.
import { useCallback, useMemo, type ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Select, Tooltip, type SelectProps } from '@mantine/core';
import {
  api,
  type FlagRef,
  type IntegrityPenalty,
  type StaffProblemRow,
  type StaffSubmissionRow,
} from '../../api/client';

// ---------------------------------------------------------------- problems

/** A /staff/problems row. */
export type StaffProblem = StaffProblemRow;

export function useProblems() {
  return useQuery({
    queryKey: ['staff', 'problems', 'v2'],
    queryFn: api.staff.problems,
  });
}

/** One URL search param as state (replace, so filters do not flood history). */
export function useParam(name: string, fallback = ''): [string, (v: string | null) => void] {
  const [params, setParams] = useSearchParams();
  const value = params.get(name) ?? fallback;
  const set = useCallback(
    (v: string | null) =>
      setParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          if (v === null || v === '') next.delete(name);
          else next.set(name, v);
          if (name !== 'page') next.delete('page');
          return next;
        },
        { replace: true },
      ),
    [name, setParams],
  );
  return [value, set];
}

/** Selected problem kept in ?problem= ; falls back to the first published problem. */
export function useProblemSlug(fallbackToFirst = true): [string | null, (slug: string | null) => void, StaffProblem | undefined] {
  const [raw, set] = useParam('problem');
  const problems = useProblems();
  const list = problems.data ?? [];
  const first = list.find((p) => p.status === 'published') ?? list[0];
  const slug = raw || (fallbackToFirst ? first?.slug ?? null : null);
  return [slug, set, list.find((p) => p.slug === slug)];
}

export function ProblemSelect({
  value,
  onChange,
  allowAll = false,
  label,
  w = 260,
}: {
  value: string | null;
  onChange: (slug: string | null) => void;
  allowAll?: boolean;
  /** Visible label; without one the select has an aria-label (for header placement). */
  label?: string;
  w?: SelectProps['w'];
}) {
  const problems = useProblems();
  const data = (problems.data ?? []).map((p) => ({
    value: p.slug,
    label: p.status === 'published' ? p.title : `${p.title} (${p.status})`,
  }));
  return (
    <Select
      label={label}
      aria-label={label ? undefined : 'Problem'}
      placeholder={allowAll ? 'All problems' : 'Choose a problem'}
      data={data}
      value={value}
      onChange={onChange}
      clearable={allowAll}
      searchable
      w={w}
      disabled={problems.isPending}
      comboboxProps={{ withinPortal: true }}
    />
  );
}

// ---------------------------------------------------------------- submissions of a problem, by id

/** Every submission row of a problem (flags with ids), indexed by submission id. */
export function useSubmissionIndex(slug: string | null | undefined, enabled = true) {
  const q = useQuery({
    queryKey: ['staff', 'submissions', 'index', slug],
    queryFn: () => api.staff.submissions({ problem: slug ?? undefined, page_size: 1000 }),
    enabled: !!slug && enabled,
  });
  const byId = useMemo(() => {
    const m = new Map<number, StaffSubmissionRow>();
    for (const r of q.data?.items ?? []) m.set(r.id, r);
    return m;
  }, [q.data]);
  return { ...q, byId };
}

// ---------------------------------------------------------------- flags

export function isCopyFlag(type: string): boolean {
  return type.startsWith('suspected_copy') || type.startsWith('possible_copy');
}

const FLAG_NAMES: Record<string, string> = {
  compile_failed: 'Does not compile',
  suspected_infinite_loop: 'Possible infinite loop',
  missing_main: 'No main()',
  analyzer_error: 'A check failed to run',
  prompt_injection_attempt: 'Prompt injection',
  suspected_copy_peer: 'Similar to a classmate',
  suspected_copy_web: 'Similar to web code',
  suspected_copy_llm: 'Similar to AI-generated code',
  possible_copy_low_confidence: 'Possible copy',
  possible_ai_generated: 'Possibly AI-generated',
  dangerous_call: 'Unsafe call',
  blocked_by_preanalysis: 'Blocked before running',
};

export function flagName(type: string): string {
  const s = FLAG_NAMES[type] ?? type.replace(/_/g, ' ');
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** Open copy flags among a submission's flags (the ones a pair decision acts on). */
export function openCopyFlags(flags: FlagRef[] | undefined): FlagRef[] {
  return (flags ?? []).filter((f) => isCopyFlag(f.type) && f.review_status === 'open');
}

/** Copy flags in any state except dismissed. */
export function liveCopyFlags(flags: FlagRef[] | undefined): FlagRef[] {
  return (flags ?? []).filter((f) => isCopyFlag(f.type) && f.review_status !== 'dismissed');
}

export function refSubmissionId(ref: string | null | undefined): number | null {
  const m = ref ? /^sub:(\d+)$/.exec(ref) : null;
  return m ? Number(m[1]) : null;
}

export function refKind(ref: string): string {
  return ref.split(':', 1)[0];
}

export const PENALTY_EFFECT: Record<IntegrityPenalty, string> = {
  zero: 'Confirming sets the grade to 0.',
  half: 'Confirming halves the grade.',
  none: 'No integrity penalty on this problem.',
};

export function penaltyEffect(p: IntegrityPenalty | undefined): string {
  return p ? PENALTY_EFFECT[p] : 'Confirming applies this problem\'s integrity penalty, if it has one.';
}

// ---------------------------------------------------------------- cache

/**
 * Invalidate after a staff mutation. Always refreshes ['staff','overview'] so the sidebar badges
 * (open flags, queued jobs) follow.
 */
export function useInvalidate() {
  const qc = useQueryClient();
  return useCallback(
    (...keys: unknown[][]) => {
      qc.invalidateQueries({ queryKey: ['staff', 'overview'] });
      for (const k of keys) qc.invalidateQueries({ queryKey: k });
    },
    [qc],
  );
}

/** Keys touched by a flag decision. */
export const FLAG_KEYS: unknown[][] = [
  ['staff', 'submissions'],
  ['staff', 'gradebook'],
  ['staff', 'leaderboard'],
  ['staff', 'problems'],
  ['submission'],
];

// ---------------------------------------------------------------- formatting

export function plural(n: number, one: string, many = `${one}s`): string {
  return `${n.toLocaleString()} ${n === 1 ? one : many}`;
}

export function fmtInt(n: number | null | undefined): string {
  return n === null || n === undefined ? '-' : n.toLocaleString();
}

export function fmtSim(s: number | null | undefined): string {
  return s === null || s === undefined ? '-' : `${Math.round(s * 100)}%`;
}

export function fmtDuration(s: number | null | undefined): string {
  if (s === null || s === undefined) return '-';
  if (s < 60) return `${s.toFixed(s < 10 ? 1 : 0)} s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} min ${Math.round(s % 60)} s`;
  return `${Math.floor(m / 60)} h ${m % 60} min`;
}

function csvCell(v: unknown): string {
  if (v === null || v === undefined) return '';
  const s = String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(rows: unknown[][]): string {
  return rows.map((r) => r.map(csvCell).join(',')).join('\n') + '\n';
}

/** Wraps a disabled control in a tooltip that says why. */
export function WhyDisabled({ reason, children }: { reason: string | null | false | undefined; children: ReactNode }) {
  if (!reason) return <>{children}</>;
  return (
    <Tooltip label={reason} multiline maw={280}>
      <span style={{ display: 'inline-flex' }} tabIndex={0}>
        {children}
      </span>
    </Tooltip>
  );
}
