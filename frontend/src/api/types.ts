// Types for the API v2 contract (docs/API_V2.md). Optional fields marked "legacy" are still sent by
// the v1 backend and are kept only so the transition compiles; new code should not rely on them.

// ---------------------------------------------------------------- users and auth
export type Role = 'student' | 'ta' | 'admin';

export interface User {
  id: number;
  roll_no: string;
  name: string;
  role: Role;
  is_active: boolean;
  must_change_pw: boolean;
  created_at?: string | null;
  last_login_at?: string | null;
}

export interface MeResponse {
  user: User | null;
}

export interface Page<T> {
  items: T[];
  total: number;
}

export interface UserQuery {
  q?: string;
  role?: Role | '';
  active?: boolean | '';
  page?: number;
  page_size?: number;
}

export interface CreateUserBody {
  roll_no: string;
  name: string;
  role: Role;
}

/** Returned by create and reset; the password is shown once and never stored in the UI. */
export interface UserWithPassword {
  user: User;
  password?: string;
}

/** DELETE /staff/users/{id}: what was removed with the account. */
export interface DeleteUserResult {
  deleted: number;
  roll_no: string;
  submissions: number;
  results: number;
  flags: number;
  jobs: number;
}

export interface UpdateUserBody {
  name?: string;
  role?: Role;
  is_active?: boolean;
  reset_password?: true;
}

export type ImportRowStatus = 'create' | 'skip' | 'reject';

export interface ImportRow {
  line: number;
  roll_no: string;
  name: string;
  role: Role | string;
  status: ImportRowStatus;
  reason: string | null;
  password?: string;
}

export interface ImportPreview {
  rows: ImportRow[];
}

export interface ImportResult extends ImportPreview {
  created: number;
  skipped: number;
  rejected: number;
}

// ---------------------------------------------------------------- problems
export type ProblemStatus = 'draft' | 'published' | 'archived';
export type GradePolicy = 'latest' | 'best';
export type IntegrityPenalty = 'none' | 'zero' | 'half';
export type JobStatus = 'queued' | 'running' | 'done' | 'failed' | 'cancelled';

export interface GradeSnapshot {
  grade: number | null;
  provisional: boolean;
  submission_id: number | null;
}

export interface LatestSnapshot extends GradeSnapshot {
  job_status: JobStatus | null;
}

export interface Limits {
  time_limit_s: number | null;
  memory_limit_mb: number | null;
}

export interface ProblemSummary {
  slug: string;
  title: string;
  status: ProblemStatus;
  due_at: string | null;
  opens_at: string | null;
  deadline_passed: boolean;
  finalized: boolean;
  grade_policy: GradePolicy;
  max_submissions_per_hour: number;
  submissions_left_this_hour: number | null;
  limits: Limits;
  my_count: number;
  my_best: GradeSnapshot | null;
  my_latest: LatestSnapshot | null;
}

export interface MetricSpec {
  name: string;
  analyzer?: string;
  /** Human label, e.g. "Correctness". */
  label?: string;
  description?: string;
  weight: number;
}

export interface ProblemDetail extends ProblemSummary {
  statement_md: string;
  sample_input: string;
  sample_output: string;
  version: number;
  metrics: MetricSpec[];
  best_available?: boolean;
  /** legacy (v1): metrics lived under rules. */
  rules?: { metrics?: MetricSpec[]; time_limit_s?: number | null; memory_limit_mb?: number | null; [k: string]: unknown };
}

export interface BestEntry {
  rank: number;
  grade: number;
  filename: string;
  source: string;
  /** staff only */
  submission_id?: number;
  /** staff only */
  roll_no?: string;
}

export interface SubmitResponse {
  submission_id: number;
  job_id: number;
}

// ---------------------------------------------------------------- submissions and reports
export interface SubmissionJob {
  id: number;
  kind: string;
  status: JobStatus;
  error?: string | null;
}

/** One row of GET /submissions (own). */
export interface SubmissionSummary {
  id: number;
  problem_slug: string;
  problem_title?: string;
  created_at: string;
  grade: number | null;
  /** The override if set, otherwise the grade with the integrity penalty applied. */
  effective_grade?: number | null;
  provisional: boolean;
  partial: boolean;
  job_status: JobStatus | null;
  counted?: boolean;
  filename?: string;
  is_late?: boolean;
  /** legacy (v1) */
  problem?: string;
  /** legacy (v1) */
  job?: SubmissionJob | null;
}

export interface Override {
  grade: number;
  reason: string;
  by: string;
  at: string;
}

export interface StaffComment {
  text: string;
  by: string;
  at: string;
}

export interface SubmissionDetail extends SubmissionSummary {
  feedback_job?: { id: number; status: JobStatus; error?: string | null } | null;
  filename: string;
  source?: string;
  report?: Report | null;
  report_txt?: string;
  override?: Override | null;
  staff_comment?: StaffComment | null;
  effective_grade?: number | null;
  /** staff only */
  user?: { id: number; roll_no: string; name: string } | null;
  problem_version_id?: number;
}

export interface Counterexample {
  source?: string;
  test?: string;
  input: string;
  expected?: string;
  got?: string;
  status?: string;
  note?: string;
  why?: string;
  [k: string]: unknown;
}

export type FlagReviewStatus = 'open' | 'dismissed' | 'confirmed';

export interface Flag {
  id?: number;
  type: string;
  detail?: string;
  severity?: string;
  review_status?: FlagReviewStatus;
  [k: string]: unknown;
}

/** Status of a metric in the report: ok, error (scored 0) or skipped. */
export type MetricStatus = 'ok' | 'error' | 'skipped' | string;

export interface MetricEntry {
  informational?: boolean;
  name: string;
  analyzer: string;
  label?: string;
  weight: number;
  status: MetricStatus;
  score: number;
  contribution: number;
  evidence?: Record<string, unknown>;
  feedback?: string;
  suggestions?: string[];
  duration_ms?: number;
}

export interface PreAnalysis {
  dangerous_calls?: unknown[];
  suspected_bugs?: { line: number; desc: string }[];
  extra_inputs?: { input: string; rationale?: string }[];
  estimated_complexity?: string;
  notes?: string[];
  [k: string]: unknown;
}

export interface Enrichment {
  explanations?: { input?: string; text: string; metric?: string }[];
  [k: string]: unknown;
}

export interface Report {
  code_feedback?: {
    status: 'queued' | 'running' | 'done' | 'unavailable';
    error?: string;
    note?: string;
    model?: string;
    rejected_locations?: number;
    withheld_unverified?: number;
    issues: { metric: string; line: number; end_line: number; code: string; explanation: string;
      suggestion: string; basis: 'compiler' | 'tool' | 'ai_hypothesis'; location_verified: boolean;
      replacement?: string;
      verification?: { verified: boolean; tests_total: number; passed_before: number; passed_after: number } }[];
    reviews: { metric: string; comment: string; available: boolean }[];
  };
  submission: string;
  problem: string;
  submission_hash?: string;
  rules_hash?: string;
  inputs_hash?: string;
  grade: number;
  partial?: boolean;
  provisional?: boolean;
  first_pass?: {
    compiled?: boolean;
    compile_warnings?: number;
    compile_errors?: string[];
    smoke_ok?: boolean;
    smoke_status?: string;
    suspected_infinite_loop?: boolean;
    [k: string]: unknown;
  };
  metrics: MetricEntry[];
  flags: Flag[];
  counterexamples?: Counterexample[];
  suggestions?: string[];
  tool_versions?: Record<string, unknown>;
  tutor_note?: { text: string; model?: string; cached?: boolean } | null;
  corpus_hash?: string | null;
  pre_analysis?: PreAnalysis | null;
  enrichment?: Enrichment | null;
  [k: string]: unknown;
}

// ---------------------------------------------------------------- staff: problems
export interface StaffProblemRow {
  slug: string;
  title: string;
  status: ProblemStatus;
  due_at: string | null;
  opens_at: string | null;
  finalized_at: string | null;
  version: number;
  n_submissions: number;
  n_students: number;
  avg_grade: number | null;
  open_flags: number;
  id?: number;
  grade_policy?: GradePolicy;
  show_best_after_deadline?: boolean;
  reveal_hidden_tests?: boolean;
  max_submissions_per_hour?: number;
  integrity_penalty: IntegrityPenalty;
  rules_hash?: string | null;
  inputs_hash?: string | null;
}

export interface ProblemMetaPatch {
  title?: string;
  statement_md?: string;
  due_at?: string | null;
  opens_at?: string | null;
  status?: ProblemStatus;
  grade_policy?: GradePolicy;
  reveal_hidden_tests?: boolean;
  show_best_after_deadline?: boolean;
  max_submissions_per_hour?: number;
  integrity_penalty?: IntegrityPenalty;
}

export interface ProblemVersion {
  version: number;
  created_at: string;
  rules_hash: string | null;
  inputs_hash: string | null;
  n_submissions: number;
  current?: boolean;
}

export interface ValidateResult {
  ok: boolean;
  rules_errors: string[];
  compile: { ok: boolean; stderr: string };
  tests: { name: string; ok: boolean; ms: number | null; error: string | null }[];
}

export interface CorpusItem {
  file: string;
  kind: 'web' | 'llm';
  size: number;
  preview: string;
}

export interface CorpusParams {
  models?: string[];
  /** Indexes into the backend's prompt list. */
  prompts?: number[];
  temps?: number[];
  seeds?: number[];
}

export interface CorpusResult {
  requested: number;
  kept: number;
  failed: number;
  reasons: string[];
}

// ---------------------------------------------------------------- staff: submissions
export interface FlagRef {
  id: number;
  type: string;
  review_status: FlagReviewStatus;
}

export interface StaffSubmissionRow {
  id: number;
  user_id: number;
  roll_no: string;
  name: string;
  problem_slug: string;
  problem_title: string;
  created_at: string;
  grade: number | null;
  effective_grade: number | null;
  provisional: boolean;
  partial: boolean;
  flags: FlagRef[];
  job_status: JobStatus | null;
  job?: { id: number; kind: string; status: JobStatus } | null;
  filename?: string;
  is_late: boolean;
  overridden: boolean;
}

export type StaffSubmissionSort = '-created' | 'grade' | '-grade';

export interface StaffSubmissionQuery {
  problem?: string;
  q?: string;
  /** 'open', 'any' or a flag type. */
  flag?: string;
  /** Exact roll number. */
  user?: string;
  /** ISO date or date-time; inclusive. */
  since?: string;
  /** ISO date (the whole day is included) or date-time. */
  until?: string;
  sort?: StaffSubmissionSort;
  page?: number;
  page_size?: number;
}

export interface SubmissionPatch {
  override_grade?: number | null;
  override_reason?: string;
  comment?: string;
}

export interface RegradeResponse {
  job_ids: number[];
  skipped_busy?: number[];
}

// ---------------------------------------------------------------- staff: gradebook
export interface GradebookCell {
  grade: number | null;
  effective_grade: number | null;
  submission_id: number;
  provisional: boolean | null;
  late: boolean;
  flags: FlagRef[];
}

export interface GradebookStudent {
  id: number;
  roll_no: string;
  name: string;
  is_active: boolean;
  cells: Record<string, GradebookCell | null>;
  /** Mean of effective grades over published problems (a missing one counts 0); null with no problems. */
  total: number | null;
}

export interface GradebookStats {
  n: number;
  mean: number | null;
  median: number | null;
  /** 10 buckets: 0-9, 10-19, ... 90-100. */
  histogram: number[];
}

export interface Gradebook {
  problems: { slug: string; title: string }[];
  students: GradebookStudent[];
  stats: Record<string, GradebookStats>;
}

// ---------------------------------------------------------------- staff: integrity
export interface ScanSummary {
  id: number;
  created_at: string;
  threshold: number;
  n_submissions: number;
  n_pairs: number;
}

export interface RefLabel {
  kind: string;
  label: string;
  submission_id?: number;
  roll_no?: string;
  name?: string;
}

export interface Cluster {
  id: number | string;
  members: string[];
  size?: number;
  max_sim?: number;
  n_submissions?: number;
}

export interface ScanPair {
  a: string;
  b: string;
  sim: number;
  ast_sim: number | null;
  shared: number | null;
}

export interface ScanOut {
  scan: {
    id: number;
    created_at: string | null;
    threshold: number;
    params: Record<string, unknown> | null;
    n_submissions: number | null;
    clusters: (Cluster | string[])[];
  } | null;
  pairs: ScanPair[];
  labels: Record<string, RefLabel>;
}

/** Matched region in the Monaco pair view (line numbers, 1-based). */
export interface Region {
  a_start: number;
  a_end: number;
  b_start: number;
  b_end: number;
}

export interface PairRegion {
  a: [number, number];
  b: [number, number];
  shared: number;
  color?: number;
}

export interface PairOut {
  a: { ref: string; label: string; source: string };
  b: { ref: string; label: string; source: string };
  sim: number;
  ast_sim: number | null;
  shared: number | null;
  regions: PairRegion[];
  labels?: Record<string, RefLabel>;
}

export interface StaffFlag extends Flag {
  id: number;
  review_status: FlagReviewStatus;
  review_note?: string | null;
  reviewed_by?: number | null;
  submission_id: number;
  result_id?: number;
  source?: 'grader' | 'staff';
  /** Parsed from a copy flag's detail ("0.93 similarity with web:a.c"); null otherwise. */
  peer_ref?: string | null;
  similarity?: number | null;
  kind?: string | null;
}

export interface PairFlagBody {
  scan: number;
  a: string;
  b: string;
  review_status?: FlagReviewStatus;
  review_note?: string;
}

export interface BulkFlagBody {
  flag_ids: number[];
  review_status: FlagReviewStatus;
  review_note?: string;
}

export interface RankRow {
  rank: number | null;
  submission_id: number;
  user_id: number;
  roll_no: string | null;
  name: string | null;
  grade: number;
  effective_grade?: number | null;
  instr_at_max_n: number | null;
  peak_heap_bytes: number | null;
  readability: number | null;
  token_count: number | null;
  submitted_at: string;
  profiled: boolean;
  ineligible_reason?: string;
  under_review?: boolean;
}

// ---------------------------------------------------------------- staff: queue, overview, audit
export interface JobInfo {
  id: number;
  kind: string;
  status: JobStatus;
  submission_id?: number | null;
  problem_id?: number | null;
  priority?: number;
  attempts?: number;
  max_attempts?: number;
  worker_id?: string | null;
  created_at?: string;
  claimed_at?: string | null;
  finished_at?: string | null;
  heartbeat_at?: string | null;
  error?: string | null;
  /** staff only: the Python traceback of a crash */
  traceback?: string | null;
  payload?: Record<string, unknown> | null;
  result?: unknown;
}

export interface ActiveJob extends JobInfo {
  roll_no: string | null;
  problem_slug: string | null;
  duration_s: number | null;
}

export interface WorkerInfo {
  worker_id: string;
  host: string;
  last_seen: string;
  online: boolean;
  busy: boolean;
}

export interface QueueState {
  counts: Partial<Record<JobStatus, number>> & Record<string, number>;
  workers: WorkerInfo[];
  active: ActiveJob[];
  recent: Page<JobInfo>;
}

export interface Overview {
  open_flags: number;
  submissions_today: number;
  failed_jobs: number;
  queued: number;
  running: number;
  workers_online: number;
  next_deadline: { slug: string; title: string; due_at: string } | null;
  recent_submissions: StaffSubmissionRow[];
}

export interface AuditEntry {
  ts: string;
  actor_roll: string | null;
  action: string;
  target: string | null;
  detail: string | null;
}

export interface PublicHealth {
  ok: boolean;
  version: string;
}

export interface StaffHealth {
  ok: boolean;
  version?: string;
  workers_alive?: string[] | number;
  analyzers?: { available: string[]; import_errors: Record<string, string> };
  sandbox?: Record<string, unknown> & { selected?: string | null };
  ollama?: { running: boolean; models: string[]; defaultModel?: string; defaultAvailable?: boolean; error?: string };
  [k: string]: unknown;
}

// ---------------------------------------------------------------- live grading (SSE)
export type GradingStage = 'queued' | 'compile' | 'tests' | 'memory' | 'quality' | 'review' | 'done';

export interface StageEvent {
  stage: GradingStage;
  label: string;
}

export interface LogEvent {
  id?: string;
  ts: string;
  kind: string;
  msg: string;
  metric?: string | null;
}
