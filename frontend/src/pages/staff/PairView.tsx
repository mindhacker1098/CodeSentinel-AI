import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useMutation, useQueries, useQuery } from '@tanstack/react-query';
import { useHotkeys } from '@mantine/hooks';
import {
  Anchor,
  Badge,
  Box,
  Button,
  Group,
  Kbd,
  Paper,
  Stack,
  Table,
  Text,
  TextInput,
  Tooltip,
} from '@mantine/core';
import { IconArrowLeft, IconChevronLeft, IconChevronRight, IconFlagCheck, IconFlagOff, IconScale } from '@tabler/icons-react';
import { api, type RefLabel, type StaffFlag } from '../../api/client';
import { confirm, EmptyState, ErrorState, MatchedRegionsView, PageHeader, REGION_COLORS, StatusChip, PageSkeleton } from '../../components';
import { notify } from '../../notify';
import { pairHref } from './FlagReview';
import {
  FLAG_KEYS,
  fmtSim,
  isCopyFlag,
  penaltyEffect,
  refKind,
  refSubmissionId,
  useInvalidate,
  useProblems,
  useSubmissionIndex,
  WhyDisabled,
} from './common';

function sideName(ref: string, labels: Record<string, RefLabel> | undefined, fallback: string) {
  const l = labels?.[ref];
  if (l?.roll_no) return `${l.roll_no} ${l.name ?? ''}`.trim();
  const k = refKind(ref);
  if (k === 'llm') return `AI-generated: ${ref.slice(4)}`;
  if (k === 'web') return `Web: ${ref.slice(4)}`;
  return fallback;
}

export default function PairView() {
  const [params] = useSearchParams();
  const nav = useNavigate();
  const scan = Number(params.get('scan'));
  const a = params.get('a') ?? '';
  const b = params.get('b') ?? '';
  const slug = params.get('problem') ?? '';
  const valid = scan > 0 && !!a && !!b;

  const q = useQuery({
    queryKey: ['staff', 'pair', scan, a, b],
    queryFn: () => api.staff.pair(scan, a, b),
    enabled: valid,
  });
  // every pair of the scan, for previous / next
  const all = useQuery({
    queryKey: ['staff', 'plagiarism', slug, scan, 'all'],
    queryFn: () => api.staff.plagiarism(slug, { scan, min: 0 }),
    enabled: valid && !!slug,
  });
  const index = useSubmissionIndex(slug || null, valid);
  const problems = useProblems();
  const penalty = problems.data?.find((p) => p.slug === slug)?.integrity_penalty;

  const list = useMemo(() => [...(all.data?.pairs ?? [])].sort((x, y) => y.sim - x.sim), [all.data]);
  const pos = list.findIndex((p) => (p.a === a && p.b === b) || (p.a === b && p.b === a));
  const prev = pos > 0 ? list[pos - 1] : undefined;
  const next = pos >= 0 && pos < list.length - 1 ? list[pos + 1] : undefined;
  const go = (p: { a: string; b: string } | undefined) => p && nav(pairHref(slug, scan, p.a, p.b));

  const ids = [a, b].map(refSubmissionId);
  // The structured copy flags of each submission side; only the ones naming the other side belong to this pair.
  const flagQs = useQueries({
    queries: ids.map((id) => ({
      queryKey: ['staff', 'submission-flags', id],
      queryFn: () => api.staff.submissionFlags(id!),
      enabled: valid && !!id,
    })),
  });
  const sides = [a, b].map((r, i) => {
    const other = i === 0 ? b : a;
    const flags: StaffFlag[] = (flagQs[i].data ?? []).filter((f) => isCopyFlag(f.type) && f.peer_ref === other);
    return { ref: r, id: ids[i], row: ids[i] ? index.byId.get(ids[i]!) : undefined, flags };
  });
  const pairFlags = sides.flatMap((s) => s.flags);
  const open = pairFlags.filter((f) => f.review_status === 'open');
  const live = pairFlags.filter((f) => f.review_status !== 'dismissed');
  const state: 'confirmed' | 'open' | 'dismissed' | null = live.some((f) => f.review_status === 'confirmed')
    ? 'confirmed'
    : open.length
      ? 'open'
      : pairFlags.length
        ? 'dismissed'
        : null;
  const hasSubmission = ids.some((id) => id !== null);

  const [note, setNote] = useState('');
  useEffect(() => setNote(''), [a, b]);
  const invalidate = useInvalidate();
  const decide = useMutation({
    mutationFn: async (status: 'confirmed' | 'dismissed') => {
      const review_note = note.trim() || undefined;
      const targets = status === 'confirmed' ? open : live;
      // Decide the flags grading raised for this pair; with none, raise a staff flag on each graded side.
      if (targets.length) return (await api.staff.bulkFlags({ flag_ids: targets.map((f) => f.id), review_status: status, review_note })).flags;
      return (await api.staff.flagPair({ scan, a, b, review_status: status, review_note })).flags;
    },
    onSuccess: (_r, status) => {
      const who = sides.map((s) => s.row?.roll_no).filter(Boolean).join(' and ') || 'this pair';
      notify.success(status === 'confirmed' ? `Copy confirmed for ${who}` : `Pair dismissed for ${who}`);
      invalidate(...FLAG_KEYS, ['staff', 'submission-flags']);
      setNote('');
    },
    onError: (e) => notify.error(e),
  });
  // Confirming applies the problem's integrity penalty, so it asks first; dismissing is harmless and instant.
  const confirmCopy = async () => {
    if (decide.isPending) return;
    const who = sides.map((s) => s.row?.roll_no).filter(Boolean).join(' and ') || 'this pair';
    const ok = await confirm({
      title: 'Confirm copying?',
      message: "Both students see the flag, and the problem's integrity penalty applies.",
      target: who,
      confirmLabel: 'Confirm copy',
      danger: true,
    });
    if (ok) decide.mutate('confirmed');
  };
  const canConfirm = hasSubmission && state !== 'confirmed';
  const canDismiss = hasSubmission && state !== 'dismissed';
  const noSubWhy = 'Neither side is a student submission, so there is nobody to flag.';
  const noteRef = useRef<HTMLInputElement>(null);

  useHotkeys([
    ['j', () => go(next)],
    ['k', () => go(prev)],
    ['c', () => canConfirm && void confirmCopy()],
    ['d', () => canDismiss && !decide.isPending && decide.mutate('dismissed')],
    ['n', () => noteRef.current?.focus()],
  ]);

  const back = `/staff/plagiarism${slug ? `?problem=${encodeURIComponent(slug)}&scan=${scan}` : ''}`;
  if (!valid) {
    return (
      <Stack>
        <PageHeader title="Compare a pair" breadcrumbs={[{ label: 'Integrity' }, { label: 'Plagiarism', to: '/staff/plagiarism' }, { label: 'Pair' }]} />
        <EmptyState title="No pair selected" action={<Button component={Link} to="/staff/plagiarism">Plagiarism</Button>} />
      </Stack>
    );
  }
  if (q.error) return <ErrorState error={q.error} onRetry={() => q.refetch()} backTo={back} backLabel="Back to plagiarism" />;
  if (!q.data) return <PageSkeleton />;
  const p = q.data;
  const labels = p.labels ?? all.data?.labels;
  const aName = sideName(a, labels, p.a.label);
  const bName = sideName(b, labels, p.b.label);

  return (
    <Stack gap="md" pb={96}>
      <PageHeader
        title={`${aName} and ${bName}`}
        documentTitle="Compare a pair"
        description={
          <>
            {fmtSim(p.sim)} similar, AST {fmtSim(p.ast_sim)}, {p.shared ?? '?'} shared fingerprints.
            {pos >= 0 && ` Pair ${pos + 1} of ${list.length} in this scan.`}
          </>
        }
        breadcrumbs={[{ label: 'Integrity' }, { label: 'Plagiarism', to: back }, { label: 'Pair' }]}
        actions={
          <Button component={Link} to={back} variant="default" leftSection={<IconArrowLeft size={16} />}>
            Back to plagiarism
          </Button>
        }
      >
        <Group gap="lg" wrap="wrap">
          {sides.map((s, i) => (
            <Group key={s.ref} gap={6} wrap="nowrap">
              <Text size="sm" c="dimmed">
                {i === 0 ? 'Left' : 'Right'}:
              </Text>
              {s.id ? (
                <Anchor component={Link} to={`/staff/submissions/${s.id}`} size="sm">
                  {i === 0 ? aName : bName}, submission {s.id}
                </Anchor>
              ) : (
                <Text size="sm">{i === 0 ? aName : bName}</Text>
              )}
              {s.flags.map((f) => (
                <StatusChip key={f.id} kind="flag" status={f.review_status} size="sm" />
              ))}
            </Group>
          ))}
        </Group>
      </PageHeader>

      <Paper p="md">
        <Text size="sm" fw={600} mb="xs">
          Matched regions
        </Text>
        {p.regions.length === 0 ? (
          <Text size="sm" c="dimmed">No contiguous matching regions</Text>
        ) : (
          <Table.ScrollContainer minWidth={420} type="native">
            <Table>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>Region</Table.Th>
                  <Table.Th>Left lines</Table.Th>
                  <Table.Th>Right lines</Table.Th>
                  <Table.Th ta="right">Shared fingerprints</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {p.regions.map((r, i) => (
                  <Table.Tr key={i}>
                    <Table.Td>
                      <Badge radius="sm" style={{ background: REGION_COLORS[i % REGION_COLORS.length], color: '#141922' }}>
                        {i + 1}
                      </Badge>
                    </Table.Td>
                    <Table.Td className="ag-num">
                      {r.a[0]}-{r.a[1]}
                    </Table.Td>
                    <Table.Td className="ag-num">
                      {r.b[0]}-{r.b[1]}
                    </Table.Td>
                    <Table.Td ta="right" className="ag-num">
                      {r.shared}
                    </Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </Table.ScrollContainer>
        )}
      </Paper>

      <MatchedRegionsView
        a={p.a.source}
        b={p.b.source}
        regions={p.regions.map((r) => ({ a_start: r.a[0], a_end: r.a[1], b_start: r.b[0], b_end: r.b[1] }))}
        aLabel={aName}
        bLabel={bName}
        height={560}
      />

      {/* sticky decision bar */}
      <Paper
        p="sm"
        role="region"
        aria-label="Decision"
        style={{
          position: 'sticky',
          bottom: 12,
          zIndex: 20,
          background: 'var(--ag-raised)',
          borderColor: state === 'open' ? 'var(--ag-warn)' : 'var(--ag-line)',
          boxShadow: '0 8px 24px rgba(0,0,0,0.35)',
        }}
      >
        <Stack gap={8}>
          <Group gap="sm" wrap="wrap" justify="space-between">
            <Group gap="xs" wrap="nowrap">
              <Tooltip label="Previous pair (k)">
                <span>
                  <Button size="sm" variant="default" px={8} disabled={!prev} onClick={() => go(prev)} aria-label="Previous pair">
                    <IconChevronLeft size={16} />
                  </Button>
                </span>
              </Tooltip>
              <Text size="sm" className="ag-num" c="dimmed" style={{ whiteSpace: 'nowrap' }}>
                {pos >= 0 ? `${pos + 1} / ${list.length}` : '-'}
              </Text>
              <Tooltip label="Next pair (j)">
                <span>
                  <Button size="sm" variant="default" px={8} disabled={!next} onClick={() => go(next)} aria-label="Next pair">
                    <IconChevronRight size={16} />
                  </Button>
                </span>
              </Tooltip>
              {state ? (
                <StatusChip kind="flag" status={state} size="sm" />
              ) : (
                <Tooltip label="Not flagged by grading. Confirming flags both submissions.">
                  <Text size="sm" c="dimmed" style={{ whiteSpace: 'nowrap' }}>
                    Not flagged
                  </Text>
                </Tooltip>
              )}
            </Group>
            <TextInput
              ref={noteRef}
              aria-label="Review note"
              placeholder="Review note (n), saved with the decision"
              value={note}
              onChange={(e) => setNote(e.currentTarget.value)}
              onKeyDown={(e) => e.key === 'Escape' && e.currentTarget.blur()}
              style={{ flex: '1 1 220px', minWidth: 180 }}
              size="sm"
              maxLength={2000}
            />
            <Group gap="xs" wrap="nowrap">
              <WhyDisabled reason={!canDismiss && (hasSubmission ? 'Already dismissed.' : noSubWhy)}>
                <Button size="sm" variant="default" leftSection={<IconFlagOff size={16} />} disabled={!canDismiss} loading={decide.isPending && decide.variables === 'dismissed'} onClick={() => decide.mutate('dismissed')}>
                  Dismiss
                </Button>
              </WhyDisabled>
              <WhyDisabled reason={!canConfirm && (hasSubmission ? 'Already confirmed.' : noSubWhy)}>
                <Button size="sm" color="fail" leftSection={<IconFlagCheck size={16} />} disabled={!canConfirm} loading={decide.isPending && decide.variables === 'confirmed'} onClick={() => void confirmCopy()}>
                  Confirm copy
                </Button>
              </WhyDisabled>
            </Group>
          </Group>
          <Group gap="md" wrap="wrap" justify="space-between">
            <Group gap={6} wrap="nowrap">
              <IconScale size={14} color="var(--ag-warn)" aria-hidden />
              <Text size="xs" c="dimmed">
                {penaltyEffect(penalty)}
              </Text>
            </Group>
            <Box visibleFrom="sm">
              <Text size="xs" c="dimmed">
                <Kbd size="xs">j</Kbd> next <Kbd size="xs">k</Kbd> previous <Kbd size="xs">c</Kbd> confirm <Kbd size="xs">d</Kbd> dismiss{' '}
                <Kbd size="xs">n</Kbd> note
              </Text>
            </Box>
          </Group>
        </Stack>
      </Paper>
    </Stack>
  );
}
