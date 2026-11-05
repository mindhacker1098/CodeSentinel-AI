import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ActionIcon, Anchor, Badge, Button, Menu, SegmentedControl, Stack, Text } from '@mantine/core';
import {
  IconArchive,
  IconArrowBackUp,
  IconCopy,
  IconDotsVertical,
  IconEye,
  IconEyeOff,
  IconFileCode,
  IconFlag,
  IconListCheck,
  IconLock,
  IconPencil,
  IconPlus,
  IconTable,
} from '@tabler/icons-react';
import { api, type ProblemStatus, type StaffProblemRow } from '../../api/client';
import { confirm, Countdown, EmptyState, ErrorState, PageHeader, ResponsiveTable, StatusChip, type Column } from '../../components';
import { fmtGrade } from '../../format';
import { notify } from '../../notify';
import { ProblemStatusChip } from './problems/widgets';

type Filter = 'all' | ProblemStatus;

export default function Problems() {
  const nav = useNavigate();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['staff', 'problems'], queryFn: api.staff.problems });
  const [filter, setFilter] = useState<Filter>('all');

  const setStatus = useMutation({
    mutationFn: ({ p, status }: { p: StaffProblemRow; status: ProblemStatus }) => api.staff.updateMeta(p.slug, { status }),
    onSuccess: (_, { p, status }) => {
      const verb = status === 'published' ? 'Published' : status === 'archived' ? 'Archived' : p.status === 'archived' ? 'Restored' : 'Unpublished';
      notify.success(`${verb} ${p.title}`);
      qc.invalidateQueries({ queryKey: ['staff', 'problems'] });
      qc.invalidateQueries({ queryKey: ['staff', 'problem', p.slug] });
    },
    onError: (e) => notify.error(e),
  });

  const all = q.data ?? [];
  const counts = { all: all.length, draft: 0, published: 0, archived: 0 } as Record<Filter, number>;
  for (const p of all) counts[p.status ?? 'published'] += 1;
  const rows = filter === 'all' ? all.filter((p) => p.status !== 'archived') : all.filter((p) => p.status === filter);

  const archive = async (p: StaffProblemRow) => {
    const ok = await confirm({
      title: 'Archive this problem?',
      target: `${p.title} (${p.n_submissions} submission${p.n_submissions === 1 ? '' : 's'})`,
      message: 'Hidden from students. Grades are kept. You can restore it later.',
      confirmLabel: 'Archive problem',
      danger: true,
    });
    if (ok) setStatus.mutate({ p, status: 'archived' });
  };

  const columns: Column<StaffProblemRow>[] = [
    {
      key: 'title',
      header: 'Title',
      cell: (p) => (
        <Anchor component={Link} to={`/staff/problems/${encodeURIComponent(p.slug)}`} fw={500}>
          {p.title}
        </Anchor>
      ),
    },
    { key: 'slug', header: 'Short name', mono: true, cell: (p) => p.slug },
    { key: 'status', header: 'Status', cell: (p) => <ProblemStatusChip status={p.status ?? 'published'} /> },
    { key: 'due', header: 'Deadline', cell: (p) => <Countdown to={p.due_at} /> },
    { key: 'version', header: 'Version', align: 'right', cell: (p) => `v${p.version}` },
    { key: 'subs', header: 'Submissions', align: 'right', cell: (p) => p.n_submissions ?? 0 },
    { key: 'students', header: 'Students', align: 'right', cell: (p) => p.n_students ?? 0 },
    { key: 'avg', header: 'Average', align: 'right', cell: (p) => (p.avg_grade === null || p.avg_grade === undefined ? '-' : fmtGrade(p.avg_grade)) },
    {
      key: 'flags',
      header: 'Open flags',
      align: 'right',
      cell: (p) =>
        p.open_flags ? (
          <Anchor component={Link} to={`/staff/flags?problem=${encodeURIComponent(p.slug)}`} aria-label={`${p.open_flags} open flags`}>
            <Badge color="warn" variant="light" size="sm" leftSection={<IconFlag size={11} />}>
              {p.open_flags}
            </Badge>
          </Anchor>
        ) : (
          <Text size="sm" c="dimmed">
            0
          </Text>
        ),
    },
    {
      key: 'final',
      header: 'Finalized',
      cell: (p) =>
        p.finalized_at ? <StatusChip kind="custom" tone="info" icon={IconLock} label="Finalized" size="sm" /> : <Text size="sm" c="dimmed">No</Text>,
    },
  ];

  const enc = encodeURIComponent;

  return (
    <Stack gap="lg">
      <PageHeader
        title="Problems"
        description={q.data ? `${counts.published} published · ${counts.draft} draft${counts.draft === 1 ? '' : 's'}` : undefined}
        breadcrumbs={[{ label: 'Course' }, { label: 'Problems' }]}
        actions={
          <Button component={Link} to="/staff/problems/new" leftSection={<IconPlus size={16} />}>
            New problem
          </Button>
        }
      />
      {q.error ? (
        <ErrorState error={q.error} onRetry={() => q.refetch()} backTo={false} />
      ) : (
        <Stack gap="sm">
          {all.length > 0 && (
            <SegmentedControl
              w="fit-content"
              value={filter}
              onChange={(v) => setFilter(v as Filter)}
              aria-label="Filter by status"
              data={[
                { value: 'all', label: `Active (${counts.draft + counts.published})` },
                { value: 'published', label: `Published (${counts.published})` },
                { value: 'draft', label: `Drafts (${counts.draft})` },
                { value: 'archived', label: `Archived (${counts.archived})` },
              ]}
            />
          )}
          <ResponsiveTable
            data={rows}
            loading={q.isPending}
            columns={columns}
            rowKey={(p) => p.slug}
            minWidth={1040}
            caption="Problems"
            empty={
              all.length === 0 ? (
                <EmptyState
                  icon={IconFileCode}
                  title="No problems yet."
                  message="Create one with a statement, a reference solution in C and a zip of test inputs."
                  action={
                    <Button component={Link} to="/staff/problems/new" leftSection={<IconPlus size={16} />}>
                      New problem
                    </Button>
                  }
                />
              ) : (
                <EmptyState compact title="No problems" action={<Button variant="default" onClick={() => setFilter('all')}>Show active</Button>} />
              )
            }
            rowActions={(p) => (
              <Menu position="bottom-end" withinPortal>
                <Menu.Target>
                  <ActionIcon variant="subtle" color="gray" aria-label={`Actions for ${p.title}`}>
                    <IconDotsVertical size={16} />
                  </ActionIcon>
                </Menu.Target>
                <Menu.Dropdown>
                  <Menu.Item leftSection={<IconPencil size={15} />} onClick={() => nav(`/staff/problems/${enc(p.slug)}`)}>
                    Edit
                  </Menu.Item>
                  <Menu.Item leftSection={<IconListCheck size={15} />} onClick={() => nav(`/staff/submissions?problem=${enc(p.slug)}`)}>
                    View submissions
                  </Menu.Item>
                  <Menu.Item leftSection={<IconTable size={15} />} onClick={() => nav(`/staff/gradebook?problem=${enc(p.slug)}`)}>
                    Gradebook
                  </Menu.Item>
                  <Menu.Item leftSection={<IconCopy size={15} />} onClick={() => nav(`/staff/plagiarism?problem=${enc(p.slug)}`)}>
                    Plagiarism
                  </Menu.Item>
                  <Menu.Divider />
                  {p.status === 'published' ? (
                    <Menu.Item leftSection={<IconEyeOff size={15} />} onClick={() => setStatus.mutate({ p, status: 'draft' })}>
                      Unpublish
                    </Menu.Item>
                  ) : p.status === 'draft' ? (
                    <Menu.Item leftSection={<IconEye size={15} />} onClick={() => setStatus.mutate({ p, status: 'published' })}>
                      Publish
                    </Menu.Item>
                  ) : null}
                  {p.status === 'archived' ? (
                    <Menu.Item leftSection={<IconArrowBackUp size={15} />} onClick={() => setStatus.mutate({ p, status: 'draft' })}>
                      Restore as draft
                    </Menu.Item>
                  ) : (
                    <Menu.Item color="fail" leftSection={<IconArchive size={15} />} onClick={() => archive(p)}>
                      Archive
                    </Menu.Item>
                  )}
                </Menu.Dropdown>
              </Menu>
            )}
          />
        </Stack>
      )}
    </Stack>
  );
}
