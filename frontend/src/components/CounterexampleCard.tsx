import { Badge, Box, Code, Group, Paper, SimpleGrid, Stack, Text } from '@mantine/core';
import type { Counterexample } from '../api/types';

function Field({ label, value, color }: { label: string; value: string | undefined; color?: string }) {
  return (
    <Box>
      <Text size="xs" fw={700} c={color ?? 'dimmed'} tt="uppercase">
        {label}
      </Text>
      <Code block style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-all', maxHeight: 180, overflow: 'auto' }}>
        {value === undefined || value === '' ? '(empty)' : value}
      </Code>
    </Box>
  );
}

export default function CounterexampleCard({ cx }: { cx: Counterexample }) {
  return (
    <Paper withBorder p="sm" radius="sm">
      <Stack gap="xs">
        <Group gap="xs">
          {cx.source && (
            <Badge variant="light" color={cx.source.includes('LLM') ? 'grape' : 'blue'} radius="sm">
              {cx.source}
            </Badge>
          )}
          {cx.test && (
            <Text size="sm" c="dimmed">
              test {cx.test}
            </Text>
          )}
          {cx.status && cx.status !== 'wrong_answer' && (
            <Badge variant="outline" color="red" radius="sm">
              {cx.note ?? cx.status}
            </Badge>
          )}
        </Group>
        <Field label="Input" value={cx.input} />
        <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="xs">
          <Field label="Expected" value={cx.expected} color="green.8" />
          <Field label="Got" value={cx.got} color="red.8" />
        </SimpleGrid>
        {cx.why && (
          <Box>
            <Text size="xs" fw={700} c="dimmed" tt="uppercase">
              Why
            </Text>
            <Text size="sm">{cx.why}</Text>
          </Box>
        )}
      </Stack>
    </Paper>
  );
}
