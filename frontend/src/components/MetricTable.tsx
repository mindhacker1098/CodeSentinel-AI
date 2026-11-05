import { Fragment, useState } from 'react';
import { ActionIcon, Badge, Code, Progress, Table, Text } from '@mantine/core';
import { IconChevronDown, IconChevronRight } from '@tabler/icons-react';
import type { MetricEntry } from '../api/types';
import { fmtPct, scoreColor } from '../format';
import { isInformational, reviewStatus } from '../metrics';

interface Props {
  metrics: MetricEntry[];
  showEvidence?: boolean;
}

function statusColor(s: string): string {
  if (s === 'ok') return 'green';
  if (s === 'skipped') return 'gray';
  if (s === 'error') return 'red';
  return 'yellow';
}

export default function MetricTable({ metrics, showEvidence = true }: Props) {
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const toggle = (n: string) => setOpen((o) => ({ ...o, [n]: !o[n] }));

  return (
    <Table striped highlightOnHover verticalSpacing="xs">
      <Table.Thead>
        <Table.Tr>
          {showEvidence && <Table.Th w={32} />}
          <Table.Th>Metric</Table.Th>
          <Table.Th>Weight</Table.Th>
          <Table.Th w={160}>Score</Table.Th>
          <Table.Th>Points</Table.Th>
          <Table.Th>Feedback</Table.Th>
        </Table.Tr>
      </Table.Thead>
      <Table.Tbody>
        {metrics.map((m) => (
          <Fragment key={m.name}>
            <Table.Tr>
              {showEvidence && (
                <Table.Td>
                  {m.evidence && (
                    <ActionIcon variant="subtle" size="sm" onClick={() => toggle(m.name)} aria-label="evidence">
                      {open[m.name] ? <IconChevronDown size={14} /> : <IconChevronRight size={14} />}
                    </ActionIcon>
                  )}
                </Table.Td>
              )}
              <Table.Td>
                <Text size="sm" fw={600}>
                  {m.name}
                </Text>
                <Text size="xs" c="dimmed">
                  {m.analyzer}
                </Text>
              </Table.Td>
              <Table.Td>{isInformational(m) ? 'Not scored' : `${Math.round(m.weight * 100)}%`}</Table.Td>
              <Table.Td>
                {isInformational(m) ? <Badge color="gray" variant="light">{reviewStatus(m)}</Badge> : m.status === 'ok' ? (
                  <>
                    <Text size="xs">{fmtPct(m.score)}</Text>
                    <Progress value={m.score * 100} color={scoreColor(m.score)} size="sm" />
                  </>
                ) : (
                  <Badge color={statusColor(m.status)} variant="light" radius="sm">
                    {m.status}
                  </Badge>
                )}
              </Table.Td>
              <Table.Td>
                <Text size="sm">{isInformational(m) ? '-' : m.contribution}</Text>
              </Table.Td>
              <Table.Td>
                <Text size="sm">{m.feedback}</Text>
              </Table.Td>
            </Table.Tr>
            {showEvidence && open[m.name] && m.evidence && (
              <Table.Tr>
                <Table.Td colSpan={6}>
                  <Code block style={{ maxHeight: 320, overflow: 'auto' }}>
                    {JSON.stringify(m.evidence, null, 2)}
                  </Code>
                </Table.Td>
              </Table.Tr>
            )}
          </Fragment>
        ))}
      </Table.Tbody>
    </Table>
  );
}
