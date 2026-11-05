import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Anchor, Badge, Group, Paper, SimpleGrid, Stack, Text, Title, Tooltip } from '@mantine/core';
import { IconChartBar, IconEye, IconTrophy } from '@tabler/icons-react';
import { api, type RankRow } from '../../api/client';
import { EmptyState, ErrorState, GradeDisplay, PageHeader, ResponsiveTable, TableSkeleton, type Column } from '../../components';
import { fmtDate } from '../../format';
import { fmtInt, plural, ProblemSelect, useProblemSlug } from './common';

function fmtBytes(n: number | null | undefined): string {
  if (n === null || n === undefined) return '-';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

const TIPS = {
  grade: 'Primary sort. Columns to the right break ties, in order.',
  instr: 'Tie-break 1: instructions on the largest input (callgrind). Fewer is better.',
  heap: 'Tie-break 2: peak heap (massif). Less is better.',
  read: 'Tie-break 3: readability, 0 to 1. Higher is better.',
  tokens: 'Tie-break 4: length in tokens. Shorter is better, then earlier submission.',
};

function Head({ label, tip }: { label: string; tip: string }) {
  return (
    <Tooltip label={tip} multiline maw={280}>
      <span tabIndex={0} style={{ textDecoration: 'underline dotted', textUnderlineOffset: 3, cursor: 'help' }}>
        {label}
      </span>
    </Tooltip>
  );
}

const MEDAL = ['#E3AE45', '#B8C2D3', '#C98B5A'];
const PLACE = ['First', 'Second', 'Third'];

function Podium({ rows }: { rows: RankRow[] }) {
  return (
    <SimpleGrid cols={{ base: 1, sm: 3 }} spacing="md">
      {rows.slice(0, 3).map((r, i) => (
        <Paper key={r.submission_id} p="md" style={{ borderTop: `3px solid ${MEDAL[i]}` }}>
          <Stack gap={8}>
            <Group justify="space-between" wrap="nowrap">
              <Group gap={6} wrap="nowrap">
                <IconTrophy size={18} color={MEDAL[i]} aria-hidden />
                <Text size="sm" c="dimmed">
                  {PLACE[i]}
                </Text>
              </Group>
              <GradeDisplay grade={r.grade} effectiveGrade={r.effective_grade} size="sm" />
            </Group>
            <Anchor component={Link} to={`/staff/submissions/${r.submission_id}`} fw={600} size="lg" lineClamp={1}>
              {r.name ?? r.roll_no}
            </Anchor>
            <Text size="sm" c="dimmed">
              <span className="ag-mono">{r.roll_no}</span>, {fmtInt(r.instr_at_max_n)} instructions, {fmtBytes(r.peak_heap_bytes)} peak heap
            </Text>
          </Stack>
        </Paper>
      ))}
    </SimpleGrid>
  );
}

export default function Leaderboard() {
  const [slug, setSlug] = useProblemSlug();
  const q = useQuery({
    queryKey: ['staff', 'leaderboard', slug],
    queryFn: () => api.staff.leaderboard(slug!),
    enabled: !!slug,
  });
  const rows = q.data ?? [];
  const ranked = rows.filter((r) => r.rank !== null);
  const review = rows.filter((r) => r.rank === null && (r.ineligible_reason === 'under review' || (r as RankRow & { under_review?: boolean }).under_review));
  const other = rows.filter((r) => r.rank === null && !review.includes(r));

  const student = (r: RankRow) => (
    <Anchor component={Link} to={`/staff/submissions/${r.submission_id}`} size="sm" style={{ whiteSpace: 'nowrap' }}>
      <span className="ag-mono">{r.roll_no}</span> {r.name}
    </Anchor>
  );
  const cols: Column<RankRow>[] = [
    { key: 'rank', header: 'Rank', width: 64, cell: (r) => <Text size="sm" fw={600} className="ag-num">{r.rank ?? '-'}</Text> },
    { key: 'student', header: 'Student', cell: student },
    { key: 'grade', header: <Head label="Grade" tip={TIPS.grade} />, cardLabel: 'Grade', align: 'right', cell: (r) => <GradeDisplay grade={r.grade} effectiveGrade={r.effective_grade} size="sm" /> },
    { key: 'instr', header: <Head label="Instructions" tip={TIPS.instr} />, cardLabel: 'Instructions', align: 'right', cell: (r) => <Text size="sm" className="ag-num">{fmtInt(r.instr_at_max_n)}</Text> },
    { key: 'heap', header: <Head label="Peak heap" tip={TIPS.heap} />, cardLabel: 'Peak heap', align: 'right', cell: (r) => <Text size="sm" className="ag-num">{fmtBytes(r.peak_heap_bytes)}</Text> },
    { key: 'read', header: <Head label="Readability" tip={TIPS.read} />, cardLabel: 'Readability', align: 'right', cell: (r) => <Text size="sm" className="ag-num">{r.readability ?? '-'}</Text> },
    { key: 'tokens', header: <Head label="Tokens" tip={TIPS.tokens} />, cardLabel: 'Tokens', align: 'right', cell: (r) => <Text size="sm" className="ag-num">{fmtInt(r.token_count)}</Text> },
    {
      key: 'when',
      header: 'Submitted',
      cell: (r) => (
        <Group gap={6} wrap="nowrap">
          <Text size="sm" c="dimmed" style={{ whiteSpace: 'nowrap' }}>
            {fmtDate(r.submitted_at)}
          </Text>
          {!r.profiled && (
            <Tooltip label="Numbers from the report, or missing">
              <Badge size="xs" color="gray" variant="light" tabIndex={0}>
                Not profiled
              </Badge>
            </Tooltip>
          )}
        </Group>
      ),
    },
  ];
  const reasonCol: Column<RankRow> = {
    key: 'reason',
    header: 'Why not ranked',
    cell: (r) => (
      <Text size="sm" c="dimmed">
        {r.ineligible_reason === 'not all io tests pass'
          ? 'Fails some tests'
          : r.ineligible_reason === 'confirmed copy'
            ? 'Confirmed copy'
            : r.ineligible_reason ?? '-'}
      </Text>
    ),
  };

  return (
    <Stack gap="lg">
      <PageHeader
        title="Ranking"
        description={q.data ? `${plural(ranked.length, 'ranked program')}` : undefined}
        breadcrumbs={[{ label: 'Grading' }, { label: 'Ranking' }]}
        actions={<ProblemSelect value={slug} onChange={setSlug} w={{ base: '100%', xs: 260 }} />}
      />
      {!slug ? (
        <EmptyState icon={IconChartBar} title="No problems yet" />
      ) : q.error ? (
        <ErrorState error={q.error} onRetry={() => q.refetch()} backTo={false} />
      ) : q.isPending ? (
        <TableSkeleton rows={6} cols={6} />
      ) : (
        <>
          {ranked.length === 0 ? (
            <Paper>
              <EmptyState
                icon={IconTrophy}
                title="No ranked programs yet"
                message="Ranked once a program passes every test with no open copy flag."
              />
            </Paper>
          ) : (
            <>
              <Podium rows={ranked} />
              <Stack gap="sm">
                <Title order={2}>Full ranking</Title>
                <ResponsiveTable data={ranked} columns={cols} rowKey={(r) => r.submission_id} minWidth={860} caption="Ranked programs" />
              </Stack>
            </>
          )}
          {review.length > 0 && (
            <Stack gap="sm">
              <Group gap="xs">
                <IconEye size={18} color="var(--ag-warn)" aria-hidden />
                <Title order={2}>Under review</Title>
              </Group>
              <Text size="sm" c="dimmed">
                Open copy flags. <Anchor component={Link} to={`/staff/flags?problem=${slug}`} size="sm">Review flags</Anchor>
              </Text>
              <ResponsiveTable data={review} columns={[...cols.slice(1, 3), cols[7]]} rowKey={(r) => r.submission_id} minWidth={560} caption="Under review" />
            </Stack>
          )}
          {other.length > 0 && (
            <Stack gap="sm">
              <Title order={2}>Not ranked</Title>
              <ResponsiveTable data={other} columns={[cols[1], cols[2], reasonCol, cols[7]]} rowKey={(r) => r.submission_id} minWidth={560} caption="Not ranked" />
            </Stack>
          )}
        </>
      )}
    </Stack>
  );
}
