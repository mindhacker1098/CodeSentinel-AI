import { Badge, Group, List, Paper, Stack, Text } from '@mantine/core';

export type Band = 'insufficient_evidence' | 'low' | 'uncertain' | 'elevated' | 'high';

const COLOR: Record<Band, string> = {
  insufficient_evidence: 'gray',
  low: 'green',
  uncertain: 'yellow',
  elevated: 'orange',
  high: 'red',
};

const DEFAULT_DISCLAIMER =
  'This is an uncalibrated heuristic signal, not an authorship probability. Review the evidence with the student.';

interface Props {
  band: Band | string;
  pRange?: [number, number] | number[] | null;
  evidence?: string[];
  disclaimer?: string;
  compact?: boolean;
}

export default function AiBand({ band, evidence, compact }: Props) {
  const color = COLOR[band as Band] ?? 'gray';
  const label = band.replace(/_/g, ' ');
  const badge = (
    <Badge color={color} variant="light" radius="sm">
      AI comparison signal: {label}
    </Badge>
  );
  if (compact) return badge;
  return (
    <Paper withBorder p="sm" radius="sm">
      <Stack gap={6}>
        <Group>{badge}</Group>
        {evidence && evidence.length > 0 && (
          <List size="sm" spacing={2}>
            {evidence.map((e, i) => (
              <List.Item key={i}>{e}</List.Item>
            ))}
          </List>
        )}
        <Text size="xs" c="dimmed">
          {DEFAULT_DISCLAIMER}
        </Text>
      </Stack>
    </Paper>
  );
}
