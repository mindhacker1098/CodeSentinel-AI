import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Alert, Box, Button, Collapse, Group, Loader, Paper, ScrollArea, Stack, Stepper, Text, Title, UnstyledButton } from '@mantine/core';
import {
  IconAlertTriangle,
  IconChevronDown,
  IconChevronRight,
  IconFileText,
  IconRefresh,
  IconTerminal2,
} from '@tabler/icons-react';
import { api, type LogEvent } from '../../api/client';
import { useJobEvents } from '../../api/sse';
import { GradeDisplay, VerdictBar } from '../../components';
import { cleanText, compiled, humanize, isActive, segmentsFor, STAGES, stageIndex, testCounts } from './shared';
import { submissionKey } from './hooks';
import type { MetricSpec } from '../../api/client';

// ---------------------------------------------------------------- terminal log
const KIND_TONE: Record<string, string> = {
  error: 'var(--ag-fail)',
  warn: 'var(--ag-warn)',
  verdict: 'var(--ag-pass)',
  ok: 'var(--ag-pass)',
  result: 'var(--ag-warn)',
  plan: 'var(--ag-info)',
  status: 'var(--ag-info)',
};

/** The API already drops staff-only kinds and worker bookkeeping for students; stage and status events drive the
 * stepper, not the log. */
const NOT_LOG = new Set(['stage', 'status']);

function visibleEvents(events: LogEvent[]): LogEvent[] {
  return events.filter((e) => !NOT_LOG.has(e.kind));
}

function tidy(msg: string): string {
  return cleanText(humanize(msg))
    .replace(/^dispatch plan:\s*/i, 'Plan: ')
    .replace(/\bSKIP\b/g, 'skip');
}

function hhmmss(ts: string) {
  const d = new Date(ts);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleTimeString(undefined, { hour12: false });
}

export function StudentLog({ events, height = 240, finished }: { events: LogEvent[]; height?: number; finished?: boolean }) {
  const viewport = useRef<HTMLDivElement>(null);
  const rows = useMemo(() => visibleEvents(events), [events]);
  useEffect(() => {
    viewport.current?.scrollTo({ top: viewport.current.scrollHeight });
  }, [rows.length]);
  return (
    <Box style={{ border: '1px solid var(--ag-line)', borderRadius: 6, background: 'var(--ag-bg)' }}>
      <ScrollArea h={height} viewportRef={viewport} type="auto">
        <Box component="pre" m={0} p="sm" className="ag-mono" style={{ fontSize: 12, lineHeight: 1.6, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }} aria-live="polite">
          {rows.length === 0 ? (
            <span style={{ color: 'var(--ag-muted)' }}>{finished ? 'No log lines were recorded for this run.' : 'Waiting for the first step to start.'}</span>
          ) : (
            rows.map((e, i) => (
              <div key={e.id ?? i}>
                <span style={{ color: '#6B7891' }}>{hhmmss(e.ts)} </span>
                <span style={{ color: KIND_TONE[e.kind] ?? 'var(--ag-text)' }}>{tidy(e.msg)}</span>
              </div>
            ))
          )}
        </Box>
      </ScrollArea>
    </Box>
  );
}

// ---------------------------------------------------------------- panel
export interface GradingPanelProps {
  jobId: number | null;
  submissionId: number;
  /** Labels for the verdict bar. */
  metrics?: MetricSpec[];
  /** "Submit another version" in the result card. */
  onReset?: () => void;
  /** Hide the "View full report" button (when already on the report). */
  onReportPage?: boolean;
  title?: string;
}

const POLL_MS = 4000;
const MAX_WAIT_MS = 5 * 60_000;

/** Stage stepper, collapsible log and, when grading is done, the result inline. Never redirects. */
export default function GradingPanel({ jobId, submissionId, metrics, onReset, onReportPage, title = 'Grading' }: GradingPanelProps) {
  const ev = useJobEvents(jobId);
  const qc = useQueryClient();
  const [logOpen, setLogOpen] = useState(false);
  const [started] = useState(() => Date.now());

  // Poll as a fallback for a dropped live connection; stop once there is a report or grading failed.
  const sub = useQuery({
    queryKey: submissionKey(submissionId),
    queryFn: () => api.submission(submissionId),
    refetchInterval: (q) => {
      const d = q.state.data;
      if (d?.report) return false;
      if (d && !isActive(d.job_status) && d.job_status !== 'done') return false;
      if (Date.now() - started > MAX_WAIT_MS) return false;
      return POLL_MS;
    },
  });

  useEffect(() => {
    if (ev.done || ev.result) {
      qc.invalidateQueries({ queryKey: submissionKey(submissionId) });
      qc.invalidateQueries({ queryKey: ['problems'] });
      qc.invalidateQueries({ queryKey: ['problem'] });
      qc.invalidateQueries({ queryKey: ['submissions'] });
    }
  }, [ev.done, ev.result, submissionId, qc]);

  const d = sub.data;
  const report = d?.report ?? null;
  const status = ev.status ?? d?.job_status ?? null;
  const failed = status === 'failed' || status === 'cancelled';
  const finished = !!report;
  const stage = finished ? 'done' : ev.stage?.stage ?? (status === 'running' ? 'compile' : 'queued');
  const active = finished ? STAGES.length : stageIndex(stage) + (stage === 'done' ? 1 : 0);
  const timedOut = !finished && !failed && Date.now() - started > MAX_WAIT_MS;

  const stepper = (
    <Stepper
      active={active}
      size="xs"
      orientation="vertical"
      color={failed ? 'fail' : 'pass'}
      iconSize={22}
      allowNextStepsSelect={false}
      styles={{
        stepLabel: { fontSize: 14, fontWeight: 500 },
        stepBody: { justifyContent: 'center' },
        verticalSeparator: { top: 'calc(22px + 2px)', left: 10, borderLeftWidth: 2 },
        step: { minHeight: 34 },
      }}
      aria-label="Grading steps"
    >
      {STAGES.map((s, i) => (
        <Stepper.Step
          key={s.key}
          label={s.label}
          description={i === active && !finished && !failed && s.key !== 'done' ? (ev.stage?.label && ev.stage.label !== s.label ? ev.stage.label : 'In progress') : undefined}
          loading={!finished && !failed && i === active && s.key !== 'done'}
          color={failed && i === active ? 'fail' : undefined}
        />
      ))}
    </Stepper>
  );

  return (
    <Paper p="md" aria-busy={!finished && !failed}>
      <Stack gap="md">
        <Group justify="space-between" wrap="nowrap" align="flex-start">
          <Box>
            <Title order={2} fz={20}>
              {finished ? 'Graded' : failed ? 'Grading did not finish' : title}
            </Title>
            {!finished && !failed && (
              <Text size="sm" c="dimmed" mt={2}>
                {ev.stage?.label && stage !== 'queued' ? ev.stage.label : 'Queued'}
              </Text>
            )}
          </Box>
          {!finished && !failed && <Loader size="sm" color="info" aria-label="Grading" />}
        </Group>

        {!finished && stepper}

        {failed && (
          <Alert color="fail" variant="light" icon={<IconAlertTriangle size={18} />} title="Grading stopped">
            {d?.job && 'error' in d.job && d.job.error && /cancel/i.test(String(d.job.error))
              ? 'Staff cancelled this grading run.'
              : 'Submit again. If it keeps failing, tell your TA.'}
          </Alert>
        )}

        {timedOut && (
          <Alert color="warn" variant="light" icon={<IconAlertTriangle size={18} />} title="Taking longer than usual">
            <Stack gap="xs">
              <Text size="sm">The queue is busy. Your submission is saved.</Text>
              <Group>
                <Button size="xs" variant="default" leftSection={<IconRefresh size={14} />} onClick={() => sub.refetch()}>
                  Check again
                </Button>
              </Group>
            </Stack>
          </Alert>
        )}

        {finished && report && (
          <ResultCard
            grade={d?.grade ?? report.grade}
            effective={d?.effective_grade}
            provisional={!!report.provisional}
            incomplete={!!report.partial}
            submissionId={submissionId}
            report={report}
            metrics={metrics}
            onReset={onReset}
            onReportPage={onReportPage}
          />
        )}

        {ev.error && !finished && (
          <Text size="sm" c="warn.5">
            Live updates stopped. Still checking.
          </Text>
        )}

        <Box>
          <UnstyledButton
            onClick={() => setLogOpen((o) => !o)}
            aria-expanded={logOpen}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 6, color: 'var(--ag-muted)', fontSize: 14 }}
          >
            {logOpen ? <IconChevronDown size={16} aria-hidden /> : <IconChevronRight size={16} aria-hidden />}
            <IconTerminal2 size={16} aria-hidden />
            {logOpen ? 'Hide log' : 'Show log'}
            <Text span size="sm" c="dimmed">
              ({visibleEvents(ev.events).length} lines)
            </Text>
          </UnstyledButton>
          <Collapse in={logOpen}>
            <Box mt="xs">
              <StudentLog events={ev.events} finished={finished || failed} height={visibleEvents(ev.events).length ? 240 : 64} />
            </Box>
          </Collapse>
        </Box>
      </Stack>
    </Paper>
  );
}

function ResultCard({
  grade,
  effective,
  provisional,
  incomplete,
  submissionId,
  report,
  metrics,
  onReset,
  onReportPage,
}: {
  grade: number | null;
  effective?: number | null;
  provisional: boolean;
  incomplete: boolean;
  submissionId: number;
  report: NonNullable<import('../../api/client').SubmissionDetail['report']>;
  metrics?: MetricSpec[];
  onReset?: () => void;
  onReportPage?: boolean;
}) {
  const segs = segmentsFor(report, metrics);
  const tc = testCounts(report);
  const ok = compiled(report);
  const lost = segs.filter((s) => s.status !== 'pass' && s.status !== 'skipped');
  return (
    <Stack gap="sm">
      <Group gap="lg" align="flex-end" wrap="wrap">
        <GradeDisplay size="lg" grade={grade} effectiveGrade={effective} provisional={provisional} incomplete={incomplete} />
        <Stack gap={2}>
          {!ok ? (
            <Text size="sm" c="fail.5">
              Does not compile
            </Text>
          ) : tc ? (
            <Text size="sm">
              {tc.passed}/{tc.total} hidden tests pass
            </Text>
          ) : null}
          {ok && lost.length > 0 && (
            <Text size="sm" c="dimmed">
              Lost marks: {lost.map((s) => s.label.toLowerCase()).join(', ')}
            </Text>
          )}
        </Stack>
      </Group>
      <VerdictBar segments={segs} size="lg" />
      <Group gap="xs" mt={4}>
        {!onReportPage && (
          <Button component={Link} to={`/submissions/${submissionId}`} leftSection={<IconFileText size={16} />}>
            Full report
          </Button>
        )}
        {onReset && (
          <Button variant="default" onClick={onReset}>
            Submit again
          </Button>
        )}
      </Group>
    </Stack>
  );
}
