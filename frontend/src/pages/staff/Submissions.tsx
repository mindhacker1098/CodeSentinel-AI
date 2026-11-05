import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { keepPreviousData, useMutation, useQuery } from '@tanstack/react-query';
import { useDebouncedValue } from '@mantine/hooks';
import {
  Anchor,
  Badge,
  Button,
  Checkbox,
  Group,
  Menu,
  Pagination,
  Select,
  Stack,
  Text,
  TextInput,
  Tooltip,
} from '@mantine/core';
import { IconChevronDown, IconDownload, IconFilterOff, IconRefresh, IconSearch, IconUpload } from '@tabler/icons-react';
import { api, downloadBlob, type StaffSubmissionRow, type StaffSubmissionSort } from '../../api/client';
import {
  confirm,
  EmptyState,
  ErrorState,
  GradeDisplay,
  PageHeader,
  ResponsiveTable,
  StatusChip,
  type Column,
  type SortState,
} from '../../components';
import { fmtDate, fmtRelative } from '../../format';
import { notify } from '../../notify';
import { FlagChips } from './FlagReview';
import { plural, ProblemSelect, toCsv, useInvalidate, useParam, WhyDisabled } from './common';

const PAGE_SIZE = 50;

const FLAG_OPTIONS = [
  { value: '', label: 'Any flags or none' },
  { value: 'open', label: 'Open flags' },
  { value: 'any', label: 'Any flag (not dismissed)' },
  { value: 'suspected_copy_peer', label: 'Similar to a classmate' },
  { value: 'suspected_copy_web', label: 'Similar to web code' },
  { value: 'suspected_copy_llm', label: 'Similar to AI-generated code' },
  { value: 'compile_failed', label: 'Does not compile' },
];

const DATE_OPTIONS = [
  { value: '', label: 'Any time' },
  { value: 'today', label: 'Today' },
  { value: '7d', label: 'Last 7 days' },
  { value: '30d', label: 'Last 30 days' },
  { value: 'custom', label: 'Between dates' },
];

/** Local midnight of a YYYY-MM-DD day (plus `addDays`), as an ISO instant for the API. */
function dayStart(day: string, addDays = 0): string | undefined {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  if (!m) return undefined;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]) + addDays).toISOString();
}

/** The since/until query of a period filter; `until` is exclusive, so a "to" day is included whole. */
function periodOf(v: string, from: string, to: string): { since?: string; until?: string } {
  if (v === 'today') {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return { since: d.toISOString() };
  }
  if (v === 'custom') return { since: dayStart(from), until: dayStart(to, 1) };
  const m = /^(\d+)d$/.exec(v);
  return m ? { since: new Date(Date.now() - Number(m[1]) * 86_400_000).toISOString() } : {};
}

const SORTS: Record<string, StaffSubmissionSort> = {
  'time:desc': '-created',
  'grade:asc': 'grade',
  'grade:desc': '-grade',
};

export default function Submissions() {
  const [qRaw, setQ] = useParam('q');
  const [problem, setProblem] = useParam('problem');
  const [flag, setFlag] = useParam('flag');
  const [date, setDate] = useParam('date');
  const [from, setFrom] = useParam('from');
  const [to, setTo] = useParam('to');
  const [sortRaw, setSort] = useParam('sort', 'time:desc');
  const [pageRaw, setPage] = useParam('page', '1');
  const [search, setSearch] = useState(qRaw);
  const [debounced] = useDebouncedValue(search, 300);
  useEffect(() => {
    if (debounced.trim() !== qRaw) setQ(debounced.trim() || null);
  }, [debounced]); // eslint-disable-line react-hooks/exhaustive-deps
  const page = Math.max(1, Number(pageRaw) || 1);
  const sort = SORTS[sortRaw] ?? '-created';
  const period = useMemo(() => periodOf(date, from, to), [date, from, to]);
  const badRange = date === 'custom' && !!from && !!to && from > to;

  const query = {
    ...(badRange ? {} : period),
    q: qRaw || undefined,
    problem: problem || undefined,
    flag: flag || undefined,
    sort,
    page,
    page_size: PAGE_SIZE,
  };
  const subs = useQuery({
    queryKey: ['staff', 'submissions', 'list', query],
    queryFn: () => api.staff.submissions(query),
    placeholderData: keepPreviousData,
    refetchInterval: (q) => (q.state.data?.items.some((r) => r.job_status === 'queued' || r.job_status === 'running') ? 4000 : false),
  });
  const rows = useMemo(() => subs.data?.items ?? [], [subs.data]);
  const total = subs.data?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const [selected, setSelected] = useState<Set<number>>(new Set());
  const visibleSel = rows.filter((r) => selected.has(r.id));
  const allOn = rows.length > 0 && visibleSel.length === rows.length;
  const toggle = (id: number) =>
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  const invalidate = useInvalidate();
  const regrade = useMutation({
    mutationFn: (body: { submission_ids?: number[]; problem_slug?: string }) => api.staff.regrade(body),
    onSuccess: (r) => {
      const busy = r.skipped_busy?.length ?? 0;
      notify.success(
        `Regrade queued for ${plural(r.job_ids.length, 'submission')}${busy ? `; ${plural(busy, 'submission')} still grading, skipped` : ''}`,
      );
      setSelected(new Set());
      invalidate(['staff', 'submissions'], ['staff', 'queue']);
    },
    onError: (e) => notify.error(e),
  });

  const regradeSelected = async () => {
    const n = visibleSel.length;
    const ok = await confirm({
      title: `Regrade ${plural(n, 'submission')}?`,
      target: visibleSel.length <= 4 ? visibleSel.map((r) => `${r.roll_no} ${r.problem_title}`).join(', ') : plural(n, 'selected submission'),
      message: 'Overrides stay in place.',
      confirmLabel: `Regrade ${plural(n, 'submission')}`,
    });
    if (ok) regrade.mutate({ submission_ids: visibleSel.map((r) => r.id) });
  };

  const regradeProblem = async () => {
    const p = problem;
    if (!p) return;
    const ok = await confirm({
      title: 'Regrade all students?',
      target: p,
      message: 'Regrades each latest submission with the current rules.',
      confirmLabel: 'Regrade all',
      danger: true,
    });
    if (ok) regrade.mutate({ problem_slug: p });
  };

  const exportCsv = () => {
    const head = ['submission_id', 'roll_no', 'name', 'problem', 'submitted_at', 'grade', 'effective_grade', 'overridden', 'late', 'status', 'flags'];
    const body = rows.map((r) => [
      r.id,
      r.roll_no,
      r.name,
      r.problem_slug,
      r.created_at,
      r.grade,
      r.effective_grade,
      r.overridden ? 1 : 0,
      r.is_late ? 1 : 0,
      r.job_status,
      r.flags.filter((f) => f.review_status !== 'dismissed').map((f) => `${f.type}:${f.review_status}`).join(';'),
    ]);
    downloadBlob(toCsv([head, ...body]), `submissions_${problem || 'all'}_p${page}.csv`, 'text/csv');
    notify.success(`Exported ${plural(rows.length, 'row')} to CSV`);
  };

  const filtered = !!(qRaw || problem || flag || date);
  const clear = () => {
    setSearch('');
    setQ(null);
    setProblem(null);
    setFlag(null);
    setDate(null);
    setFrom(null);
    setTo(null);
  };

  const [sKey, sDir] = sortRaw.split(':');
  const sortState: SortState = { key: sKey, dir: sDir === 'asc' ? 'asc' : 'desc' };

  const cols: Column<StaffSubmissionRow>[] = [
    {
      key: 'sel',
      header: (
        <Checkbox
          aria-label="Select every submission on this page"
          checked={allOn}
          indeterminate={visibleSel.length > 0 && !allOn}
          onChange={() => setSelected(allOn ? new Set() : new Set(rows.map((r) => r.id)))}
        />
      ),
      cardLabel: 'Select',
      width: 36,
      cell: (r) => (
        <Checkbox aria-label={`Select submission ${r.id} by ${r.roll_no}`} checked={selected.has(r.id)} onChange={() => toggle(r.id)} onClick={(e) => e.stopPropagation()} />
      ),
      hideOnCard: true,
    },
    {
      key: 'student',
      header: 'Student',
      hideOnCard: true,
      cell: (r) => (
        <Anchor component={Link} to={`/staff/submissions/${r.id}`} size="sm" style={{ whiteSpace: 'nowrap' }}>
          <span className="ag-mono">{r.roll_no}</span>{' '}
          <Text span size="sm" c="var(--ag-text)">
            {r.name}
          </Text>
        </Anchor>
      ),
    },
    { key: 'problem', header: 'Problem', cell: (r) => <Text size="sm">{r.problem_title}</Text> },
    {
      key: 'time',
      header: 'Submitted',
      sortable: true,
      cell: (r) => (
        <Group gap={6} wrap="nowrap">
          <Tooltip label={fmtDate(r.created_at)}>
            <Text size="sm" c="dimmed" span style={{ whiteSpace: 'nowrap' }}>
              {fmtRelative(r.created_at)}
            </Text>
          </Tooltip>
          {r.is_late && (
            <Tooltip label="Submitted after the deadline">
              <Badge color="warn" variant="outline" size="sm" radius="sm">
                Late
              </Badge>
            </Tooltip>
          )}
        </Group>
      ),
    },
    {
      key: 'grade',
      header: 'Grade',
      sortable: true,
      cell: (r) =>
        r.job_status === 'queued' || r.job_status === 'running' || (r.grade === null && (r.job_status === 'failed' || r.job_status === 'cancelled')) ? (
          <StatusChip kind="job" status={r.job_status} size="sm" />
        ) : (
          <GradeDisplay
            grade={r.grade}
            effectiveGrade={r.effective_grade}
            provisional={!!r.provisional}
            incomplete={!!r.partial}
            override={r.overridden}
            size="sm"
          />
        ),
    },
    {
      key: 'flags',
      header: 'Flags',
      cell: (r) => <FlagChips flags={r.flags} submissionId={r.id} problemSlug={r.problem_slug} />,
    },
  ];

  const noSelReason = !rows.length ? 'No submissions' : 'Select submissions first';

  return (
    <Stack gap="md">
      <PageHeader
        title="Submissions"
        description={subs.data ? plural(total, 'submission') : undefined}
        breadcrumbs={[{ label: 'Grading' }, { label: 'Submissions' }]}
        actions={
          <>
            <WhyDisabled reason={!rows.length && 'Nothing to export'}>
              <Button variant="default" leftSection={<IconDownload size={16} />} onClick={exportCsv} disabled={!rows.length}>
                Export CSV
              </Button>
            </WhyDisabled>
            <Group gap={0} wrap="nowrap">
              <WhyDisabled reason={!visibleSel.length && noSelReason}>
                <Button
                  leftSection={<IconRefresh size={16} />}
                  onClick={regradeSelected}
                  disabled={!visibleSel.length}
                  loading={regrade.isPending}
                  style={{ borderTopRightRadius: 0, borderBottomRightRadius: 0 }}
                >
                  {visibleSel.length ? `Regrade ${plural(visibleSel.length, 'submission')}` : 'Regrade selected'}
                </Button>
              </WhyDisabled>
              <Menu position="bottom-end" withinPortal>
                <Menu.Target>
                  <Button px={8} aria-label="More regrade options" style={{ borderTopLeftRadius: 0, borderBottomLeftRadius: 0, borderLeft: '1px solid rgba(0,0,0,0.25)' }}>
                    <IconChevronDown size={16} />
                  </Button>
                </Menu.Target>
                <Menu.Dropdown>
                  <Tooltip label="Filter by a problem first" disabled={!!problem} position="left">
                    <div>
                      <Menu.Item leftSection={<IconRefresh size={14} />} disabled={!problem} onClick={regradeProblem}>
                        Regrade all students on this problem
                      </Menu.Item>
                    </div>
                  </Tooltip>
                </Menu.Dropdown>
              </Menu>
            </Group>
          </>
        }
      />

      <Group gap="sm" align="flex-end" wrap="wrap">
        <TextInput
          label="Student"
          placeholder="Roll number or name"
          leftSection={<IconSearch size={16} />}
          value={search}
          onChange={(e) => setSearch(e.currentTarget.value)}
          w={{ base: '100%', xs: 240 }}
        />
        <ProblemSelect label="Problem" value={problem || null} onChange={(v) => setProblem(v)} allowAll w={{ base: 'calc(50% - 6px)', xs: 220 }} />
        <Select label="Flags" data={FLAG_OPTIONS} value={flag} onChange={(v) => setFlag(v || null)} w={{ base: 'calc(50% - 6px)', xs: 200 }} allowDeselect={false} />
        <Select
          label="Submitted"
          data={DATE_OPTIONS}
          value={date}
          onChange={(v) => {
            setDate(v || null);
            if (v !== 'custom') {
              setFrom(null);
              setTo(null);
            }
          }}
          w={{ base: 'calc(50% - 6px)', xs: 160 }}
          allowDeselect={false}
        />
        {date === 'custom' && (
          <>
            <TextInput
              type="date"
              label="From"
              value={from}
              max={to || undefined}
              onChange={(e) => setFrom(e.currentTarget.value || null)}
              w={{ base: 'calc(50% - 6px)', xs: 160 }}
            />
            <TextInput
              type="date"
              label="To"
              value={to}
              min={from || undefined}
              onChange={(e) => setTo(e.currentTarget.value || null)}
              error={badRange ? 'Pick a day on or after From.' : undefined}
              w={{ base: 'calc(50% - 6px)', xs: 160 }}
            />
          </>
        )}
        {filtered && (
          <Button variant="subtle" leftSection={<IconFilterOff size={16} />} onClick={clear}>
            Clear filters
          </Button>
        )}
      </Group>

      <Group justify="space-between" gap="xs">
        <Text size="sm" c="dimmed" aria-live="polite">
          {subs.isPending
            ? 'Loading...'
            : `${plural(total, 'submission')}${pages > 1 ? `, page ${page} of ${pages}` : ''}`}
          {visibleSel.length > 0 && `. ${visibleSel.length} selected.`}
        </Text>
        <Select
          aria-label="Sort"
          size="xs"
          w={180}
          data={[
            { value: 'time:desc', label: 'Newest first' },
            { value: 'grade:desc', label: 'Highest grade first' },
            { value: 'grade:asc', label: 'Lowest grade first' },
          ]}
          value={SORTS[sortRaw] ? sortRaw : 'time:desc'}
          onChange={(v) => setSort(v === 'time:desc' ? null : v)}
          allowDeselect={false}
        />
      </Group>

      {subs.error ? (
        <ErrorState error={subs.error} onRetry={() => subs.refetch()} backTo={false} />
      ) : (
        <ResponsiveTable
          data={rows}
          columns={cols}
          rowKey={(r) => r.id}
          loading={subs.isPending}
          minWidth={860}
          caption="Submissions"
          sort={sortState}
          onSortChange={(s) => setSort(s.key === 'time' ? (s.dir === 'desc' ? null : 'time:desc') : `grade:${s.dir}`)}
          rowStyle={(r) => (selected.has(r.id) ? { background: 'rgba(139,156,255,0.08)' } : undefined)}
          cardTitle={(r) => (
            <Group gap="xs" wrap="nowrap">
              <Checkbox aria-label={`Select submission ${r.id}`} checked={selected.has(r.id)} onChange={() => toggle(r.id)} />
              <Anchor component={Link} to={`/staff/submissions/${r.id}`} size="sm">
                <span className="ag-mono">{r.roll_no}</span> {r.name}
              </Anchor>
            </Group>
          )}
          empty={
            filtered ? (
              <EmptyState
                compact
                icon={IconFilterOff}
                title="No matches"
                action={
                  <Button variant="default" onClick={clear}>
                    Clear filters
                  </Button>
                }
              />
            ) : (
              <EmptyState compact icon={IconUpload} title="No submissions yet" />
            )
          }
        />
      )}

      {pages > 1 && (
        <Group justify="flex-end">
          <Pagination total={pages} value={page} onChange={(p) => setPage(String(p))} size="sm" aria-label="Pages" />
        </Group>
      )}
    </Stack>
  );
}
