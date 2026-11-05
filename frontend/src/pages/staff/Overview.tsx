import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Anchor, Box, Button, Group, Paper, SimpleGrid, Stack, Text, Title, Tooltip } from '@mantine/core';
import {
  IconAlertTriangle,
  IconCalendarDue,
  IconChartBar,
  IconCopy,
  IconFileCode,
  IconFlag,
  IconListCheck,
  IconServer,
  IconStack2,
  IconTable,
  IconUpload,
  IconUsers,
} from '@tabler/icons-react';
import { api, type StaffSubmissionRow } from '../../api/client';
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
  type Column,
} from '../../components';
import { fmtDate, fmtRelative } from '../../format';
import { FlagChips } from './FlagReview';

function workerHint(workers: { online: boolean; busy: boolean }[] | undefined, online: number) {
  if (!workers) return { text: '', tone: undefined as 'pass' | 'fail' | 'warn' | undefined };
  const live = workers.filter((w) => w.online);
  if (!online) return { text: 'No worker running. Start one.', tone: 'fail' as const };
  const busy = live.filter((w) => w.busy).length;
  return {
    text: busy ? `${busy} busy` : 'Idle',
    tone: 'pass' as const,
  };
}

const QUICK = [
  { to: '/staff/problems/new', label: 'New problem', icon: IconFileCode },
  { to: '/staff/users', label: 'Roster', icon: IconUsers },
  { to: '/staff/gradebook', label: 'Gradebook', icon: IconTable },
  { to: '/staff/plagiarism', label: 'Plagiarism', icon: IconCopy },
  { to: '/staff/leaderboard', label: 'Leaderboard', icon: IconChartBar },
  { to: '/staff/queue', label: 'Queue', icon: IconStack2 },
];

export default function Overview() {
  const ov = useQuery({ queryKey: ['staff', 'overview'], queryFn: api.staff.overview, refetchInterval: 10_000 });
  const queue = useQuery({ queryKey: ['staff', 'queue', 1], queryFn: () => api.staff.queue(1), refetchInterval: 10_000 });
  const o = ov.data;
  const w = workerHint(queue.data?.workers, o?.workers_online ?? 0);

  const cols: Column<StaffSubmissionRow>[] = [
    {
      key: 'student',
      header: 'Student',
      cell: (r) => (
        <Anchor component={Link} to={`/staff/submissions/${r.id}`} size="sm">
          <span className="ag-mono">{r.roll_no}</span> {r.name}
        </Anchor>
      ),
    },
    { key: 'problem', header: 'Problem', cell: (r) => r.problem_title },
    {
      key: 'time',
      header: 'Submitted',
      cell: (r) => (
        <Tooltip label={fmtDate(r.created_at)}>
          <Text size="sm" c="dimmed" span>
            {fmtRelative(r.created_at)}
          </Text>
        </Tooltip>
      ),
    },
    {
      key: 'grade',
      header: 'Grade',
      cell: (r) =>
        r.job_status === 'queued' || r.job_status === 'running' || (r.grade === null && r.job_status && r.job_status !== 'done') ? (
          <StatusChip kind="job" status={r.job_status} size="sm" />
        ) : (
          <GradeDisplay grade={r.grade} effectiveGrade={r.effective_grade} provisional={r.provisional} incomplete={r.partial} override={r.overridden} size="sm" />
        ),
    },
    {
      key: 'flags',
      header: 'Flags',
      cell: (r) => <FlagChips flags={r.flags} submissionId={r.id} problemSlug={r.problem_slug} />,
    },
  ];

  return (
    <Stack gap="lg">
      <PageHeader
        title="Overview"
        breadcrumbs={[{ label: 'Course' }, { label: 'Overview' }]}
        actions={
          <Button component={Link} to="/staff/submissions" variant="default" leftSection={<IconListCheck size={16} />}>
            All submissions
          </Button>
        }
      />

      {ov.error ? (
        <ErrorState error={ov.error} onRetry={() => ov.refetch()} backTo={false} />
      ) : !o ? (
        <CardSkeleton count={6} />
      ) : (
        <SimpleGrid cols={{ base: 1, xs: 2, md: 3 }} spacing="md">
          <StatCard
            label="Open flags"
            icon={IconFlag}
            value={o.open_flags}
            tone={o.open_flags ? 'warn' : undefined}
            hint={o.open_flags ? 'To review' : 'None'}
            to="/staff/flags"
          />
          <StatCard
            label="Submissions today"
            icon={IconUpload}
            value={o.submissions_today}
            hint="Since midnight"
            to="/staff/submissions"
          />
          <StatCard
            label="Failed grading"
            icon={IconAlertTriangle}
            value={o.failed_jobs}
            tone={o.failed_jobs ? 'fail' : undefined}
            hint={o.failed_jobs ? 'Retry from the queue' : 'None'}
            to="/staff/queue"
          />
          <StatCard
            label="Queued or running"
            icon={IconStack2}
            value={o.queued + o.running}
            tone={o.queued + o.running ? 'info' : undefined}
            hint={`${o.queued} queued, ${o.running} running`}
            to="/staff/queue"
          />
          <StatCard
            label="Workers online"
            icon={IconServer}
            value={o.workers_online}
            tone={w.tone}
            hint={<Text span size="sm" c={w.tone ? `${w.tone}.5` : 'dimmed'}>{w.text || ' '}</Text>}
            to="/staff/queue"
          />
          <StatCard
            label="Next deadline"
            icon={IconCalendarDue}
            value={
              o.next_deadline ? (
                <Text span fz={20} fw={600} lh={1.2} style={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {o.next_deadline.title}
                </Text>
              ) : (
                <Text span fz={20} fw={600} c="dimmed">
                  None
                </Text>
              )
            }
            hint={o.next_deadline ? <Countdown to={o.next_deadline.due_at} /> : 'No upcoming deadline'}
            to={o.next_deadline ? `/staff/problems/${o.next_deadline.slug}` : '/staff/problems'}
          />
        </SimpleGrid>
      )}

      <Group align="flex-start" gap="xl" wrap="wrap">
        <Stack gap="sm" style={{ flex: '1 1 560px', minWidth: 0 }}>
          <Group justify="space-between">
            <Title order={2}>Recent submissions</Title>
            <Anchor component={Link} to="/staff/submissions" size="sm">
              View all
            </Anchor>
          </Group>
          <ResponsiveTable
            data={o?.recent_submissions ?? []}
            columns={cols}
            rowKey={(r) => r.id}
            loading={ov.isPending}
            minWidth={600}
            caption="Five most recent submissions"
            empty={<EmptyState compact icon={IconUpload} title="No submissions yet" />}
          />
        </Stack>
        <Stack gap="sm" style={{ flex: '0 1 280px', minWidth: 240 }}>
          <Title order={2}>Quick links</Title>
          <Paper p={0}>
            {QUICK.map((q, i) => (
              <Box key={q.to} style={{ borderTop: i ? '1px solid var(--ag-line)' : undefined }}>
                <Anchor
                  component={Link}
                  to={q.to}
                  underline="never"
                  c="var(--ag-text)"
                  className="ag-quicklink"
                  style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', fontSize: 14 }}
                >
                  <q.icon size={16} stroke={1.7} color="var(--ag-muted)" aria-hidden />
                  {q.label}
                </Anchor>
              </Box>
            ))}
          </Paper>
        </Stack>
      </Group>
    </Stack>
  );
}
