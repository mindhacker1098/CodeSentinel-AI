import { useMemo, useState, type CSSProperties, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { keepPreviousData, useMutation, useQuery } from '@tanstack/react-query';
import {
  ActionIcon,
  Badge,
  Box,
  Button,
  Group,
  Menu,
  Paper,
  Stack,
  Switch,
  Text,
  TextInput,
  Tooltip,
  UnstyledButton,
} from '@mantine/core';
import {
  IconArrowDown,
  IconArrowUp,
  IconClockHour4,
  IconDots,
  IconDownload,
  IconFlag,
  IconLock,
  IconLockOpen,
  IconSearch,
  IconTable,
} from '@tabler/icons-react';
import { api, downloadBlob, type GradebookCell, type GradebookStudent } from '../../api/client';
import { confirm, EmptyState, ErrorState, gradeTone, Histogram, PageHeader, TableSkeleton } from '../../components';
import { fmtDate, fmtGrade } from '../../format';
import { notify } from '../../notify';
import { flagName, plural, useInvalidate, useParam, useProblems } from './common';

const TONE_BG: Record<string, string> = {
  pass: 'rgba(61,190,139,',
  warn: 'rgba(227,174,69,',
  fail: 'rgba(242,112,107,',
};

/** Background for a grade cell: the tone of the grade, stronger toward the ends of each band. */
function cellBg(g: number | null | undefined): string | undefined {
  if (g === null || g === undefined) return undefined;
  const tone = gradeTone(g);
  if (tone === 'gray') return undefined;
  const a = tone === 'pass' ? 0.1 + ((g - 80) / 20) * 0.16 : tone === 'warn' ? 0.1 + ((80 - g) / 40) * 0.08 : 0.12 + ((40 - g) / 40) * 0.16;
  return `${TONE_BG[tone]}${a.toFixed(3)})`;
}

/** The cell's flags that still matter (dismissed ones are left out), as "Similar to a classmate (open)". */
function flagTypes(c: GradebookCell): string[] {
  return c.flags.filter((f) => f.review_status !== 'dismissed').map((f) => `${flagName(f.type)} (${f.review_status})`);
}

function Cell({ c, title }: { c: GradebookCell | null; title: string }) {
  if (!c) {
    return (
      <Text size="sm" c="dimmed" ta="center" aria-label={`${title}: no submission`}>
        -
      </Text>
    );
  }
  const g = c.effective_grade ?? c.grade;
  const changed = c.effective_grade !== null && c.effective_grade !== undefined && c.grade !== null && c.effective_grade !== c.grade;
  const flags = flagTypes(c);
  const tip = [
    `${title}: ${fmtGrade(g)} / 100`,
    changed ? `computed ${fmtGrade(c.grade)} (adjusted)` : '',
    c.provisional ? 'provisional' : '',
    c.late ? 'submitted late' : '',
    flags.length ? `flags: ${flags.join(', ')}` : '',
  ]
    .filter(Boolean)
    .join('; ');
  return (
    <Tooltip label={tip} multiline maw={300} openDelay={250}>
      <UnstyledButton
        component={Link}
        to={`/staff/submissions/${c.submission_id}`}
        aria-label={tip}
        className="ag-gb-cell"
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'flex-end',
          gap: 4,
          height: 36,
          padding: '0 10px',
          background: cellBg(g),
          borderStyle: c.provisional ? 'dashed' : undefined,
        }}
      >
        {flags.length > 0 && <IconFlag size={12} color="var(--ag-warn)" aria-hidden />}
        {c.late && <IconClockHour4 size={12} color="var(--ag-muted)" aria-hidden />}
        <Text size="sm" className="ag-num" fw={500} td={undefined} c={g === null ? 'dimmed' : undefined}>
          {fmtGrade(g)}
        </Text>
        {changed && (
          <Text size="xs" c="dimmed" td="line-through" className="ag-num">
            {fmtGrade(c.grade)}
          </Text>
        )}
      </UnstyledButton>
    </Tooltip>
  );
}

type SortKey = { key: string; dir: 'asc' | 'desc' };

export default function Gradebook() {
  const [inactive, setInactive] = useParam('inactive');
  const includeInactive = inactive === '1';
  const [filter, setFilter] = useState('');
  const [sort, setSort] = useState<SortKey>({ key: 'roll', dir: 'asc' });
  const gb = useQuery({
    queryKey: ['staff', 'gradebook', includeInactive],
    queryFn: () => api.staff.gradebook(includeInactive),
    placeholderData: keepPreviousData,
  });
  const problems = useProblems();
  const meta = (slug: string) => problems.data?.find((p) => p.slug === slug);
  const invalidate = useInvalidate();

  const finalize = useMutation({
    mutationFn: async ({ slug, reopen }: { slug: string; reopen: boolean }): Promise<{ job_ids?: number[] }> =>
      reopen ? (await api.staff.reopen(slug), {}) : api.staff.finalize(slug),
    onSuccess: (r, { slug, reopen }) => {
      const title = meta(slug)?.title ?? slug;
      const n = r.job_ids?.length ?? 0;
      notify.success(reopen ? `Reopened ${title}` : `Finalized ${title}${n ? `; regrade queued for ${plural(n, 'submission')}` : ''}`);
      invalidate(['staff', 'problems'], ['staff', 'gradebook'], ['staff', 'queue']);
    },
    onError: (e) => notify.error(e),
  });

  const askFinalize = async (slug: string, title: string, reopen: boolean) => {
    const ok = await confirm(
      reopen
        ? {
            title: 'Reopen this problem?',
            target: title,
            message: 'Students can submit again and grades may change.',
            confirmLabel: 'Reopen problem',
          }
        : {
            title: 'Finalize this problem?',
            target: title,
            message: 'Closes submissions and regrades the counting submission of each student.',
            confirmLabel: 'Finalize problem',
            danger: true,
          },
    );
    if (ok) finalize.mutate({ slug, reopen });
  };

  const download = async () => {
    try {
      const blob = await api.staff.gradebookCsv({ includeInactive });
      downloadBlob(blob, `gradebook${includeInactive ? '_with_inactive' : ''}.csv`);
      notify.success('Downloaded the gradebook CSV');
    } catch (e) {
      notify.error(e);
    }
  };

  const data = gb.data;
  const students = useMemo(() => {
    const f = filter.trim().toLowerCase();
    const list = (data?.students ?? []).filter((s) => !f || s.roll_no.toLowerCase().includes(f) || s.name.toLowerCase().includes(f));
    const val = (s: GradebookStudent): number | string => {
      if (sort.key === 'roll') return s.roll_no;
      if (sort.key === 'total') return s.total ?? -1;
      const c = s.cells[sort.key];
      return c ? c.effective_grade ?? c.grade ?? -1 : -2;
    };
    return [...list].sort((a, b) => {
      const x = val(a);
      const y = val(b);
      const r = typeof x === 'string' ? x.localeCompare(String(y)) : x - (y as number);
      return sort.dir === 'asc' ? r : -r;
    });
  }, [data, filter, sort]);

  const sortBtn = (key: string, label: ReactNode, align: 'left' | 'right' = 'right') => {
    const on = sort.key === key;
    const I = on && sort.dir === 'asc' ? IconArrowUp : IconArrowDown;
    return (
      <UnstyledButton
        onClick={() => setSort({ key, dir: on ? (sort.dir === 'asc' ? 'desc' : 'asc') : key === 'roll' ? 'asc' : 'desc' })}
        style={{ display: 'inline-flex', alignItems: 'center', gap: 4, color: 'inherit', font: 'inherit', textAlign: align }}
        aria-label={`Sort by ${typeof label === 'string' ? label : key}`}
      >
        {label}
        <I size={12} style={{ opacity: on ? 1 : 0.3 }} aria-hidden />
      </UnstyledButton>
    );
  };

  const stickyTh: CSSProperties = { position: 'sticky', left: 0, zIndex: 3, background: 'var(--ag-surface)', borderRight: '1px solid var(--ag-line)' };
  const stickyTd: CSSProperties = { position: 'sticky', left: 0, zIndex: 1, background: 'var(--ag-surface)', borderRight: '1px solid var(--ag-line)' };
  const th: CSSProperties = { padding: '8px 10px', fontWeight: 500, fontSize: 13, color: 'var(--ag-muted)', textAlign: 'right', whiteSpace: 'nowrap', borderBottom: '1px solid var(--ag-line)', verticalAlign: 'bottom' };
  const td: CSSProperties = { padding: 0, borderBottom: '1px solid var(--ag-line)', borderLeft: '1px solid var(--ag-line)' };

  return (
    <Stack gap="md">
      <PageHeader
        title="Gradebook"
        description={data ? `${plural(data.students.length, 'student')} · ${plural(data.problems.length, 'problem')}` : undefined}
        breadcrumbs={[{ label: 'Grading' }, { label: 'Gradebook' }]}
        actions={
          <Button variant="default" leftSection={<IconDownload size={16} />} onClick={download}>
            Download CSV
          </Button>
        }
      />
      <Group gap="md" align="center" wrap="wrap">
        <TextInput
          aria-label="Find a student"
          placeholder="Find a student"
          leftSection={<IconSearch size={16} />}
          value={filter}
          onChange={(e) => setFilter(e.currentTarget.value)}
          w={{ base: '100%', xs: 240 }}
        />
        <Switch
          label="Include inactive students"
          checked={includeInactive}
          onChange={(e) => setInactive(e.currentTarget.checked ? '1' : null)}
        />
        <Group gap="md" ml={{ base: 0, sm: 'auto' }} wrap="wrap">
          <Legend />
        </Group>
      </Group>

      {gb.error ? (
        <ErrorState error={gb.error} onRetry={() => gb.refetch()} backTo={false} />
      ) : !data ? (
        <TableSkeleton rows={8} cols={5} />
      ) : data.problems.length === 0 ? (
        <Paper>
          <EmptyState
            icon={IconTable}
            title="No published problems"
            action={
              <Button component={Link} to="/staff/problems">
                Problems
              </Button>
            }
          />
        </Paper>
      ) : data.students.length === 0 ? (
        <Paper>
          <EmptyState
            icon={IconTable}
            title={includeInactive ? 'No students yet' : 'No active students'}
            action={
              <Button component={Link} to="/staff/users">
                Roster
              </Button>
            }
          />
        </Paper>
      ) : (
        <Paper p={0} style={{ overflow: 'hidden' }}>
          <Box style={{ overflowX: 'auto', WebkitOverflowScrolling: 'touch' }} tabIndex={0} aria-label="Gradebook, scrolls sideways">
            <table style={{ borderCollapse: 'separate', borderSpacing: 0, width: '100%', minWidth: 220 + data.problems.length * 130 + 110 }}>
              <caption className="ag-sr-only">Grades by student and problem</caption>
              <thead>
                <tr>
                  <th style={{ ...th, ...stickyTh, textAlign: 'left', minWidth: 180 }} scope="col">
                    {sortBtn('roll', 'Student', 'left')}
                  </th>
                  {data.problems.map((p) => {
                    const m = meta(p.slug);
                    const fin = !!m?.finalized_at;
                    return (
                      <th key={p.slug} style={{ ...th, minWidth: 130, borderLeft: '1px solid var(--ag-line)' }} scope="col">
                        <Stack gap={4} align="flex-end">
                          <Group gap={2} wrap="nowrap" justify="flex-end">
                            <Tooltip label={p.title}>
                              <Box style={{ maxWidth: 140, overflow: 'hidden', textOverflow: 'ellipsis', color: 'var(--ag-text)' }}>
                                {sortBtn(p.slug, p.title)}
                              </Box>
                            </Tooltip>
                            <Menu position="bottom-end" withinPortal>
                              <Menu.Target>
                                <ActionIcon variant="subtle" color="gray" size="sm" aria-label={`Actions for ${p.title}`}>
                                  <IconDots size={14} />
                                </ActionIcon>
                              </Menu.Target>
                              <Menu.Dropdown>
                                <Menu.Item component={Link} to={`/staff/submissions?problem=${p.slug}`}>
                                  See submissions
                                </Menu.Item>
                                <Menu.Item component={Link} to={`/staff/problems/${p.slug}`}>
                                  Edit problem
                                </Menu.Item>
                                <Menu.Divider />
                                {fin ? (
                                  <Menu.Item leftSection={<IconLockOpen size={14} />} onClick={() => askFinalize(p.slug, p.title, true)}>
                                    Reopen problem
                                  </Menu.Item>
                                ) : (
                                  <Menu.Item color="fail" leftSection={<IconLock size={14} />} onClick={() => askFinalize(p.slug, p.title, false)}>
                                    Finalize problem
                                  </Menu.Item>
                                )}
                              </Menu.Dropdown>
                            </Menu>
                          </Group>
                          {fin && (
                            <Tooltip label={`Finalized ${fmtDate(m!.finalized_at)}. Submissions are closed.`}>
                              <Badge size="sm" color="gray" variant="light" leftSection={<IconLock size={10} />} tabIndex={0}>
                                Finalized
                              </Badge>
                            </Tooltip>
                          )}
                        </Stack>
                      </th>
                    );
                  })}
                  <th style={{ ...th, minWidth: 110, borderLeft: '2px solid var(--ag-line)' }} scope="col">
                    <Tooltip label="Mean over all published problems; missing counts as 0" multiline maw={260}>
                      <span>{sortBtn('total', 'Total')}</span>
                    </Tooltip>
                  </th>
                </tr>
              </thead>
              <tbody>
                {students.map((s) => (
                  <tr key={s.id} style={s.is_active ? undefined : { opacity: 0.6 }}>
                    <th scope="row" style={{ ...td, ...stickyTd, borderLeft: 0, padding: '0 10px', textAlign: 'left', fontWeight: 400 }}>
                      <Group gap={6} wrap="nowrap" h={36}>
                        <Text size="sm" className="ag-mono" fz={13}>
                          {s.roll_no}
                        </Text>
                        <Text size="sm" truncate maw={{ base: 90, sm: 180 } as unknown as number}>
                          {s.name}
                        </Text>
                        {!s.is_active && (
                          <Badge size="xs" color="gray" variant="light">
                            Inactive
                          </Badge>
                        )}
                      </Group>
                    </th>
                    {data.problems.map((p) => (
                      <td key={p.slug} style={td}>
                        <Cell c={s.cells[p.slug] ?? null} title={`${s.roll_no}, ${p.title}`} />
                      </td>
                    ))}
                    <td style={{ ...td, borderLeft: '2px solid var(--ag-line)', padding: '0 10px', textAlign: 'right' }}>
                      <Text size="sm" fw={600} className="ag-num" c={s.total === null ? 'dimmed' : `${gradeTone(s.total)}.5`}>
                        {fmtGrade(s.total)}
                      </Text>
                    </td>
                  </tr>
                ))}
                {students.length === 0 && (
                  <tr>
                    <td colSpan={data.problems.length + 2} style={{ padding: 16 }}>
                      <Text size="sm" c="dimmed">
                        No student matches "{filter}".
                      </Text>
                    </td>
                  </tr>
                )}
              </tbody>
              <tfoot>
                {(['mean', 'median'] as const).map((k) => (
                  <tr key={k}>
                    <th scope="row" style={{ ...stickyTd, padding: '6px 10px', textAlign: 'left', fontWeight: 500, fontSize: 13, color: 'var(--ag-muted)', borderTop: k === 'mean' ? '2px solid var(--ag-line)' : undefined }}>
                      {k === 'mean' ? 'Mean' : 'Median'}
                    </th>
                    {data.problems.map((p) => (
                      <td key={p.slug} className="ag-num" style={{ padding: '6px 10px', textAlign: 'right', fontSize: 14, borderLeft: '1px solid var(--ag-line)', borderTop: k === 'mean' ? '2px solid var(--ag-line)' : undefined }}>
                        {fmtGrade(data.stats[p.slug]?.[k])}
                      </td>
                    ))}
                    <td style={{ borderLeft: '2px solid var(--ag-line)', borderTop: k === 'mean' ? '2px solid var(--ag-line)' : undefined }} />
                  </tr>
                ))}
                <tr>
                  <th scope="row" style={{ ...stickyTd, padding: '6px 10px', textAlign: 'left', fontWeight: 500, fontSize: 13, color: 'var(--ag-muted)' }}>
                    Distribution
                  </th>
                  {data.problems.map((p) => {
                    const st = data.stats[p.slug];
                    return (
                      <td key={p.slug} style={{ padding: '6px 10px 8px', borderLeft: '1px solid var(--ag-line)' }}>
                        {st && st.n ? (
                          <Stack gap={2}>
                            <Histogram bins={st.histogram} height={32} aria-label={`${p.title}: grade distribution of ${st.n} students`} />
                            <Text size="xs" c="dimmed" ta="right">
                              {plural(st.n, 'student')}
                            </Text>
                          </Stack>
                        ) : (
                          <Text size="xs" c="dimmed" ta="right">
                            No grades yet
                          </Text>
                        )}
                      </td>
                    );
                  })}
                  <td style={{ borderLeft: '2px solid var(--ag-line)' }} />
                </tr>
              </tfoot>
            </table>
          </Box>
        </Paper>
      )}
    </Stack>
  );
}

function Legend() {
  const item = (bg: string, label: string) => (
    <Group gap={6} wrap="nowrap">
      <Box w={14} h={14} style={{ background: bg, borderRadius: 3, border: '1px solid var(--ag-line)' }} aria-hidden />
      <Text size="sm" c="dimmed">
        {label}
      </Text>
    </Group>
  );
  return (
    <>
      {item(cellBg(95)!, '80 or more')}
      {item(cellBg(55)!, '40 to 79')}
      {item(cellBg(15)!, 'Under 40')}
      <Group gap={4} wrap="nowrap">
        <IconFlag size={12} color="var(--ag-warn)" aria-hidden />
        <Text size="sm" c="dimmed">
          Flagged
        </Text>
      </Group>
      <Group gap={4} wrap="nowrap">
        <IconClockHour4 size={12} color="var(--ag-muted)" aria-hidden />
        <Text size="sm" c="dimmed">
          Late
        </Text>
      </Group>
      <Group gap={4} wrap="nowrap">
        <Text size="sm" c="dimmed" td="line-through" className="ag-num">72</Text>
        <Text size="sm" c="dimmed">
          Computed, before an adjustment
        </Text>
      </Group>
    </>
  );
}
