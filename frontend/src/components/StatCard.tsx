import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Group, Paper, Stack, Text, UnstyledButton } from '@mantine/core';
import type { Icon } from '@tabler/icons-react';

export interface StatCardProps {
  /** Sentence-case label, e.g. "Open flags". */
  label: string;
  value: ReactNode;
  /** A short line under the value, e.g. "3 waiting for review". */
  hint?: ReactNode;
  icon?: Icon;
  /** Colours the value; use only when the number carries meaning (fail for failed jobs, etc.). */
  tone?: 'pass' | 'fail' | 'warn' | 'info';
  /** Makes the card a link. */
  to?: string;
  /** Small chart (sparkline/histogram) under the value. */
  chart?: ReactNode;
}

export function StatCard({ label, value, hint, icon: I, tone, to, chart }: StatCardProps) {
  const body = (
    <Paper p="md" h="100%" style={to ? { transition: 'border-color 120ms' } : undefined} className={to ? 'ag-statcard-link' : undefined}>
      <Stack gap={6}>
        <Group gap={6} wrap="nowrap">
          {I && <I size={16} stroke={1.7} color="var(--ag-muted)" aria-hidden />}
          <Text size="sm" c="dimmed">
            {label}
          </Text>
        </Group>
        <Text fz={26} fw={600} lh={1.1} c={tone ? `${tone}.5` : undefined} className="ag-num">
          {value}
        </Text>
        {hint && (
          <Text size="sm" c="dimmed">
            {hint}
          </Text>
        )}
        {chart}
      </Stack>
    </Paper>
  );
  if (!to) return body;
  return (
    <UnstyledButton component={Link} to={to} style={{ display: 'block', borderRadius: 6 }} aria-label={`${label}: ${typeof value === 'string' || typeof value === 'number' ? value : ''}`}>
      {body}
    </UnstyledButton>
  );
}
