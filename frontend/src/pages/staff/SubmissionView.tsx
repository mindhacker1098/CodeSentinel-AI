import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Anchor,
  Badge,
  Box,
  Button,
  Group,
  Loader,
  Modal,
  NumberInput,
  Paper,
  Progress,
  Stack,
  Text,
  Textarea,
  Tooltip,
} from '@mantine/core';
import { useHotkeys } from '@mantine/hooks';
import {
  IconArrowLeft,
  IconArrowRight,
  IconCheck,
  IconFlag,
  IconMessage,
  IconPencil,
  IconRefresh,
  IconX,
} from '@tabler/icons-react';
import { api, parseId, type GradingStage, type SubmissionDetail } from '../../api/client';
import { useJobEvents } from '../../api/sse';
import { ErrorState, PageHeader, PageSkeleton } from '../../components';
import { fmtDate, fmtGrade, fmtRelative } from '../../format';
import { notify } from '../../notify';
import ReportPage from '../student/ReportPage';
import { FlagReviewModal } from './FlagReview';
import { plural, useInvalidate, WhyDisabled } from './common';


const STAGES: GradingStage[] = ['queued', 'compile', 'tests', 'memory', 'quality', 'review', 'done'];
const STAGE_TEXT: Record<GradingStage, string> = {
  queued: 'Waiting for a worker',
  compile: 'Compiling',
  tests: 'Running tests',
  memory: 'Checking memory',
  quality: 'Checking code quality',
  review: 'Reviewing',
  done: 'Done',
};

/** In-page progress of a regrade, from the live stage stream; refreshes the report when it ends. */
function RegradeBanner({ jobId, sid, onClose }: { jobId: number; sid: number; onClose: () => void }) {
  const ev = useJobEvents(jobId);
  const qc = useQueryClient();
  const invalidate = useInvalidate();
  const announced = useRef(false);
  const stage = ev.stage?.stage ?? (ev.status === 'running' ? 'compile' : 'queued');
  const idx = Math.max(0, STAGES.indexOf(stage));
  const finished = ev.done || ev.status === 'done' || ev.status === 'failed' || ev.status === 'cancelled';
  const failed = ev.status === 'failed' || ev.status === 'cancelled';

  useEffect(() => {
    if (!finished || announced.current) return;
    announced.current = true;
    qc.invalidateQueries({ queryKey: ['submission', sid] });
    invalidate(['staff', 'submissions'], ['staff', 'gradebook'], ['staff', 'queue']);
    if (failed) notify.error(new Error(`Regrade ${ev.status === 'cancelled' ? 'was cancelled' : 'failed'}. See the queue for the reason.`));
    else notify.success(ev.result ? `Regrade finished: ${fmtGrade(ev.result.grade)} / 100` : 'Regrade finished');
  }, [finished]); // eslint-disable-line react-hooks/exhaustive-deps

  const pct = finished ? 100 : Math.round(((idx + 0.5) / (STAGES.length - 1)) * 100);
  return (
    <Paper p="sm" role="status" aria-live="polite" style={{ borderColor: failed ? 'var(--ag-fail)' : finished ? 'var(--ag-pass)' : 'var(--ag-info)' }}>
      <Group justify="space-between" wrap="nowrap" mb={8}>
        <Group gap="xs" wrap="nowrap">
          {finished ? failed ? <IconX size={18} color="var(--ag-fail)" /> : <IconCheck size={18} color="var(--ag-pass)" /> : <Loader size={16} color="info" />}
          <Text size="sm" fw={500}>
            {finished
              ? failed
                ? `Regrade ${ev.status === 'cancelled' ? 'cancelled' : 'failed'}`
                : `Regraded${ev.result ? `: ${fmtGrade(ev.result.grade)} / 100` : ''}`
              : `Regrading: ${ev.stage?.label || STAGE_TEXT[stage]}`}
          </Text>
        </Group>
        {finished && (
          <Button size="compact-sm" variant="subtle" onClick={onClose}>
            Hide
          </Button>
        )}
      </Group>
      <Progress value={pct} color={failed ? 'fail' : finished ? 'pass' : 'info'} size="sm" animated={!finished} aria-label="Regrade progress" />
      <Group gap={0} mt={6} justify="space-between" visibleFrom="sm">
        {STAGES.slice(1).map((s, i) => (
          <Text key={s} size="xs" c={i + 1 <= idx || finished ? 'var(--ag-text)' : 'dimmed'}>
            {STAGE_TEXT[s]}
          </Text>
        ))}
      </Group>
      {ev.error && !finished && (
        <Text size="sm" c="dimmed" mt={6}>
          {ev.error}
        </Text>
      )}
    </Paper>
  );
}

function OverrideModal({ sub, opened, onClose }: { sub: SubmissionDetail; opened: boolean; onClose: () => void }) {
  const [grade, setGrade] = useState<number | string>('');
  const [reason, setReason] = useState('');
  const [tried, setTried] = useState(false);
  useEffect(() => {
    if (opened) {
      setGrade(sub.override?.grade ?? sub.effective_grade ?? sub.grade ?? '');
      setReason(sub.override?.reason ?? '');
      setTried(false);
    }
  }, [opened]); // eslint-disable-line react-hooks/exhaustive-deps
  const qc = useQueryClient();
  const invalidate = useInvalidate();
  const roll = sub.user?.roll_no ?? '';
  const m = useMutation({
    mutationFn: (clear: boolean) =>
      api.staff.updateSubmission(sub.id, clear ? { override_grade: null } : { override_grade: Number(grade), override_reason: reason.trim() }),
    onSuccess: (_r, clear) => {
      notify.success(clear ? `Override removed for ${roll}` : `Grade overridden for ${roll}: ${fmtGrade(Number(grade))} / 100`);
      qc.invalidateQueries({ queryKey: ['submission', sub.id] });
      invalidate(['staff', 'submissions'], ['staff', 'gradebook'], ['staff', 'leaderboard']);
      onClose();
    },
    onError: (e) => notify.error(e),
  });
  const gradeErr = grade === '' || Number(grade) < 0 || Number(grade) > 100 ? 'Enter a grade from 0 to 100.' : null;
  const reasonErr = !reason.trim() ? 'Give a reason. The student sees it next to the grade.' : null;
  return (
    <Modal opened={opened} onClose={onClose} title="Override the grade" size="md">
      <form
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          setTried(true);
          if (!gradeErr && !reasonErr) m.mutate(false);
        }}
      >
        <Stack gap="sm">
          <Text size="sm" c="dimmed">
            Computed grade {fmtGrade(sub.grade)} / 100. Overrides survive regrades.
          </Text>
          <NumberInput
            label="Grade"
            min={0}
            max={100}
            step={0.5}
            decimalScale={1}
            value={grade}
            onChange={setGrade}
            rightSection={<Text size="sm" c="dimmed" pr={8}>/ 100</Text>}
            rightSectionWidth={56}
            error={tried && gradeErr}
            data-autofocus
            required
          />
          <Textarea
            label="Reason"
            description="Visible to the student"
            value={reason}
            onChange={(e) => setReason(e.currentTarget.value)}
            autosize
            minRows={2}
            maxLength={2000}
            error={tried && reasonErr}
            required
          />
          <Group justify="space-between" mt="xs">
            {sub.override ? (
              <Button variant="subtle" color="fail" onClick={() => m.mutate(true)} loading={m.isPending && m.variables === true}>
                Remove override
              </Button>
            ) : (
              <span />
            )}
            <Group gap="xs">
              <Button variant="default" onClick={onClose}>
                Cancel
              </Button>
              <Button type="submit" loading={m.isPending && m.variables === false}>
                Override grade
              </Button>
            </Group>
          </Group>
        </Stack>
      </form>
    </Modal>
  );
}

function CommentModal({ sub, opened, onClose }: { sub: SubmissionDetail; opened: boolean; onClose: () => void }) {
  const [text, setText] = useState('');
  useEffect(() => {
    if (opened) setText(sub.staff_comment?.text ?? '');
  }, [opened]); // eslint-disable-line react-hooks/exhaustive-deps
  const qc = useQueryClient();
  const roll = sub.user?.roll_no ?? '';
  const m = useMutation({
    mutationFn: (value: string) => api.staff.updateSubmission(sub.id, { comment: value }),
    onSuccess: (_r, value) => {
      notify.success(value.trim() ? `Comment sent to ${roll}` : `Comment removed for ${roll}`);
      qc.invalidateQueries({ queryKey: ['submission', sub.id] });
      onClose();
    },
    onError: (e) => notify.error(e),
  });
  return (
    <Modal opened={opened} onClose={onClose} title={`Comment to ${roll}`} size="lg">
      <Stack gap="sm">
        <Textarea
          label="Comment"
          description="Visible to the student"
          value={text}
          onChange={(e) => setText(e.currentTarget.value)}
          autosize
          minRows={4}
          maxLength={5000}
          data-autofocus
        />
        <Group justify="space-between">
          {sub.staff_comment ? (
            <Button variant="subtle" color="fail" onClick={() => m.mutate('')} loading={m.isPending && m.variables === ''}>
              Remove comment
            </Button>
          ) : (
            <span />
          )}
          <Group gap="xs">
            <Button variant="default" onClick={onClose}>
              Cancel
            </Button>
            <Button onClick={() => m.mutate(text)} disabled={!text.trim()} loading={m.isPending && m.variables !== ''}>
              {sub.staff_comment ? 'Update comment' : 'Send comment'}
            </Button>
          </Group>
        </Group>
      </Stack>
    </Modal>
  );
}

export default function SubmissionView() {
  const { id } = useParams();
  const sid = parseId(id) ?? 0;
  const nav = useNavigate();
  const sub = useQuery({ queryKey: ['submission', sid], queryFn: () => api.submission(sid), enabled: sid > 0 });
  const d = sub.data;
  const slug = d?.problem_slug;
  const roll = d?.user?.roll_no;

  // every attempt of this student on this problem (for the attempt number, prev/next and the flag ids)
  const attempts = useQuery({
    queryKey: ['staff', 'submissions', 'attempts', slug, roll],
    queryFn: () => api.staff.submissions({ problem: slug, q: roll, page_size: 500, sort: '-created' }),
    enabled: !!slug && !!roll,
    select: (p) => p.items.filter((r) => r.user_id === d?.user?.id).sort((a, b) => a.id - b.id),
  });
  const list = attempts.data ?? [];
  const pos = list.findIndex((r) => r.id === sid);
  const row = pos >= 0 ? list[pos] : undefined;
  const prev = pos > 0 ? list[pos - 1] : undefined;
  const next = pos >= 0 && pos < list.length - 1 ? list[pos + 1] : undefined;

  const [jobId, setJobId] = useState<number | null>(null);
  useEffect(() => setJobId(null), [sid]);
  const invalidate = useInvalidate();
  const regrade = useMutation({
    mutationFn: () => api.staff.regrade({ submission_ids: [sid] }),
    onSuccess: (r) => {
      if (r.job_ids.length) {
        setJobId(r.job_ids[0]);
        notify.success(`Regrade queued for ${roll ?? `submission ${sid}`}`);
        invalidate(['staff', 'queue']);
      } else notify.error(new Error('Still grading. Try again when it finishes.'));
    },
    onError: (e) => notify.error(e),
  });
  const [modal, setModal] = useState<'override' | 'comment' | 'flags' | null>(null);
  useHotkeys([
    ['[', () => prev && nav(`/staff/submissions/${prev.id}`)],
    [']', () => next && nav(`/staff/submissions/${next.id}`)],
  ]);

  if (sub.error) return <ErrorState error={sub.error} onRetry={() => sub.refetch()} backTo="/staff/submissions" backLabel="Back to submissions" />;
  if (!d) return <PageSkeleton />;

  const grading = d.job_status === 'queued' || d.job_status === 'running';
  const flags = row?.flags ?? [];
  const liveFlags = flags.filter((f) => f.review_status !== 'dismissed');
  const name = d.user ? `${d.user.roll_no} ${d.user.name}` : `Submission ${sid}`;

  return (
    <Stack gap="md">
      <PageHeader
        title={
          <Group gap="sm" component="span" wrap="wrap">
            <span className="ag-mono" style={{ fontSize: '0.85em' }}>
              {d.user?.roll_no}
            </span>
            <span>{d.user?.name ?? `Submission ${sid}`}</span>
          </Group>
        }
        documentTitle={`${name}, ${d.problem_title ?? slug}`}
        breadcrumbs={[{ label: 'Grading' }, { label: 'Submissions', to: '/staff/submissions' }, { label: `Submission ${sid}` }]}
        description={
          <>
            <Anchor component={Link} to={`/staff/problems/${slug}`}>
              {d.problem_title ?? slug}
            </Anchor>
            {pos >= 0 && `, attempt ${pos + 1} of ${list.length}`}
            {', '}
            <Tooltip label={fmtDate(d.created_at)}>
              <span>submitted {fmtRelative(d.created_at)}</span>
            </Tooltip>
            {d.filename && (
              <>
                {' as '}
                <span className="ag-mono" style={{ fontSize: 13 }}>
                  {d.filename}
                </span>
              </>
            )}
          </>
        }
        actions={
          <>
            <WhyDisabled reason={grading && 'Grading in progress'}>
              <Button
                variant="default"
                leftSection={<IconRefresh size={16} />}
                loading={regrade.isPending}
                disabled={grading}
                onClick={() => regrade.mutate()}
              >
                Regrade
              </Button>
            </WhyDisabled>
            <Button variant="default" leftSection={<IconPencil size={16} />} onClick={() => setModal('override')}>
              {d.override ? 'Edit override' : 'Override grade'}
            </Button>
            <Button variant="default" leftSection={<IconMessage size={16} />} onClick={() => setModal('comment')}>
              {d.staff_comment ? 'Edit comment' : 'Comment'}
            </Button>
            <WhyDisabled reason={!liveFlags.length && 'No flags'}>
              <Button
                leftSection={<IconFlag size={16} />}
                color={liveFlags.some((f) => f.review_status === 'open') ? 'warn' : 'iris'}
                variant={liveFlags.some((f) => f.review_status === 'open') ? 'filled' : 'default'}
                disabled={!liveFlags.length}
                onClick={() => setModal('flags')}
              >
                {liveFlags.length ? `Review ${plural(liveFlags.length, 'flag')}` : 'Review flags'}
              </Button>
            </WhyDisabled>
          </>
        }
      >
        {(d.is_late || list.length > 1) && (
        <Group gap="md" wrap="wrap" justify="space-between">
          <Group gap="md" wrap="wrap">
            {d.is_late && (
              <Badge color="warn" variant="outline" radius="sm">
                Late
              </Badge>
            )}
          </Group>
          {list.length > 1 && <Group gap="xs" wrap="nowrap">
            <Tooltip label={prev ? `Attempt ${pos} (press [)` : 'This is the first attempt'}>
              <span>
                <Button
                  size="xs"
                  variant="subtle"
                  leftSection={<IconArrowLeft size={14} />}
                  disabled={!prev}
                  onClick={() => prev && nav(`/staff/submissions/${prev.id}`)}
                >
                  Previous attempt
                </Button>
              </span>
            </Tooltip>
            <Tooltip label={next ? `Attempt ${pos + 2} (press ])` : 'This is the latest attempt'}>
              <span>
                <Button
                  size="xs"
                  variant="subtle"
                  rightSection={<IconArrowRight size={14} />}
                  disabled={!next}
                  onClick={() => next && nav(`/staff/submissions/${next.id}`)}
                >
                  Next attempt
                </Button>
              </span>
            </Tooltip>
          </Group>}
        </Group>
        )}
      </PageHeader>

      {jobId && <RegradeBanner key={jobId} jobId={jobId} sid={sid} onClose={() => setJobId(null)} />}

      <Box>
        <ReportPage id={sid} staff hideHeader problemHref={(s) => `/staff/problems/${encodeURIComponent(s)}`} />
      </Box>

      <OverrideModal sub={d} opened={modal === 'override'} onClose={() => setModal(null)} />
      <CommentModal sub={d} opened={modal === 'comment'} onClose={() => setModal(null)} />
      {slug && (
        <FlagReviewModal opened={modal === 'flags'} onClose={() => setModal(null)} submissionId={sid} problemSlug={slug} flags={flags} />
      )}
    </Stack>
  );
}
