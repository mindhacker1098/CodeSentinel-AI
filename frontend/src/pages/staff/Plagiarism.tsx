import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Accordion,
  Anchor,
  Badge,
  Box,
  Button,
  Group,
  Loader,
  Paper,
  Progress,
  Select,
  Slider,
  Stack,
  Text,
  Title,
  Tooltip,
} from '@mantine/core';
import { IconCopy, IconFlagCheck, IconFlagOff, IconRadar } from '@tabler/icons-react';
import { api, type Cluster, type RefLabel, type ScanPair, type StaffSubmissionRow } from '../../api/client';
import { EmptyState, ErrorState, PageHeader, ResponsiveTable, StatusChip, TableSkeleton, type Column } from '../../components';
import { fmtRelative } from '../../format';
import { notify } from '../../notify';
import { BulkDecisionModal } from './Flags';
import { pairHref } from './FlagReview';
import {
  fmtSim,
  liveCopyFlags,
  openCopyFlags,
  penaltyEffect,
  plural,
  ProblemSelect,
  refKind,
  refSubmissionId,
  useInvalidate,
  useParam,
  useProblemSlug,
  useSubmissionIndex,
  WhyDisabled,
} from './common';

function RefName({ r, labels, byId }: { r: string; labels: Record<string, RefLabel>; byId: Map<number, StaffSubmissionRow> }) {
  const sid = refSubmissionId(r);
  const l = labels[r];
  if (sid) {
    const s = byId.get(sid);
    return (
      <Anchor component={Link} to={`/staff/submissions/${sid}`} size="sm" style={{ whiteSpace: 'nowrap' }}>
        <span className="ag-mono">{l?.roll_no ?? s?.roll_no ?? r}</span> {l?.name ?? s?.name ?? ''}
      </Anchor>
    );
  }
  const kind = refKind(r);
  return (
    <Group gap={6} wrap="nowrap">
      <Badge size="sm" variant="light" color={kind === 'llm' ? 'iris' : 'info'} radius="sm">
        {kind === 'llm' ? 'AI-generated' : kind === 'web' ? 'Web' : kind}
      </Badge>
      <Tooltip label={l?.label ?? r.slice(kind.length + 1)}>
        <Text size="sm" className="ag-mono" fz={13} style={{ whiteSpace: 'nowrap' }} tabIndex={0}>
          {middle(l?.label ?? r.slice(kind.length + 1))}
        </Text>
      </Tooltip>
    </Group>
  );
}

/** "qwen2.5_coder_7b_seed1001.c" -> "qwen2.5_co…seed1001.c": keep the end, where the names differ. */
function middle(s: string, max = 26): string {
  return s.length <= max ? s : `${s.slice(0, 10)}…${s.slice(-(max - 11))}`;
}

function SimBar({ v }: { v: number | null | undefined }) {
  if (v === null || v === undefined) return <Text size="sm" c="dimmed">-</Text>;
  const color = v >= 0.85 ? 'fail' : v >= 0.7 ? 'warn' : 'info';
  return (
    <Group gap={8} wrap="nowrap" justify="flex-end">
      <Progress value={v * 100} color={color} size={6} w={64} aria-hidden />
      <Text size="sm" className="ag-num" w={40} ta="right" c={`${color}.5`}>
        {fmtSim(v)}
      </Text>
    </Group>
  );
}

function pairState(p: ScanPair, byId: Map<number, StaffSubmissionRow>) {
  const flags = [p.a, p.b].flatMap((r) => liveCopyFlags(byId.get(refSubmissionId(r) ?? -1)?.flags));
  if (flags.some((f) => f.review_status === 'confirmed')) return 'confirmed' as const;
  if (flags.some((f) => f.review_status === 'open')) return 'open' as const;
  return null;
}

function normCluster(c: Cluster | string[], i: number): Cluster {
  return Array.isArray(c) ? { id: i + 1, members: c, size: c.length } : c;
}

export default function Plagiarism() {
  const [slug, , problem] = useProblemSlug();
  const [scanRaw, setScan] = useParam('scan');
  const [, setParams] = useSearchParams();
  // one URL update: two back-to-back updates would overwrite each other and undo the problem change
  const pickProblem = (v: string | null) =>
    setParams((prev) => {
      const next = new URLSearchParams(prev);
      if (v) next.set('problem', v); else next.delete('problem');
      next.delete('scan');
      next.delete('page');
      return next;
    }, { replace: true });
  const [thr, setThr] = useState(0.85);
  const [minQ, setMinQ] = useState(0.85);
  const qc = useQueryClient();
  const invalidate = useInvalidate();

  const scans = useQuery({ queryKey: ['staff', 'scans', slug], queryFn: () => api.staff.scans(slug!), enabled: !!slug });
  const scanId = scanRaw ? Number(scanRaw) : scans.data?.[0]?.id;
  const out = useQuery({
    queryKey: ['staff', 'plagiarism', slug, scanId ?? null, minQ],
    queryFn: () => api.staff.plagiarism(slug!, { scan: scanId, min: minQ }),
    enabled: !!slug && scans.isSuccess,
    placeholderData: keepPreviousData,
  });
  const scan = out.data?.scan ?? null;
  useEffect(() => {
    if (scan?.threshold) {
      setThr(scan.threshold);
      setMinQ(scan.threshold);
    }
  }, [scan?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const index = useSubmissionIndex(slug);
  const byId = index.byId;
  const labels = out.data?.labels ?? {};

  const run = useMutation({
    mutationFn: () => api.staff.runScan(slug!, thr, false),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ['staff', 'scans', slug] });
      qc.invalidateQueries({ queryKey: ['staff', 'plagiarism', slug] });
      invalidate(['staff', 'submissions']);
      setScan(r.scan_id ? String(r.scan_id) : null);
      notify.success(`Plagiarism scan finished for ${problem?.title ?? slug}`);
    },
    onError: (e) => notify.error(e),
  });

  const pairs = useMemo(() => [...(out.data?.pairs ?? [])].sort((a, b) => b.sim - a.sim), [out.data]);
  const clusters = useMemo(() => (scan?.clusters ?? []).map(normCluster), [scan]);

  const [bulk, setBulk] = useState<{ ids: number[]; status: 'confirmed' | 'dismissed'; target: string } | null>(null);

  const pairCols: Column<ScanPair>[] = [
    { key: 'a', header: 'First', cell: (p) => <RefName r={p.a} labels={labels} byId={byId} /> },
    { key: 'b', header: 'Second', cell: (p) => <RefName r={p.b} labels={labels} byId={byId} /> },
    { key: 'sim', header: 'Similarity', align: 'right', cell: (p) => <SimBar v={p.sim} /> },
    {
      key: 'ast',
      header: (
        <Tooltip label="Syntax-tree similarity (robust to renaming and reformatting)" multiline maw={260}>
          <span>AST similarity</span>
        </Tooltip>
      ),
      cardLabel: 'AST similarity',
      align: 'right',
      cell: (p) => <Text size="sm" className="ag-num">{fmtSim(p.ast_sim)}</Text>,
    },
    {
      key: 'shared',
      header: (
        <Tooltip label="Shared fingerprints, boilerplate removed" multiline maw={240}>
          <span>Shared</span>
        </Tooltip>
      ),
      cardLabel: 'Shared fingerprints',
      align: 'right',
      cell: (p) => <Text size="sm" className="ag-num">{p.shared ?? '-'}</Text>,
    },
    {
      key: 'state',
      header: 'Decision',
      cell: (p) => {
        const s = pairState(p, byId);
        return s ? <StatusChip kind="flag" status={s} size="sm" /> : <Text size="sm" c="dimmed">No flag</Text>;
      },
    },
  ];

  const pickerAndActions = (
    <>
      <ProblemSelect value={slug} onChange={pickProblem} w={{ base: '100%', xs: 240 }} />
      <Select
        aria-label="Scan"
        placeholder={scans.data?.length === 0 ? 'No scans yet' : 'Scan'}
        data={(scans.data ?? []).map((s, i) => ({
          value: String(s.id),
          label: `${i === 0 ? 'Latest, ' : ''}${new Date(s.created_at).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}, ${plural(s.n_pairs, 'pair')}`,
        }))}
        value={scanId ? String(scanId) : null}
        onChange={(v) => setScan(v)}
        disabled={!scans.data?.length}
        w={{ base: '100%', xs: 260 }}
        allowDeselect={false}
      />
      <WhyDisabled reason={!slug && 'Choose a problem first.'}>
        <Button leftSection={<IconRadar size={16} />} onClick={() => run.mutate()} loading={run.isPending} disabled={!slug}>
          Run plagiarism scan
        </Button>
      </WhyDisabled>
    </>
  );

  return (
    <Stack gap="lg">
      <PageHeader
        title="Plagiarism"
        breadcrumbs={[{ label: 'Integrity' }, { label: 'Plagiarism' }]}
        actions={pickerAndActions}
      />

      {run.isPending && (
        <Paper p="sm" role="status" aria-live="polite" style={{ borderColor: 'var(--ag-info)' }}>
          <Group gap="xs" mb={8}>
            <Loader size={16} color="info" />
            <Text size="sm">
              Scanning {problem ? plural(problem.n_students, 'student') : 'submissions'} at {fmtSim(thr)}...
            </Text>
          </Group>
          <Progress value={100} animated striped color="info" size="sm" aria-label="Scan in progress" />
        </Paper>
      )}

      <Paper p="md">
        <Group gap="xl" align="flex-end" wrap="wrap">
          <Box style={{ flex: '1 1 300px', maxWidth: 460 }}>
            <Group justify="space-between" mb={6}>
              <Text size="sm" fw={500} id="thr-label">
                Similarity threshold
              </Text>
              <Text size="sm" className="ag-num" fw={600} aria-hidden>
                {fmtSim(thr)}
              </Text>
            </Group>
            <Slider
              aria-labelledby="thr-label"
              min={0.5}
              max={1}
              step={0.01}
              value={thr}
              onChange={setThr}
              onChangeEnd={setMinQ}
              label={null}
              marks={[{ value: 0.7 }, { value: 0.85 }]}
            />
          </Box>
          {scan && (
            <Text size="sm" c="dimmed" style={{ flex: '1 1 200px' }}>
              Last scan {fmtRelative(scan.created_at)} · {plural(scan.n_submissions ?? 0, 'submission')} · clusters at {fmtSim(scan.threshold)}
            </Text>
          )}
        </Group>
      </Paper>

      {!slug ? (
        <EmptyState icon={IconCopy} title="No problems yet" />
      ) : out.error ? (
        <ErrorState error={out.error} onRetry={() => out.refetch()} backTo={false} />
      ) : scans.isPending || out.isPending ? (
        <TableSkeleton rows={6} />
      ) : !scan ? (
        <Paper>
          <EmptyState
            icon={IconRadar}
            title="No scan yet"
            action={
              <Button leftSection={<IconRadar size={16} />} onClick={() => run.mutate()} loading={run.isPending}>
                Run plagiarism scan
              </Button>
            }
          />
        </Paper>
      ) : (
        <>
          <Stack gap="sm">
            <Title order={2}>
              {clusters.length ? plural(clusters.length, 'cluster') : 'Clusters'}
            </Title>
            {clusters.length === 0 ? (
              <Text size="sm" c="dimmed">
                No clusters above {fmtSim(scan.threshold)}
              </Text>
            ) : (
              <Accordion multiple variant="separated" radius="sm" chevronPosition="left">
                {clusters.map((c, i) => {
                  const members = c.members;
                  const subs = members.map(refSubmissionId).filter((x): x is number => x !== null);
                  const others = members.length - subs.length;
                  const inner = pairs.filter((p) => members.includes(p.a) && members.includes(p.b));
                  const open = subs.flatMap((id) => openCopyFlags(byId.get(id)?.flags));
                  const live = subs.flatMap((id) => liveCopyFlags(byId.get(id)?.flags).filter((f) => f.review_status !== 'dismissed'));
                  const maxSim = c.max_sim ?? Math.max(0, ...inner.map((p) => p.sim));
                  const names = subs.map((id) => labels[`sub:${id}`]?.roll_no ?? byId.get(id)?.roll_no ?? `#${id}`);
                  const target = `Cluster ${i + 1}: ${names.join(', ')}`;
                  return (
                    <Accordion.Item key={String(c.id)} value={String(c.id)} style={{ background: 'var(--ag-surface)', borderColor: 'var(--ag-line)' }}>
                      <Accordion.Control>
                        <Group justify="space-between" wrap="wrap" gap="xs" pr="sm">
                          <Group gap="sm" wrap="wrap">
                            <Text fw={600}>Cluster {i + 1}</Text>
                            <Text size="sm" c="dimmed">
                              {plural(subs.length, 'student')}
                              {others ? `, ${plural(others, 'outside source')}` : ''}, up to {fmtSim(maxSim)} similar
                            </Text>
                          </Group>
                          {open.length > 0 ? (
                            <StatusChip kind="flag" status="open" size="sm" label={`${plural(open.length, 'flag')} to review`} />
                          ) : live.some((f) => f.review_status === 'confirmed') ? (
                            <StatusChip kind="flag" status="confirmed" size="sm" />
                          ) : null}
                        </Group>
                      </Accordion.Control>
                      <Accordion.Panel>
                        <Stack gap="sm">
                          <Group gap="xs" wrap="wrap">
                            {members.map((m) => (
                              <Paper key={m} px="sm" py={6} style={{ background: 'var(--ag-raised)' }}>
                                <RefName r={m} labels={labels} byId={byId} />
                              </Paper>
                            ))}
                          </Group>
                          <ResponsiveTable
                            data={inner}
                            columns={pairCols}
                            rowKey={(p) => `${p.a}|${p.b}`}
                            minWidth={760}
                            caption={`Pairs in cluster ${i + 1}`}
                            rowActions={(p) => (
                              <Button size="compact-sm" variant="light" component={Link} to={pairHref(slug, scan.id, p.a, p.b)}>
                                Review
                              </Button>
                            )}
                            empty={<Text size="sm" c="dimmed" p="sm">All pairs below the threshold</Text>}
                          />
                          <Group gap="xs" justify="flex-end">
                            <WhyDisabled reason={!open.length && 'No open copy flags'}>
                              <Button
                                variant="default"
                                leftSection={<IconFlagOff size={16} />}
                                disabled={!open.length}
                                onClick={() => setBulk({ ids: open.map((f) => f.id), status: 'dismissed', target })}
                              >
                                Dismiss all
                              </Button>
                            </WhyDisabled>
                            <WhyDisabled reason={!open.length && 'No open copy flags'}>
                              <Button
                                color="fail"
                                leftSection={<IconFlagCheck size={16} />}
                                disabled={!open.length}
                                onClick={() => setBulk({ ids: open.map((f) => f.id), status: 'confirmed', target })}
                              >
                                Confirm all
                              </Button>
                            </WhyDisabled>
                          </Group>
                        </Stack>
                      </Accordion.Panel>
                    </Accordion.Item>
                  );
                })}
              </Accordion>
            )}
          </Stack>

          <Stack gap="sm">
            <Group justify="space-between" align="baseline">
              <Title order={2}>Pairs</Title>
              <Text size="sm" c="dimmed">
                {plural(pairs.length, 'pair')} at {fmtSim(minQ)}+
              </Text>
            </Group>
            <ResponsiveTable
              data={pairs}
              columns={pairCols}
              rowKey={(p) => `${p.a}|${p.b}`}
              minWidth={820}
              caption="Similar pairs"
              rowActions={(p) => (
                <Button size="compact-sm" variant="light" component={Link} to={pairHref(slug, scan.id, p.a, p.b)}>
                  Review
                </Button>
              )}
              empty={
                <EmptyState
                  compact
                  icon={IconCopy}
                  title={`No pairs at ${fmtSim(minQ)}+`}
                />
              }
            />
          </Stack>
        </>
      )}

      <BulkDecisionModal
        opened={!!bulk}
        onClose={() => setBulk(null)}
        flagIds={bulk?.ids ?? []}
        status={bulk?.status ?? 'dismissed'}
        copy
        penaltyText={penaltyEffect(problem?.integrity_penalty)}
        target={bulk?.target}
      />
    </Stack>
  );
}
