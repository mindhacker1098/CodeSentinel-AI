// HTTP client for the API v2 contract (docs/API_V2.md).
// A few normalisers accept the older v1 shapes too, so the UI keeps working while the backend migrates.
import type {
  AuditEntry,
  BestEntry,
  BulkFlagBody,
  CorpusItem,
  CorpusParams,
  CreateUserBody,
  Gradebook,
  GradeSnapshot,
  ImportPreview,
  ImportResult,
  JobInfo,
  LatestSnapshot,
  MeResponse,
  MetricSpec,
  Overview,
  Page,
  PairOut,
  ProblemDetail,
  ProblemMetaPatch,
  ProblemSummary,
  PairFlagBody,
  ProblemVersion,
  PublicHealth,
  QueueState,
  RankRow,
  RegradeResponse,
  ScanOut,
  ScanSummary,
  StaffFlag,
  StaffHealth,
  StaffProblemRow,
  StaffSubmissionQuery,
  StaffSubmissionRow,
  SubmissionDetail,
  SubmissionPatch,
  SubmissionSummary,
  SubmitResponse,
  UpdateUserBody,
  User,
  UserQuery,
  UserWithPassword,
  DeleteUserResult,
  ValidateResult,
  FlagReviewStatus,
} from './types';

export * from './types';

export const BASE = '/api';

// ---------------------------------------------------------------- errors
/**
 * Every failed request throws an ApiError.
 * - `status`: HTTP status (0 when the network failed)
 * - `detail`: the human sentence from `{"detail": "..."}` (or a fallback)
 * - `extra`: every other field of the error body, e.g. `job_id` and `submission_id` on a 409
 * - `body`: the parsed body as-is
 */
export class ApiError extends Error {
  status: number;
  detail: string;
  extra: Record<string, unknown>;
  body: unknown;
  constructor(status: number, detail: string, body?: unknown) {
    super(detail);
    this.name = 'ApiError';
    this.status = status;
    this.detail = detail;
    this.body = body;
    this.extra = {};
    if (body && typeof body === 'object' && !Array.isArray(body)) {
      for (const [k, v] of Object.entries(body as Record<string, unknown>)) if (k !== 'detail') this.extra[k] = v;
    }
  }
  /** On 409 "already grading": the running job and submission. */
  get jobId(): number | null {
    return typeof this.extra.job_id === 'number' ? this.extra.job_id : null;
  }
  get submissionId(): number | null {
    return typeof this.extra.submission_id === 'number' ? this.extra.submission_id : null;
  }
  get isPasswordChangeRequired(): boolean {
    return this.status === 403 && (this.extra.code === 'password_change_required' || /password change required/i.test(this.detail));
  }
}

export function isApiError(e: unknown, status?: number): e is ApiError {
  return e instanceof ApiError && (status === undefined || e.status === status);
}

function sentence(s: string): string {
  const t = s.trim();
  if (!t) return t;
  const cap = t[0].toUpperCase() + t.slice(1);
  return /[.!?]$/.test(cap) ? cap : cap + '.';
}

const FALLBACK: Record<number, string> = {
  0: 'Could not reach the server. Check your connection and try again.',
  400: 'The request was not accepted. Check the form and try again.',
  401: 'Your session ended. Sign in again.',
  403: 'You do not have access to this.',
  404: 'This page or item does not exist.',
  409: 'This conflicts with something already in progress.',
  413: 'The upload is too large.',
  422: 'Some fields are not valid. Check the form and try again.',
  429: 'Too many requests. Wait a minute and try again.',
  500: 'The server hit an error. Try again in a moment.',
};

function detailFrom(status: number, body: unknown): string {
  if (body && typeof body === 'object' && 'detail' in body) {
    const d = (body as { detail: unknown }).detail;
    if (typeof d === 'string' && d) return sentence(d);
    // A raw pydantic list: show one readable sentence, not the field dump.
    if (Array.isArray(d) && d.length) {
      const first = d[0] as { msg?: string; loc?: unknown[] };
      const field = Array.isArray(first?.loc) ? String(first.loc[first.loc.length - 1] ?? '') : '';
      const msg = first?.msg ? String(first.msg).replace(/^Value error, /, '') : '';
      if (msg) return sentence(field && !/^(body|query)$/.test(field) ? `${field.replace(/_/g, ' ')}: ${msg}` : msg);
    }
    if (d && typeof d === 'object' && 'message' in d) return sentence(String((d as { message: unknown }).message));
  }
  if (typeof body === 'string' && body && body.length < 300 && !body.trimStart().startsWith('<')) return sentence(body);
  return FALLBACK[status] ?? (status >= 500 ? FALLBACK[500] : `The request failed (${status}).`);
}

// ---------------------------------------------------------------- transport
type Query = Record<string, string | number | boolean | null | undefined>;

export function withQuery(path: string, q?: Query): string {
  if (!q) return path;
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(q)) {
    if (v === undefined || v === null || v === '') continue;
    p.set(k, typeof v === 'boolean' ? (v ? '1' : '0') : String(v));
  }
  const s = p.toString();
  return s ? `${path}${path.includes('?') ? '&' : '?'}${s}` : path;
}

type Body = FormData | string | Blob | object | undefined;

async function raw(method: string, path: string, body?: Body, contentType?: string): Promise<Response> {
  const headers: Record<string, string> = { Accept: 'application/json' };
  const init: RequestInit = { method, credentials: 'include', headers };
  if (body instanceof FormData || body instanceof Blob) {
    init.body = body;
  } else if (typeof body === 'string') {
    headers['Content-Type'] = contentType ?? 'text/plain';
    init.body = body;
  } else if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify(body);
  }
  let res: Response;
  try {
    res = await fetch(BASE + path, init);
  } catch {
    throw new ApiError(0, FALLBACK[0]);
  }
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    let parsed: unknown = text;
    try {
      parsed = JSON.parse(text);
    } catch {
      /* plain text error */
    }
    throw new ApiError(res.status, detailFrom(res.status, parsed), parsed);
  }
  return res;
}

async function json<T>(method: string, path: string, body?: Body, contentType?: string): Promise<T> {
  const res = await raw(method, path, body, contentType);
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  return (text ? JSON.parse(text) : undefined) as T;
}

export async function getText(path: string, q?: Query): Promise<string> {
  return (await raw('GET', withQuery(path, q))).text();
}

export async function getBlob(path: string, q?: Query): Promise<Blob> {
  return (await raw('GET', withQuery(path, q))).blob();
}

export const get = <T>(path: string, q?: Query) => json<T>('GET', withQuery(path, q));
export const post = <T>(path: string, body?: Body) => json<T>('POST', path, body);
export const put = <T>(path: string, body?: Body) => json<T>('PUT', path, body);
export const patch = <T>(path: string, body?: Body) => json<T>('PATCH', path, body);
export const del = <T>(path: string) => json<T>('DELETE', path);

export function downloadBlob(data: Blob | string, filename: string, type = 'text/plain') {
  const b = typeof data === 'string' ? new Blob([data], { type }) : data;
  const url = URL.createObjectURL(b);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// ---------------------------------------------------------------- normalisers (v1 -> v2 shapes)
function asPage<T>(r: Page<T> | T[]): Page<T> {
  return Array.isArray(r) ? { items: r, total: r.length } : { items: r.items ?? [], total: r.total ?? r.items?.length ?? 0 };
}

function snapshot(v: unknown): GradeSnapshot | null {
  if (v === null || v === undefined) return null;
  if (typeof v === 'number') return { grade: v, provisional: false, submission_id: null };
  const o = v as Partial<LatestSnapshot>;
  return {
    grade: o.grade ?? null,
    provisional: !!o.provisional,
    submission_id: o.submission_id ?? null,
    ...('job_status' in o ? { job_status: o.job_status ?? null } : {}),
  };
}

function normProblem<T extends ProblemSummary>(p: T): T {
  const rules = (p as unknown as ProblemDetail).rules;
  return {
    ...p,
    status: p.status ?? 'published',
    opens_at: p.opens_at ?? null,
    deadline_passed: p.deadline_passed ?? (!!p.due_at && new Date(p.due_at).getTime() < Date.now()),
    finalized: !!p.finalized,
    my_count: p.my_count ?? 0,
    limits: p.limits ?? { time_limit_s: rules?.time_limit_s ?? null, memory_limit_mb: rules?.memory_limit_mb ?? null },
    submissions_left_this_hour: p.submissions_left_this_hour ?? null,
    my_best: snapshot(p.my_best),
    my_latest: snapshot(p.my_latest) as LatestSnapshot | null,
  };
}

function normProblemDetail(p: ProblemDetail): ProblemDetail {
  const n = normProblem(p);
  return {
    ...n,
    sample_output: p.sample_output ?? '',
    metrics: problemMetrics(p),
    version: p.version ?? (p as unknown as { current_version?: number }).current_version ?? 1,
  };
}

function normSubmission<T extends SubmissionSummary>(s: T): T {
  return {
    ...s,
    problem_slug: s.problem_slug ?? s.problem ?? '',
    job_status: s.job_status ?? s.job?.status ?? null,
    provisional: !!s.provisional,
    partial: !!s.partial,
  };
}

function normMe(r: MeResponse | User | null): User | null {
  if (!r) return null;
  if ('user' in r) return r.user ?? null;
  return 'id' in r ? (r as User) : null;
}

/** Metrics with labels; v1 kept them under rules.metrics. */
export function problemMetrics(p: Pick<ProblemDetail, 'metrics' | 'rules'>): MetricSpec[] {
  return p.metrics ?? p.rules?.metrics ?? [];
}

/** Grade out of a snapshot, a bare number (v1) or nothing. */
export function gradeValue(g: GradeSnapshot | number | null | undefined): number | null {
  if (g === null || g === undefined) return null;
  if (typeof g === 'number') return g;
  return g.grade ?? null;
}

/** True for a positive integer route id such as "/submissions/42"; use it to show NotFound instead of fetching. */
export function parseId(raw: string | undefined | null): number | null {
  if (!raw || !/^[1-9]\d{0,9}$/.test(raw)) return null;
  return Number(raw);
}

/** Slugs are lowercase letters, digits, - and _. */
export function isValidSlug(raw: string | undefined | null): raw is string {
  return !!raw && /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(raw);
}

const enc = encodeURIComponent;

// ---------------------------------------------------------------- endpoints
export const api = {
  // auth
  login: async (roll_no: string, password: string): Promise<User | null> =>
    normMe(await post<MeResponse | User>('/auth/login', { roll_no: roll_no.trim().toUpperCase(), password })),
  logout: () => post<{ ok: boolean }>('/auth/logout'),
  /** Never 401 in v2: an anonymous visitor gets `null`. */
  me: async (): Promise<User | null> => {
    try {
      return normMe(await get<MeResponse | User>('/auth/me'));
    } catch (e) {
      if (isApiError(e, 401)) return null;
      throw e;
    }
  },
  changePassword: (old: string, next: string) => post<{ ok: boolean }>('/auth/change-password', { old, new: next }),

  // student: problems
  problems: async () => (await get<ProblemSummary[]>('/problems')).map(normProblem),
  problem: async (slug: string) => normProblemDetail(await get<ProblemDetail>(`/problems/${enc(slug)}`)),
  problemBest: (slug: string) => get<BestEntry[]>(`/problems/${enc(slug)}/best`),
  submitFile: (slug: string, file: File) => {
    const fd = new FormData();
    fd.append('file', file, file.name);
    return post<SubmitResponse>(`/problems/${enc(slug)}/submissions`, fd);
  },
  submitSource: (slug: string, filename: string, source: string) =>
    post<SubmitResponse>(`/problems/${enc(slug)}/submissions`, { filename, source }),

  // student: submissions
  submissions: async (problem?: string): Promise<Page<SubmissionSummary>> => {
    const p = asPage(await get<Page<SubmissionSummary> | SubmissionSummary[]>('/submissions', { problem }));
    return { ...p, items: p.items.map(normSubmission) };
  },
  submission: async (id: number) => normSubmission(await get<SubmissionDetail>(`/submissions/${id}`)),
  sourceUrl: (id: number) => `${BASE}/submissions/${id}/source.c`,
  source: (id: number) => getText(`/submissions/${id}/source.c`),
  reportJson: (id: number) => getText(`/submissions/${id}/report.json`),
  reportTxt: (id: number) => getText(`/submissions/${id}/report.txt`),
  job: (id: number) => get<JobInfo>(`/jobs/${id}`),
  jobEventsUrl: (id: number) => `${BASE}/jobs/${id}/events`,

  health: () => get<PublicHealth>('/health'),

  // staff
  staff: {
    overview: () => get<Overview>('/staff/overview'),
    health: () => get<StaffHealth>('/staff/health'),
    audit: (page = 1) => get<Page<AuditEntry>>('/staff/audit', { page }),

    // users
    users: async (q: UserQuery = {}) => asPage(await get<Page<User> | User[]>('/staff/users', { ...q })),
    createUser: (body: CreateUserBody) => post<UserWithPassword>('/staff/users', body),
    updateUser: async (id: number, body: UpdateUserBody): Promise<UserWithPassword> => {
      const r = await patch<UserWithPassword | (User & { password?: string })>(`/staff/users/${id}`, body);
      if ('user' in r) return r;
      const { password, ...user } = r;
      return { user: user as User, password };
    },
    /** Admin only. 409 with code "has_submissions" unless force (deletes their submissions too). */
    deleteUser: (id: number, opts: { force?: boolean } = {}) =>
      del<DeleteUserResult>(`/staff/users/${id}${opts.force ? '?force=1' : ''}`),
    importPreview: (file: File | string) => {
      const body = typeof file === 'string' ? file : formWith(file);
      return json<ImportPreview>('POST', '/staff/users/import?dry_run=1', body, 'text/csv');
    },
    importCommit: (file: File | string) => {
      const body = typeof file === 'string' ? file : formWith(file);
      return json<ImportResult>('POST', '/staff/users/import', body, 'text/csv');
    },
    userTemplateCsv: () => getBlob('/staff/users/template.csv'),
    usersExportCsv: () => getBlob('/staff/users/export.csv'),

    // problems
    problems: () => get<StaffProblemRow[]>('/staff/problems'),
    createProblem: (form: FormData) => post<StaffProblemRow & { version: number }>('/staff/problems', form),
    updateGrading: (slug: string, form: FormData) =>
      put<StaffProblemRow & { version: number }>(`/staff/problems/${enc(slug)}`, form),
    updateMeta: (slug: string, body: ProblemMetaPatch) => patch<StaffProblemRow>(`/staff/problems/${enc(slug)}/meta`, body),
    versions: (slug: string) => get<ProblemVersion[]>(`/staff/problems/${enc(slug)}/versions`),
    validate: (slug: string) => post<ValidateResult>(`/staff/problems/${enc(slug)}/validate`),
    validateRules: (rules: unknown) => post<{ errors: string[] }>('/staff/rules/validate', { rules }),
    finalize: (slug: string) => post<{ job_ids: number[] }>(`/staff/problems/${enc(slug)}/finalize`),
    reopen: (slug: string) => del<{ ok: boolean }>(`/staff/problems/${enc(slug)}/finalize`),
    corpus: (slug: string) => get<CorpusItem[]>(`/staff/problems/${enc(slug)}/corpus`),
    deleteCorpus: (slug: string, kind: 'web' | 'llm', file: string) =>
      del<{ ok: boolean }>(`/staff/problems/${enc(slug)}/corpus/${kind}/${enc(file)}`),
    llmCorpus: (slug: string, body: CorpusParams) => post<{ job_id: number }>(`/staff/problems/${enc(slug)}/llm-corpus`, body),
    webCorpus: (slug: string, body: { urls: string[]; query?: string }) =>
      post<WebCorpusResult>(`/staff/problems/${enc(slug)}/web-corpus`, body),

    // submissions
    submissions: async (q: StaffSubmissionQuery = {}) =>
      asPage(await get<Page<StaffSubmissionRow> | StaffSubmissionRow[]>('/staff/submissions', { ...q })),
    updateSubmission: (id: number, body: SubmissionPatch) => patch<SubmissionDetail>(`/staff/submissions/${id}`, body),
    regrade: (body: { submission_ids?: number[]; problem_slug?: string }) => post<RegradeResponse>('/staff/regrade', body),

    // gradebook
    gradebook: (includeInactive = false) => get<Gradebook>('/staff/gradebook', { include_inactive: includeInactive ? 1 : 0 }),
    gradebookCsv: (opts: { problem?: string; includeInactive?: boolean } = {}) =>
      getBlob('/staff/gradebook.csv', { problem: opts.problem, include_inactive: opts.includeInactive ? 1 : undefined }),

    // integrity
    scans: (slug: string) => get<ScanSummary[]>(`/staff/problems/${enc(slug)}/plagiarism/scans`),
    plagiarism: (slug: string, q: { scan?: number; min?: number } = {}) =>
      get<ScanOut>(`/staff/problems/${enc(slug)}/plagiarism`, q),
    runScan: (slug: string, threshold: number, background = false) =>
      post<{ scan_id: number | null; job_id: number | null }>(`/staff/problems/${enc(slug)}/plagiarism-scan`, {
        threshold,
        background,
      }),
    pair: (scan: number, a: string, b: string) => get<PairOut>('/staff/plagiarism/pair', { scan, a, b }),
    reviewFlag: (id: number, review_status: FlagReviewStatus, review_note = '') =>
      patch<StaffFlag>(`/staff/flags/${id}`, { review_status, review_note: review_note || null }),
    bulkFlags: (body: BulkFlagBody) => post<{ updated: number; flags: StaffFlag[] }>('/staff/flags/bulk', body),
    /** Raises (or updates) a copy flag on each graded side of a scanned pair; confirmed by default. */
    flagPair: (body: PairFlagBody) => post<{ flags: StaffFlag[] }>('/staff/plagiarism/pair/flag', body),
    submissionFlags: (id: number) => get<StaffFlag[]>(`/staff/submissions/${id}/flags`),
    leaderboard: (slug: string) => get<RankRow[]>(`/staff/problems/${enc(slug)}/leaderboard`),

    // queue
    queue: async (page = 1): Promise<QueueState> => {
      const r = await get<QueueState | (Omit<QueueState, 'recent' | 'workers'> & { recent: JobInfo[]; workers?: QueueState['workers'] })>(
        '/staff/queue',
        { page },
      );
      return { ...r, workers: r.workers ?? [], recent: asPage(r.recent as Page<JobInfo> | JobInfo[]) };
    },
    cancelJob: (id: number) => post<JobInfo>(`/staff/jobs/${id}/cancel`),
    retryFailed: () => post<{ requeued: number }>('/staff/jobs/retry-failed'),
  },
};

function formWith(file: File): FormData {
  const fd = new FormData();
  fd.append('file', file, file.name);
  return fd;
}

export interface WebCorpusResult {
  query: string | null;
  searched: boolean;
  pages: { url: string; status: string; programs: number; kept: number }[];
  kept: string[];
}
