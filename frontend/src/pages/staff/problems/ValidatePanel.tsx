import { Alert, Badge, Box, Button, Group, List, Stack, Text } from '@mantine/core';
import { IconCheck, IconPlayerPlay, IconX } from '@tabler/icons-react';
import type { ValidateResult } from '../../../api/client';
import { errorText } from '../../../notify';
import { CodeBlock, ResponsiveTable, StatusChip, type Column } from '../../../components';

type TestRow = ValidateResult['tests'][number];

const columns: Column<TestRow>[] = [
  { key: 'name', header: 'Test', cell: (t) => t.name, mono: true },
  {
    key: 'ok',
    header: 'Result',
    cell: (t) =>
      t.ok ? (
        <StatusChip kind="custom" tone="pass" icon={IconCheck} label="Pass" size="sm" />
      ) : (
        <StatusChip kind="custom" tone="fail" icon={IconX} label="Fail" size="sm" />
      ),
  },
  { key: 'ms', header: 'Time', align: 'right', cell: (t) => (t.ms === null ? '-' : `${Math.round(t.ms)} ms`) },
  { key: 'error', header: 'Why', cell: (t) => (t.error ? <Text size="sm">{t.error}</Text> : <Text size="sm" c="dimmed">-</Text>) },
];

export interface ValidatePanelProps {
  result: ValidateResult | null;
  running: boolean;
  onRun: () => void;
  runLabel?: string;
  /** Shown above the button, e.g. "Validation checks the saved version (v2)." */
  note?: string;
  disabled?: boolean;
  /** The last run failed before producing a result (e.g. the sandbox is down). */
  error?: unknown;
}

/** Compile the reference and run every test input through it; pass/fail per test. */
export function ValidatePanel({ result, running, onRun, runLabel = 'Run validation', note, disabled, error }: ValidatePanelProps) {
  const failed = result ? result.tests.filter((t) => !t.ok).length : 0;
  return (
    <Stack gap="md">
      {note && (
        <Text size="sm" c="dimmed">
          {note}
        </Text>
      )}
      <Group>
        <Button leftSection={<IconPlayerPlay size={16} />} loading={running} onClick={onRun} disabled={disabled}>
          {runLabel}
        </Button>
      </Group>
      {!!error && !running && (
        <Alert color="fail" variant="light" icon={<IconX size={18} />} title="Validation did not run" role="alert">
          {errorText(error)}
        </Alert>
      )}
      {result && (
        <Stack gap="md" aria-live="polite">
          {result.ok ? (
            <Alert color="pass" variant="light" icon={<IconCheck size={18} />} title="Ready to publish">
              {result.tests.length}/{result.tests.length} tests pass on the reference.
            </Alert>
          ) : (
            <Alert color="fail" variant="light" icon={<IconX size={18} />} title="Not ready yet">
              {!result.compile.ok
                ? 'reference.c does not compile.'
                : result.rules_errors.length
                  ? 'The rules have errors.'
                  : `${failed} of ${result.tests.length} tests fail on the reference.`}
            </Alert>
          )}
          {result.rules_errors.length > 0 && (
            <Box>
              <Text size="sm" fw={500} mb={4}>
                Rule errors
              </Text>
              <List size="sm">
                {result.rules_errors.map((e, i) => (
                  <List.Item key={i}>{e}</List.Item>
                ))}
              </List>
            </Box>
          )}
          <Group gap="xs">
            <Text size="sm" fw={500}>
              Compile
            </Text>
            {result.compile.ok ? (
              <StatusChip kind="custom" tone="pass" icon={IconCheck} label="Compiles" size="sm" />
            ) : (
              <StatusChip kind="custom" tone="fail" icon={IconX} label="Does not compile" size="sm" />
            )}
            <Badge variant="light" color={failed ? 'fail' : 'pass'} size="sm">
              {result.tests.length - failed} of {result.tests.length} tests pass
            </Badge>
          </Group>
          {result.compile.stderr?.trim() && <CodeBlock code={result.compile.stderr} label="Compiler output" maxHeight={220} />}
          {result.tests.length > 0 && (
            <ResponsiveTable data={result.tests} columns={columns} rowKey={(t) => t.name} minWidth={480} caption="Test results" maxHeight={360} />
          )}
        </Stack>
      )}
    </Stack>
  );
}
