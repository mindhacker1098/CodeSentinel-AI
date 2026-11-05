import { useEffect, useState } from 'react';
import { Group, Text, Tooltip } from '@mantine/core';
import { IconClock, IconLock } from '@tabler/icons-react';
import { fmtDate } from '../format';

export interface CountdownProps {
  /** ISO date string or Date of the deadline. null means no deadline. */
  to: string | Date | null | undefined;
  /** Prefix while open, default "Due in". */
  prefix?: string;
  /** Text after the deadline, default "Closed". */
  closedLabel?: string;
  /** Hide the clock icon. */
  noIcon?: boolean;
  size?: 'sm' | 'md';
}

function parts(ms: number): string {
  const m = Math.floor(ms / 60_000);
  const d = Math.floor(m / 1440);
  const h = Math.floor((m % 1440) / 60);
  const min = m % 60;
  const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`;
  if (d >= 2) return plural(d, 'day');
  if (d === 1) return h ? `1 day ${plural(h, 'hour')}` : '1 day';
  if (h >= 1) return min ? `${plural(h, 'hour')} ${min} min` : plural(h, 'hour');
  if (min >= 1) return `${min} min`;
  return 'under a minute';
}

/** Time to a deadline: muted when far, warn under 24 h, fail under 1 h. Updates itself. */
export function Countdown({ to, prefix = 'Due in', closedLabel = 'Closed', noIcon, size = 'sm' }: CountdownProps) {
  const target = to ? new Date(to).getTime() : NaN;
  const [now, setNow] = useState(() => Date.now());
  const left = target - now;
  useEffect(() => {
    if (Number.isNaN(target)) return;
    const every = left < 3_600_000 ? 15_000 : 60_000;
    const id = window.setInterval(() => setNow(Date.now()), every);
    return () => window.clearInterval(id);
  }, [target, left < 3_600_000]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!to || Number.isNaN(target)) {
    return (
      <Text size={size} c="dimmed">
        No deadline
      </Text>
    );
  }
  const past = left <= 0;
  const color = past ? 'dimmed' : left < 3_600_000 ? 'fail.5' : left < 86_400_000 ? 'warn.5' : 'dimmed';
  const I = past ? IconLock : IconClock;
  const text = past ? `${closedLabel} ${parts(-left)} ago` : `${prefix} ${parts(left)}`;
  const iso = new Date(target).toISOString();
  return (
    <Tooltip label={fmtDate(iso)}>
      <Group gap={4} wrap="nowrap" c={color} component="span" style={{ display: 'inline-flex' }} tabIndex={0}>
        {!noIcon && <I size={size === 'sm' ? 14 : 16} stroke={1.8} aria-hidden />}
        <Text size={size} c={color} component="time" dateTime={iso} style={{ whiteSpace: 'nowrap' }}>
          {text}
        </Text>
      </Group>
    </Tooltip>
  );
}
