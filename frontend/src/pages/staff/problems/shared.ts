// Shared helpers for the staff problem pages (list, create wizard, edit tabs).
import { get, type GradePolicy, type IntegrityPenalty, type ProblemStatus } from '../../../api/client';

const enc = encodeURIComponent;

export const SLUG_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/;

/** "Sum of two integers!" -> "sum_of_two_integers" */
export function slugify(title: string): string {
  return title
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 64);
}

/**
 * Staff view of one problem. The contract has no staff detail route, so this is GET /problems/{slug},
 * which adds rules_json, statement_raw and the settings fields when the caller is staff.
 */
export interface StaffProblemDetail {
  slug: string;
  title: string;
  status: ProblemStatus;
  due_at: string | null;
  opens_at: string | null;
  finalized_at?: string | null;
  finalized?: boolean;
  version: number;
  grade_policy: GradePolicy;
  max_submissions_per_hour: number;
  show_best_after_deadline?: boolean;
  reveal_hidden_tests?: boolean;
  integrity_penalty?: IntegrityPenalty;
  statement_md: string;
  statement_raw?: string;
  sample_input?: string;
  rules_json?: Record<string, unknown> | null;
  rules_hash?: string | null;
  inputs_hash?: string | null;
}

export const problemDetail = (slug: string) => get<StaffProblemDetail>(`/problems/${enc(slug)}`);

// ---------------------------------------------------------------- rules
export interface MetricRow {
  name: string;
  analyzer: string;
  /** 0..1 */
  weight: number;
  params?: Record<string, unknown>;
  [k: string]: unknown;
}

export interface Rules {
  problem: string;
  time_limit_s: number;
  memory_limit_mb: number;
  metrics: MetricRow[];
  [k: string]: unknown;
}

/** Analyzer -> what staff see in the metric editor. Mirrors METRIC_LABELS in backend/api/problems.py. */
export const ANALYZERS: Record<string, { label: string; hint: string; params?: Record<string, unknown>; needsGenerator?: boolean }> = {
  io_tests: { label: 'Correctness', hint: 'Runs the hidden tests and compares output', params: { testset_dir: 'tests/' } },
  compiler_warnings: { label: 'Clean build', hint: 'Warnings and errors under strict flags', params: { flags: '-Wall -Wextra -Werror -std=c11' } },
  static_analysis: { label: 'Structure', hint: 'Function length and branching', params: { max_cyclomatic: 8, max_function_length: 40 } },
  function_split: { label: 'Modularity', hint: 'Helper functions instead of one long main', params: { expect_helpers: true, min_functions: 2 } },
  edge_case_runner: { label: 'Edge cases', hint: 'Needs input_spec.generator', params: { random_trials: 100, seed: 7 }, needsGenerator: true },
  complexity_estimator: { label: 'Efficiency', hint: 'Needs input_spec.generator', params: { sizes: [1, 10, 100] }, needsGenerator: true },
  sanitizer_run: { label: 'Memory safety', hint: 'AddressSanitizer and UBSan', params: { flags: '-fsanitize=address,undefined' } },
  llm_review: { label: 'Readability', hint: 'Fixed rubric; optional AI advice does not affect marks', params: { provider: 'ollama', temperature: 0, seed: 42 } },
  similarity_flag: { label: 'Similarity review', hint: 'Compare available sources; no originality percentage or automatic mark deduction', params: { corpus_dir: 'submissions/', flag_threshold: 0.85 } },
  codacy_review: { label: 'Code quality', hint: 'Static analysis rules' },
  ai_detector: { label: 'AI-origin check', hint: 'Staff-only signal; use weight 0' },
};

export function analyzerLabel(a: string): string {
  return ANALYZERS[a]?.label ?? a.replace(/_/g, ' ');
}

/** A neutral starting point: no input generator, so it works for any problem with a reference and tests. */
export function templateRules(slug: string): Rules {
  const m = (name: string, analyzer: string, weight: number): MetricRow => ({
    name,
    analyzer,
    weight,
    ...(ANALYZERS[analyzer]?.params ? { params: { ...ANALYZERS[analyzer].params } } : {}),
  });
  return {
    problem: slug || 'my_problem',
    time_limit_s: 1,
    memory_limit_mb: 64,
    reference_solution: 'reference.c',
    sample_input: 'sample.in',
    metrics: [
      m('correctness', 'io_tests', 0.4),
      m('syntax', 'compiler_warnings', 0.1),
      m('structure', 'static_analysis', 0.1),
      m('modularity', 'function_split', 0.1),
      m('memory_safety', 'sanitizer_run', 0.15),
      m('readability', 'llm_review', 0.15),
      m('originality', 'similarity_flag', 0),
      m('code_quality', 'codacy_review', 0),
      m('ai_origin_signal', 'ai_detector', 0),
    ],
  };
}

export const rulesText = (r: unknown) => JSON.stringify(r, null, 2);

export interface ParsedRules {
  value: Rules | null;
  error: string | null;
}

export function parseRules(text: string): ParsedRules {
  try {
    const v = JSON.parse(text);
    if (!v || typeof v !== 'object' || Array.isArray(v)) return { value: null, error: 'The rules must be a JSON object.' };
    return { value: { ...v, metrics: Array.isArray(v.metrics) ? v.metrics : [] } as Rules, error: null };
  } catch (e) {
    return { value: null, error: `This is not valid JSON: ${(e as Error).message}` };
  }
}

export function weightSum(metrics: MetricRow[]): number {
  return metrics.reduce((s, m) => s + (typeof m.weight === 'number' && Number.isFinite(m.weight) ? m.weight : 0), 0);
}

/** Round to 4 decimals so 0.1 + 0.2 shows as 0.3. */
export const r4 = (n: number) => Math.round(n * 10000) / 10000;

// ---------------------------------------------------------------- dates
/** ISO -> value for <input type="datetime-local"> in local time. */
export function toLocalInput(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function fromLocalInput(v: string): string | null {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

export const STATUS_LABEL: Record<ProblemStatus, string> = { draft: 'Draft', published: 'Published', archived: 'Archived' };
