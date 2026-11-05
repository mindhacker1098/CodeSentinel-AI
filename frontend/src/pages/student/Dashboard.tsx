import { useMemo } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Anchor, Box, Button, Group, Paper, SimpleGrid, Stack, Text, Title } from '@mantine/core';
import {
  IconAlertTriangle,
  IconCalendarDue,
  IconCircleDashed,
  IconChartBar,
  IconChecklist,
  IconFileText,
  IconHistory,
  IconInbox,
  IconPlayerPlay,
} from '@tabler/icons-react';
import { api, type ProblemSummary } from '../../api/client';
import {
  CardSkeleton,
  Countdown,
  EmptyState,
  ErrorState,
  GradeDisplay,
  PageHeader,
  ResponsiveTable,
  StatCard,
  StatusChip,
  VerdictBar,
  type Column,
} from '../../components';
import { fmtDate, fmtGrade, fmtRelative } from '../../format';
import { useSubmissionDetails } from './hooks';
import { COURSE, countedGrade, problemState, segmentsFor, sortSubs } from './shared';

function StateChip({ p }: { p: ProblemSummary }) {
  const s = problemState(p);
  if (s === 'grading') return <StatusChip kind="job" status={p.my_latest?.job_status ?? 'running'} audience="student" />;
  if (s === 'not-started') return <StatusChip kind="custom" tone="gray" icon={IconCircleDashed} label="Not started" />;
  if (s === 'failed') return <StatusChip kind="custom" tone="fail" icon={IconAlertTriangle} label="Grading failed" />;
  return <StatusChip kind="custom" tone="pass" icon={IconChecklist} label={`Graded ${p.my_count}×`} />;
}

export default function Dashboard() {
  const nav = useNavigate();
  const problems = useQuery({ queryKey: ['problems'], queryFn: api.problems });
  const subs = useQuery({ queryKey: ['submissions', 'all'], queryFn: () => api.submissions() });

  const list = problems.data ?? [];
  const latestIds = useMemo(
    () =>
      list
        .map((p) => p.my_latest)
        .filter((s) => s && s.submission_id && s.job_status === 'done')
        .map((s) => s!.submission_id!) as number[],
    [list],
  );
  const details = useSubmissionDetails(latestIds);

  const stats = useMemo(() => {
    const open = list.filter((p) => !p.finalized);
    const done = list.filter((p) => countedGrade(p) !== null);
    const grades = done.map((p) => countedGrade(p)!) as number[];
    const avg = grades.length ? grades.reduce((a, b) => a + b, 0) / grades.length : null;
    const upcoming = open
      .filter((p) => p.due_at && new Date(p.due_at).getTime() > Date.now())
      .sort((a, b) => new Date(a.due_at!).getTime() - new Date(b.due_at!).getTime());
    const notStarted = list.filter((p) => p.my_count === 0).length;
    return { done: done.length, total: list.length, notStarted, avg, next: upcoming[0] ?? null };
  }, [list]);

  const recent = subs.data ? sortSubs(subs.data.items)[0] ?? null : null;
  const recentProblem = recent ? list.find((p) => p.slug === recent.problem_slug) : undefined;
  const firstTodo = list.find((p) => problemState(p) === 'not-started' && !p.deadline_passed && !p.finalized);

  const columns: Column<ProblemSummary>[] = [
    {
      key: 'title',
      header: 'Problem',
      cell: (p) => (
        <Anchor component={Link} to={`/problems/${encodeURIComponent(p.slug)}`} fw={500} c="var(--ag-text)" underline="hover">
          {p.title}
        </Anchor>
      ),
    },
    { key: 'status', header: 'Status', cell: (p) => <StateChip p={p} /> },
    {
      key: 'best',
      header: 'Best',
      align: 'right',
      cell: (p) => (
        <GradeDisplay grade={p.my_best?.grade ?? null} provisional={p.my_best?.provisional} size="sm" emptyLabel="-" />
      ),
    },
    {
      key: 'latest',
      header: 'Latest',
      align: 'right',
      cell: (p) => (
        <GradeDisplay grade={p.my_latest?.grade ?? null} provisional={!!p.my_latest?.provisional} size="sm" emptyLabel="-" />
      ),
    },
    {
      key: 'checks',
      header: 'Latest checks',
      cell: (p) => {
        const d = p.my_latest?.submission_id ? details.get(p.my_latest.submission_id) : undefined;
        const segs = segmentsFor(d?.report);
        return segs.length ? (
          <Box w={120} maw="100%" ml="auto">
            <VerdictBar segments={segs} size="sm" />
          </Box>
        ) : (
          <Text size="sm" c="dimmed">
            -
          </Text>
        );
      },
      width: 140,
    },
    {
      key: 'due',
      header: 'Deadline',
      cell: (p) => (p.finalized ? <Text size="sm" c="dimmed">Grading closed</Text> : <Countdown to={p.due_at} />),
    },
    {
      key: 'left',
      header: 'Attempts left',
      cardLabel: 'Attempts left this hour',
      align: 'right',
      cell: (p) =>
        p.submissions_left_this_hour == null ? (
          '-'
        ) : (
          <Text size="sm" className="ag-num" c={p.submissions_left_this_hour === 0 ? 'fail.5' : undefined} title="Submissions left this hour">
            {p.submissions_left_this_hour} of {p.max_submissions_per_hour}
          </Text>
        ),
    },
    {
      key: 'open',
      header: <span className="ag-sr-only">Open</span>,
      cardLabel: '',
      hideOnCard: true,
      align: 'right',
      cell: (p) => (
        <Button size="xs" variant="default" component={Link} to={`/problems/${encodeURIComponent(p.slug)}`} onClick={(e) => e.stopPropagation()}>
          Open
        </Button>
      ),
    },
  ];

  return (
    <>
      <PageHeader
        title="Problems"
        documentTitle="Problems"
        description={
          problems.data
            ? `${COURSE} · ${list.filter((p) => !p.finalized && !p.deadline_passed).length} open`
            : COURSE
        }
        breadcrumbs={[{ label: 'Problems' }]}
        actions={
          <Button variant="default" component={Link} to="/history" leftSection={<IconHistory size={16} />}>
            My submissions
          </Button>
        }
      />

      <Stack gap="lg">
        {problems.isPending ? (
          <CardSkeleton count={4} />
        ) : problems.error ? null : (
          <SimpleGrid cols={{ base: 2, md: 4 }} spacing="md">
            <StatCard
              label="Problems done"
              icon={IconChecklist}
              value={
                <>
                  {stats.done}
                  <Text span fz={16} c="dimmed" fw={400}>
                    {' '}
                    of {stats.total}
                  </Text>
                </>
              }
              hint={
                stats.done === stats.total && stats.total
                  ? 'All graded'
                  : stats.notStarted === stats.total - stats.done
                    ? `${stats.notStarted} not started`
                    : `${stats.total - stats.done} not graded`
              }
            />
            <StatCard
              label="Average grade"
              icon={IconChartBar}
              value={stats.avg === null ? '-' : fmtGrade(Math.round(stats.avg * 10) / 10)}
              tone={stats.avg === null ? undefined : stats.avg >= 80 ? 'pass' : stats.avg >= 40 ? 'warn' : 'fail'}
            />
            <StatCard
              label="Next deadline"
              icon={IconCalendarDue}
              value={stats.next ? <Countdown to={stats.next.due_at} prefix="In" size="md" noIcon /> : 'None'}
              hint={stats.next ? stats.next.title : 'No open deadlines'}
              to={stats.next ? `/problems/${encodeURIComponent(stats.next.slug)}` : undefined}
            />
            <StatCard
              label="Last submission"
              icon={IconFileText}
              value={recent ? <Text fz={20} fw={600} lh={1.3}>{fmtRelative(recent.created_at)}</Text> : '-'}
              hint={recent ? recent.problem_title ?? recent.problem_slug : 'None yet'}
              to={recent ? `/submissions/${recent.id}` : undefined}
            />
          </SimpleGrid>
        )}

        {(recent || firstTodo) && (
          <Paper p="md" component="section" aria-labelledby="continue" style={{ borderLeft: '3px solid var(--ag-iris)' }}>
            <Group justify="space-between" wrap="wrap" gap="sm">
              <Box style={{ minWidth: 0, flex: '1 1 260px' }}>
                <Title order={2} fz={16} id="continue">
                  {recent ? recent.problem_title ?? recent.problem_slug : firstTodo!.title}
                </Title>
                <Group gap="sm" mt={6} wrap="wrap">
                  {recent ? (
                    <>
                      <GradeDisplay grade={recent.grade} provisional={recent.provisional} incomplete={recent.partial} size="sm" emptyLabel="Not graded yet" />
                      <Text size="sm" c="dimmed">
                        <span title={fmtDate(recent.created_at)}>Submitted {fmtRelative(recent.created_at)}</span>
                      </Text>
                      {recentProblem && !recentProblem.finalized && <Countdown to={recentProblem.due_at} />}
                    </>
                  ) : (
                    <>
                      <Text size="sm" c="dimmed">
                        Not started
                      </Text>
                      <Countdown to={firstTodo!.due_at} />
                    </>
                  )}
                </Group>
              </Box>
              <Group gap="xs">
                {recent && (
                  <Button variant="default" component={Link} to={`/submissions/${recent.id}`} leftSection={<IconFileText size={16} />}>
                    Report
                  </Button>
                )}
                <Button
                  component={Link}
                  to={`/problems/${encodeURIComponent(recent ? recent.problem_slug : firstTodo!.slug)}`}
                  leftSection={<IconPlayerPlay size={16} />}
                >
                  Open
                </Button>
              </Group>
            </Group>
          </Paper>
        )}

        <Box component="section" aria-labelledby="problems-h">
          <Title order={2} fz={20} mb="sm" id="problems-h">
            All problems
          </Title>
          {problems.error ? (
            <ErrorState error={problems.error} onRetry={() => problems.refetch()} backTo={false} />
          ) : (
            <ResponsiveTable
              data={list}
              columns={columns}
              rowKey={(p) => p.slug}
              loading={problems.isPending}
              minWidth={860}
              caption="Problems"
              onRowClick={(p) => nav(`/problems/${encodeURIComponent(p.slug)}`)}
              empty={
                <EmptyState
                  icon={IconInbox}
                  title="No problems yet"
                />
              }
            />
          )}
        </Box>
      </Stack>
    </>
  );
}
