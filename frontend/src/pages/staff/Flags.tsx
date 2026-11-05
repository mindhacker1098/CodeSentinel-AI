import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { keepPreviousData, useMutation, useQuery } from '@tanstack/react-query';
import { Alert, Anchor, Button, Checkbox, Group, Modal, SegmentedControl, Stack, Text, Textarea, Tooltip } from '@mantine/core';
import { IconFlagCheck, IconFlagOff, IconScale, IconShieldCheck } from '@tabler/icons-react';
import { api, type FlagRef, type FlagReviewStatus, type StaffSubmissionRow } from '../../api/client';
import {
  EmptyState,
  ErrorState,
  FlagBadge,
  GradeDisplay,
  PageHeader,
  ResponsiveTable,
  StatusChip,
  type Column,
} from '../../components';
import { fmtDate, fmtRelative } from '../../format';
import { notify } from '../../notify';
import { FlagReviewModal } from './FlagReview';
import {
  FLAG_KEYS,
  flagName,
  isCopyFlag,
  penaltyEffect,
  plural,
  ProblemSelect,
  useInvalidate,
  useParam,
  useProblems,
  WhyDisabled,
} from './common';

interface Row {
  s: StaffSubmissionRow;
  f: FlagRef;
}

/** Note + confirm/dismiss for many flags at once. */
export function BulkDecisionModal({
  opened,
  onClose,
  flagIds,
  status,
  copy,
  penaltyText,
  target,
  onDone,
}: {
  opened: boolean;
  onClose: () => void;
  flagIds: number[];
  status: Extract<FlagReviewStatus, 'confirmed' | 'dismissed'>;
  /** Some of the flags are copy flags (the penalty applies). */
  copy: boolean;
  penaltyText: string;
  /** What is acted on, e.g. "Cluster 2: S01, S04, S09". */
  target?: string;
  onDone?: () => void;
}) {
  const [note, setNote] = useState('');
  const invalidate = useInvalidate();
  const n = flagIds.length;
  const verb = status === 'confirmed' ? 'Confirm' : 'Dismiss';
  const m = useMutation({
    mutationFn: () => api.staff.bulkFlags({ flag_ids: flagIds, review_status: status, review_note: note.trim() || undefined }),
    onSuccess: (r) => {
      notify.success(`${status === 'confirmed' ? 'Confirmed' : 'Dismissed'} ${plural(r.updated, 'flag')}`);
      invalidate(...FLAG_KEYS);
      setNote('');
      onDone?.();
      onClose();
    },
    onError: (e) => notify.error(e),
  });
  return (
    <Modal opened={opened} onClose={onClose} title={`${verb} ${plural(n, 'flag')}?`} size="md">
      <Stack gap="sm">
        {target && (
          <Text fw={600} px="sm" py={8} style={{ border: '1px solid var(--ag-line)', borderRadius: 4, background: 'var(--ag-bg)' }}>
            {target}
          </Text>
        )}
        {status === 'confirmed' && copy && (
          <Alert color="warn" variant="light" icon={<IconScale size={18} />} p="xs">
            {penaltyText}
          </Alert>
        )}
        <Textarea
          label="Review note"
          description="Staff only"
          value={note}
          onChange={(e) => setNote(e.currentTarget.value)}
          autosize
          minRows={2}
          maxLength={2000}
          data-autofocus
        />
        <Group justify="flex-end" gap="xs">
          <Button variant="default" onClick={onClose}>
            Cancel
          </Button>
          <Button
            color={status === 'confirmed' ? 'fail' : 'iris'}
            leftSection={status === 'confirmed' ? <IconFlagCheck size={16} /> : <IconFlagOff size={16} />}
            loading={m.isPending}
            onClick={() => m.mutate()}
          >
            {verb} {plural(n, 'flag')}
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}

/** Review queue: every flag on a current result. */
export default function Flags() {
  const [problem, setProblem] = useParam('problem');
  const [status, setStatus] = useParam('status', 'open');
  const problems = useProblems();
  const q = useQuery({
    queryKey: ['staff', 'submissions', 'flags', problem, status],
    queryFn: () =>
      api.staff.submissions({ problem: problem || undefined, flag: status === 'open' ? 'open' : 'any', page_size: 1000 }),
    placeholderData: keepPreviousData,
  });
  const rows: Row[] = useMemo(
    () =>
      (q.data?.items ?? []).flatMap((s) =>
        s.flags.filter((f) => status === 'all' || f.review_status === status).map((f) => ({ s, f })),
      ),
    [q.data, status],
  );
  const [sel, setSel] = useState<Set<number>>(new Set());
  const chosen = rows.filter((r) => sel.has(r.f.id));
  const allOn = rows.length > 0 && chosen.length === rows.length;
  const [bulk, setBulk] = useState<'confirmed' | 'dismissed' | null>(null);
  const [review, setReview] = useState<Row | null>(null);

  const penaltyFor = (slug: string) => problems.data?.find((p) => p.slug === slug)?.integrity_penalty;
  const slugs = [...new Set(chosen.filter((r) => isCopyFlag(r.f.type)).map((r) => r.s.problem_slug))];
  const penaltyText =
    slugs.length === 1
      ? penaltyEffect(penaltyFor(slugs[0]))
      : "Applies each problem's integrity penalty.";

  const toggle = (id: number) =>
    setSel((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  const cols: Column<Row>[] = [
    {
      key: 'sel',
      header: (
        <Checkbox
          aria-label="Select every flag"
          checked={allOn}
          indeterminate={chosen.length > 0 && !allOn}
          onChange={() => setSel(allOn ? new Set() : new Set(rows.map((r) => r.f.id)))}
        />
      ),
      width: 36,
      hideOnCard: true,
      cell: (r) => <Checkbox aria-label={`Select flag ${flagName(r.f.type)} on ${r.s.roll_no}`} checked={sel.has(r.f.id)} onChange={() => toggle(r.f.id)} />,
    },
    { key: 'flag', header: 'Flag', cell: (r) => <FlagBadge flag={{ type: r.f.type, review_status: r.f.review_status }} /> },
    {
      key: 'student',
      header: 'Student',
      cell: (r) => (
        <Anchor component={Link} to={`/staff/submissions/${r.s.id}`} size="sm" style={{ whiteSpace: 'nowrap' }}>
          <span className="ag-mono">{r.s.roll_no}</span> {r.s.name}
        </Anchor>
      ),
    },
    { key: 'problem', header: 'Problem', cell: (r) => r.s.problem_title },
    {
      key: 'time',
      header: 'Submitted',
      cell: (r) => (
        <Tooltip label={fmtDate(r.s.created_at)}>
          <Text size="sm" c="dimmed" span>
            {fmtRelative(r.s.created_at)}
          </Text>
        </Tooltip>
      ),
    },
    {
      key: 'grade',
      header: 'Grade',
      cell: (r) => <GradeDisplay grade={r.s.grade} effectiveGrade={r.s.effective_grade} override={r.s.overridden} size="sm" />,
    },
    { key: 'state', header: 'State', cell: (r) => <StatusChip kind="flag" status={r.f.review_status} size="sm" /> },
  ];

  const noSel = 'Select flags first';
  return (
    <Stack gap="md">
      <PageHeader
        title="Flag review"
        breadcrumbs={[{ label: 'Integrity' }, { label: 'Flag review' }]}
        actions={
          <>
            <WhyDisabled reason={!chosen.length && noSel}>
              <Button variant="default" leftSection={<IconFlagOff size={16} />} disabled={!chosen.length} onClick={() => setBulk('dismissed')}>
                {chosen.length ? `Dismiss ${plural(chosen.length, 'flag')}` : 'Dismiss selected'}
              </Button>
            </WhyDisabled>
            <WhyDisabled reason={!chosen.length && noSel}>
              <Button color="fail" leftSection={<IconFlagCheck size={16} />} disabled={!chosen.length} onClick={() => setBulk('confirmed')}>
                {chosen.length ? `Confirm ${plural(chosen.length, 'flag')}` : 'Confirm selected'}
              </Button>
            </WhyDisabled>
          </>
        }
      />
      <Group gap="sm" align="flex-end" wrap="wrap">
        <ProblemSelect label="Problem" value={problem || null} onChange={(v) => { setProblem(v); setSel(new Set()); }} allowAll />
        <Stack gap={4}>
          <Text size="sm" fw={500}>
            Show
          </Text>
          <SegmentedControl
            aria-label="Review state"
            data={[
              { value: 'open', label: 'Needs review' },
              { value: 'confirmed', label: 'Confirmed' },
              { value: 'all', label: 'All' },
            ]}
            value={status}
            onChange={(v) => {
              setStatus(v === 'open' ? null : v);
              setSel(new Set());
            }}
          />
        </Stack>
      </Group>
      {q.error ? (
        <ErrorState error={q.error} onRetry={() => q.refetch()} backTo={false} />
      ) : (
        <ResponsiveTable
          data={rows}
          columns={cols}
          rowKey={(r) => r.f.id}
          loading={q.isPending}
          minWidth={820}
          caption="Flags"
          rowActions={(r) => (
            <Button size="compact-sm" variant="light" onClick={() => setReview(r)}>
              Review
            </Button>
          )}
          rowStyle={(r) => (sel.has(r.f.id) ? { background: 'rgba(139,156,255,0.08)' } : undefined)}
          cardTitle={(r) => (
            <Group gap="xs" wrap="nowrap">
              <Checkbox aria-label={`Select flag on ${r.s.roll_no}`} checked={sel.has(r.f.id)} onChange={() => toggle(r.f.id)} />
              <FlagBadge flag={{ type: r.f.type, review_status: r.f.review_status }} />
            </Group>
          )}
          empty={
            <EmptyState
              compact
              icon={IconShieldCheck}
              title={status === 'open' ? 'Nothing to review' : 'No flags'}
              action={
                <Button component={Link} to="/staff/plagiarism" variant="default">
                  Run a plagiarism scan
                </Button>
              }
            />
          }
        />
      )}
      <BulkDecisionModal
        opened={bulk !== null}
        onClose={() => setBulk(null)}
        flagIds={chosen.map((r) => r.f.id)}
        status={bulk ?? 'dismissed'}
        copy={chosen.some((r) => isCopyFlag(r.f.type))}
        penaltyText={penaltyText}
        target={`${plural(chosen.length, 'flag')} on ${plural(new Set(chosen.map((r) => r.s.user_id)).size, 'student')}`}
        onDone={() => setSel(new Set())}
      />
      {review && (
        <FlagReviewModal
          opened
          onClose={() => setReview(null)}
          submissionId={review.s.id}
          problemSlug={review.s.problem_slug}
          flags={q.data?.items.find((s) => s.id === review.s.id)?.flags ?? review.s.flags}
          focusFlagId={review.f.id}
        />
      )}
    </Stack>
  );
}
