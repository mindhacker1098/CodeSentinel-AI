import { Badge, Group, Tooltip } from '@mantine/core';
import type { Flag } from '../api/types';

const LABELS: Record<string, string> = {
  compile_failed: 'Does not compile',
  suspected_infinite_loop: 'Possible infinite loop',
  missing_main: 'No main()',
  analyzer_error: 'A check failed to run',
  prompt_injection_attempt: 'Prompt injection',
  suspected_copy_peer: 'Similar to a classmate',
  suspected_copy_web: 'Similar to web code',
  suspected_copy_llm: 'Similar to AI-generated code',
  possible_copy_low_confidence: 'Possible copy',
  possible_ai_generated: 'Possibly AI-generated',
  dangerous_call: 'Unsafe call',
  blocked_by_preanalysis: 'Blocked before running',
  late: 'Late',
};

const SEVERITY_COLOR: Record<string, string> = {
  critical: 'fail',
  high: 'fail',
  medium: 'warn',
  low: 'warn',
  info: 'gray',
};

function colorFor(f: Flag): string {
  if (f.review_status === 'dismissed') return 'gray';
  if (f.severity && SEVERITY_COLOR[f.severity]) return SEVERITY_COLOR[f.severity];
  if (f.type.startsWith('suspected_copy') || f.type === 'compile_failed') return 'fail';
  return 'warn';
}

function sentenceCase(s: string) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export default function FlagBadge({ flag }: { flag: Flag | string }) {
  const f: Flag = typeof flag === 'string' ? { type: flag } : flag;
  const label = LABELS[f.type] ?? sentenceCase(f.type.replace(/_/g, ' '));
  const badge = (
    <Badge color={colorFor(f)} variant="light" radius="sm" td={f.review_status === 'dismissed' ? 'line-through' : undefined}>
      {label}
      {f.review_status === 'confirmed' ? ', confirmed' : ''}
    </Badge>
  );
  return f.detail ? (
    <Tooltip label={f.detail} multiline maw={360} withArrow>
      {badge}
    </Tooltip>
  ) : (
    badge
  );
}

export function FlagList({ flags }: { flags: (Flag | string)[] | undefined }) {
  if (!flags || flags.length === 0) return null;
  return (
    <Group gap={6}>
      {flags.map((f, i) => (
        <FlagBadge key={i} flag={f} />
      ))}
    </Group>
  );
}
