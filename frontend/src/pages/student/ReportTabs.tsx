import { useMemo, useRef, useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Alert,
  Badge,
  Box,
  Button,
  Group,
  List,
  Paper,
  SimpleGrid,
  Stack,
  Table,
  Text,
  Title,
  Tooltip,
  UnstyledButton,
} from '@mantine/core';
import {
  IconAlertCircle,
  IconAlertTriangle,
  IconBulb,
  IconCircleCheck,
  IconCode,
  IconEyeOff,
  IconInfoCircle,
  IconLock,
  IconTrophy,
} from '@tabler/icons-react';
import type { editor as MonacoEditor } from 'monaco-editor';
import { api, isApiError, type Counterexample, type MetricEntry, type MetricSpec, type Report } from '../../api/client';
import {
  CodeBlock,
  CodeViewer,
  DiffView,
  EmptyState,
  ErrorState,
  GradeDisplay,
  ResponsiveTable,
  type Column,
} from '../../components';
import { fmtPct } from '../../format';
import { isInformational, reviewStatus } from '../../metrics';
import {
  cleanText,
  compiled,
  diagnostics,
  edgeCaseNames,
  failureGroups,
  failureKind,
  HIDDEN,
  labelled,
  lineOf,
  metricBy,
  plural,
  scoredMetrics,
  sourceLabel,
  type Diagnostic,
  type Severity,
} from './shared';

function Section({ title, description, children, id }: { title: string; description?: ReactNode; children: ReactNode; id?: string }) {
  return (
    <Paper p="md" component="section" aria-labelledby={id}>
      <Title order={3} fz={16} id={id}>
        {title}
      </Title>
      {description && (
        <Text size="sm" c="dimmed" mt={2} className="ag-prose">
          {description}
        </Text>
      )}
      <Box mt="sm">{children}</Box>
    </Paper>
  );
}

// ---------------------------------------------------------------- compiler-style diagnostics
const SEV_COLOR: Record<Severity, string> = {
  error: 'var(--ag-fail)',
  warning: 'var(--ag-warn)',
  note: 'var(--ag-info)',
  info: 'var(--ag-muted)',
};

export function DiagnosticList({ items, filename, onLine }: { items: Diagnostic[]; filename: string; onLine?: (n: number) => void }) {
  return (
    <Box
      component="ul"
      m={0}
      p={0}
      className="ag-mono"
      style={{ listStyle: 'none', border: '1px solid var(--ag-line)', borderRadius: 6, background: 'var(--ag-bg)', fontSize: 13, lineHeight: 1.55 }}
    >
      {items.map((d, i) => {
        const loc = `${filename}${d.line ? `:${d.line}${d.col ? `:${d.col}` : ''}` : ''}`;
        return (
          <Box
            component="li"
            key={i}
            px="sm"
            py={6}
            style={{ borderTop: i ? '1px solid var(--ag-line)' : undefined, overflowWrap: 'anywhere' }}
          >
            {onLine && d.line ? (
              <UnstyledButton onClick={() => onLine(d.line!)} className="ag-mono" style={{ color: 'var(--ag-iris)', fontSize: 13 }} aria-label={`Go to line ${d.line}`}>
                {loc}
              </UnstyledButton>
            ) : (
              <span style={{ color: 'var(--ag-muted)' }}>{loc}</span>
            )}{' '}
            <span style={{ color: SEV_COLOR[d.severity], fontWeight: 600 }}>{d.severity}</span>{' '}
            <span>{d.message}</span>
            <span style={{ color: 'var(--ag-muted)' }}>
              {'  '}[{d.tool}
              {d.rule ? `: ${d.rule}` : ''}]
            </span>
          </Box>
        );
      })}
    </Box>
  );
}

// ---------------------------------------------------------------- failures
function FailureCard({ cx, index }: { cx: Counterexample; index: number }) {
  const src = sourceLabel(cx.source);
  const hidden = cx.input === HIDDEN;
  return (
    <Paper p="md" component="article" aria-label={`Failing input ${index + 1}`}>
      <Group gap="xs" mb="sm" wrap="wrap">
        <Badge color="fail" variant="light" leftSection={<IconAlertCircle size={12} />}>
          {failureKind(cx)}
        </Badge>
        {src && (
          <Tooltip label={src.tip} disabled={!src.tip} multiline maw={320}>
            <Badge color="gray" variant="outline" tabIndex={0}>
              {src.label}
            </Badge>
          </Tooltip>
        )}
        {cx.test && (
          <Text size="sm" c="dimmed">
            Test <span className="ag-mono">{String(cx.test)}</span>
          </Text>
        )}
      </Group>
      {hidden ? (
        <Group gap="xs" c="dimmed" mb={cx.why ? 'xs' : 0} wrap="nowrap" align="flex-start">
          <IconEyeOff size={16} aria-hidden style={{ flexShrink: 0, marginTop: 2 }} />
          <Text size="sm">Hidden test</Text>
        </Group>
      ) : (
        <DiffView input={cx.input ?? ''} expected={cx.expected ?? ''} got={cx.got ?? ''} maxHeight={240} />
      )}
      {cx.why && (
        <Group gap="xs" mt="sm" wrap="nowrap" align="flex-start">
          <IconBulb size={16} color="var(--ag-warn)" aria-hidden style={{ flexShrink: 0, marginTop: 3 }} />
          <Text size="sm" className="ag-prose">
            <Text span fw={600} size="sm">
              Why:{' '}
            </Text>
            {cx.why}
          </Text>
        </Group>
      )}
    </Paper>
  );
}

function HiddenSummary({ hidden, total, hasVisible, edgeNames }: { hidden: Counterexample[]; total: number | null; hasVisible: boolean; edgeNames: string[] }) {
  const ids = hidden.map((c) => c.test).filter(Boolean) as string[];
  const shown = ids.slice(0, 6).join(', ') + (ids.length > 6 ? ', ...' : '');
  const kinds = new Map<string, number>();
  for (const c of hidden) kinds.set(failureKind(c), (kinds.get(failureKind(c)) ?? 0) + 1);
  const n = hidden.length;
  return (
    <Paper p="md" style={{ borderLeft: '3px solid var(--ag-fail)' }}>
      <Stack gap={6}>
        <Group gap="xs" wrap="wrap">
          <IconLock size={16} color="var(--ag-muted)" aria-hidden />
          <Text fw={600}>
            {total ? `${n} of ${total} hidden tests fail` : `${plural(n, 'hidden test')} ${n === 1 ? 'fails' : 'fail'}`}
            {shown && <Text span c="dimmed" fw={400}>{` (test${ids.length === 1 ? '' : 's'} ${shown})`}</Text>}
          </Text>
        </Group>
        {kinds.size > 1 && (
          <Group gap={6} wrap="wrap">
            {[...kinds.entries()].map(([k, v]) => (
              <Badge key={k} variant="light" color={/time|crash|runtime|exit/i.test(k) ? 'warn' : 'fail'} radius="sm">
                {k}: {v}
              </Badge>
            ))}
          </Group>
        )}
        {!hasVisible && edgeNames.length > 0 && (
          <Text size="sm" c="dimmed">
            Edge cases checked: {edgeNames.join(', ')}
          </Text>
        )}
      </Stack>
    </Paper>
  );
}

export function FailuresTab({ r, filename }: { r: Report; filename: string }) {
  const groups = useMemo(() => failureGroups(r), [r]);
  const edgeNames = useMemo(() => edgeCaseNames(r), [r]);
  const [limit, setLimit] = useState(8);
  if (!compiled(r)) {
    const diags = diagnostics(r).filter((d) => d.tool === 'Compiler');
    return (
      <Stack gap="md">
        <Alert color="fail" variant="light" icon={<IconAlertTriangle size={18} />} title="Your program does not compile">
          No tests ran. Fix the errors below and submit again.
        </Alert>
        {diags.length > 0 ? (
          <DiagnosticList items={diags} filename={filename} />
        ) : (
          <Text size="sm" c="dimmed">
            No compiler output. Try gcc -Wall -std=c11 locally.
          </Text>
        )}
      </Stack>
    );
  }
  const { visible, hidden, hiddenTotal } = groups;
  if (!visible.length && !hidden.length) {
    return (
      <Paper p={0}>
        <EmptyState
          icon={IconCircleCheck}
          title="No failing inputs"
          compact
        />
      </Paper>
    );
  }
  return (
    <Stack gap="md">
      {visible.length > 0 && (
        <Text size="sm" c="dimmed">
          {plural(visible.length, 'failing input')}
        </Text>
      )}
      {visible.slice(0, limit).map((cx, i) => (
        <FailureCard key={i} cx={cx} index={i} />
      ))}
      {visible.length > limit && (
        <Group>
          <Button variant="default" onClick={() => setLimit(visible.length)}>
            Show all {visible.length} failing inputs
          </Button>
        </Group>
      )}
      {hidden.length > 0 && <HiddenSummary hidden={hidden} total={hiddenTotal} hasVisible={visible.length > 0} edgeNames={edgeNames} />}
    </Stack>
  );
}

// ---------------------------------------------------------------- metrics
function ScoreCell({ m }: { m: MetricEntry }) {
  if (isInformational(m)) return <Badge color={reviewStatus(m) === 'Review required' ? 'orange' : 'gray'} variant="light">{reviewStatus(m)}</Badge>;
  if (m.status === 'skipped') return <Text size="sm" c="dimmed">Not graded</Text>;
  const tone = m.score >= 0.999 ? 'pass' : m.score <= 0.001 ? 'fail' : 'warn';
  return (
    <Group gap={8} wrap="nowrap" justify="flex-end">
      <Box w={64} h={6} style={{ background: 'var(--ag-raised)', borderRadius: 3, overflow: 'hidden' }} aria-hidden visibleFrom="sm">
        <Box h="100%" w={`${Math.max(0, Math.min(1, m.score)) * 100}%`} style={{ background: `var(--ag-${tone})` }} />
      </Box>
      <Text size="sm" className="ag-num" c={`${tone}.5`} style={{ whiteSpace: 'nowrap' }}>
        {fmtPct(m.score)}
      </Text>
    </Group>
  );
}

function pts(n: number) {
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}

export function MetricsTab({ r, specs }: { r: Report; specs?: MetricSpec[] }) {
  const metrics = useMemo(() => labelled(scoredMetrics(r), specs), [r, specs]);
  const total = metrics.reduce((s, m) => s + (m.weight || 0), 0) || 1;
  const scale = total <= 1.0001 ? 100 : 100 / total;
  const descr = (m: MetricEntry) => specs?.find((s) => s.name === m.name)?.description;
  const cols: Column<MetricEntry>[] = [
    {
      key: 'label',
      header: 'Check',
      cell: (m) => (
        <Box>
          <Text size="sm" fw={500}>
            {m.label}
          </Text>
          {descr(m) && (
            <Text size="sm" c="dimmed" visibleFrom="sm">
              {descr(m)}
            </Text>
          )}
        </Box>
      ),
      width: '24%',
    },
    { key: 'weight', header: 'Weight', align: 'right', cell: (m) => isInformational(m) ? <Text size="sm" c="dimmed">Not scored</Text> : <span className="ag-num">{Math.round((m.weight / total) * 100)}%</span> },
    { key: 'score', header: 'Score', align: 'right', cell: (m) => <ScoreCell m={m} /> },
    {
      key: 'points',
      header: 'Points',
      align: 'right',
      cell: (m) => isInformational(m) ? <Text size="sm" c="dimmed">-</Text> : (
        <Text size="sm" className="ag-num" style={{ whiteSpace: 'nowrap' }}>
          {m.status === 'skipped' ? '-' : pts(Math.round(m.score * m.weight * scale * 10) / 10)}
          <Text span c="dimmed" size="sm">
            {' '}
            / {pts(Math.round(m.weight * scale * 10) / 10)}
          </Text>
        </Text>
      ),
    },
    {
      key: 'feedback',
      header: 'Feedback',
      cell: (m) => (
        <Text size="sm" style={{ textAlign: 'left', overflowWrap: 'anywhere' }}>
          {m.feedback || '-'}
        </Text>
      ),
      width: '40%',
    },
  ];
  const suggestions = Array.from(new Set((r.suggestions ?? []).map(cleanText).filter(Boolean)));
  return (
    <Stack gap="md">
      {r.tutor_note?.text && (
        <Alert color="info" variant="light" icon={<IconInfoCircle size={18} />} title="Summary">
          <Text size="sm" className="ag-prose">
            {cleanText(r.tutor_note.text)}
          </Text>
        </Alert>
      )}
      <ResponsiveTable data={metrics} columns={cols} rowKey={(m) => m.name} minWidth={720} caption="Score by check" />
      {suggestions.length > 0 && (
        <Section title="What to fix">
          <List spacing={6} size="sm" icon={<IconBulb size={15} color="var(--ag-warn)" style={{ marginTop: 3 }} />} className="ag-prose">
            {suggestions.map((s, i) => (
              <List.Item key={i}>{s}</List.Item>
            ))}
          </List>
        </Section>
      )}
    </Stack>
  );
}

// ---------------------------------------------------------------- memory and speed
const MEM_KIND: Record<string, string> = {
  'heap-buffer-overflow': 'Read or write past the end of a malloc() block',
  'stack-buffer-overflow': 'Read or write past the end of a local array',
  'global-buffer-overflow': 'Read or write past the end of a global array',
  'out-of-bounds': 'Array index out of bounds',
  'heap-use-after-free': 'Memory used after free()',
  'use-after-free': 'Memory used after free()',
  'double-free': 'The same block freed twice',
  'attempting double-free': 'The same block freed twice',
  'stack-overflow': 'Stack overflow (very deep or endless recursion)',
  SEGV: 'Segmentation fault (invalid pointer)',
  'memory-leak': 'Memory not freed',
  'uninitialised-read': 'A variable read before it was given a value',
  'invalid-read': 'Read from memory the program does not own',
  'invalid-write': 'Write to memory the program does not own',
  'invalid-free': 'free() on a pointer that malloc() did not return',
};

interface MemIssue {
  tool: string;
  kind: string;
  where?: string;
  input?: string;
  bytes?: number;
}

interface SanEvidence {
  compiled?: boolean;
  inputs_checked?: number;
  valgrind?: boolean;
  issues?: MemIssue[];
  undefined_behaviour_notes?: { tool?: string; line?: number; message: string; input?: string }[];
}

interface CxEvidence {
  compiled?: boolean;
  required?: string;
  measured?: string;
  method?: string;
  fits?: Record<string, number> | unknown;
  measurements?: { n: number; instructions?: number | null; ms?: number; status?: string }[];
  profile_hot_functions?: { function: string; share: number; user_code: boolean }[];
}

function toolName(t: string) {
  if (/asan|addresssanitizer/i.test(t)) return 'AddressSanitizer';
  if (/valgrind/i.test(t)) return 'valgrind';
  if (/ubsan/i.test(t)) return 'UBSan';
  return t;
}

export function MemoryTab({ r }: { r: Report }) {
  const san = metricBy(r, 'sanitizer_run');
  const cx = metricBy(r, 'complexity_estimator');
  const io = metricBy(r, 'io_tests');
  const se = (san?.evidence ?? {}) as SanEvidence;
  const ce = (cx?.evidence ?? {}) as CxEvidence;
  const maxMs = (io?.evidence as { max_ms?: number } | undefined)?.max_ms;
  const limitS = (r as { time_limit_s?: number }).time_limit_s;
  if (!san && !cx && maxMs === undefined) {
    return (
      <Paper p={0}>
        <EmptyState icon={IconInfoCircle} title="Not checked for this problem" compact />
      </Paper>
    );
  }
  const issues = se.issues ?? [];
  const ub = se.undefined_behaviour_notes ?? [];
  const tools = ['AddressSanitizer', se.valgrind ? 'valgrind' : null].filter(Boolean).join(' and ');
  const meas = ce.measurements ?? [];
  // Only worth showing when one of the student's own functions shows up; otherwise it is all startup code.
  const allHot = ce.profile_hot_functions ?? [];
  const mineHot = allHot.filter((h) => h.user_code && h.share >= 0.01);
  const hot = mineHot.length
    ? [...mineHot.slice(0, 5), { function: 'C library and startup', share: Math.max(0, 1 - mineHot.reduce((s, h) => s + h.share, 0)), user_code: false }]
    : [];
  const usesInstr = meas.some((m) => m.instructions != null);

  return (
    <Stack gap="md">
      {san && (
        <Section
          title="Memory safety"
          id="mem-safety"
          description={
            se.compiled === false
              ? 'Not checked: does not compile'
              : `${tools || 'Memory checkers'} · ${plural(se.inputs_checked ?? 0, 'input')}`
          }
        >
          {se.compiled === false ? null : (
            <Stack gap="sm">
              {issues.length === 0 && (
                <Group gap="xs" c="pass.5">
                  <IconCircleCheck size={18} aria-hidden />
                  <Text size="sm">No memory errors or leaks</Text>
                </Group>
              )}
              {ub.length > 0 && (
                <Text size="sm" c="dimmed">
                  Undefined behaviour found (no marks lost, but often the cause of wrong answers).
                </Text>
              )}
              {issues.map((x, i) => (
                <Paper key={i} p="sm" bg="var(--ag-bg)">
                  <Group gap="xs" wrap="wrap" mb={4}>
                    <IconAlertCircle size={16} color={x.kind === 'memory-leak' ? 'var(--ag-warn)' : 'var(--ag-fail)'} aria-hidden />
                    <Text size="sm" fw={600}>
                      {MEM_KIND[x.kind] ?? x.kind.replace(/-/g, ' ')}
                    </Text>
                    {x.bytes ? (
                      <Text size="sm" c="dimmed" className="ag-num">
                        {x.bytes} bytes lost
                      </Text>
                    ) : null}
                  </Group>
                  <Text size="sm" c="dimmed">
                    Found by {toolName(x.tool)}
                    {x.where ? (
                      <>
                        {' '}
                        in <span className="ag-mono">{x.where}</span>
                      </>
                    ) : null}
                    .
                  </Text>
                  {x.input && (
                    <Box mt="xs">
                      <CodeBlock code={x.input} label="Input that triggered it" maxHeight={120} />
                    </Box>
                  )}
                </Paper>
              ))}
              {ub.map((u, i) => (
                <Paper key={`ub${i}`} p="sm" bg="var(--ag-bg)">
                  <Group gap="xs" mb={4}>
                    <IconAlertTriangle size={16} color="var(--ag-warn)" aria-hidden />
                    <Text size="sm" fw={600}>
                      Undefined behaviour{u.line ? ` on line ${u.line}` : ''}
                    </Text>
                  </Group>
                  <Text size="sm" className="ag-mono" fz={13}>
                    {u.message}
                  </Text>
                </Paper>
              ))}
            </Stack>
          )}
        </Section>
      )}

      {cx && (
        <Section
          title="Efficiency"
          id="efficiency"
          description={
            ce.compiled === false
              ? 'Not measured: does not compile'
              : `${usesInstr ? 'Instruction count' : 'Running time'} on growing inputs`
          }
        >
          {ce.compiled === false ? null : (
            <Stack gap="md">
              <SimpleGrid cols={{ base: 2, sm: 3 }} spacing="sm">
                <Box>
                  <Text size="sm" c="dimmed">
                    Required
                  </Text>
                  <Text fz={20} fw={600} className="ag-mono">
                    {ce.required ?? '-'}
                  </Text>
                </Box>
                <Box>
                  <Text size="sm" c="dimmed">
                    Measured
                  </Text>
                  <Text fz={20} fw={600} className="ag-mono" c={cx.score >= 0.999 ? 'pass.5' : cx.score > 0 ? 'warn.5' : 'fail.5'}>
                    {ce.measured ?? '-'}
                  </Text>
                </Box>
                {maxMs !== undefined && (
                  <Box>
                    <Text size="sm" c="dimmed">
                      Slowest hidden test
                    </Text>
                    <Text fz={20} fw={600} className="ag-num">
                      {Math.round(maxMs)} ms
                      {limitS ? (
                        <Text span size="sm" c="dimmed" fw={400}>
                          {' '}
                          (limit {limitS * 1000} ms)
                        </Text>
                      ) : null}
                    </Text>
                  </Box>
                )}
              </SimpleGrid>
              {cx.feedback && (
                <Text size="sm" className="ag-prose">
                  {cleanText(cx.feedback)}
                </Text>
              )}
              {meas.length > 0 && (
                <Table.ScrollContainer minWidth={280} type="native">
                  <Table withTableBorder={false} fz="sm" maw={460}>
                    <Table.Thead>
                      <Table.Tr>
                        <Table.Th>Input size n</Table.Th>
                        <Table.Th style={{ textAlign: 'right' }}>{usesInstr ? 'Instructions' : 'Time'}</Table.Th>
                      </Table.Tr>
                    </Table.Thead>
                    <Table.Tbody>
                      {meas.map((m, i) => (
                        <Table.Tr key={i}>
                          <Table.Td className="ag-num">{m.n.toLocaleString()}</Table.Td>
                          <Table.Td className="ag-num" style={{ textAlign: 'right' }}>
                            {m.instructions != null
                              ? m.instructions.toLocaleString()
                              : m.ms != null
                                ? `${m.ms} ms`
                                : (m.status ?? 'did not finish').replace(/_/g, ' ')}
                          </Table.Td>
                        </Table.Tr>
                      ))}
                    </Table.Tbody>
                  </Table>
                </Table.ScrollContainer>
              )}
              {hot.length > 0 && (
                <Box>
                  <Text size="sm" fw={500} mb={6}>
                    Where the time goes
                  </Text>
                  <Stack gap={6} maw={460}>
                    {hot.map((h) => (
                      <Group key={h.function} gap="sm" wrap="nowrap">
                        <Text size="sm" className={h.user_code ? "ag-mono" : undefined} fz={13} w={170} truncate c={h.user_code ? undefined : "dimmed"}>
                          {h.user_code ? `${h.function}()` : h.function}
                        </Text>
                        <Box style={{ flex: 1, background: 'var(--ag-raised)', borderRadius: 3, height: 6 }} aria-hidden>
                          <Box h={6} w={`${h.share * 100}%`} style={{ background: h.user_code ? 'var(--ag-info)' : '#56627A', borderRadius: 3 }} />
                        </Box>
                        <Text size="sm" className="ag-num" w={44} ta="right">
                          {Math.round(h.share * 100)}%
                        </Text>
                      </Group>
                    ))}
                  </Stack>
                  <Text size="sm" c="dimmed" mt={6}>
                    Share of instructions at the largest input. Your functions in blue.
                  </Text>
                </Box>
              )}
            </Stack>
          )}
        </Section>
      )}
    </Stack>
  );
}

// ---------------------------------------------------------------- code quality
interface SaEvidence {
  thresholds?: { max_cyclomatic?: number; max_function_length?: number; max_nesting?: number };
  functions?: { name: string; lines: number; cyclomatic: number; nesting: number }[];
}

export function QualityTab({ r, filename }: { r: Report; filename: string }) {
  const diags = useMemo(() => diagnostics(r), [r]);
  const groups: [string, Diagnostic[]][] = [];
  for (const d of diags) {
    const key = d.tool.startsWith('Codacy') ? 'Codacy' : d.tool;
    const g = groups.find((x) => x[0] === key);
    if (g) g[1].push(d);
    else groups.push([key, [d]]);
  }
  const sa = metricBy(r, 'static_analysis');
  const se = (sa?.evidence ?? {}) as SaEvidence;
  const th = se.thresholds ?? {};
  const fns = se.functions ?? [];
  const codacy = metricBy(r, 'codacy_review');
  const codacyOff = (codacy?.evidence as { available?: boolean } | undefined)?.available === false;
  const modularity = metricBy(r, 'function_split');
  const TITLES: Record<string, string> = {
    Compiler: 'Compiler (gcc)',
    cppcheck: 'cppcheck',
    Codacy: 'Codacy',
  };

  return (
    <Stack gap="md">
      {groups.length === 0 ? (
        <Paper p="md">
          <Group gap="xs" c="pass.5">
            <IconCircleCheck size={18} aria-hidden />
            <Text size="sm">No compiler warnings or static analysis findings.</Text>
          </Group>
        </Paper>
      ) : (
        groups.map(([k, items]) => (
          <Section key={k} title={`${TITLES[k] ?? k}: ${plural(items.length, 'finding')}`}>
            <DiagnosticList items={items} filename={filename} />
          </Section>
        ))
      )}
      {codacyOff && (
        <Text size="sm" c="dimmed">
          Codacy did not run (no effect on grade).
        </Text>
      )}
      {fns.length > 0 && (
        <Section
          title="Function size"
          description={`Limits: ${th.max_function_length ?? '-'} lines, branching complexity ${th.max_cyclomatic ?? '-'}, nesting depth ${th.max_nesting ?? '-'}.`}
        >
          <Table.ScrollContainer minWidth={360} type="native">
            <Table fz="sm" maw={560}>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>Function</Table.Th>
                  <Table.Th style={{ textAlign: 'right' }}>Lines</Table.Th>
                  <Table.Th style={{ textAlign: 'right' }}>Branching</Table.Th>
                  <Table.Th style={{ textAlign: 'right' }}>Nesting</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {fns.map((f) => {
                  const over = (v: number, lim?: number) => (lim !== undefined && v > lim ? 'fail.5' : undefined);
                  return (
                    <Table.Tr key={f.name}>
                      <Table.Td className="ag-mono" fz={13}>
                        {f.name}()
                      </Table.Td>
                      <Table.Td style={{ textAlign: 'right' }}>
                        <Text span size="sm" className="ag-num" c={over(f.lines, th.max_function_length)}>
                          {f.lines}
                        </Text>
                      </Table.Td>
                      <Table.Td style={{ textAlign: 'right' }}>
                        <Text span size="sm" className="ag-num" c={over(f.cyclomatic, th.max_cyclomatic)}>
                          {f.cyclomatic}
                        </Text>
                      </Table.Td>
                      <Table.Td style={{ textAlign: 'right' }}>
                        <Text span size="sm" className="ag-num" c={over(f.nesting, th.max_nesting)}>
                          {f.nesting}
                        </Text>
                      </Table.Td>
                    </Table.Tr>
                  );
                })}
              </Table.Tbody>
            </Table>
          </Table.ScrollContainer>
          {modularity?.feedback && (
            <Text size="sm" mt="sm" className="ag-prose">
              {cleanText(modularity.feedback)}
            </Text>
          )}
        </Section>
      )}
    </Stack>
  );
}

// ---------------------------------------------------------------- source
export function SourceTab({ r, source, filename }: { r: Report | null; source: string; filename: string }) {
  const ed = useRef<MonacoEditor.IStandaloneCodeEditor | null>(null);
  const marks = useMemo(() => {
    const d = diagnostics(r).filter((x) => x.line);
    const san = (metricBy(r, 'sanitizer_run')?.evidence ?? {}) as SanEvidence;
    for (const x of san.issues ?? []) {
      const ln = lineOf(x.where);
      if (ln) d.push({ line: ln, severity: x.kind === 'memory-leak' ? 'warning' : 'error', message: MEM_KIND[x.kind] ?? x.kind, tool: 'Memory check' });
    }
    for (const u of san.undefined_behaviour_notes ?? []) {
      if (u.line) d.push({ line: u.line, severity: 'warning', message: `Undefined behaviour: ${u.message}`, tool: 'Memory check' });
    }
    return d.sort((a, b) => (a.line ?? 0) - (b.line ?? 0));
  }, [r]);
  const go = (n: number) => {
    ed.current?.revealLineInCenter(n);
    ed.current?.setPosition({ lineNumber: n, column: 1 });
    ed.current?.focus();
  };
  return (
    <Stack gap="sm">
      <CodeViewer
        source={source}
        height={Math.min(640, Math.max(220, source.split('\n').length * 19 + 24))}
        onMount={(editor, monaco) => {
          ed.current = editor;
          editor.updateOptions({ wordWrap: 'on', ariaLabel: `${filename}, read only` });
          const model = editor.getModel();
          if (!model) return;
          const S = monaco.MarkerSeverity;
          monaco.editor.setModelMarkers(
            model,
            'autograder',
            marks.map((m) => ({
              startLineNumber: m.line!,
              endLineNumber: m.line!,
              startColumn: m.col ?? 1,
              endColumn: model.getLineMaxColumn(Math.min(m.line!, model.getLineCount())),
              message: `${m.message} (${m.tool})`,
              severity: m.severity === 'error' ? S.Error : m.severity === 'warning' ? S.Warning : S.Info,
            })),
          );
        }}
      />
      {marks.length > 0 ? (
        <>
          <DiagnosticList items={marks} filename={filename} onLine={go} />
        </>
      ) : (
        <Text size="sm" c="dimmed">
          No line has a finding.
        </Text>
      )}
    </Stack>
  );
}

// ---------------------------------------------------------------- model solutions
export function SolutionsTab({ slug }: { slug: string }) {
  const q = useQuery({ queryKey: ['problem', slug, 'best'], queryFn: () => api.problemBest(slug) });
  if (q.isPending) return <Text size="sm" c="dimmed">Loading model solutions...</Text>;
  if (q.error) {
    if (isApiError(q.error, 403))
      return (
        <Paper p={0}>
          <EmptyState icon={IconTrophy} title="Not available yet" message={q.error.detail} compact />
        </Paper>
      );
    return <ErrorState error={q.error} onRetry={() => q.refetch()} backTo={false} compact />;
  }
  if (!q.data.length)
    return (
      <Paper p={0}>
        <EmptyState icon={IconTrophy} title="No model solutions shared" compact />
      </Paper>
    );
  return (
    <Stack gap="md">
      {q.data.map((b) => (
        <Paper key={b.rank} p="md">
          <Group justify="space-between" mb="sm">
            <Group gap="xs">
              <IconCode size={16} color="var(--ag-muted)" aria-hidden />
              <Text fw={600}>Solution {b.rank}</Text>
            </Group>
            <GradeDisplay grade={b.grade} size="sm" />
          </Group>
          <CodeBlock code={b.source} label={b.filename} lineNumbers maxHeight={420} />
        </Paper>
      ))}
    </Stack>
  );
}
