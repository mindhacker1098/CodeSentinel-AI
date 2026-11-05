// Flag review modal: the evidence for each flag of one submission, and confirm / dismiss with a note.
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery } from '@tanstack/react-query';
import {
  Alert,
  Anchor,
  Box,
  Button,
  Group,
  Modal,
  Paper,
  SimpleGrid,
  Skeleton,
  Stack,
  Text,
  Textarea,
  UnstyledButton,
} from '@mantine/core';
import { IconArrowsDiff, IconExternalLink, IconFlag, IconFlagCheck, IconFlagOff, IconScale } from '@tabler/icons-react';
import { api, type FlagRef, type FlagReviewStatus, type PairOut } from '../../api/client';
import { CodeBlock, ErrorState, FlagBadge, StatusChip } from '../../components';
import { notify } from '../../notify';
import {
  FLAG_KEYS,
  flagName,
  isCopyFlag,
  penaltyEffect,
  refSubmissionId,
  useInvalidate,
  useProblems,
} from './common';

/** Source lines start..end (1-based) with their numbers, for an inline excerpt. */
function excerpt(src: string, start: number, end: number, max = 14): string {
  const lines = src.split('\n');
  const s = Math.max(1, start);
  const e = Math.min(lines.length, end, s + max - 1);
  const w = String(e).length;
  const out: string[] = [];
  for (let i = s; i <= e; i++) out.push(`${String(i).padStart(w)}  ${lines[i - 1] ?? ''}`);
  if (end > e) out.push(`${' '.repeat(w)}  ... ${end - e} more lines`);
  return out.join('\n');
}

/** Where to compare a submission with its peer: the newest scan of the problem. */
export function useLatestScan(slug: string | null | undefined) {
  return useQuery({
    queryKey: ['staff', 'scans', slug],
    queryFn: () => api.staff.scans(slug!),
    enabled: !!slug,
    select: (s) => s[0] ?? null,
  });
}

export function pairHref(slug: string, scan: number, a: string, b: string) {
  const p = new URLSearchParams({ problem: slug, scan: String(scan), a, b });
  return `/staff/plagiarism/pair?${p}`;
}

function CopyEvidence({ slug, sid, peer }: { slug: string; sid: number; peer: string }) {
  const scan = useLatestScan(slug);
  const self = `sub:${sid}`;
  const pair = useQuery<PairOut>({
    queryKey: ['staff', 'pair', scan.data?.id, self, peer],
    queryFn: () => api.staff.pair(scan.data!.id, self, peer),
    enabled: !!scan.data,
    retry: false,
  });
  const peerId = refSubmissionId(peer);
  return (
    <Stack gap="xs">
      <Group gap="md" wrap="wrap">
        {peerId ? (
          <Anchor component={Link} to={`/staff/submissions/${peerId}`} size="sm">
            Open the peer submission
          </Anchor>
        ) : (
          <Text size="sm" c="dimmed">
            Matched {peer.startsWith('llm:') ? 'an AI-generated program' : 'a web source'}:{' '}
            <span className="ag-mono">{peer.split(':').slice(1).join(':')}</span>
          </Text>
        )}
        {scan.data && pair.data ? (
          <Button
            size="xs"
            variant="light"
            leftSection={<IconArrowsDiff size={14} />}
            component={Link}
            to={pairHref(slug, scan.data.id, self, peer)}
          >
            Compare side by side
          </Button>
        ) : (
          <Text size="sm" c="dimmed">
            {scan.isPending || pair.isPending
              ? 'Loading...'
              : scan.data
                ? 'Not in the latest scan. Run a new scan to compare.'
                : 'No scan yet. Run one to compare.'}
          </Text>
        )}
      </Group>
      {pair.isPending && scan.data && <Skeleton h={120} />}
      {pair.data && pair.data.regions.length > 0 && (
        <Stack gap={6}>
          <Text size="sm" c="dimmed">
            Matched lines ({pair.data.regions.length} region{pair.data.regions.length === 1 ? '' : 's'}, showing the
            largest)
          </Text>
          {[...pair.data.regions]
            .sort((x, y) => y.shared - x.shared)
            .slice(0, 2)
            .map((r, i) => (
              <SimpleGrid key={i} cols={{ base: 1, sm: 2 }} spacing="xs">
                <CodeBlock
                  label={`This submission, lines ${r.a[0]}-${r.a[1]}`}
                  code={excerpt(pair.data!.a.source, r.a[0], r.a[1])}
                  maxHeight={220}
                  copyable={false}
                />
                <CodeBlock
                  label={`${pair.data!.b.label}, lines ${r.b[0]}-${r.b[1]}`}
                  code={excerpt(pair.data!.b.source, r.b[0], r.b[1])}
                  maxHeight={220}
                  copyable={false}
                />
              </SimpleGrid>
            ))}
        </Stack>
      )}
    </Stack>
  );
}

export interface FlagReviewModalProps {
  opened: boolean;
  onClose: () => void;
  submissionId: number;
  problemSlug: string;
  /** Unused: the modal loads the structured flags itself. Kept so callers can pass what they have. */
  flags?: FlagRef[];
  /** Start with this flag selected. */
  focusFlagId?: number;
}

export function FlagReviewModal({ opened, onClose, submissionId, problemSlug, focusFlagId }: FlagReviewModalProps) {
  const sub = useQuery({
    queryKey: ['submission', submissionId],
    queryFn: () => api.submission(submissionId),
    enabled: opened,
  });
  // The structured flags (detail, peer_ref, similarity) of the submission's current result.
  const flagQ = useQuery({
    queryKey: ['staff', 'submission-flags', submissionId],
    queryFn: () => api.staff.submissionFlags(submissionId),
    enabled: opened,
  });
  const problems = useProblems();
  const penalty = problems.data?.find((p) => p.slug === problemSlug)?.integrity_penalty;
  const [note, setNote] = useState('');
  const [current, setCurrent] = useState<number | null>(focusFlagId ?? null);
  useEffect(() => {
    if (opened) {
      setNote('');
      setCurrent(focusFlagId ?? null);
    }
  }, [opened, focusFlagId]);
  const invalidate = useInvalidate();
  const roll = sub.data?.user?.roll_no ?? `submission ${submissionId}`;

  const review = useMutation({
    mutationFn: ({ id, status }: { id: number; status: FlagReviewStatus }) => api.staff.reviewFlag(id, status, note),
    onSuccess: (f, { status }) => {
      const what = flagName(f.type);
      notify.success(
        status === 'confirmed'
          ? isCopyFlag(f.type)
            ? `Copy confirmed for ${roll}`
            : `Flag confirmed for ${roll}: ${what}`
          : status === 'dismissed'
            ? `Flag dismissed for ${roll}: ${what}`
            : `Flag reopened for ${roll}: ${what}`,
      );
      invalidate(...FLAG_KEYS, ['staff', 'submission-flags', submissionId]);
      setNote('');
    },
    onError: (e) => notify.error(e),
  });

  const details = flagQ.data ?? [];
  const sel = details.find((f) => f.id === current) ?? details.find((f) => f.review_status === 'open') ?? details[0];

  return (
    <Modal opened={opened} onClose={onClose} title={`Review flags on ${roll}'s submission`} size="xl">
      {sub.error || flagQ.error ? (
        <ErrorState error={sub.error ?? flagQ.error} compact backTo={false} />
      ) : !sub.data || !flagQ.data ? (
        <Stack gap="xs">
          <Skeleton h={24} w="40%" />
          <Skeleton h={120} />
        </Stack>
      ) : details.length === 0 ? (
        <Text c="dimmed">No flags</Text>
      ) : (
        <Stack gap="md">
          <Text size="sm" c="dimmed">
            {sub.data.user?.name ?? roll} · {sub.data.problem_title ?? problemSlug} · #{submissionId}
          </Text>
          {details.length > 1 && (
            <Group gap={6} role="tablist" aria-label="Flags">
              {details.map((f) => (
                <UnstyledButton
                  key={f.id}
                  role="tab"
                  aria-selected={sel?.id === f.id}
                  onClick={() => setCurrent(f.id)}
                  style={{
                    borderRadius: 4,
                    outline: sel?.id === f.id ? '2px solid var(--ag-iris)' : undefined,
                    outlineOffset: 1,
                  }}
                >
                  <FlagBadge flag={{ type: f.type, review_status: f.review_status }} />
                </UnstyledButton>
              ))}
            </Group>
          )}
          {sel && (
            <Paper p="md">
              <Stack gap="sm">
                <Group justify="space-between" wrap="wrap">
                  <Text fw={600}>{flagName(sel.type)}</Text>
                  <StatusChip kind="flag" status={sel.review_status} />
                </Group>
                {sel.detail && <Text size="sm">{sel.detail}</Text>}
                {isCopyFlag(sel.type) && sel.peer_ref && (
                  <CopyEvidence slug={problemSlug} sid={submissionId} peer={sel.peer_ref} />
                )}
                {sel.source === 'staff' && (
                  <Text size="sm" c="dimmed">
                    Raised by staff. Kept through regrades.
                  </Text>
                )}
                {isCopyFlag(sel.type) && sel.review_status !== 'confirmed' && (
                  <Alert color="warn" variant="light" icon={<IconScale size={18} />} p="xs">
                    {penaltyEffect(penalty)}
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
                />
                <Group justify="flex-end" gap="xs">
                  {sel.review_status !== 'open' && (
                    <Button
                      variant="default"
                      leftSection={<IconFlag size={16} />}
                      loading={review.isPending && review.variables?.status === 'open'}
                      onClick={() => review.mutate({ id: sel.id, status: 'open' })}
                    >
                      Reopen flag
                    </Button>
                  )}
                  {sel.review_status !== 'dismissed' && (
                    <Button
                      variant="default"
                      leftSection={<IconFlagOff size={16} />}
                      loading={review.isPending && review.variables?.status === 'dismissed'}
                      onClick={() => review.mutate({ id: sel.id, status: 'dismissed' })}
                    >
                      Dismiss flag
                    </Button>
                  )}
                  {sel.review_status !== 'confirmed' && (
                    <Button
                      color="fail"
                      leftSection={<IconFlagCheck size={16} />}
                      loading={review.isPending && review.variables?.status === 'confirmed'}
                      onClick={() => review.mutate({ id: sel.id, status: 'confirmed' })}
                    >
                      {isCopyFlag(sel.type) ? 'Confirm copy' : 'Confirm flag'}
                    </Button>
                  )}
                </Group>
              </Stack>
            </Paper>
          )}
          <Box>
            <Anchor component={Link} to={`/staff/submissions/${submissionId}`} size="sm" onClick={onClose}>
              <Group gap={4} component="span">
                Open the full report <IconExternalLink size={14} aria-hidden />
              </Group>
            </Anchor>
          </Box>
        </Stack>
      )}
    </Modal>
  );
}

/** Clickable flag chips that open the review modal on that flag. */
export function FlagChips({
  flags,
  submissionId,
  problemSlug,
  hideDismissed = true,
}: {
  flags: FlagRef[];
  submissionId: number;
  problemSlug: string;
  hideDismissed?: boolean;
}) {
  const [focus, setFocus] = useState<number | null>(null);
  const shown = hideDismissed ? flags.filter((f) => f.review_status !== 'dismissed') : flags;
  if (!shown.length) return <Text size="sm" c="dimmed">None</Text>;
  return (
    <>
      <Group gap={4} wrap="wrap">
        {shown.map((f) => (
          <UnstyledButton
            key={f.id}
            onClick={(e) => {
              e.stopPropagation();
              setFocus(f.id);
            }}
            aria-label={`Review flag: ${flagName(f.type)}, ${f.review_status}`}
            style={{ borderRadius: 4, display: 'inline-flex' }}
          >
            <FlagBadge flag={{ type: f.type, review_status: f.review_status }} />
          </UnstyledButton>
        ))}
      </Group>
      <FlagReviewModal
        opened={focus !== null}
        onClose={() => setFocus(null)}
        submissionId={submissionId}
        problemSlug={problemSlug}
        flags={flags}
        focusFlagId={focus ?? undefined}
      />
    </>
  );
}
