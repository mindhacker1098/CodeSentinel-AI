import { Badge, Box, Group, Stack, Text, Tooltip } from '@mantine/core';
import { IconAlertTriangle, IconClockHour4, IconPencil } from '@tabler/icons-react';
import { fmtGrade } from '../format';

export interface GradeDisplayProps {
  /** The computed grade (0-100) or null when not graded. */
  grade: number | null | undefined;
  /** Override or penalty result; shown instead of `grade` when it differs. */
  effectiveGrade?: number | null;
  /** May change after the deadline regrade. */
  provisional?: boolean;
  /** Some checks could not run and scored 0 ("partial" in the API). */
  incomplete?: boolean;
  /** A staff override is in place; pass the reason for the tooltip. */
  override?: { reason?: string | null; by?: string | null } | boolean | null;
  /** lg: the 40px numeral for the report header. md/sm: a chip for tables and cards. */
  size?: 'lg' | 'md' | 'sm';
  max?: number;
  /** Text when there is no grade. */
  emptyLabel?: string;
}

export function gradeTone(g: number | null | undefined): 'pass' | 'warn' | 'fail' | 'gray' {
  if (g === null || g === undefined || Number.isNaN(g)) return 'gray';
  if (g >= 80) return 'pass';
  if (g >= 40) return 'warn';
  return 'fail';
}

const TIPS = {
  provisional: 'May change after the post-deadline regrade.',
  incomplete: 'Some checks could not run and scored 0.',
};

/** Grade numeral (lg) or chip (md/sm). Never truncates; states are icons plus words. */
export function GradeDisplay({
  grade,
  effectiveGrade,
  provisional,
  incomplete,
  override,
  size = 'md',
  max = 100,
  emptyLabel = 'Not graded',
}: GradeDisplayProps) {
  const overridden = !!override;
  const hasEffective = effectiveGrade !== undefined && effectiveGrade !== null && effectiveGrade !== grade;
  const shown = hasEffective ? effectiveGrade : grade;
  const tone = gradeTone(shown);
  const overrideReason = typeof override === 'object' && override ? override.reason : null;
  const overrideTip = overridden
    ? `Set by staff${typeof override === 'object' && override?.by ? ` (${override.by})` : ''}${overrideReason ? `: ${overrideReason}` : '.'}`
    : hasEffective
      ? 'Adjusted after an integrity review.'
      : null;

  if (size === 'lg') {
    return (
      <Stack gap={6}>
        <Group gap={6} align="baseline" wrap="nowrap">
          {shown === null || shown === undefined ? (
            <Text fz={40} fw={600} lh={1} c="dimmed">
              -
            </Text>
          ) : (
            <Text fz={40} fw={600} lh={1} c={`${tone}.5`} className="ag-num" style={{ whiteSpace: 'nowrap' }}>
              {fmtGrade(shown)}
            </Text>
          )}
          <Text fz={16} c="dimmed" className="ag-num">
            / {max}
          </Text>
          {(hasEffective || overridden) && grade !== null && grade !== undefined && grade !== shown && (
            <Text fz={16} c="dimmed" td="line-through" className="ag-num" aria-label={`Computed grade ${fmtGrade(grade)}`}>
              {fmtGrade(grade)}
            </Text>
          )}
        </Group>
        <StateChips provisional={provisional} incomplete={incomplete} overrideTip={overrideTip} overridden={overridden} />
      </Stack>
    );
  }

  if (shown === null || shown === undefined) {
    return (
      <Text size="sm" c="dimmed" style={{ whiteSpace: 'nowrap' }}>
        {emptyLabel}
      </Text>
    );
  }

  const label = `${fmtGrade(shown)}${provisional ? ', provisional' : ''}${incomplete ? ', incomplete grading' : ''}${overridden ? ', set by staff' : ''}`;
  const tips = [provisional && TIPS.provisional, incomplete && TIPS.incomplete, overrideTip].filter(Boolean).join(' ');
  const chip = (
    <Badge
      size={size === 'sm' ? 'md' : 'lg'}
      variant={provisional ? 'outline' : 'light'}
      color={tone}
      radius="sm"
      aria-label={`Grade ${label}`}
      leftSection={incomplete ? <IconAlertTriangle size={12} aria-hidden /> : overridden ? <IconPencil size={12} aria-hidden /> : undefined}
      rightSection={provisional ? <IconClockHour4 size={12} aria-hidden /> : undefined}
      styles={{ root: { overflow: 'visible', maxWidth: 'none', borderStyle: provisional ? 'dashed' : undefined }, label: { overflow: 'visible' } }}
      className="ag-num"
    >
      {fmtGrade(shown)}
    </Badge>
  );
  return tips ? (
    <Tooltip label={tips}>
      <Box component="span" style={{ display: 'inline-flex' }} tabIndex={0}>
        {chip}
      </Box>
    </Tooltip>
  ) : (
    chip
  );
}

function StateChips({
  provisional,
  incomplete,
  overridden,
  overrideTip,
}: {
  provisional?: boolean;
  incomplete?: boolean;
  overridden?: boolean;
  overrideTip: string | null;
}) {
  if (!provisional && !incomplete && !overrideTip) return null;
  return (
    <Group gap={6}>
      {provisional && (
        <Tooltip label={TIPS.provisional}>
          <Badge variant="outline" color="info" leftSection={<IconClockHour4 size={12} />} tabIndex={0} style={{ borderStyle: 'dashed' }}>
            Provisional
          </Badge>
        </Tooltip>
      )}
      {incomplete && (
        <Tooltip label={TIPS.incomplete}>
          <Badge color="warn" leftSection={<IconAlertTriangle size={12} />} tabIndex={0}>
            Incomplete grading
          </Badge>
        </Tooltip>
      )}
      {overrideTip && (
        <Tooltip label={overrideTip}>
          <Badge color="iris" leftSection={<IconPencil size={12} />} tabIndex={0}>
            {overridden ? 'Set by staff' : 'Adjusted'}
          </Badge>
        </Tooltip>
      )}
    </Group>
  );
}
