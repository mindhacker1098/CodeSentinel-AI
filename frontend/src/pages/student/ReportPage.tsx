import { useEffect, useMemo, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Alert, Badge, Box, Button, Group, Paper, Stack, Tabs, Text, Tooltip } from '@mantine/core';
import {
  IconAlertTriangle,
  IconArrowDownRight,
  IconArrowLeft,
  IconArrowRight,
  IconArrowUpRight,
  IconCode,
  IconDownload,
  IconGauge,
  IconListCheck,
  IconMessage,
  IconPencil,
  IconScale,
  IconRepeat,
  IconStethoscope,
  IconTrophy,
  IconX,
} from '@tabler/icons-react';
import { api, downloadBlob, parseId, type Report, type SubmissionDetail } from '../../api/client';
import { isStaff, useAuth } from '../../auth';
import {
  ErrorState,
  FlagList,
  GradeDisplay,
  PageHeader,
  ReportSkeleton,
  StatusChip,
  VerdictBar,
} from '../../components';
import { fmtDate, fmtGrade, fmtRelative } from '../../format';
import { notify } from '../../notify';
import GradingPanel from './GradingPanel';
import CodeFeedback from './CodeFeedback';
import { submissionKey } from './hooks';
import { FailuresTab, MemoryTab, MetricsTab, QualityTab, SolutionsTab, SourceTab } from './ReportTabs';
import { compiled, effectiveOf, failureGroups, isActive, segmentsFor, sortSubs, testCounts } from './shared';

export interface ReportPageProps {
  /** Submission id; defaults to the `:id` route param. */
  id?: number;
  /**
   * Staff mode: no resubmit, no delta against the student's own history, staff breadcrumbs.
   * Defaults to the signed-in user's role.
   */
  staff?: boolean;
  /** Where "Back to problem" goes. Defaults to the student problem page. */
  problemHref?: (slug: string) => string;
  /** Hide the page header (title, breadcrumbs, actions) when a staff page renders its own. */
  hideHeader?: boolean;
}

/** Stop polling for a report that does not appear (e.g. the result was lost) after this long. */
const REPORT_WAIT_MS = 2 * 60_000;
const POLL_MS = 4000;

const TABS = ['failures', 'metrics', 'memory', 'quality', 'source', 'solutions'] as const;
type TabKey = (typeof TABS)[number];

class ReportTimeout extends Error {
  constructor() {
    super('No report after 2 minutes. Reload, or submit again.');
  }
}

function Delta({ now, prev, prevId }: { now: number | null; prev: number | null; prevId: number }) {
  if (now === null || prev === null) return null;
  const d = Math.round((now - prev) * 10) / 10;
  const same = Math.abs(d) < 0.05;
  const tone = same ? 'gray' : d > 0 ? 'pass' : 'fail';
  const I = same ? IconArrowRight : d > 0 ? IconArrowUpRight : IconArrowDownRight;
  return (
    <Tooltip label={`Your previous attempt scored ${fmtGrade(prev)}.`}>
      <Badge
        component={Link}
        to={`/submissions/${prevId}`}
        variant="light"
        color={tone}
        leftSection={<I size={13} aria-hidden />}
        style={{ cursor: 'pointer' }}
        className="ag-num"
      >
        {same ? 'Same as last attempt' : `${d > 0 ? '+' : ''}${fmtGrade(d)} since last attempt`}
      </Badge>
    </Tooltip>
  );
}

function StaffNotes({ sub }: { sub: SubmissionDetail }) {
  // A confirmed copy flag (students only ever see confirmed ones) lowers the grade by the course's integrity policy.
  const grade = sub.grade ?? sub.report?.grade ?? null;
  const penalised =
    !sub.override &&
    grade !== null &&
    sub.effective_grade !== null &&
    sub.effective_grade !== undefined &&
    sub.effective_grade < grade &&
    (sub.report?.flags ?? []).some((f) => /^(suspected_copy|possible_copy)/.test(f.type));
  if (!sub.override && !sub.staff_comment && !penalised) return null;
  return (
    <Paper p="md" style={{ borderLeft: '3px solid var(--ag-iris)' }} component="section" aria-label="Notes from staff">
      <Stack gap="sm">
        {penalised && (
          <Group gap="xs" wrap="nowrap" align="flex-start">
            <IconScale size={18} color="var(--ag-warn)" aria-hidden style={{ flexShrink: 0, marginTop: 2 }} />
            <Box>
              <Text size="sm" fw={600}>
                Grade lowered to {fmtGrade(sub.effective_grade)} for copying
              </Text>
              <Text size="sm" className="ag-prose">
                Confirmed too similar to another source. Original grade {fmtGrade(grade)}. Disagree? Talk to your admin.
              </Text>
            </Box>
          </Group>
        )}
        {sub.override && (
          <Group gap="xs" wrap="nowrap" align="flex-start">
            <IconPencil size={18} color="var(--ag-iris)" aria-hidden style={{ flexShrink: 0, marginTop: 2 }} />
            <Box>
              <Text size="sm" fw={600}>
                Grade set to {fmtGrade(sub.override.grade)} by {sub.override.by || 'staff'}
              </Text>
              {sub.override.reason && (
                <Text size="sm" className="ag-prose">
                  {sub.override.reason}
                </Text>
              )}
              <Text size="sm" c="dimmed">
                {fmtDate(sub.override.at)}
              </Text>
            </Box>
          </Group>
        )}
        {sub.staff_comment && (
          <Group gap="xs" wrap="nowrap" align="flex-start">
            <IconMessage size={18} color="var(--ag-iris)" aria-hidden style={{ flexShrink: 0, marginTop: 2 }} />
            <Box>
              <Text size="sm" fw={600}>
                Comment from {sub.staff_comment.by || 'staff'}
              </Text>
              <Text size="sm" className="ag-prose" style={{ whiteSpace: 'pre-wrap' }}>
                {sub.staff_comment.text}
              </Text>
              <Text size="sm" c="dimmed">
                {fmtDate(sub.staff_comment.at)}
              </Text>
            </Box>
          </Group>
        )}
      </Stack>
    </Paper>
  );
}

function Verdict({
  sub,
  r,
  specs,
  prev,
  staff,
}: {
  sub: SubmissionDetail;
  r: Report;
  specs?: import('../../api/client').MetricSpec[];
  prev: { grade: number | null; id: number } | null;
  staff: boolean;
}) {
  const segs = segmentsFor(r, specs);
  const tc = testCounts(r);
  const ok = compiled(r);
  const full = segs.filter((s) => s.status === 'pass').length;
  const lost = segs.filter((s) => s.status === 'fail' || s.status === 'partial').length;
  const nFail = failureGroups(r).visible.length;
  const grade = sub.grade ?? r.grade;
  const eff = sub.effective_grade ?? null;
  return (
    <Paper p="lg" component="section" aria-label="Result">
      <Stack gap="md">
        <Group justify="space-between" align="flex-end" wrap="wrap" gap="md">
          <GradeDisplay
            size="lg"
            grade={grade}
            effectiveGrade={eff}
            provisional={!!(r.provisional ?? sub.provisional)}
            incomplete={!!(r.partial ?? sub.partial)}
            override={sub.override ? { reason: sub.override.reason, by: sub.override.by } : null}
          />
          <Group gap="xs" wrap="wrap">
            {!staff && prev && <Delta now={eff ?? grade} prev={prev.grade} prevId={prev.id} />}
            {sub.is_late && (
              <Tooltip label="After the deadline">
                <Badge color="warn" variant="outline" tabIndex={0}>
                  Late
                </Badge>
              </Tooltip>
            )}
          </Group>
        </Group>
        <VerdictBar segments={segs} size="lg" />
        <Group gap="lg" style={{ rowGap: 6 }} wrap="wrap">
          {!ok ? (
            <Group gap={6} c="fail.5">
              <IconX size={16} aria-hidden />
              <Text size="sm">Does not compile</Text>
            </Group>
          ) : tc ? (
            <Text size="sm">
              <Text span fw={600} c={tc.passed === tc.total ? 'pass.5' : tc.passed === 0 ? 'fail.5' : 'warn.5'} className="ag-num">
                {tc.passed} of {tc.total}
              </Text>{' '}
              hidden tests pass
            </Text>
          ) : null}
          {ok && (
            <Text size="sm">
              <Text span fw={600} className="ag-num" c={nFail ? 'fail.5' : 'pass.5'}>
                {nFail}
              </Text>{' '}
              failing {nFail === 1 ? 'input' : 'inputs'}{staff ? '' : ' you can see'}
            </Text>
          )}
          <Text size="sm" c="dimmed">
            {full} of {segs.length} checks with full marks{lost ? `, ${lost} with marks lost` : ''}
          </Text>
        </Group>
        {(r.flags ?? []).some((f) => f.type !== 'compile_failed') && <FlagList flags={(r.flags ?? []).filter((f) => f.type !== 'compile_failed')} />}
      </Stack>
    </Paper>
  );
}

function Pending({ sub, timedOut, onRetry }: { sub: SubmissionDetail; timedOut: boolean; onRetry: () => void }) {
  const st = sub.job_status;
  if (isActive(st)) {
    return <GradingPanel jobId={sub.job?.id ?? null} submissionId={sub.id} onReportPage title="Still grading" />;
  }
  if (st === 'failed' || st === 'cancelled') {
    return (
      <Alert color="fail" variant="light" icon={<IconAlertTriangle size={18} />} title="Grading did not finish">
        {st === 'cancelled' ? 'Cancelled by staff.' : 'Grading failed.'} Submit again.
      </Alert>
    );
  }
  if (timedOut) return <ErrorState error={new ReportTimeout()} onRetry={onRetry} backTo="/history" backLabel="Back to my submissions" />;
  if (!st) {
    return (
      <Alert color="gray" variant="light" title="Not graded" />
    );
  }
  return <ReportSkeleton />;
}

export default function ReportPage({ id: idProp, staff: staffProp, problemHref, hideHeader }: ReportPageProps = {}) {
  const params = useParams();
  const sid = idProp ?? parseId(params.id) ?? 0;
  const { user } = useAuth();
  const staff = staffProp ?? isStaff(user);
  const [search, setSearch] = useSearchParams();
  const [firstSeen] = useState(() => Date.now());
  const [timedOut, setTimedOut] = useState(false);

  const q = useQuery({
    queryKey: submissionKey(sid),
    queryFn: () => api.submission(sid),
    enabled: sid > 0,
    refetchInterval: (query) => {
      const d = query.state.data;
      if (d?.feedback_job && isActive(d.feedback_job.status)) return POLL_MS;
      if (!d?.feedback_job && d?.report?.code_feedback?.status === 'queued' && Date.now() - firstSeen < REPORT_WAIT_MS) return POLL_MS;
      if (!d || d.report) return false;
      if (isActive(d.job_status)) return false; // the live panel polls and listens
      if (d.job_status !== 'done') return false;
      return Date.now() - firstSeen > REPORT_WAIT_MS ? false : POLL_MS;
    },
  });
  const sub = q.data;
  const waiting = !!sub && !sub.report && sub.job_status === 'done';
  useEffect(() => {
    if (!waiting) return;
    const t = window.setTimeout(() => setTimedOut(true), Math.max(0, REPORT_WAIT_MS - (Date.now() - firstSeen)));
    return () => window.clearTimeout(t);
  }, [waiting, firstSeen]);
  const slug = sub?.problem_slug || sub?.problem || sub?.report?.problem || '';
  const problem = useQuery({ queryKey: ['problem', slug], queryFn: () => api.problem(slug), enabled: !!slug, staleTime: 60_000 });
  const mine = useQuery({
    queryKey: ['submissions', slug],
    queryFn: () => api.submissions(slug),
    enabled: !!slug && !staff && !!sub?.report,
  });

  const prev = useMemo(() => {
    if (!mine.data || !sub) return null;
    const list = sortSubs(mine.data.items);
    const i = list.findIndex((s) => s.id === sub.id);
    if (i < 0) return null;
    const older = list.slice(i + 1).find((s) => effectiveOf(s) !== null);
    return older ? { grade: effectiveOf(older), id: older.id } : null;
  }, [mine.data, sub]);

  const r = sub?.report ?? null;
  const nFail = r ? failureGroups(r).count : 0;
  const ok = compiled(r);
  const showSolutions = !!slug && (staff || !!problem.data?.best_available);
  const defaultTab: TabKey = r && (!ok || nFail > 0) ? 'failures' : 'metrics';
  const asked = search.get('tab') as TabKey | null;
  const tab: TabKey = asked && TABS.includes(asked) && (asked !== 'solutions' || showSolutions) ? asked : defaultTab;
  const setTab = (v: string | null) => {
    const next = new URLSearchParams(search);
    if (!v || v === defaultTab) next.delete('tab');
    else next.set('tab', v);
    setSearch(next, { replace: true });
  };

  if (!sid) return <ErrorState error={new Error('Invalid submission link.')} backTo="/history" />;
  if (q.isPending) return <ReportSkeleton />;
  if (q.error)
    return (
      <>
        {!hideHeader && <PageHeader title="Submission" breadcrumbs={[{ label: staff ? 'Submissions' : 'My submissions', to: staff ? '/staff/submissions' : '/history' }, { label: `#${sid}` }]} />}
        <ErrorState error={q.error} onRetry={() => q.refetch()} backTo={staff ? '/staff/submissions' : '/history'} backLabel={staff ? 'Back to submissions' : 'Back to my submissions'} />
      </>
    );

  const s = sub!;
  const title = s.problem_title || problem.data?.title || slug;
  const toProblem = problemHref ? problemHref(slug) : `/problems/${encodeURIComponent(slug)}`;
  const filename = s.filename || r?.submission || 'program.c';

  const download = async () => {
    try {
      const text = s.source ?? (await api.source(s.id));
      downloadBlob(text, filename, 'text/x-csrc');
    } catch (e) {
      notify.error(e, 'Could not download the code');
    }
  };

  const crumbs = staff
    ? [{ label: 'Submissions', to: '/staff/submissions' }, { label: title, to: `/staff/submissions?problem=${encodeURIComponent(slug)}` }, { label: `#${s.id}` }]
    : [{ label: 'My submissions', to: '/history' }, { label: title, to: toProblem }, { label: `#${s.id}` }];

  const header = hideHeader ? null : (
    <PageHeader
      title={title}
      documentTitle={`Report #${s.id}, ${title}`}
      description={
        <>
          <span className="ag-mono" style={{ fontSize: 14 }}>{filename}</span> · <span title={fmtDate(s.created_at)}>{fmtRelative(s.created_at)}</span>
        </>
      }
      breadcrumbs={crumbs}
      actions={
        <Group gap="xs" wrap="wrap" style={{ maxWidth: '100%' }}>
          {!staff && slug && (
            <Button
              component={Link}
              to={`${toProblem}?from=${s.id}`}
              leftSection={<IconRepeat size={16} />}
              disabled={problem.data?.finalized}
            >
              Edit and resubmit
            </Button>
          )}
          {slug && (
            <Button component={Link} to={toProblem} variant="default" leftSection={<IconArrowLeft size={16} />}>
              Back to problem
            </Button>
          )}
          <Button variant="default" leftSection={<IconDownload size={16} />} onClick={download}>
            Download .c
          </Button>
        </Group>
      }
    >
      {!r && <StatusChip kind="job" status={s.job_status} audience={staff ? 'staff' : 'student'} />}
    </PageHeader>
  );

  if (!r) {
    return (
      <>
        {header}
        <Pending sub={s} timedOut={timedOut} onRetry={() => window.location.reload()} />
      </>
    );
  }

  return (
    <>
      {header}
      <Stack gap="lg">
        <Verdict sub={s} r={r} specs={problem.data?.metrics} prev={prev} staff={staff} />
        <StaffNotes sub={s} />
        <CodeFeedback submission={s} refresh={() => { void q.refetch(); }} />
        <Tabs value={tab} onChange={setTab} keepMounted={false} style={{ minWidth: 0, maxWidth: '100%' }}>
          <Box style={{ overflowX: 'auto', overflowY: 'hidden', maxWidth: '100%', width: '100%' }}>
            <Tabs.List style={{ flexWrap: 'nowrap', minWidth: 'max-content' }}>
              <Tabs.Tab value="failures" leftSection={<IconX size={15} />} rightSection={nFail ? <Badge size="sm" color="fail" variant="light" className="ag-num">{nFail}</Badge> : undefined}>
                Failures
              </Tabs.Tab>
              <Tabs.Tab value="metrics" leftSection={<IconListCheck size={15} />}>
                Metrics
              </Tabs.Tab>
              <Tabs.Tab value="memory" leftSection={<IconGauge size={15} />}>
                Memory and speed
              </Tabs.Tab>
              <Tabs.Tab value="quality" leftSection={<IconStethoscope size={15} />}>
                Code quality
              </Tabs.Tab>
              <Tabs.Tab value="source" leftSection={<IconCode size={15} />}>
                Source
              </Tabs.Tab>
              {showSolutions && (
                <Tabs.Tab value="solutions" leftSection={<IconTrophy size={15} />}>
                  Model solutions
                </Tabs.Tab>
              )}
            </Tabs.List>
          </Box>
          <Box pt="md">
            <Tabs.Panel value="failures">
              <FailuresTab r={r} filename={filename} />
            </Tabs.Panel>
            <Tabs.Panel value="metrics">
              <MetricsTab r={r} specs={problem.data?.metrics} />
            </Tabs.Panel>
            <Tabs.Panel value="memory">
              <MemoryTab r={{ ...r, time_limit_s: problem.data?.limits.time_limit_s ?? undefined }} />
            </Tabs.Panel>
            <Tabs.Panel value="quality">
              <QualityTab r={r} filename={filename} />
            </Tabs.Panel>
            <Tabs.Panel value="source">
              <SourceTab r={r} source={s.source ?? ''} filename={filename} />
            </Tabs.Panel>
            {showSolutions && (
              <Tabs.Panel value="solutions">
                <SolutionsTab slug={slug} />
              </Tabs.Panel>
            )}
          </Box>
        </Tabs>
      </Stack>
    </>
  );
}
