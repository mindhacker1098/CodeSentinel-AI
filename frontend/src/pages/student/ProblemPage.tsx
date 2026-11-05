import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Alert,
  Anchor,
  Box,
  Button,
  Divider,
  Grid,
  Group,
  Paper,
  SimpleGrid,
  Skeleton,
  Stack,
  Tabs,
  Text,
  TextInput,
  Title,
  Tooltip,
} from '@mantine/core';
import {
  IconAlertTriangle,
  IconClock,
  IconCpu,
  IconEraser,
  IconExternalLink,
  IconEye,
  IconLock,
  IconPencil,
  IconScale,
  IconSend,
  IconStack2,
  IconTicket,
  IconUpload,
} from '@tabler/icons-react';
import { useMediaQuery } from '@mantine/hooks';
import { api, ApiError, type MetricSpec, type ProblemDetail, type SubmitResponse } from '../../api/client';
import { useAuth } from '../../auth';
import {
  C_FILENAME,
  CodeBlock,
  CodeViewer,
  Countdown,
  ErrorState,
  FileDrop,
  fmtBytes,
  Markdown,
  MAX_SOURCE_BYTES,
  PageHeader,
} from '../../components';
import GradingPanel from './GradingPanel';
import { submissionKey, useLocalDraft } from './hooks';
import { isActive, plural, POLICY_TEXT, stripSamples, stripTitle } from './shared';

const SKELETON = '#include <stdio.h>\n\nint main(void) {\n    \n    return 0;\n}\n';

interface Watching {
  jobId: number | null;
  submissionId: number;
}

// ---------------------------------------------------------------- info strip
function InfoItem({ icon: I, children, tip }: { icon: typeof IconClock; children: ReactNode; tip?: string }) {
  const body = (
    <Group gap={6} wrap="nowrap" tabIndex={tip ? 0 : undefined}>
      <I size={15} stroke={1.7} color="var(--ag-muted)" aria-hidden />
      <Text size="sm" style={{ whiteSpace: 'nowrap' }}>
        {children}
      </Text>
    </Group>
  );
  return tip ? <Tooltip label={tip} multiline maw={300}>{body}</Tooltip> : body;
}

function InfoStrip({ p }: { p: ProblemDetail }) {
  const left = p.submissions_left_this_hour;
  return (
    <Paper px="md" py={10} aria-label="Problem details">
      <Group gap="lg" style={{ rowGap: 8 }} wrap="wrap">
        {p.finalized ? (
          <InfoItem icon={IconLock}>Grading is closed</InfoItem>
        ) : (
          <Countdown to={p.due_at} size="sm" />
        )}
        {p.limits.time_limit_s != null && (
          <InfoItem icon={IconClock}>
            Time limit {p.limits.time_limit_s} s
          </InfoItem>
        )}
        {p.limits.memory_limit_mb != null && (
          <InfoItem icon={IconCpu}>
            Memory limit {p.limits.memory_limit_mb} MB
          </InfoItem>
        )}
        <InfoItem icon={IconScale}>{POLICY_TEXT[p.grade_policy] ?? 'Latest submission counts'}</InfoItem>
        <InfoItem icon={IconStack2}>
          Version {p.version}
        </InfoItem>
        {left != null && (
          <InfoItem icon={IconTicket}>
            <Text span size="sm" c={left === 0 ? 'fail.5' : left <= 2 ? 'warn.5' : undefined}>
              {left} of {p.max_submissions_per_hour} submissions left this hour
            </Text>
          </InfoItem>
        )}
      </Group>
    </Paper>
  );
}

// ---------------------------------------------------------------- statement column
function HowGraded({ metrics }: { metrics: MetricSpec[] }) {
  const shown = metrics.filter((m) => (m.weight ?? 0) > 0);
  const total = shown.reduce((s, m) => s + m.weight, 0) || 1;
  const max = Math.max(...shown.map((m) => m.weight), 0.0001);
  if (!shown.length) return null;
  return (
    <Paper p="md" component="section" aria-labelledby="how-graded">
      <Title order={2} fz={20} id="how-graded">
        Grading
      </Title>
      <Box mb="sm" />
      <Stack gap={0}>
        {shown.map((m, i) => {
          const pct = Math.round((m.weight / total) * 100);
          return (
            <Group
              key={m.name}
              justify="space-between"
              wrap="nowrap"
              gap="md"
              py={8}
              style={{ borderTop: i ? '1px solid var(--ag-line)' : undefined }}
            >
              <Box style={{ minWidth: 0, flex: 1 }}>
                <Text size="sm" fw={500}>
                  {m.label ?? m.name}
                </Text>
                {m.description && (
                  <Text size="sm" c="dimmed">
                    {m.description}
                  </Text>
                )}
              </Box>
              <Box w={{ base: 64, sm: 120 }} h={6} style={{ background: 'var(--ag-raised)', borderRadius: 3, overflow: 'hidden', flexShrink: 0 }} aria-hidden>
                <Box h="100%" w={`${(m.weight / max) * 100}%`} style={{ background: '#6B7891', borderRadius: 3 }} />
              </Box>
              <Text size="sm" className="ag-num" w={40} ta="right" style={{ flexShrink: 0 }}>
                {pct}%
              </Text>
            </Group>
          );
        })}
      </Stack>
    </Paper>
  );
}

function Statement({ p }: { p: ProblemDetail }) {
  const md = useMemo(() => {
    let s = stripTitle(p.statement_md ?? '', p.title);
    if (p.sample_input) s = stripSamples(s);
    return s.trim();
  }, [p.statement_md, p.title, p.sample_input]);
  return (
    <Stack gap="md">
      <Paper p="lg" component="section" aria-label="Problem statement">
        <Box className="ag-md">
          <Markdown source={md} />
        </Box>
        {(p.sample_input || p.sample_output) && (
          <>
            <Divider my="md" />
            <Title order={2} fz={16} mb="xs">
              Sample
            </Title>
            <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="sm">
              <CodeBlock code={p.sample_input ?? ''} label="Sample input" maxHeight={200} />
              <CodeBlock code={p.sample_output ?? ''} label="Sample output" maxHeight={200} emptyText="Not available yet" />
            </SimpleGrid>
          </>
        )}
      </Paper>
      <Box visibleFrom="md">
        <HowGraded metrics={p.metrics} />
      </Box>
    </Stack>
  );
}

// ---------------------------------------------------------------- submit column
function SubmitError({ error, onWatch }: { error: unknown; onWatch: (w: Watching) => void }) {
  if (!error) return null;
  if (error instanceof ApiError && error.status === 409) {
    const sid = error.submissionId;
    return (
      <Alert color="warn" variant="light" icon={<IconAlertTriangle size={18} />} title="Previous submission is still grading" role="alert">
        <Stack gap="xs">
          {sid && (
            <Group gap="xs">
              <Button size="xs" variant="light" leftSection={<IconEye size={14} />} onClick={() => onWatch({ jobId: error.jobId, submissionId: sid })}>
                Watch
              </Button>
              <Button size="xs" variant="default" component={Link} to={`/submissions/${sid}`} leftSection={<IconExternalLink size={14} />}>
                Open
              </Button>
            </Group>
          )}
        </Stack>
      </Alert>
    );
  }
  const title =
    error instanceof ApiError
      ? error.status === 403
        ? 'Submissions are closed'
        : error.status === 429
          ? 'Hourly limit reached'
          : error.status === 413
            ? 'The file is too large'
            : 'The submission was not accepted'
      : 'Check your submission';
  const text = error instanceof ApiError ? error.detail : error instanceof Error ? error.message : String(error);
  return (
    <Alert color="fail" variant="light" icon={<IconAlertTriangle size={18} />} title={title} role="alert">
      {text}
    </Alert>
  );
}

function SubmitPanel({ p, onSubmitted, onWatch }: { p: ProblemDetail; onSubmitted: (r: SubmitResponse) => void; onWatch: (w: Watching) => void }) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [params, setParams] = useSearchParams();
  const [tab, setTab] = useState<string | null>(params.get('tab') === 'write' || params.get('from') ? 'write' : 'upload');
  const [file, setFile] = useState<File | null>(null);
  const [filename, setFilename] = useState(`${p.slug}.c`);
  const draft = useLocalDraft(user ? `ag:draft:${user.id}:${p.slug}` : null, SKELETON);
  const [localError, setLocalError] = useState<string | null>(null);
  const phone = useMediaQuery('(max-width: 48em)');

  // "Edit and resubmit" from a report: load that submission's code into the editor.
  const from = params.get('from');
  useEffect(() => {
    const id = from && /^\d+$/.test(from) ? Number(from) : null;
    if (!id) return;
    let alive = true;
    api
      .submission(id)
      .then((s) => {
        if (!alive || !s.source) return;
        draft.setValue(s.source);
        if (s.filename && C_FILENAME.test(s.filename)) setFilename(s.filename);
        setTab('write');
      })
      .catch(() => undefined)
      .finally(() => {
        const next = new URLSearchParams(params);
        next.delete('from');
        next.delete('tab');
        setParams(next, { replace: true });
      });
    return () => {
      alive = false;
    };
  }, [from]); // eslint-disable-line react-hooks/exhaustive-deps

  const m = useMutation({
    mutationFn: async () => {
      if (tab === 'upload') {
        if (!file) throw new Error('Choose a .c file first.');
        return api.submitFile(p.slug, file);
      }
      const name = filename.trim();
      if (!C_FILENAME.test(name)) throw new Error('File name must end in .c and use letters, digits, "-", "_" or ".".');
      const size = new Blob([draft.value]).size;
      if (!draft.value.trim()) throw new Error('The editor is empty.');
      if (size > MAX_SOURCE_BYTES) throw new Error(`Your code is ${fmtBytes(size)}. The limit is ${fmtBytes(MAX_SOURCE_BYTES)}.`);
      return api.submitSource(p.slug, name, draft.value);
    },
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ['submissions'] });
      qc.invalidateQueries({ queryKey: ['problems'] });
      qc.invalidateQueries({ queryKey: ['problem', p.slug] });
      setFile(null);
      onSubmitted(r);
    },
  });

  const closed = p.finalized;
  const noneLeft = p.submissions_left_this_hour === 0;
  const ready = tab === 'upload' ? !!file : draft.value.trim().length > 0 && draft.value !== SKELETON;
  const what =
    tab === 'upload'
      ? file
        ? `${file.name}, ${fmtBytes(file.size)}`
        : 'No file chosen'
      : `${filename.trim() || 'untitled.c'}, ${draft.value.split('\n').length} lines`;

  return (
    <Paper p={0} style={{ display: 'flex', flexDirection: 'column' }}>
      <Box p="md" pb="sm">
        <Title order={2} fz={20}>
          Submit
        </Title>
      </Box>
      {closed && (
        <Box px="md" pb="sm">
          <Alert color="gray" variant="light" icon={<IconLock size={18} />} title="Grading is closed" />
        </Box>
      )}
      <Tabs value={tab} onChange={(v) => { setTab(v); setLocalError(null); m.reset(); }} keepMounted={false}>
        <Tabs.List px="md">
          <Tabs.Tab value="upload" leftSection={<IconUpload size={15} />}>
            Upload
          </Tabs.Tab>
          <Tabs.Tab value="write" leftSection={<IconPencil size={15} />}>
            Write
          </Tabs.Tab>
        </Tabs.List>
        <Tabs.Panel value="upload" p="md">
          <FileDrop value={file} onChange={(f) => { setFile(f); m.reset(); }} disabled={closed || m.isPending} />
        </Tabs.Panel>
        <Tabs.Panel value="write" p="md">
          <Stack gap="xs">
            <Group gap="xs" align="flex-end" wrap="wrap">
              <TextInput
                label="File name"
                value={filename}
                onChange={(e) => setFilename(e.currentTarget.value)}
                error={filename && !C_FILENAME.test(filename.trim()) ? 'Use letters, digits, "-", "_" or ".", ending in .c' : undefined}
                styles={{ input: { fontFamily: 'var(--mantine-font-family-monospace)' } }}
                style={{ flex: '1 1 180px' }}
                disabled={closed}
              />
              <Button
                variant="subtle"
                color="gray"
                leftSection={<IconEraser size={15} />}
                onClick={draft.clear}
                disabled={!draft.isDraft || closed}
              >
                Clear draft
              </Button>
            </Group>
            <CodeViewer
              source={draft.value}
              readOnly={closed}
              height={440}
              onChange={draft.setValue}
              onMount={(ed) => ed.updateOptions({ wordWrap: 'on', ariaLabel: 'C source editor' })}
            />
            <Text size="sm" c="dimmed" aria-live="polite">
              {draft.isDraft && draft.savedAt ? 'Draft saved' : '\u00a0'}
            </Text>
          </Stack>
        </Tabs.Panel>
      </Tabs>

      {(m.error || localError) && (
        <Box px="md" pb="sm">
          <SubmitError error={m.error ?? localError} onWatch={onWatch} />
        </Box>
      )}

      <Box
        px="md"
        py="sm"
        style={{
          position: phone ? 'static' : 'sticky',
          bottom: 0,
          zIndex: 2,
          background: 'var(--ag-surface)',
          borderTop: '1px solid var(--ag-line)',
          borderRadius: '0 0 8px 8px',
        }}
      >
        <Group justify="space-between" wrap="wrap" gap="xs">
          <Box style={{ minWidth: 0, flex: '1 1 160px' }}>
            <Text size="sm" className={tab === 'upload' && file ? 'ag-mono' : undefined} truncate>
              {what}
            </Text>
            {p.submissions_left_this_hour != null && (
              <Text size="sm" c={noneLeft ? 'fail.5' : 'dimmed'}>
                {noneLeft ? 'No submissions left this hour' : `${p.submissions_left_this_hour} left this hour`}
              </Text>
            )}
          </Box>
          <Button
            leftSection={<IconSend size={16} />}
            onClick={() => {
              setLocalError(null);
              m.mutate();
            }}
            loading={m.isPending}
            disabled={closed || !ready || noneLeft}
          >
            Submit for grading
          </Button>
        </Group>
      </Box>
    </Paper>
  );
}

// ---------------------------------------------------------------- page
function ProblemSkeleton() {
  return (
    <Stack gap="lg" aria-busy="true" aria-label="Loading the problem">
      <Skeleton h={26} w={260} />
      <Skeleton h={40} />
      <Grid gutter="lg">
        <Grid.Col span={{ base: 12, md: 7 }}>
          <Paper p="lg">
            <Stack gap="sm">
              {[90, 100, 70, 95, 60].map((w, i) => (
                <Skeleton key={i} h={12} w={`${w}%`} />
              ))}
            </Stack>
          </Paper>
        </Grid.Col>
        <Grid.Col span={{ base: 12, md: 5 }}>
          <Paper p="lg" h={320}>
            <Skeleton h={18} w="50%" mb="md" />
            <Skeleton h={180} />
          </Paper>
        </Grid.Col>
      </Grid>
    </Stack>
  );
}

export default function ProblemPage() {
  const { slug = '' } = useParams();
  const q = useQuery({ queryKey: ['problem', slug], queryFn: () => api.problem(slug) });
  const [watching, setWatching] = useState<Watching | null>(null);
  const panel = useRef<HTMLDivElement>(null);
  // After submitting, bring the live panel into view (it sits below the statement on phones).
  useEffect(() => {
    const el = panel.current;
    if (!watching || !el) return;
    const top = el.getBoundingClientRect().top;
    if (top < 52 || top > window.innerHeight * 0.6) {
      const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      window.scrollTo({ top: window.scrollY + top - 68, behavior: reduce ? 'auto' : 'smooth' });
    }
  }, [watching?.submissionId]); // eslint-disable-line react-hooks/exhaustive-deps

  // A submission that is still grading when the page opens: show its progress instead of the form.
  const latest = q.data?.my_latest;
  const runningId = latest && isActive(latest.job_status) ? latest.submission_id : null;
  const running = useQuery({
    queryKey: submissionKey(runningId ?? 0),
    queryFn: () => api.submission(runningId!),
    enabled: !!runningId && !watching,
  });
  useEffect(() => {
    if (!watching && runningId && running.data && isActive(running.data.job_status)) {
      setWatching({ jobId: running.data.job?.id ?? null, submissionId: runningId });
    }
  }, [watching, runningId, running.data]);

  if (q.isPending) return <ProblemSkeleton />;
  if (q.error)
    return (
      <>
        <PageHeader title="Problem" breadcrumbs={[{ label: 'Problems', to: '/dashboard' }, { label: slug }]} />
        <ErrorState error={q.error} onRetry={() => q.refetch()} backTo="/dashboard" backLabel="Back to problems" />
      </>
    );
  const p = q.data;

  return (
    <>
      <PageHeader
        title={p.title}
        description={
          p.my_count > 0 ? (
            <>
              {plural(p.my_count, 'submission')} ·{' '}
              <Anchor component={Link} to={`/history?problem=${encodeURIComponent(p.slug)}`}>
                History
              </Anchor>
            </>
          ) : undefined
        }
        breadcrumbs={[{ label: 'Problems', to: '/dashboard' }, { label: p.title }]}
      >
        <InfoStrip p={p} />
      </PageHeader>

      <Grid gutter="lg" align="flex-start">
        <Grid.Col span={{ base: 12, md: 6, lg: 7 }}>
          <Statement p={p} />
        </Grid.Col>
        <Grid.Col span={{ base: 12, md: 6, lg: 5 }}>
          <Box ref={panel}>
            {watching ? (
              <Stack gap="md">
                {p.finalized && (
                  <Alert color="gray" variant="light" icon={<IconLock size={18} />} title="Grading is closed" />
                )}
                <GradingPanel
                  key={watching.submissionId}
                  jobId={watching.jobId}
                  submissionId={watching.submissionId}
                  metrics={p.metrics}
                  onReset={p.finalized ? undefined : () => setWatching(null)}
                />
              </Stack>
            ) : (
              <SubmitPanel
                p={p}
                onSubmitted={(r) => setWatching({ jobId: r.job_id, submissionId: r.submission_id })}
                onWatch={setWatching}
              />
            )}
          </Box>
          <Box hiddenFrom="md" mt="md">
            <HowGraded metrics={p.metrics} />
          </Box>
        </Grid.Col>
      </Grid>
    </>
  );
}
