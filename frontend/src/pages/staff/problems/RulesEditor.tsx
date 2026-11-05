import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  ActionIcon,
  Alert,
  Box,
  Button,
  Group,
  List,
  NumberInput,
  Paper,
  Select,
  SimpleGrid,
  Stack,
  Text,
  TextInput,
  Tooltip,
} from '@mantine/core';
import { useDebouncedValue } from '@mantine/hooks';
import { IconAlertTriangle, IconCircleCheck, IconLoader2, IconPlus, IconTrash } from '@tabler/icons-react';
import { api } from '../../../api/client';
import { ANALYZERS, analyzerLabel, parseRules, r4, rulesText, weightSum, type MetricRow, type Rules } from './shared';
import { JsonEditor } from './widgets';

/** One segment per metric, width = weight. Same visual language as the student verdict bar. */
export function WeightBar({ metrics }: { metrics: MetricRow[] }) {
  const sum = weightSum(metrics);
  const pct = Math.round(sum * 1000) / 10;
  const over = sum > 1 + 1e-6;
  const under = sum < 1 - 1e-6;
  const scale = over ? 1 / sum : 1;
  const tone = over ? 'var(--ag-fail)' : under ? 'var(--ag-warn)' : 'var(--ag-pass)';
  const shades = ['#3A4763', '#334058', '#2C384E', '#405071'];
  return (
    <Stack gap={6}>
      <Box
        role="img"
        aria-label={`Weights add up to ${pct}%`}
        style={{ display: 'flex', height: 28, borderRadius: 4, overflow: 'hidden', border: `1px solid ${tone}`, background: 'var(--ag-bg)' }}
      >
        {metrics
          .filter((m) => m.weight > 0)
          .map((m, i) => (
            <Tooltip key={i} label={`${m.name || analyzerLabel(m.analyzer)}: ${r4(m.weight * 100)}%`}>
              <Box
                style={{
                  width: `${m.weight * scale * 100}%`,
                  background: shades[i % shades.length],
                  borderRight: '1px solid var(--ag-bg)',
                  display: 'flex',
                  alignItems: 'center',
                  paddingInline: 6,
                  overflow: 'hidden',
                  minWidth: 2,
                }}
              >
                <Text size="xs" c="var(--ag-text)" truncate>
                  {m.name || analyzerLabel(m.analyzer)}
                </Text>
              </Box>
            </Tooltip>
          ))}
        {under && (
          <Box
            style={{
              flex: 1,
              backgroundImage: 'repeating-linear-gradient(135deg, transparent 0 6px, rgba(227,174,69,0.18) 6px 12px)',
            }}
            aria-hidden
          />
        )}
      </Box>
      <Group gap={6} c={tone}>
        {over || under ? <IconAlertTriangle size={16} aria-hidden /> : <IconCircleCheck size={16} aria-hidden />}
        <Text size="sm" c={tone} fw={500}>
          {over
            ? `Weights add up to ${pct}%. Remove ${r4(pct - 100)}% so they total 100%.`
            : under
              ? `Weights add up to ${pct}%. Assign ${r4(100 - pct)}% more so they total 100%.`
              : 'Weights add up to 100%.'}
        </Text>
      </Group>
    </Stack>
  );
}

export interface RulesEditorProps {
  text: string;
  onChange: (t: string) => void;
  slug: string;
  /** Errors returned by the server on create or save. */
  serverErrors?: string[];
  analyzers?: string[];
}

export function RulesEditor({ text, onChange, slug, serverErrors = [], analyzers }: RulesEditorProps) {
  const parsed = useMemo(() => parseRules(text), [text]);
  const rules = parsed.value;
  const [debounced] = useDebouncedValue(rules, 500);
  const v = useQuery({
    queryKey: ['staff', 'rules-validate', JSON.stringify(debounced)],
    queryFn: () => api.staff.validateRules(debounced),
    enabled: debounced !== null,
    staleTime: Infinity,
  });
  const known = analyzers?.length ? analyzers : Object.keys(ANALYZERS);
  const analyzerData = known.map((a) => ({ value: a, label: analyzerLabel(a) }));

  const update = (fn: (r: Rules) => Rules) => {
    if (rules) onChange(rulesText(fn(structuredClone(rules))));
  };
  const setMetric = (i: number, patch: Partial<MetricRow>) =>
    update((r) => ({ ...r, metrics: r.metrics.map((m, j) => (j === i ? { ...m, ...patch } : m)) }));

  const errors = parsed.error ? [parsed.error] : (v.data?.errors ?? []);
  const generatorMissing = !!rules && rules.metrics.some((m) => ANALYZERS[m.analyzer]?.needsGenerator) && !rules.input_spec;

  return (
    <Stack gap="md">
      {serverErrors.length > 0 && (
        <Alert color="fail" variant="light" icon={<IconAlertTriangle size={18} />} title="The server did not accept these rules">
          <List size="sm">
            {serverErrors.map((e, i) => (
              <List.Item key={i}>{e}</List.Item>
            ))}
          </List>
        </Alert>
      )}
      <SimpleGrid cols={{ base: 1, lg: 2 }} spacing="lg" verticalSpacing="lg">
        <Stack gap="md">
          {rules ? (
            <>
              <Group grow align="flex-start">
                <NumberInput
                  label="Time limit (seconds)"
                  description="Per test run"
                  min={0.1}
                  step={0.5}
                  decimalScale={2}
                  value={typeof rules.time_limit_s === 'number' ? rules.time_limit_s : ''}
                  onChange={(x) => update((r) => ({ ...r, time_limit_s: Number(x) || 0 }))}
                />
                <NumberInput
                  label="Memory limit (MB)"
                  description="Per test run"
                  min={8}
                  step={16}
                  value={typeof rules.memory_limit_mb === 'number' ? rules.memory_limit_mb : ''}
                  onChange={(x) => update((r) => ({ ...r, memory_limit_mb: Number(x) || 0 }))}
                />
              </Group>
              <Stack gap={6}>
                <Text size="sm" fw={500}>
                  Metrics
                </Text>
                <Text size="sm" c="dimmed">
                  Weights must total 100%.
                </Text>
                <Paper p={0}>
                  <Group gap="xs" px="sm" py={6} wrap="nowrap" style={{ borderBottom: '1px solid var(--ag-line)' }}>
                    <Text size="xs" c="dimmed" style={{ flex: '1 1 0' }}>
                      Analyzer
                    </Text>
                    <Text size="xs" c="dimmed" style={{ flex: '1 1 0' }}>
                      Name in reports
                    </Text>
                    <Text size="xs" c="dimmed" w={96}>
                      Weight
                    </Text>
                    <Box w={28} />
                  </Group>
                  {rules.metrics.map((m, i) => (
                    <Group key={i} gap="xs" px="sm" py={6} wrap="nowrap" align="flex-start" style={{ borderBottom: '1px solid var(--ag-line)' }}>
                      <Select
                        style={{ flex: '1 1 0', minWidth: 0 }}
                        aria-label={`Analyzer for metric ${i + 1}`}
                        data={analyzerData.some((d) => d.value === m.analyzer) ? analyzerData : [...analyzerData, { value: m.analyzer, label: m.analyzer }]}
                        value={m.analyzer}
                        searchable
                        allowDeselect={false}
                        onChange={(a) => {
                          if (!a) return;
                          const def = ANALYZERS[a]?.params;
                          setMetric(i, { analyzer: a, ...(def ? { params: { ...def } } : {}) });
                        }}
                        size="xs"
                      />
                      <TextInput
                        style={{ flex: '1 1 0', minWidth: 0 }}
                        aria-label={`Name of metric ${i + 1}`}
                        value={m.name}
                        onChange={(e) => setMetric(i, { name: e.currentTarget.value.replace(/\s+/g, '_') })}
                        size="xs"
                        styles={{ input: { fontFamily: 'var(--mantine-font-family-monospace)' } }}
                      />
                      <NumberInput
                        w={96}
                        aria-label={`Weight of metric ${i + 1} in percent`}
                        value={r4((m.weight ?? 0) * 100)}
                        min={0}
                        max={100}
                        step={5}
                        decimalScale={2}
                        suffix="%"
                        onChange={(x) => setMetric(i, { weight: r4((Number(x) || 0) / 100) })}
                        size="xs"
                      />
                      <ActionIcon
                        variant="subtle"
                        color="gray"
                        aria-label={`Remove metric ${m.name || i + 1}`}
                        onClick={() => update((r) => ({ ...r, metrics: r.metrics.filter((_, j) => j !== i) }))}
                        mt={2}
                      >
                        <IconTrash size={15} />
                      </ActionIcon>
                    </Group>
                  ))}
                  <Box px="sm" py={6}>
                    <Button
                      size="compact-sm"
                      variant="subtle"
                      leftSection={<IconPlus size={14} />}
                      onClick={() =>
                        update((r) => {
                          const used = new Set(r.metrics.map((x) => x.analyzer));
                          const a = known.find((k) => !used.has(k)) ?? known[0];
                          const left = Math.max(0, r4(1 - weightSum(r.metrics)));
                          return {
                            ...r,
                            metrics: [...r.metrics, { name: a, analyzer: a, weight: left, ...(ANALYZERS[a]?.params ? { params: { ...ANALYZERS[a].params } } : {}) }],
                          };
                        })
                      }
                    >
                      Add metric
                    </Button>
                  </Box>
                </Paper>
              </Stack>
              <WeightBar metrics={rules.metrics} />
              <Select
                label="Generated input format"
                description="Optional for uploaded tests. Set bounds in rules.json to match the question."
                clearable
                value={(rules.input_spec as { generator?: string } | undefined)?.generator ?? null}
                data={[
                  { value: 'two_ints', label: 'Two integers' },
                  { value: 'int_array', label: 'Integer array: n followed by n values' },
                  { value: 'text_line', label: 'One line of text' },
                  { value: 'int_matrix', label: 'Square matrix: n followed by n × n values' },
                ]}
                onChange={(value) => update((r) => ({ ...r, input_spec: value ? {
                  generator: value,
                  ...(value === 'text_line' ? { min_n: 1, max_n: 200 } : {}),
                  ...(value === 'int_matrix' ? { min_n: 1, max_n: 20, min_val: -1000, max_val: 1000 } : {}),
                } : undefined }))}
              />
              <Text size="xs" c="dimmed">Efficiency sizes must fit these bounds. Other input formats require uploaded tests.</Text>
              {generatorMissing && (
                <Alert color="warn" variant="light" icon={<IconAlertTriangle size={18} />}>
                  Edge cases and Efficiency need <code>{'"input_spec": {"generator": "..."}'}</code>.
                </Alert>
              )}
            </>
          ) : (
            <Alert color="warn" variant="light" icon={<IconAlertTriangle size={18} />}>
              Invalid JSON. Fix it to use the form.
            </Alert>
          )}
        </Stack>
        <Stack gap={6}>
          <Group justify="space-between">
            <Text size="sm" fw={500}>
              rules.json
            </Text>
            <Group gap="xs">
              {rules && slug && rules.problem !== slug && (
                <Button size="compact-xs" variant="subtle" onClick={() => update((r) => ({ ...r, problem: slug }))}>
                  Set "problem" to {slug}
                </Button>
              )}
              <Button size="compact-xs" variant="subtle" disabled={!rules} onClick={() => rules && onChange(rulesText(rules))}>
                Reformat
              </Button>
            </Group>
          </Group>
          <JsonEditor value={text} onChange={onChange} height={440} />
          <Group gap={6} mih={22} aria-live="polite">
            {parsed.error ? null : v.isFetching ? (
              <>
                <IconLoader2 size={15} aria-hidden />
                <Text size="sm" c="dimmed">
                  Checking the rules
                </Text>
              </>
            ) : errors.length === 0 && v.data ? (
              <>
                <IconCircleCheck size={15} color="var(--ag-pass)" aria-hidden />
                <Text size="sm" c="pass.4">
                  Valid
                </Text>
              </>
            ) : null}
          </Group>
          {errors.length > 0 && (
            <Alert color="fail" variant="light" p="xs" icon={<IconAlertTriangle size={16} />}>
              <List size="sm">
                {errors.map((e, i) => (
                  <List.Item key={i}>{e}</List.Item>
                ))}
              </List>
            </Alert>
          )}
        </Stack>
      </SimpleGrid>
    </Stack>
  );
}

/** True when the rules parse and every local check passes (the server check is advisory in the UI). */
export function rulesLookValid(text: string): boolean {
  const p = parseRules(text);
  return !!p.value && p.value.metrics.length > 0 && Math.abs(weightSum(p.value.metrics) - 1) < 1e-6;
}
