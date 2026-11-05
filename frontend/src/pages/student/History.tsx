import { useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Anchor, Box, Button, Group, Pagination, Paper, SimpleGrid, Stack, Text, Tooltip, UnstyledButton } from '@mantine/core';
import { IconFilterOff, IconInbox, IconListDetails, IconStarFilled } from '@tabler/icons-react';
import { api, type SubmissionSummary } from '../../api/client';
import {
  EmptyState,
  ErrorState,
  GradeDisplay,
  PageHeader,
  ResponsiveTable,
  Sparkline,
  StatusChip,
  VerdictBar,
  type Column,
} from '../../components';
import { fmtDate, fmtGrade, fmtRelative } from '../../format';
import { useSubmissionDetails } from './hooks';
import { effectiveOf, plural, segmentsFor, sortSubs } from './shared';

const PAGE = 50;

interface Group_ {
  slug: string;
  title: string;
  items: SubmissionSummary[];
  grades: number[];
  counted: SubmissionSummary | undefined;
}

function Star({ on }: { on?: boolean }) {
  if (!on) return null;
  return (
    <Tooltip label="Counts towards your grade">
      <Box component="span" tabIndex={0} aria-label="Counts towards your grade" style={{ display: 'inline-flex', color: 'var(--ag-warn)' }}>
        <IconStarFilled size={14} aria-hidden />
      </Box>
    </Tooltip>
  );
}

function ProblemCard({ g, active, onClick }: { g: Group_; active: boolean; onClick: () => void }) {
  const cg = g.counted ? effectiveOf(g.counted) : null;
  return (
    <UnstyledButton onClick={onClick} aria-pressed={active} style={{ display: 'block', borderRadius: 8 }}>
      <Paper p="sm" h="100%" style={{ borderColor: active ? 'var(--ag-iris)' : undefined }}>
        <Group justify="space-between" wrap="nowrap" align="flex-start" gap="xs">
          <Box style={{ minWidth: 0 }}>
            <Text size="sm" fw={600} truncate>
              {g.title}
            </Text>
            <Text size="sm" c="dimmed">
              {plural(g.items.length, 'submission')}
            </Text>
          </Box>
          {cg !== null && (
            <Group gap={4} wrap="nowrap">
              <IconStarFilled size={12} color="var(--ag-warn)" aria-hidden />
              <GradeDisplay grade={cg} size="sm" />
            </Group>
          )}
        </Group>
        <Box mt={6} h={28}>
          {g.grades.length >= 2 ? (
            <Sparkline
              values={g.grades}
              width={180}
              height={28}
              color="var(--ag-info)"
              aria-label={`Grade trend for ${g.title}: ${g.grades.map((x) => fmtGrade(x)).join(', ')}`}
            />
          ) : (
            <Text size="sm" c="dimmed">
              {g.grades.length === 1 ? 'Submit again to see a trend' : 'No grades yet'}
            </Text>
          )}
        </Box>
      </Paper>
    </UnstyledButton>
  );
}

export default function History() {
  const nav = useNavigate();
  const [params, setParams] = useSearchParams();
  const filter = params.get('problem');
  const [page, setPage] = useState(1);
  const q = useQuery({ queryKey: ['submissions', 'all'], queryFn: () => api.submissions() });

  const all = useMemo(() => sortSubs(q.data?.items ?? []), [q.data]);
  const groups = useMemo(() => {
    const m = new Map<string, Group_>();
    for (const s of all) {
      const g = m.get(s.problem_slug) ?? { slug: s.problem_slug, title: s.problem_title || s.problem_slug, items: [], grades: [], counted: undefined };
      g.items.push(s);
      if (s.counted) g.counted = s;
      m.set(s.problem_slug, g);
    }
    for (const g of m.values()) {
      g.grades = [...g.items].reverse().map(effectiveOf).filter((x): x is number => x !== null);
    }
    return [...m.values()];
  }, [all]);

  const rows = filter ? all.filter((s) => s.problem_slug === filter) : all;
  const pages = Math.max(1, Math.ceil(rows.length / PAGE));
  const cur = Math.min(page, pages);
  const shown = rows.slice((cur - 1) * PAGE, cur * PAGE);
  const doneIds = useMemo(() => shown.filter((s) => s.job_status === 'done' && s.grade !== null).map((s) => s.id), [shown]);
  const details = useSubmissionDetails(doneIds);

  const setFilter = (slug: string | null) => {
    const next = new URLSearchParams(params);
    if (slug) next.set('problem', slug);
    else next.delete('problem');
    setParams(next, { replace: true });
    setPage(1);
  };

  const columns: Column<SubmissionSummary>[] = [
    {
      key: 'problem',
      header: 'Problem',
      cell: (s) => (
        <Group gap={6} wrap="nowrap">
          <Anchor component={Link} to={`/submissions/${s.id}`} c="var(--ag-text)" fw={500} underline="hover" onClick={(e) => e.stopPropagation()}>
            {s.problem_title || s.problem_slug}
          </Anchor>
          <Star on={s.counted} />
        </Group>
      ),
    },
    {
      key: 'when',
      header: 'Submitted',
      cell: (s) => (
        <Tooltip label={fmtDate(s.created_at)}>
          <Text size="sm" component="time" dateTime={s.created_at} style={{ whiteSpace: 'nowrap' }}>
            {fmtRelative(s.created_at)}
          </Text>
        </Tooltip>
      ),
    },
    {
      key: 'grade',
      header: 'Grade',
      align: 'right',
      cell: (s) =>
        s.grade === null && s.job_status !== 'done' ? (
          <StatusChip kind="job" status={s.job_status} audience="student" size="sm" />
        ) : (
          <GradeDisplay
            grade={s.grade}
            effectiveGrade={effectiveOf(s)}
            provisional={s.provisional}
            incomplete={s.partial}
            size="sm"
          />
        ),
    },
    {
      key: 'checks',
      header: 'Checks',
      cell: (s) => {
        const segs = segmentsFor(details.get(s.id)?.report);
        if (segs.length)
          return (
            <Box w={120} maw="100%" ml="auto">
              <VerdictBar segments={segs} size="sm" />
            </Box>
          );
        return (
          <Text size="sm" c="dimmed">
            -
          </Text>
        );
      },
      width: 140,
    },
    {
      key: 'file',
      header: 'File',
      mono: true,
      cell: (s) => (
        <Text span className="ag-mono" fz={13} c="dimmed" style={{ overflowWrap: 'anywhere' }}>
          {s.filename ?? '-'}
        </Text>
      ),
    },
  ];

  if (q.error)
    return (
      <>
        <PageHeader title="My submissions" breadcrumbs={[{ label: 'My submissions' }]} />
        <ErrorState error={q.error} onRetry={() => q.refetch()} backTo="/dashboard" backLabel="Back to problems" />
      </>
    );

  const filteredTitle = filter ? groups.find((g) => g.slug === filter)?.title ?? filter : null;

  return (
    <>
      <PageHeader
        title="My submissions"
        breadcrumbs={[{ label: 'My submissions' }]}
        actions={
          <Button variant="default" component={Link} to="/dashboard" leftSection={<IconListDetails size={16} />}>
            Problems
          </Button>
        }
      />
      <Stack gap="lg">
        {groups.length > 1 && (
          <Box component="section" aria-label="Filter by problem">
            <SimpleGrid cols={{ base: 1, xs: 2, md: 3, lg: 4 }} spacing="sm">
              {groups.map((g) => (
                <ProblemCard key={g.slug} g={g} active={filter === g.slug} onClick={() => setFilter(filter === g.slug ? null : g.slug)} />
              ))}
            </SimpleGrid>
          </Box>
        )}
        {groups.length === 1 && <ProblemCard g={groups[0]} active={false} onClick={() => nav(`/problems/${encodeURIComponent(groups[0].slug)}`)} />}

        {filter && (
          <Group justify="space-between" wrap="wrap">
            <Text size="sm">
              Showing {plural(rows.length, 'submission')} for <b>{filteredTitle}</b>.
            </Text>
            <Button size="xs" variant="subtle" color="gray" leftSection={<IconFilterOff size={14} />} onClick={() => setFilter(null)}>
              All problems
            </Button>
          </Group>
        )}

        <ResponsiveTable
          data={shown}
          columns={columns}
          rowKey={(s) => s.id}
          loading={q.isPending}
          minWidth={680}
          caption="My submissions"
          onRowClick={(s) => nav(`/submissions/${s.id}`)}
          empty={
            <EmptyState
              icon={IconInbox}
              title={filter ? 'No submissions for this problem' : 'No submissions yet'}
              action={
                <Button component={Link} to={filter ? `/problems/${encodeURIComponent(filter)}` : '/dashboard'}>
                  {filter ? 'Open problem' : 'Problems'}
                </Button>
              }
            />
          }
        />
        {pages > 1 && (
          <Group justify="space-between" wrap="wrap">
            <Text size="sm" c="dimmed">
              {(cur - 1) * PAGE + 1} to {Math.min(cur * PAGE, rows.length)} of {rows.length}
            </Text>
            <Pagination value={cur} onChange={setPage} total={pages} size="sm" />
          </Group>
        )}
      </Stack>
    </>
  );
}
