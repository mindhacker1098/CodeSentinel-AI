import { Badge, Group, Paper, Table, Text, Title } from '@mantine/core';
import type { MetricEntry } from '../api/types';

export interface CodacyIssue {
  tool: string;
  rule: string;
  level: string;
  category?: string;
  line: number;
  message: string;
}

interface CodacyEvidence {
  available?: boolean;
  mode?: string;
  reason?: string;
  issues?: CodacyIssue[];
  tool_versions?: Record<string, unknown>;
}

const LEVEL_COLOR: Record<string, string> = { Error: 'red', Warning: 'orange', Info: 'gray' };

/** Codacy issues from the codacy_review metric, if the rules include it. */
export default function CodacyFindings({ metrics }: { metrics: MetricEntry[] }) {
  const m = metrics.find((x) => x.analyzer === 'codacy_review');
  if (!m) return null;
  const ev = (m.evidence ?? {}) as CodacyEvidence;
  const issues = ev.issues ?? [];
  if (ev.available === false) {
    return (
      <Paper withBorder p="md" radius="md">
        <Title order={4} mb="xs">
          Codacy findings
        </Title>
        <Text size="sm" c="dimmed">
          Codacy was not available for this grade ({ev.reason ?? 'unknown reason'}).
        </Text>
      </Paper>
    );
  }
  if (!issues.length) return null;
  return (
    <Paper withBorder p="md" radius="md">
      <Group justify="space-between" mb="sm">
        <Title order={4}>Codacy findings ({issues.length})</Title>
        <Text size="xs" c="dimmed">
          {ev.mode ?? 'local'} mode, lizard + opengrep
        </Text>
      </Group>
      <Table striped withTableBorder fz="sm" verticalSpacing={4}>
        <Table.Thead>
          <Table.Tr>
            <Table.Th w={60}>Line</Table.Th>
            <Table.Th w={90}>Tool</Table.Th>
            <Table.Th>Rule</Table.Th>
            <Table.Th w={90}>Level</Table.Th>
            <Table.Th>Message</Table.Th>
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {issues.map((i, k) => (
            <Table.Tr key={k}>
              <Table.Td>{i.line}</Table.Td>
              <Table.Td>{i.tool}</Table.Td>
              <Table.Td>
                <Text size="xs" ff="monospace" style={{ wordBreak: 'break-all' }}>
                  {i.rule}
                </Text>
              </Table.Td>
              <Table.Td>
                <Badge size="sm" variant="light" color={LEVEL_COLOR[i.level] ?? 'gray'}>
                  {i.level}
                </Badge>
              </Table.Td>
              <Table.Td>{i.message}</Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>
    </Paper>
  );
}
