import { Badge, Loader } from '@mantine/core';
import {
  IconBan,
  IconCheck,
  IconCircleDashed,
  IconClock,
  IconFlag,
  IconFlagCheck,
  IconFlagOff,
  IconX,
  type Icon,
} from '@tabler/icons-react';
import type { FlagReviewStatus, JobStatus } from '../api/types';

type Tone = 'pass' | 'fail' | 'warn' | 'info' | 'gray' | 'iris';

interface ChipSpec {
  tone: Tone;
  icon: Icon | 'spinner';
  label: string;
}

/** Students never see "job" or "worker": the wording comes from their side. */
const JOB_STAFF: Record<JobStatus, ChipSpec> = {
  queued: { tone: 'info', icon: IconClock, label: 'Queued' },
  running: { tone: 'info', icon: 'spinner', label: 'Running' },
  done: { tone: 'pass', icon: IconCheck, label: 'Done' },
  failed: { tone: 'fail', icon: IconX, label: 'Failed' },
  cancelled: { tone: 'gray', icon: IconBan, label: 'Cancelled' },
};

const JOB_STUDENT: Record<JobStatus, ChipSpec> = {
  queued: { tone: 'info', icon: IconClock, label: 'Waiting to grade' },
  running: { tone: 'info', icon: 'spinner', label: 'Grading' },
  done: { tone: 'pass', icon: IconCheck, label: 'Graded' },
  failed: { tone: 'fail', icon: IconX, label: 'Grading failed' },
  cancelled: { tone: 'gray', icon: IconBan, label: 'Grading cancelled' },
};

const FLAG: Record<FlagReviewStatus, ChipSpec> = {
  open: { tone: 'warn', icon: IconFlag, label: 'Needs review' },
  confirmed: { tone: 'fail', icon: IconFlagCheck, label: 'Confirmed' },
  dismissed: { tone: 'gray', icon: IconFlagOff, label: 'Dismissed' },
};

export type StatusChipProps =
  | { kind: 'job'; status: JobStatus | null | undefined; audience?: 'student' | 'staff'; label?: string; size?: 'sm' | 'md' }
  | { kind: 'flag'; status: FlagReviewStatus | null | undefined; label?: string; size?: 'sm' | 'md' }
  | { kind: 'custom'; tone: Tone; icon: Icon; label: string; size?: 'sm' | 'md' };

/** A state chip: icon + words + tone. Never colour alone. */
export function StatusChip(props: StatusChipProps) {
  let spec: ChipSpec;
  if (props.kind === 'custom') {
    spec = { tone: props.tone, icon: props.icon, label: props.label };
  } else if (props.kind === 'job') {
    const table = props.audience === 'student' ? JOB_STUDENT : JOB_STAFF;
    spec = props.status ? table[props.status] : { tone: 'gray', icon: IconCircleDashed, label: 'Not graded' };
    if (props.label) spec = { ...spec, label: props.label };
  } else {
    spec = FLAG[props.status ?? 'open'];
    if (props.label) spec = { ...spec, label: props.label };
  }
  const size = props.size ?? 'md';
  const iconSize = size === 'sm' ? 11 : 13;
  const left =
    spec.icon === 'spinner' ? (
      <Loader size={iconSize - 2} color={spec.tone} type="oval" aria-hidden />
    ) : (
      <spec.icon size={iconSize} stroke={2} aria-hidden />
    );
  return (
    <Badge color={spec.tone} variant="light" size={size} leftSection={left} styles={{ root: { overflow: 'visible' }, label: { overflow: 'visible' } }}>
      {spec.label}
    </Badge>
  );
}
