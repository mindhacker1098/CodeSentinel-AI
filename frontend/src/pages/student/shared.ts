// Helpers shared by the student pages (and the report reused by staff). No JSX here.
import type {
  Counterexample,
  GradingStage,
  JobStatus,
  MetricEntry,
  MetricSpec,
  ProblemSummary,
  Report,
  SubmissionSummary,
} from '../../api/client';
import { metricsToSegments, type VerdictSegment } from '../../components';

export const COURSE = 'CS5103 lab';

// ---------------------------------------------------------------- metric labels
/** Same human labels as the backend's METRIC_LABELS (docs/API_V2.md), keyed by analyzer. */
const ANALYZER_LABEL: Record<string, string> = {
  io_tests: 'Correctness',
  compiler_warnings: 'Clean build',
  static_analysis: 'Structure',
  function_split: 'Modularity',
  edge_case_runner: 'Edge cases',
  complexity_estimator: 'Efficiency',
  sanitizer_run: 'Memory safety',
  llm_review: 'Readability',
  similarity_flag: 'Similarity review',
  codacy_review: 'Code quality',
  ai_detector: 'AI-origin check',
};

function titleCase(s: string) {
  const t = s.replace(/[_-]+/g, ' ').trim();
  return t.charAt(0).toUpperCase() + t.slice(1);
}

/** Label for a report metric: the problem's label for that metric name, then the analyzer table. */
export function labelFor(m: { name: string; analyzer?: string; label?: string }, specs?: MetricSpec[]): string {
  if (m.label) return m.label;
  const spec = specs?.find((s) => s.name === m.name);
  if (spec?.label) return spec.label;
  if (m.analyzer && ANALYZER_LABEL[m.analyzer]) return ANALYZER_LABEL[m.analyzer];
  return titleCase(m.name);
}

export function labelled(metrics: MetricEntry[], specs?: MetricSpec[]): MetricEntry[] {
  return metrics.map((m) => ({ ...m, label: labelFor(m, specs), feedback: m.feedback ? sentence(cleanText(m.feedback)) : m.feedback }));
}

/** Capital first letter and a closing full stop. */
export function sentence(s: string): string {
  const t = s.trim();
  if (!t) return t;
  const c = t.charAt(0).toUpperCase() + t.slice(1);
  return /[.!?)"']$/.test(c) ? c : `${c}.`;
}

/** The report's metrics; when the program does not compile, the checks that could not run count as 0, not skipped. */
export function scoredMetrics(report: Report): MetricEntry[] {
  const ms = report.metrics ?? [];
  if (compiled(report)) return ms;
  return ms.map((m) => (m.status === 'skipped' ? { ...m, status: 'ok', score: 0, contribution: 0 } : m));
}

export function segmentsFor(report: Report | null | undefined, specs?: MetricSpec[]): VerdictSegment[] {
  if (!report?.metrics?.length) return [];
  return metricsToSegments(labelled(scoredMetrics(report), specs));
}

/** Words students should never see, and analyzer ids, replaced in free text (logs, feedback). */
const SYSTEM_WORDS: [RegExp, string][] = [
  [/\benrich(?:ment|ed|ing)?\b/gi, 'feedback'],
  [/\bworkers?\b/gi, 'grader'],
  [/\bjobs?\b/gi, 'grading'],
  [/\bSSE\b/g, 'live updates'],
];

export function humanize(text: string): string {
  let t = text;
  for (const [id, label] of Object.entries(ANALYZER_LABEL)) {
    t = t.replace(new RegExp(`\\b${id}\\b:?`, 'g'), (m) => (m.endsWith(':') ? `${label}:` : label));
  }
  for (const [re, w] of SYSTEM_WORDS) t = t.replace(re, w);
  return t;
}

/** Tidy machine-joined sentences: ".;" "..", " ." and doubled spaces. */
export function cleanText(s: string): string {
  return s
    .replace(/\.\s*;/g, ';')
    .replace(/;\s*\./g, '.')
    .replace(/\.{2,}(?!\.)/g, '.')
    .replace(/\s+([.,;:])/g, '$1')
    .replace(/([;,])(?=[A-Za-z(])/g, '$1 ')
    .replace(/([a-z]{2,}\.)(?=[A-Z])/g, '$1 ')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

// ---------------------------------------------------------------- problems
export type ProblemState = 'not-started' | 'grading' | 'graded' | 'failed';

export function problemState(p: ProblemSummary): ProblemState {
  const js = p.my_latest?.job_status;
  if (js === 'queued' || js === 'running') return 'grading';
  if (!p.my_count && !p.my_latest) return 'not-started';
  if ((js === 'failed' || js === 'cancelled') && p.my_latest?.grade == null) return 'failed';
  return 'graded';
}

/** The snapshot that counts under the grade policy. */
export function countedGrade(p: ProblemSummary): number | null {
  const s = p.grade_policy === 'best' ? p.my_best : p.my_latest;
  return s?.grade ?? p.my_latest?.grade ?? null;
}

export const isActive = (s: JobStatus | null | undefined) => s === 'queued' || s === 'running';

export const POLICY_TEXT: Record<string, string> = {
  best: 'Best submission counts',
  latest: 'Latest submission counts',
};

export function plural(n: number, w: string, ws = `${w}s`) {
  return `${n} ${n === 1 ? w : ws}`;
}

export function firstName(name: string | null | undefined, roll: string): string {
  const n = (name ?? '').trim();
  if (!n || n.toUpperCase() === roll.toUpperCase()) return roll;
  return n.split(/\s+/)[0];
}

export function greeting(d = new Date()): string {
  const h = d.getHours();
  if (h < 5) return 'Working late';
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  return 'Good evening';
}

// ---------------------------------------------------------------- statement
/** Removes a leading "# Title" that repeats the problem title (the API strips it; this guards against old data). */
export function stripTitle(md: string, title: string): string {
  const m = /^\s*#\s+(.+?)\s*#*\s*\n/.exec(md);
  if (!m) return md;
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '');
  return norm(m[1]) === norm(title) ? md.slice(m[0].length) : md;
}

/** Removes "Sample input/output" headings with their fenced block, since the page shows them as copyable blocks. */
export function stripSamples(md: string): string {
  return md.replace(
    /^[ \t]*(?:#{1,6}[ \t]*)?(?:\*\*|__)?sample[ \t]+(?:input|output)s?:?(?:\*\*|__)?:?[ \t]*\n(?:[ \t]*\n)*[ \t]*```[^\n]*\n[\s\S]*?\n[ \t]*```[ \t]*(?:\n|$)/gim,
    '',
  );
}

// ---------------------------------------------------------------- grading stages
export const STAGES: { key: GradingStage; label: string }[] = [
  { key: 'queued', label: 'Queued' },
  { key: 'compile', label: 'Compiling' },
  { key: 'tests', label: 'Running tests' },
  { key: 'memory', label: 'Memory check' },
  { key: 'quality', label: 'Code quality' },
  { key: 'review', label: 'Review' },
  { key: 'done', label: 'Done' },
];

export function stageIndex(s: GradingStage | null | undefined): number {
  if (!s) return 0;
  const i = STAGES.findIndex((x) => x.key === s);
  return i < 0 ? 0 : i;
}

// ---------------------------------------------------------------- report details
export function metricBy(r: Report | null | undefined, analyzer: string): MetricEntry | undefined {
  return r?.metrics?.find((m) => m.analyzer === analyzer);
}

export interface TestCounts {
  passed: number;
  total: number;
}

export function testCounts(r: Report | null | undefined): TestCounts | null {
  const ev = metricBy(r, 'io_tests')?.evidence as { tests_passed?: number; tests_total?: number } | undefined;
  if (!ev || typeof ev.tests_total !== 'number') return null;
  return { passed: ev.tests_passed ?? 0, total: ev.tests_total };
}

export function compiled(r: Report | null | undefined): boolean {
  if (!r) return true;
  if (r.first_pass?.compiled === false) return false;
  return !(r.flags ?? []).some((f) => f.type === 'compile_failed');
}

const SOURCE_LABEL: Record<string, { label: string; tip: string }> = {
  'hidden test': { label: 'Hidden test', tip: 'One of the test cases the course uses for grading.' },
  'edge case': { label: 'Edge case', tip: 'A tricky input (zero, negatives, limits) compared with the reference solution.' },
  'generated counter-example': { label: 'Random test', tip: 'A random input where your output differs from the reference solution.' },
  'LLM-suggested, execution-confirmed': {
    label: 'AI-suggested, confirmed by running',
    tip: 'An AI read your code and suggested this input. It only appears here because running your program on it really failed.',
  },
};

export function sourceLabel(src: string | undefined): { label: string; tip: string } | null {
  if (!src) return null;
  return SOURCE_LABEL[src] ?? { label: titleCase(src), tip: '' };
}

export const HIDDEN = '(hidden test)';

/** Counterexamples with the matching explanation merged into `why` (so there is no separate Explanations list). */
export function failures(r: Report): Counterexample[] {
  const ex = r.enrichment?.explanations ?? [];
  const used = new Set<number>();
  const out = (r.counterexamples ?? []).map((c) => {
    const i = ex.findIndex((e, k) => !used.has(k) && e.input !== undefined && e.input === c.input && c.input !== HIDDEN);
    if (i < 0) return { ...c, why: c.why ? cleanText(c.why) : c.why };
    used.add(i);
    const extra = cleanText(ex[i].text);
    const why = c.why ? cleanText(c.why) : '';
    return { ...c, why: why && !why.includes(extra) && !extra.includes(why) ? `${why} ${extra}` : extra || why };
  });
  return out;
}

/** Where a counterexample came from, best evidence first. Unknown sources go last. */
const SOURCE_RANK: Record<string, number> = {
  'edge case': 0,
  'generated counter-example': 1,
  'LLM-suggested, execution-confirmed': 2,
  'hidden test': 3,
};

function isCrashOrTimeout(c: Counterexample): boolean {
  return c.status === 'timeout' || c.status === 'crash' || c.status === 'nonzero_exit' || /runtime error|crash|time limit/i.test(c.note ?? '');
}

export interface FailureGroups {
  /** Failing inputs the student can see: wrong answers by source (edge, random, AI-confirmed), then crashes and timeouts. */
  visible: Counterexample[];
  /** Hidden tests that fail; their inputs are secret. */
  hidden: Counterexample[];
  /** Hidden tests run in total, when the report says. */
  hiddenTotal: number | null;
  /** Items in the Failures tab: each visible input plus one card for all hidden tests. */
  count: number;
}

export function failureGroups(r: Report): FailureGroups {
  const all = failures(r);
  const hidden = all.filter((c) => c.input === HIDDEN);
  const rank = (c: Counterexample) => (isCrashOrTimeout(c) ? 10 : 0) + (SOURCE_RANK[c.source ?? ''] ?? 5);
  const visible = all
    .filter((c) => c.input !== HIDDEN)
    .map((c, i) => ({ c, i }))
    .sort((x, y) => rank(x.c) - rank(y.c) || x.i - y.i)
    .map((x) => x.c);
  const ev = metricBy(r, 'io_tests')?.evidence as { tests_total?: number } | undefined;
  return { visible, hidden, hiddenTotal: typeof ev?.tests_total === 'number' ? ev.tests_total : null, count: visible.length + (hidden.length ? 1 : 0) };
}

/** Names of the edge-case categories the problem checks ("large values", "negatives"), from the report. */
export function edgeCaseNames(r: Report): string[] {
  for (const m of r.metrics ?? []) {
    const cats = (m.evidence as { categories?: Record<string, unknown> } | undefined)?.categories;
    if (cats && typeof cats === 'object') return Object.keys(cats).map((k) => k.replace(/_/g, ' '));
  }
  return [];
}

const STATUS_NOTE: Record<string, string> = {
  timeout: 'Time limit exceeded',
  crash: 'Crashed',
  nonzero_exit: 'Non-zero exit',
  wrong_answer: 'Wrong answer',
  ok: 'Wrong answer',
};

/** A short chip label; long sanitizer messages stay in the "why" text. */
export function failureKind(c: Counterexample): string {
  const n = (c.note ?? '').trim();
  if (/runtime error/i.test(n)) return 'Runtime error';
  if (n && n.length <= 28) return n.charAt(0).toUpperCase() + n.slice(1);
  return STATUS_NOTE[c.status ?? ''] ?? 'Wrong answer';
}

// ---------------------------------------------------------------- diagnostics
export type Severity = 'error' | 'warning' | 'note' | 'info';

export interface Diagnostic {
  line: number | null;
  col?: number | null;
  severity: Severity;
  message: string;
  /** Where it came from, in plain words: "Compiler", "cppcheck", "Codacy", "Memory check". */
  tool: string;
  rule?: string;
}

const GCC = /^(?:([^:]*[^\d\s:][^:]*):)?(\d+)(?::(\d+))?:\s*(fatal error|error|warning|note):\s*(.*)$/i;

function sev(s: string | undefined): Severity {
  const t = (s ?? '').toLowerCase();
  if (t.includes('error')) return 'error';
  if (t.includes('warn') || t === 'style' || t === 'performance' || t === 'portability') return 'warning';
  if (t === 'note') return 'note';
  return 'info';
}

export function diagnostics(r: Report | null | undefined): Diagnostic[] {
  if (!r) return [];
  const out: Diagnostic[] = [];
  const cw = metricBy(r, 'compiler_warnings')?.evidence as { diagnostics?: string[] } | undefined;
  const gccLines = [...(cw?.diagnostics ?? []), ...(r.first_pass?.compile_errors ?? [])];
  const seen = new Set<string>();
  for (const raw of gccLines) {
    const ln = String(raw).trim().replace(/^line\s+/i, '');
    if (!ln) continue;
    const m = GCC.exec(ln);
    const d: Diagnostic = m
      ? { line: Number(m[2]), col: m[3] ? Number(m[3]) : null, severity: sev(m[4]), message: m[5], tool: 'Compiler' }
      : { line: null, severity: /error/i.test(ln) ? 'error' : 'warning', message: ln, tool: 'Compiler' };
    const key = `${d.line}|${d.message}`;
    const dup = out.findIndex((x) => x.tool === 'Compiler' && `${x.line}|${x.message}` === key);
    if (dup >= 0) {
      if (!out[dup].col && d.col) out[dup] = d;
      continue;
    }
    if (seen.has(ln)) continue;
    seen.add(ln);
    out.push(d);
  }
  const sa = metricBy(r, 'static_analysis')?.evidence as { cppcheck?: { line: number; severity?: string; id?: string; message: string }[] } | undefined;
  for (const f of sa?.cppcheck ?? []) {
    out.push({ line: f.line || null, severity: sev(f.severity), message: f.message, tool: 'cppcheck', rule: f.id });
  }
  const cq = metricBy(r, 'codacy_review')?.evidence as { issues?: { line: number; level: string; message: string; rule?: string; tool?: string }[] } | undefined;
  for (const i of cq?.issues ?? []) {
    out.push({
      line: i.line || null,
      severity: sev(i.level),
      message: i.message,
      tool: i.tool ? `Codacy (${i.tool})` : 'Codacy',
      rule: i.rule,
    });
  }
  return out;
}

/** "main() line 12" -> 12 */
export function lineOf(where: string | undefined): number | null {
  const m = where ? /line\s+(\d+)/i.exec(where) : null;
  return m ? Number(m[1]) : null;
}

export function sortSubs(items: SubmissionSummary[]): SubmissionSummary[] {
  return [...items].sort((a, b) => (b.created_at ?? '').localeCompare(a.created_at ?? '') || b.id - a.id);
}

export function effectiveOf(s: SubmissionSummary): number | null {
  const e = (s as SubmissionSummary & { effective_grade?: number | null }).effective_grade;
  return e ?? s.grade;
}
