import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ActionIcon,
  Alert,
  Button,
  Group,
  List,
  Menu,
  Modal,
  MultiSelect,
  Paper,
  SimpleGrid,
  Stack,
  TagsInput,
  Text,
  Textarea,
  TextInput,
  Title,
} from '@mantine/core';
import { IconDotsVertical, IconEye, IconRobot, IconSparkles, IconTrash, IconWorld } from '@tabler/icons-react';
import { api, type CorpusItem, type CorpusResult, type JobInfo, type WebCorpusResult } from '../../../api/client';
import { useJobEvents } from '../../../api/sse';
import { CodeBlock, confirm, EmptyState, fmtBytes, LogStream, ResponsiveTable, StatusChip, type Column } from '../../../components';
import { notify } from '../../../notify';

const PROMPTS = [
  { value: '1', label: 'Plain solution' },
  { value: '2', label: 'First-year student style' },
  { value: '3', label: 'Commented, with helpers' },
  { value: '4', label: 'Edge-case focused' },
];
const TEMPS = ['0', '0.2', '0.5', '0.7', '1'];
const SECONDS_PER_PROGRAM = 20;

function asResult(r: unknown): CorpusResult | null {
  if (!r || typeof r !== 'object') return null;
  const o = r as Partial<CorpusResult>;
  return typeof o.requested === 'number' ? { requested: o.requested, kept: o.kept ?? 0, failed: o.failed ?? 0, reasons: o.reasons ?? [] } : null;
}

function JobProgress({ jobId, onDone }: { jobId: number; onDone: () => void }) {
  const ev = useJobEvents(jobId);
  const finished = ev.done || ev.status === 'done' || ev.status === 'failed' || ev.status === 'cancelled';
  const job = useQuery<JobInfo>({
    queryKey: ['job', jobId],
    queryFn: () => api.job(jobId),
    refetchInterval: (q) => (['done', 'failed', 'cancelled'].includes(q.state.data?.status ?? '') ? false : finished ? 1000 : 4000),
  });
  const status = job.data?.status ?? ev.status ?? 'queued';
  const result = asResult(job.data?.result);
  const ended = ['done', 'failed'].includes(job.data?.status ?? '');
  useEffect(() => {
    if (ended) onDone();
  }, [ended]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <Stack gap="sm">
      <Group gap="xs">
        <Text size="sm" fw={500}>
          Generation {jobId}
        </Text>
        <StatusChip kind="job" status={status} size="sm" />
      </Group>
      {result && (
        <SimpleGrid cols={3} maw={420}>
          {(
            [
              ['Requested', result.requested, 'gray'],
              ['Kept', result.kept, result.kept ? 'pass' : 'warn'],
              ['Failed', result.failed, result.failed ? 'fail' : 'gray'],
            ] as const
          ).map(([label, n, tone]) => (
            <Paper key={label} p="sm">
              <Text size="sm" c="dimmed">
                {label}
              </Text>
              <Text fz={22} fw={600} c={tone === 'gray' ? undefined : `${tone}.4`} className="ag-num">
                {n}
              </Text>
            </Paper>
          ))}
        </SimpleGrid>
      )}
      {result && result.reasons.length > 0 && (
        <Alert color={result.kept ? 'warn' : 'fail'} variant="light" title={result.kept ? 'Some programs dropped' : 'No programs kept'}>
          <List size="sm">
            {result.reasons.map((r, i) => (
              <List.Item key={i}>{r}</List.Item>
            ))}
          </List>
        </Alert>
      )}
      {!result && job.data?.error && (
        <Alert color="fail" variant="light">
          {job.data.error}
        </Alert>
      )}
      <LogStream events={ev.events} height={200} emptyText="Queued" />
    </Stack>
  );
}

export function CorpusTab({ slug }: { slug: string }) {
  const qc = useQueryClient();
  const health = useQuery({ queryKey: ['staff', 'health'], queryFn: api.staff.health, staleTime: 5 * 60_000 });
  const items = useQuery({ queryKey: ['staff', 'corpus', slug], queryFn: () => api.staff.corpus(slug) });
  const [preview, setPreview] = useState<CorpusItem | null>(null);
  const [models, setModels] = useState<string[]>([]);
  const [prompts, setPrompts] = useState<string[]>(PROMPTS.map((p) => p.value));
  const [temps, setTemps] = useState<string[]>(['0.2', '0.7', '1']);
  const [seeds, setSeeds] = useState<string[]>(['1001', '1002']);
  const [jobId, setJobId] = useState<number | null>(null);
  const [webUrls, setWebUrls] = useState('');
  const [webQuery, setWebQuery] = useState('');
  const [webResult, setWebResult] = useState<WebCorpusResult | null>(null);
  const urlList = webUrls.split(/\s+/).map((u) => u.trim()).filter(Boolean);

  const web = useMutation({
    mutationFn: () => api.staff.webCorpus(slug, { urls: urlList, query: webQuery.trim() || undefined }),
    onSuccess: (r) => {
      setWebResult(r);
      notify.success(`Saved ${r.kept.length} web solution${r.kept.length === 1 ? '' : 's'}`);
      qc.invalidateQueries({ queryKey: ['staff', 'corpus', slug] });
    },
    onError: (e) => notify.error(e),
  });

  const ollama = health.data?.ollama;
  const modelOptions = Array.from(new Set([...(ollama?.models ?? []), ollama?.defaultModel ?? 'qwen2.5-coder:7b'].filter(Boolean) as string[]));
  const chosenModels = models.length ? models : [modelOptions[0]];
  const validSeeds = seeds.filter((s) => /^\d{1,9}$/.test(s));
  const n = chosenModels.length * prompts.length * temps.length * validSeeds.length;
  const minutes = Math.max(1, Math.round((n * SECONDS_PER_PROGRAM) / 60));

  const del = useMutation({
    mutationFn: (it: CorpusItem) => api.staff.deleteCorpus(slug, it.kind, it.file),
    onSuccess: (_, it) => {
      notify.success(`Deleted ${it.file}`);
      qc.invalidateQueries({ queryKey: ['staff', 'corpus', slug] });
    },
    onError: (e) => notify.error(e),
  });

  const gen = useMutation({
    mutationFn: () =>
      api.staff.llmCorpus(slug, {
        models: chosenModels,
        prompts: prompts.map(Number),
        temps: temps.map(Number),
        seeds: validSeeds.map(Number),
      }),
    onSuccess: (r) => {
      setJobId(r.job_id);
      notify.success(`Generation queued: ${n} program${n === 1 ? '' : 's'}`);
    },
    onError: (e) => notify.error(e),
  });

  const columns: Column<CorpusItem>[] = [
    { key: 'file', header: 'File', mono: true, cell: (it) => it.file },
    {
      key: 'kind',
      header: 'Source',
      cell: (it) =>
        it.kind === 'llm' ? (
          <StatusChip kind="custom" tone="info" icon={IconRobot} label="AI generated" size="sm" />
        ) : (
          <StatusChip kind="custom" tone="gray" icon={IconWorld} label="Web" size="sm" />
        ),
    },
    { key: 'size', header: 'Size', align: 'right', cell: (it) => fmtBytes(it.size) },
  ];

  const remove = async (it: CorpusItem) => {
    const ok = await confirm({
      title: 'Delete this corpus file?',
      target: it.file,
      message: 'Existing flags are kept.',
      confirmLabel: 'Delete file',
      danger: true,
    });
    if (ok) del.mutate(it);
  };

  return (
    <Stack gap="xl">
      <Stack gap="sm">
        <Title order={2} fz={20}>
          Current corpus
        </Title>
        <ResponsiveTable
          data={items.data ?? []}
          loading={items.isPending}
          columns={columns}
          rowKey={(it) => `${it.kind}/${it.file}`}
          minWidth={520}
          maxHeight={360}
          caption="Corpus files"
          empty={
            <EmptyState
              compact
              icon={IconRobot}
              title="No corpus files yet"
            />
          }
          rowActions={(it) => (
            <Menu position="bottom-end" withinPortal>
              <Menu.Target>
                <ActionIcon variant="subtle" color="gray" aria-label={`Actions for ${it.file}`}>
                  <IconDotsVertical size={16} />
                </ActionIcon>
              </Menu.Target>
              <Menu.Dropdown>
                <Menu.Item leftSection={<IconEye size={15} />} onClick={() => setPreview(it)}>
                  Preview
                </Menu.Item>
                <Menu.Item color="fail" leftSection={<IconTrash size={15} />} onClick={() => remove(it)}>
                  Delete file
                </Menu.Item>
              </Menu.Dropdown>
            </Menu>
          )}
        />
      </Stack>

      <Stack gap="sm">
        <Title order={2} fz={20}>
          Find web solutions
        </Title>
        <Text size="sm" c="dimmed" maw={760}>
          Search the problem in your browser and paste the result pages (GeeksforGeeks, Programiz, ...). C programs on
          those pages are saved as known web solutions, and every submission is compared with them. Student code is
          never sent anywhere.
        </Text>
        <SimpleGrid cols={{ base: 1, md: 2 }} maw={880}>
          <Textarea
            label="Page URLs"
            description="One per line"
            autosize
            minRows={3}
            value={webUrls}
            onChange={(e) => setWebUrls(e.currentTarget.value)}
            placeholder="https://www.geeksforgeeks.org/..."
          />
          <TextInput
            label="Search query (optional)"
            description="Needs a search API key on the server"
            value={webQuery}
            onChange={(e) => setWebQuery(e.currentTarget.value)}
            placeholder="C program to check prime number"
          />
        </SimpleGrid>
        <Group gap="md">
          <Button
            leftSection={<IconWorld size={16} />}
            onClick={() => web.mutate()}
            loading={web.isPending}
            disabled={urlList.length === 0 && !webQuery.trim()}
          >
            Save web solutions
          </Button>
        </Group>
        {webResult && (
          <Paper p="md">
            <List size="sm" spacing={4}>
              {webResult.pages.map((pg) => (
                <List.Item key={pg.url}>
                  {pg.kept}/{pg.programs} saved · {pg.status} · <Text span ff="monospace" size="xs">{pg.url}</Text>
                </List.Item>
              ))}
            </List>
          </Paper>
        )}
      </Stack>

      <Stack gap="sm">
        <Title order={2} fz={20}>
          Generate AI solutions
        </Title>
        {ollama && !ollama.running && (
          <Alert color="warn" variant="light">
            Local model server is not running. {ollama.error ?? ''}
          </Alert>
        )}
        <SimpleGrid cols={{ base: 1, md: 2 }} maw={880}>
          <TagsInput
            label="Models"
            description={models.length ? undefined : `Default: ${modelOptions[0]}`}
            data={modelOptions}
            value={models}
            onChange={setModels}
            placeholder={models.length ? undefined : modelOptions[0]}
            clearable
          />
          <MultiSelect label="Prompts" data={PROMPTS} value={prompts} onChange={setPrompts} />
          <MultiSelect
            label="Temperatures"
            data={TEMPS}
            value={temps}
            onChange={(v) => setTemps(v.sort((a, b) => Number(a) - Number(b)))}
          />
          <TagsInput
            label="Seeds"
            description="Press Enter after each"
            value={seeds}
            onChange={(v) => setSeeds(v.filter((s) => /^\d{1,9}$/.test(s.trim())).map((s) => s.trim()))}
          />
        </SimpleGrid>
        <Group gap="md">
          <Button
            leftSection={<IconSparkles size={16} />}
            onClick={() => gen.mutate()}
            loading={gen.isPending}
            disabled={n === 0}
          >
            Generate {n} program{n === 1 ? '' : 's'}
          </Button>
          <Text size="sm" c="dimmed">
            {n === 0 ? 'Pick at least one of each' : `About ${minutes} min`}
          </Text>
        </Group>
        {jobId !== null && (
          <Paper p="md">
            <JobProgress key={jobId} jobId={jobId} onDone={() => qc.invalidateQueries({ queryKey: ['staff', 'corpus', slug] })} />
          </Paper>
        )}
      </Stack>

      <Modal opened={!!preview} onClose={() => setPreview(null)} title={preview?.file} size="xl">
        {preview && <CodeBlock code={preview.preview} label="First 30 lines" lineNumbers maxHeight={480} />}
      </Modal>
    </Stack>
  );
}
