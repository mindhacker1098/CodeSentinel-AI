import { Link } from 'react-router-dom';
import { keepPreviousData, useMutation, useQuery } from '@tanstack/react-query';
import { Anchor, Badge, Button, Group, Pagination, Stack, Tabs, Text, Title, Tooltip } from '@mantine/core';
import { IconBan, IconCircleFilled, IconHistory, IconRefreshAlert, IconServer, IconStack2 } from '@tabler/icons-react';
import { api, type ActiveJob, type AuditEntry, type JobInfo, type WorkerInfo } from '../../api/client';
import { confirm, EmptyState, ErrorState, PageHeader, ResponsiveTable, StatusChip, type Column } from '../../components';
import { fmtDate, fmtRelative } from '../../format';
import { notify } from '../../notify';
import { fmtDuration, plural, useInvalidate, useParam, WhyDisabled } from './common';

const KIND: Record<string, string> = {
  grade: 'Grade',
  regrade: 'Regrade',
  enrich: 'Feedback',
  profile: 'Profile',
  plagiarism_scan: 'Plagiarism scan',
  corpus_gen: 'AI corpus',
};
const kindName = (k: string) => KIND[k] ?? k.replace(/_/g, ' ');

type QJob = JobInfo & { roll_no?: string | null; problem_slug?: string | null; duration_s?: number | null };

/** The error without its traceback. */
function firstLine(e: string): string {
  return e.split(/\s+Traceback \(most recent call last\)|\r?\n/)[0];
}

function JobState({ j }: { j: QJob }) {
  if (j.status === 'cancelled') {
    return (
      <Group gap={6} wrap="nowrap">
        <StatusChip kind="job" status="cancelled" size="sm" />
        {j.error && (
          <Text size="sm" c="dimmed" style={{ whiteSpace: 'nowrap' }}>
            {j.error}
          </Text>
        )}
      </Group>
    );
  }
  if (j.status === 'failed') {
    return (
      <Group gap={6} wrap="nowrap">
        <StatusChip kind="job" status="failed" size="sm" />
        {j.error && (
          <Tooltip label={firstLine(j.error).slice(0, 400)} multiline maw={420}>
            <Text size="sm" c="fail.4" truncate maw={260} tabIndex={0}>
              {firstLine(j.error)}
            </Text>
          </Tooltip>
        )}
      </Group>
    );
  }
  return <StatusChip kind="job" status={j.status} size="sm" />;
}

function What({ j }: { j: QJob }) {
  return (
    <Stack gap={0}>
      <Text size="sm">
        {kindName(j.kind)}{' '}
        <Text span size="sm" c="dimmed" className="ag-num">
          #{j.id}
        </Text>
      </Text>
      {(j.roll_no || j.problem_slug) && (
        <Text size="sm" c="dimmed">
          {j.roll_no && <span className="ag-mono">{j.roll_no}</span>}
          {j.roll_no && j.problem_slug ? ', ' : ''}
          {j.problem_slug}
        </Text>
      )}
    </Stack>
  );
}

function JobsTab() {
  const [pageRaw, setPage] = useParam('page', '1');
  const page = Math.max(1, Number(pageRaw) || 1);
  const q = useQuery({
    queryKey: ['staff', 'queue', page],
    queryFn: () => api.staff.queue(page),
    refetchInterval: 4000,
    placeholderData: keepPreviousData,
  });
  const invalidate = useInvalidate();
  const cancel = useMutation({
    mutationFn: (id: number) => api.staff.cancelJob(id),
    onSuccess: (j) => {
      notify.success(`Cancelled job ${j.id}`);
      invalidate(['staff', 'queue'], ['staff', 'submissions']);
    },
    onError: (e) => notify.error(e),
  });
  const retry = useMutation({
    mutationFn: () => api.staff.retryFailed(),
    onSuccess: (r) => {
      notify.success(r.requeued ? `Retried ${plural(r.requeued, 'failed job')}` : 'Nothing to retry');
      invalidate(['staff', 'queue'], ['staff', 'submissions']);
    },
    onError: (e) => notify.error(e),
  });

  const d = q.data;
  const failed = d?.counts.failed ?? 0;
  const askCancel = async (j: ActiveJob) => {
    const ok = await confirm({
      title: 'Cancel this job?',
      target: `${kindName(j.kind)} #${j.id}${j.roll_no ? `, ${j.roll_no}` : ''}${j.problem_slug ? `, ${j.problem_slug}` : ''}`,
      message: j.status === 'running' ? 'The submission keeps its previous grade.' : undefined,
      confirmLabel: 'Cancel job',
      cancelLabel: 'Keep it',
      danger: true,
    });
    if (ok) cancel.mutate(j.id);
  };
  const askRetry = async () => {
    const ok = await confirm({
      title: `Retry ${plural(failed, 'failed job')}?`,
      confirmLabel: `Retry ${plural(failed, 'failed job')}`,
    });
    if (ok) retry.mutate();
  };

  const workerCols: Column<WorkerInfo>[] = [
    { key: 'id', header: 'Worker', mono: true, cell: (w) => w.worker_id },
    { key: 'host', header: 'Host', cell: (w) => <Text size="sm">{w.host}</Text> },
    {
      key: 'state',
      header: 'State',
      cell: (w) =>
        !w.online ? (
          <StatusChip kind="custom" tone="gray" icon={IconCircleFilled} label="Offline" size="sm" />
        ) : w.busy ? (
          <StatusChip kind="custom" tone="info" icon={IconCircleFilled} label="Online, busy" size="sm" />
        ) : (
          <StatusChip kind="custom" tone="pass" icon={IconCircleFilled} label="Online, idle" size="sm" />
        ),
    },
    {
      key: 'seen',
      header: 'Last seen',
      cell: (w) => (
        <Tooltip label={fmtDate(w.last_seen)}>
          <Text size="sm" c="dimmed" span>
            {fmtRelative(w.last_seen)}
          </Text>
        </Tooltip>
      ),
    },
  ];
  const activeCols: Column<ActiveJob>[] = [
    { key: 'what', header: 'Job', cell: (j) => <What j={j} /> },
    { key: 'state', header: 'State', cell: (j) => <StatusChip kind="job" status={j.status} size="sm" /> },
    {
      key: 'sub',
      header: 'Submission',
      cell: (j) =>
        j.submission_id ? (
          <Anchor component={Link} to={`/staff/submissions/${j.submission_id}`} size="sm">
            Open submission {j.submission_id}
          </Anchor>
        ) : (
          <Text size="sm" c="dimmed">-</Text>
        ),
    },
    { key: 'worker', header: 'Worker', mono: true, cell: (j) => j.worker_id ?? '-' },
    {
      key: 'dur',
      header: 'Running for',
      align: 'right',
      cell: (j) => <Text size="sm" className="ag-num">{j.status === 'queued' ? `queued ${fmtRelative(j.created_at)}` : fmtDuration(j.duration_s)}</Text>,
    },
  ];
  const recentCols: Column<QJob>[] = [
    { key: 'what', header: 'Job', cell: (j) => <What j={j} /> },
    { key: 'state', header: 'Result', cell: (j) => <JobState j={j} /> },
    {
      key: 'sub',
      header: 'Submission',
      cell: (j) =>
        j.submission_id ? (
          <Anchor component={Link} to={`/staff/submissions/${j.submission_id}`} size="sm">
            {j.submission_id}
          </Anchor>
        ) : (
          <Text size="sm" c="dimmed">-</Text>
        ),
    },
    { key: 'dur', header: 'Took', align: 'right', cell: (j) => <Text size="sm" className="ag-num">{fmtDuration(j.duration_s)}</Text> },
    {
      key: 'done',
      header: 'Finished',
      cell: (j) => (
        <Tooltip label={fmtDate(j.finished_at)}>
          <Text size="sm" c="dimmed" span style={{ whiteSpace: 'nowrap' }}>
            {fmtRelative(j.finished_at)}
          </Text>
        </Tooltip>
      ),
    },
  ];

  if (q.error) return <ErrorState error={q.error} onRetry={() => q.refetch()} backTo={false} />;
  const pages = d ? Math.max(1, Math.ceil(d.recent.total / 50)) : 1;
  const online = d?.workers.filter((w) => w.online) ?? [];

  return (
    <Stack gap="lg">
      <Group justify="space-between" wrap="wrap" gap="sm">
        <Group gap="xs" wrap="wrap">
          {(['queued', 'running', 'done', 'failed', 'cancelled'] as const).map((s) => (
            <Group key={s} gap={6}>
              <StatusChip kind="job" status={s} size="sm" />
              <Text size="sm" className="ag-num" fw={500} mr="sm">
                {d?.counts[s] ?? '-'}
              </Text>
            </Group>
          ))}
        </Group>
        <WhyDisabled reason={!failed && 'No failed jobs'}>
          <Button variant="default" leftSection={<IconRefreshAlert size={16} />} disabled={!failed} loading={retry.isPending} onClick={askRetry}>
            {failed ? `Retry ${plural(failed, 'failed job')}` : 'Retry failed jobs'}
          </Button>
        </WhyDisabled>
      </Group>

      <Stack gap="sm">
        <Group justify="space-between">
          <Title order={2}>Workers</Title>
          <Text size="sm" c={online.length ? 'pass.5' : 'fail.5'}>
            {!d ? '' : online.length ? `${plural(online.length, 'worker')} online, ${online.some((w) => w.busy) ? 'grading' : 'idle'}` : 'No worker online'}
          </Text>
        </Group>
        <ResponsiveTable
          data={d?.workers ?? []}
          columns={workerCols}
          rowKey={(w) => w.worker_id}
          loading={q.isPending}
          minWidth={520}
          caption="Workers"
          empty={<EmptyState compact icon={IconServer} title="No workers" message="python -m autograder.worker" />}
        />
      </Stack>

      <Stack gap="sm">
        <Title order={2}>Active jobs</Title>
        <ResponsiveTable
          data={d?.active ?? []}
          columns={activeCols}
          rowKey={(j) => j.id}
          loading={q.isPending}
          minWidth={720}
          caption="Active jobs"
          rowActions={(j) => (
            <Button size="compact-sm" variant="subtle" color="fail" leftSection={<IconBan size={14} />} onClick={() => askCancel(j)}>
              Cancel
            </Button>
          )}
          empty={<EmptyState compact icon={IconStack2} title="Queue is empty" />}
        />
      </Stack>

      <Stack gap="sm">
        <Group justify="space-between">
          <Title order={2}>Recent jobs</Title>
          {d && (
            <Text size="sm" c="dimmed">
              {plural(d.recent.total, 'finished job')}
            </Text>
          )}
        </Group>
        <ResponsiveTable
          data={(d?.recent.items ?? []) as QJob[]}
          columns={recentCols}
          rowKey={(j) => j.id}
          loading={q.isPending}
          minWidth={720}
          caption="Recent jobs"
          empty={<EmptyState compact icon={IconHistory} title="No finished jobs yet." />}
        />
        {pages > 1 && (
          <Group justify="flex-end">
            <Pagination total={pages} value={page} onChange={(p) => setPage(String(p))} size="sm" />
          </Group>
        )}
      </Stack>
    </Stack>
  );
}

const ACTION: Record<string, string> = {
  'flag.review': 'Reviewed a flag',
  'flag.raise': 'Raised a copy flag',
  'corpus.delete': 'Deleted a corpus file',
  'problem.validate': 'Validated a problem',
  'submission.update': 'Changed a submission',
  regrade: 'Queued a regrade',
  'plagiarism.scan': 'Ran a plagiarism scan',
  'job.cancel': 'Cancelled a job',
  'jobs.retry_failed': 'Retried failed jobs',
  'corpus.generate': 'Generated AI corpus',
  'problem.meta': 'Changed problem settings',
  'problem.create': 'Added a problem',
  'problem.update': 'Changed grading rules',
  'problem.finalize': 'Finalized a problem',
  'problem.reopen': 'Reopened a problem',
  'user.create': 'Added a user',
  'user.update': 'Changed a user',
  'users.import': 'Imported a roster',
};

function detailText(d: unknown): string {
  if (d === null || d === undefined || d === '') return '';
  if (typeof d === 'string') {
    try {
      return detailText(JSON.parse(d));
    } catch {
      return d;
    }
  }
  if (typeof d === 'object') {
    return Object.entries(d as Record<string, unknown>)
      .map(([k, v]) => `${k.replace(/_/g, ' ')}: ${Array.isArray(v) ? v.join(', ') : typeof v === 'object' && v ? JSON.stringify(v) : String(v)}`)
      .join('; ');
  }
  return String(d);
}

function AuditTab() {
  const [pageRaw, setPage] = useParam('apage', '1');
  const page = Math.max(1, Number(pageRaw) || 1);
  const q = useQuery({ queryKey: ['staff', 'audit', page], queryFn: () => api.staff.audit(page), placeholderData: keepPreviousData });
  const cols: Column<AuditEntry>[] = [
    {
      key: 'ts',
      header: 'When',
      cell: (a) => (
        <Tooltip label={fmtDate(a.ts)}>
          <Text size="sm" c="dimmed" span style={{ whiteSpace: 'nowrap' }}>
            {fmtRelative(a.ts)}
          </Text>
        </Tooltip>
      ),
    },
    { key: 'who', header: 'Who', mono: true, cell: (a) => a.actor_roll ?? 'system' },
    {
      key: 'what',
      header: 'Action',
      cell: (a) => (
        <Group gap={6} wrap="nowrap">
          <Text size="sm">{ACTION[a.action] ?? a.action.replace(/[._]/g, ' ')}</Text>
          <Badge size="xs" variant="light" color="gray" className="ag-mono" style={{ textTransform: 'none' }}>
            {a.action}
          </Badge>
        </Group>
      ),
    },
    { key: 'target', header: 'Target', mono: true, cell: (a) => a.target ?? '-' },
    {
      key: 'detail',
      header: 'Details',
      cell: (a) => {
        const t = detailText(a.detail);
        return (
          <Tooltip label={t} multiline maw={460} disabled={t.length < 60}>
            <Text size="sm" c="dimmed" truncate maw={380}>
              {t || '-'}
            </Text>
          </Tooltip>
        );
      },
    },
  ];
  if (q.error) return <ErrorState error={q.error} onRetry={() => q.refetch()} backTo={false} />;
  const pages = q.data ? Math.max(1, Math.ceil(q.data.total / 50)) : 1;
  return (
    <Stack gap="sm">
      <Text size="sm" c="dimmed">
        Every staff action, newest first{q.data ? `: ${plural(q.data.total, 'entry', 'entries')}` : ''}.
      </Text>
      <ResponsiveTable
        data={q.data?.items ?? []}
        columns={cols}
        rowKey={(a) => `${a.ts}-${a.action}-${a.target}-${(a as AuditEntry & { id?: number }).id ?? ''}`}
        loading={q.isPending}
        minWidth={820}
        caption="Audit log"
        empty={<EmptyState compact icon={IconHistory} title="No actions yet" />}
      />
      {pages > 1 && (
        <Group justify="flex-end">
          <Pagination total={pages} value={page} onChange={(p) => setPage(String(p))} size="sm" />
        </Group>
      )}
    </Stack>
  );
}

export default function Queue() {
  const [tab, setTab] = useParam('tab', 'jobs');
  return (
    <Stack gap="md">
      <PageHeader
        title="Queue"
        breadcrumbs={[{ label: 'System' }, { label: 'Queue' }]}
      />
      <Tabs value={tab} onChange={(v) => setTab(v === 'jobs' ? null : v)} keepMounted={false}>
        <Tabs.List mb="md">
          <Tabs.Tab value="jobs" leftSection={<IconStack2 size={16} />}>
            Jobs and workers
          </Tabs.Tab>
          <Tabs.Tab value="audit" leftSection={<IconHistory size={16} />}>
            Audit log
          </Tabs.Tab>
        </Tabs.List>
        <Tabs.Panel value="jobs">
          <JobsTab />
        </Tabs.Panel>
        <Tabs.Panel value="audit">
          <AuditTab />
        </Tabs.Panel>
      </Tabs>
    </Stack>
  );
}
