import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Alert,
  Badge,
  Box,
  Button,
  Checkbox,
  Group,
  NumberInput,
  Paper,
  SegmentedControl,
  Select,
  SimpleGrid,
  Stack,
  Switch,
  Tabs,
  Text,
  TextInput,
  Title,
  Tooltip,
} from '@mantine/core';
import {
  IconAlertTriangle,
  IconCircleCheck,
  IconFileCode,
  IconHistory,
  IconInfoCircle,
  IconListCheck,
  IconLock,
  IconLockOpen,
  IconPlayerPlay,
  IconRobot,
  IconSettings,
  IconTextCaption,
} from '@tabler/icons-react';
import {
  api,
  ApiError,
  type GradePolicy,
  type IntegrityPenalty,
  type ProblemMetaPatch,
  type ProblemStatus,
  type ProblemVersion,
  type ValidateResult,
} from '../../../api/client';
import { confirm, ErrorState, FileDrop, PageHeader, PageSkeleton, ResponsiveTable, StatusChip, type Column } from '../../../components';
import { fmtDate } from '../../../format';
import { notify } from '../../../notify';
import { CorpusTab } from './CorpusTab';
import { useAnalyzers } from './CreateWizard';
import { RulesEditor } from './RulesEditor';
import { fromLocalInput, parseRules, problemDetail, rulesText, toLocalInput, type StaffProblemDetail } from './shared';
import { useLeaveGuard } from './useLeaveGuard';
import { ValidatePanel } from './ValidatePanel';
import { AssetDrop, ProblemStatusChip, StatementEditor } from './widgets';

interface Settings {
  title: string;
  due: string;
  opens: string;
  status: ProblemStatus;
  grade_policy: GradePolicy;
  per_hour: number;
  penalty: IntegrityPenalty;
  show_best: boolean;
  reveal_hidden: boolean;
}

interface Files {
  reference_c: File | null;
  tests_zip: File | null;
  sample_in: File | null;
}
const NO_FILES: Files = { reference_c: null, tests_zip: null, sample_in: null };

function settingsOf(p: StaffProblemDetail): Settings {
  return {
    title: p.title,
    due: toLocalInput(p.due_at),
    opens: toLocalInput(p.opens_at),
    status: p.status ?? 'published',
    grade_policy: p.grade_policy ?? 'latest',
    per_hour: p.max_submissions_per_hour ?? 10,
    penalty: p.integrity_penalty ?? 'none',
    show_best: !!p.show_best_after_deadline,
    reveal_hidden: !!p.reveal_hidden_tests,
  };
}

const TABS = ['settings', 'statement', 'grading', 'validate', 'versions', 'corpus', 'finalize'] as const;
type Tab = (typeof TABS)[number];

// ---------------------------------------------------------------- settings
function SettingsTab({ s, set }: { s: Settings; set: (p: Partial<Settings>) => void }) {
  return (
    <Stack gap="lg" maw={760}>
      <TextInput label="Title" value={s.title} onChange={(e) => set({ title: e.currentTarget.value })} required error={!s.title.trim() ? 'Title is required.' : null} />
      <Stack gap={6}>
        <Text size="sm" fw={500}>
          Status
        </Text>
        <SegmentedControl
          w="fit-content"
          value={s.status}
          onChange={(v) => set({ status: v as ProblemStatus })}
          data={[
            { value: 'draft', label: 'Draft' },
            { value: 'published', label: 'Published' },
            { value: 'archived', label: 'Archived' },
          ]}
        />
        <Text size="sm" c="dimmed">
          {s.status === 'draft'
            ? 'Staff only'
            : s.status === 'published'
              ? 'Visible to students from the opening time'
              : 'Hidden. Grades are kept.'}
        </Text>
      </Stack>
      <SimpleGrid cols={{ base: 1, sm: 2 }}>
        <TextInput
          type="datetime-local"
          label="Deadline"
          description="Local time. Optional."
          value={s.due}
          onChange={(e) => set({ due: e.currentTarget.value })}
        />
        <TextInput
          type="datetime-local"
          label="Opens at"
          description="Empty means now"
          value={s.opens}
          onChange={(e) => set({ opens: e.currentTarget.value })}
        />
        <Select
          label="Grade that counts"
          data={[
            { value: 'latest', label: 'Latest submission' },
            { value: 'best', label: 'Best submission' },
          ]}
          value={s.grade_policy}
          onChange={(v) => v && set({ grade_policy: v as GradePolicy })}
          allowDeselect={false}
        />
        <NumberInput
          label="Submissions per hour"
          description="Per student"
          min={1}
          max={1000}
          value={s.per_hour}
          onChange={(v) => set({ per_hour: Math.max(1, Number(v) || 1) })}
        />
        <Select
          label="Penalty for confirmed copying"
          data={[
            { value: 'none', label: 'None (flag only)' },
            { value: 'half', label: 'Halve the grade' },
            { value: 'zero', label: 'Grade becomes 0' },
          ]}
          value={s.penalty}
          onChange={(v) => v && set({ penalty: v as IntegrityPenalty })}
          allowDeselect={false}
        />
      </SimpleGrid>
      <Switch
        label="Show top 3 solutions after the deadline"
        description="Only from students who allowed sharing"
        checked={s.show_best}
        onChange={(e) => set({ show_best: e.currentTarget.checked })}
      />
      <Stack gap={6}>
        <Switch
          label="Reveal hidden tests in student reports"
          description="Shows input and expected output of failed hidden tests"
          checked={s.reveal_hidden}
          onChange={(e) => set({ reveal_hidden: e.currentTarget.checked })}
        />
        {s.reveal_hidden && (
          <Alert color="warn" variant="light" icon={<IconAlertTriangle size={18} />}>
            Students can hard-code answers. Use only after the deadline or for practice.
          </Alert>
        )}
      </Stack>
    </Stack>
  );
}

// ---------------------------------------------------------------- versions
function VersionsTab({ slug }: { slug: string }) {
  const q = useQuery({ queryKey: ['staff', 'versions', slug], queryFn: () => api.staff.versions(slug) });
  const hash = (h: string | null) =>
    h ? (
      <Tooltip label={h}>
        <span>{h.replace(/^sha256(v2)?:/, '').slice(0, 10)}</span>
      </Tooltip>
    ) : (
      '-'
    );
  const columns: Column<ProblemVersion & { current?: boolean }>[] = [
    {
      key: 'v',
      header: 'Version',
      cell: (v) => (
        <Group gap={6} wrap="nowrap">
          <Text size="sm" fw={600}>
            v{v.version}
          </Text>
          {v.current && (
            <Badge size="sm" variant="light" color="iris">
              Current
            </Badge>
          )}
        </Group>
      ),
    },
    { key: 'at', header: 'Created', cell: (v) => fmtDate(v.created_at) },
    { key: 'rules', header: 'Rules hash', mono: true, cell: (v) => hash(v.rules_hash) },
    { key: 'inputs', header: 'Tests hash', mono: true, cell: (v) => hash(v.inputs_hash) },
    { key: 'n', header: 'Submissions', align: 'right', cell: (v) => v.n_submissions },
  ];
  if (q.error) return <ErrorState error={q.error} onRetry={() => q.refetch()} backTo={false} compact />;
  return (
    <Stack gap="sm">
      <ResponsiveTable data={q.data ?? []} loading={q.isPending} columns={columns} rowKey={(v) => v.version} minWidth={560} caption="Versions" />
    </Stack>
  );
}

// ---------------------------------------------------------------- finalize
function FinalizeTab({ p, nStudents, onChanged }: { p: StaffProblemDetail; nStudents: number | null; onChanged: () => void }) {
  const finalized = !!p.finalized_at;
  const fin = useMutation({
    mutationFn: () => api.staff.finalize(p.slug),
    onSuccess: (r) => {
      notify.success(`Finalized ${p.title}. Regrade queued for ${r.job_ids.length} submission${r.job_ids.length === 1 ? '' : 's'}`);
      onChanged();
    },
    onError: (e) => notify.error(e),
  });
  const reopen = useMutation({
    mutationFn: () => api.staff.reopen(p.slug),
    onSuccess: () => {
      notify.success(`Reopened ${p.title}`);
      onChanged();
    },
    onError: (e) => notify.error(e),
  });
  return (
    <Stack gap="md" maw={720}>
      {finalized ? (
        <Alert color="info" variant="light" icon={<IconLock size={18} />} title={`Finalized ${fmtDate(p.finalized_at)}`}>
          Submissions closed.
        </Alert>
      ) : (
        <Text size="sm" c="dimmed">
          Closes submissions and regrades each counted submission against the final peers. Do this after the deadline.
        </Text>
      )}
      <Group>
        {finalized ? (
          <Button
            variant="default"
            leftSection={<IconLockOpen size={16} />}
            loading={reopen.isPending}
            onClick={async () => {
              const ok = await confirm({
                title: 'Reopen this problem?',
                target: p.title,
                message: 'Students can submit again. Grades are kept.',
                confirmLabel: 'Reopen problem',
                danger: true,
              });
              if (ok) reopen.mutate();
            }}
          >
            Reopen problem
          </Button>
        ) : (
          <Button
            color="fail"
            leftSection={<IconLock size={16} />}
            loading={fin.isPending}
            onClick={async () => {
              const ok = await confirm({
                title: 'Finalize grades?',
                target: `${p.title}${nStudents !== null ? ` (${nStudents} student${nStudents === 1 ? '' : 's'})` : ''}`,
                message: 'Closes submissions and regrades counted submissions.',
                confirmLabel: 'Finalize grades',
                danger: true,
              });
              if (ok) fin.mutate();
            }}
          >
            Finalize grades
          </Button>
        )}
      </Group>
    </Stack>
  );
}

// ---------------------------------------------------------------- editor
function Editor({ p, onSaved }: { p: StaffProblemDetail; onSaved: () => Promise<unknown> }) {
  const qc = useQueryClient();
  const analyzers = useAnalyzers();
  const [params, setParams] = useSearchParams();
  const tab: Tab = (TABS as readonly string[]).includes(params.get('tab') ?? '') ? (params.get('tab') as Tab) : 'settings';
  const setTab = (t: string | null) =>
    setParams(
      (prev) => {
        const n = new URLSearchParams(prev);
        n.set('tab', t ?? 'settings');
        return n;
      },
      { replace: true },
    );

  const base = useMemo(() => settingsOf(p), [p]);
  const baseStatement = p.statement_raw ?? p.statement_md ?? '';
  const baseRules = useMemo(() => rulesText(p.rules_json ?? {}), [p.rules_json]);

  const [s, setS] = useState<Settings>(base);
  const [statement, setStatement] = useState(baseStatement);
  const [rules, setRules] = useState(baseRules);
  const [files, setFiles] = useState<Files>(NO_FILES);
  const [regrade, setRegrade] = useState(false);
  const [serverErrors, setServerErrors] = useState<string[]>([]);
  const [result, setResult] = useState<ValidateResult | null>(null);

  const row = useQuery({ queryKey: ['staff', 'problems'], queryFn: api.staff.problems }).data?.find((r) => r.slug === p.slug);

  const metaPatch: ProblemMetaPatch = {};
  if (s.title !== base.title) metaPatch.title = s.title.trim();
  if (s.due !== base.due) metaPatch.due_at = fromLocalInput(s.due);
  if (s.opens !== base.opens) metaPatch.opens_at = fromLocalInput(s.opens);
  if (s.status !== base.status) metaPatch.status = s.status;
  if (s.grade_policy !== base.grade_policy) metaPatch.grade_policy = s.grade_policy;
  if (s.per_hour !== base.per_hour) metaPatch.max_submissions_per_hour = s.per_hour;
  if (s.penalty !== base.penalty) metaPatch.integrity_penalty = s.penalty;
  if (s.show_best !== base.show_best) metaPatch.show_best_after_deadline = s.show_best;
  if (s.reveal_hidden !== base.reveal_hidden) metaPatch.reveal_hidden_tests = s.reveal_hidden;
  const settingsDirty = Object.keys(metaPatch).length > 0;
  const statementDirty = statement !== baseStatement;
  const rulesDirty = rules !== baseRules;
  const gradingDirty = rulesDirty || Object.values(files).some(Boolean);
  const dirtyParts = [settingsDirty && 'Settings', statementDirty && 'Statement', gradingDirty && 'Grading'].filter(Boolean) as string[];
  const dirty = dirtyParts.length > 0;
  const rulesBroken = rulesDirty && !parseRules(rules).value;
  useLeaveGuard(dirty, `Unsaved changes in ${dirtyParts.join(', ').toLowerCase()}.`);

  const save = useMutation({
    mutationFn: async () => {
      const done: string[] = [];
      if (settingsDirty || statementDirty) {
        await api.staff.updateMeta(p.slug, { ...metaPatch, ...(statementDirty ? { statement_md: statement } : {}) });
      }
      let version: number | null = null;
      let queued: number | null = null;
      if (gradingDirty) {
        const fd = new FormData();
        if (rulesDirty) fd.append('rules_json', rules);
        for (const [k, f] of Object.entries(files)) if (f) fd.append(k, f, f.name);
        version = (await api.staff.updateGrading(p.slug, fd)).version;
        if (regrade) queued = (await api.staff.regrade({ problem_slug: p.slug })).job_ids.length;
      }
      done.push(version ? `Saved changes. Now version ${version}` : 'Saved changes');
      if (queued !== null) done.push(`regrade queued for ${queued} submission${queued === 1 ? '' : 's'}`);
      return done.join('; ');
    },
    onSuccess: async (msg) => {
      notify.success(msg);
      setServerErrors([]);
      qc.invalidateQueries({ queryKey: ['staff', 'problems'] });
      qc.invalidateQueries({ queryKey: ['staff', 'versions', p.slug] });
      await onSaved();
    },
    onError: (e) => {
      const errs = e instanceof ApiError && Array.isArray(e.extra.errors) ? e.extra.errors.map(String) : null;
      if (errs) {
        setServerErrors(errs);
        setTab('grading');
      }
      notify.error(e);
    },
  });

  // Regrading every student is a bulk action: confirm it, naming the problem.
  const saveClick = async () => {
    if (gradingDirty && regrade) {
      const ok = await confirm({
        title: `Save version ${p.version + 1} and regrade everyone?`,
        target: p.title,
        message: 'Overrides stay in place.',
        confirmLabel: 'Save and regrade',
      });
      if (!ok) return;
    }
    save.mutate();
  };

  const discard = async () => {
    const ok = await confirm({
      title: 'Discard your changes?',
      target: dirtyParts.join(', '),
      confirmLabel: 'Discard changes',
      danger: true,
    });
    if (!ok) return;
    setS(base);
    setStatement(baseStatement);
    setRules(baseRules);
    setFiles(NO_FILES);
    setServerErrors([]);
  };

  const validate = useMutation({
    mutationFn: () => api.staff.validate(p.slug),
    onSuccess: (r) => {
      setResult(r);
      if (r.ok) notify.success(`Validation passed: ${r.tests.length} of ${r.tests.length} tests`);
      else notify.info('Validation found problems. See the results.');
    },
    onError: (e) => notify.error(e),
  });

  const setFile = (k: keyof Files) => (f: File | null) => setFiles((x) => ({ ...x, [k]: f }));
  const dot = (on: boolean) => (on ? <Box component="span" w={6} h={6} ml={4} style={{ borderRadius: 3, background: 'var(--ag-warn)', display: 'inline-block' }} aria-label="unsaved" /> : null);

  return (
    <Stack gap="lg" pb={dirty ? 0 : 'lg'}>
      <PageHeader
        title={p.title}
        documentTitle={`Edit ${p.title}`}
        breadcrumbs={[{ label: 'Course' }, { label: 'Problems', to: '/staff/problems' }, { label: p.title }]}
        actions={
          <>
            <Button variant="default" component={Link} to={`/staff/submissions?problem=${encodeURIComponent(p.slug)}`} leftSection={<IconListCheck size={16} />}>
              View submissions
            </Button>
          </>
        }
      >
        <Group gap="xs">
          <Text className="ag-mono" fz={13} c="dimmed">
            {p.slug}
          </Text>
          <ProblemStatusChip status={p.status} />
          <Badge variant="light" color="gray" size="sm" tt="none">
            Version {p.version}
          </Badge>
          {p.finalized_at && <StatusChip kind="custom" tone="info" icon={IconLock} label="Finalized" size="sm" />}
        </Group>
      </PageHeader>

      <Tabs value={tab} onChange={setTab}>
        <Tabs.List mb="lg" style={{ overflowX: 'auto', flexWrap: 'nowrap' }}>
          <Tabs.Tab value="settings" leftSection={<IconSettings size={15} />}>
            Settings{dot(settingsDirty)}
          </Tabs.Tab>
          <Tabs.Tab value="statement" leftSection={<IconTextCaption size={15} />}>
            Statement{dot(statementDirty)}
          </Tabs.Tab>
          <Tabs.Tab value="grading" leftSection={<IconFileCode size={15} />}>
            Grading{dot(gradingDirty)}
          </Tabs.Tab>
          <Tabs.Tab value="validate" leftSection={<IconPlayerPlay size={15} />}>
            Validate
          </Tabs.Tab>
          <Tabs.Tab value="versions" leftSection={<IconHistory size={15} />}>
            Versions
          </Tabs.Tab>
          <Tabs.Tab value="corpus" leftSection={<IconRobot size={15} />}>
            AI-origin corpus
          </Tabs.Tab>
          <Tabs.Tab value="finalize" leftSection={<IconLock size={15} />}>
            Finalize
          </Tabs.Tab>
        </Tabs.List>

        <Tabs.Panel value="settings">
          <SettingsTab s={s} set={(x) => setS((o) => ({ ...o, ...x }))} />
        </Tabs.Panel>
        <Tabs.Panel value="statement">
          <StatementEditor value={statement} onChange={setStatement} minRows={22} />
        </Tabs.Panel>
        <Tabs.Panel value="grading">
          <Stack gap="lg">
            <Alert color={gradingDirty ? 'warn' : 'info'} variant="light" icon={gradingDirty ? <IconAlertTriangle size={18} /> : <IconInfoCircle size={18} />}>
              {gradingDirty
                ? `Saving creates version ${p.version + 1}. Existing grades stay on v${p.version} until regraded.`
                : `Version ${p.version}. Grading changes create a new version.`}
            </Alert>
            <RulesEditor
              text={rules}
              onChange={(t) => {
                setRules(t);
                setServerErrors([]);
              }}
              slug={p.slug}
              serverErrors={serverErrors}
              analyzers={analyzers}
            />
            <Title order={2} fz={20} mt="sm">
              Files
            </Title>
            <SimpleGrid cols={{ base: 1, md: 3 }} spacing="lg">
              <Stack gap={6}>
                <Text size="sm" fw={500}>
                  Reference solution
                </Text>
                <Text size="sm" c="dimmed">
                  Empty keeps the current one
                </Text>
                <FileDrop value={files.reference_c} onChange={setFile('reference_c')} maxBytes={5 * 1024 * 1024} preview={false} hint="Up to 5 MB" />
              </Stack>
              <AssetDrop
                label="Tests"
                description=".zip of .in/.out files. Empty keeps the current one"
                extensions={['.zip']}
                value={files.tests_zip}
                onChange={setFile('tests_zip')}
              />
              <AssetDrop
                label="Sample input"
                description="Empty keeps the current one"
                extensions={['.in', '.txt']}
                value={files.sample_in}
                onChange={setFile('sample_in')}
              />
            </SimpleGrid>
          </Stack>
        </Tabs.Panel>
        <Tabs.Panel value="validate">
          <ValidatePanel
            result={result}
            running={validate.isPending}
            onRun={() => validate.mutate()}
            error={validate.error}
            note={gradingDirty ? `Checks saved v${p.version}, not unsaved changes` : `Checks v${p.version}`}
          />
        </Tabs.Panel>
        <Tabs.Panel value="versions">
          <VersionsTab slug={p.slug} />
        </Tabs.Panel>
        <Tabs.Panel value="corpus">
          <CorpusTab slug={p.slug} />
        </Tabs.Panel>
        <Tabs.Panel value="finalize">
          <FinalizeTab p={p} nStudents={row?.n_students ?? null} onChanged={onSaved} />
        </Tabs.Panel>
      </Tabs>

      {dirty && (
        <Paper
          p="sm"
          px="md"
          role="region"
          aria-label="Unsaved changes"
          style={{
            position: 'sticky',
            bottom: 12,
            zIndex: 20,
            borderColor: 'var(--ag-warn)',
            boxShadow: '0 8px 24px rgba(0,0,0,0.45)',
          }}
        >
          <Group justify="space-between" gap="sm" wrap="wrap">
            <Stack gap={2} style={{ minWidth: 0, flex: '1 1 320px' }}>
              <Text size="sm" fw={600}>
                Unsaved changes in {dirtyParts.join(', ').toLowerCase()}
              </Text>
              {gradingDirty ? (
                <Group gap="md" wrap="wrap">
                  <Text size="sm" c="warn.4">
                    Creates version {p.version + 1}
                  </Text>
                  <Checkbox size="xs" label="Regrade all after saving" checked={regrade} onChange={(e) => setRegrade(e.currentTarget.checked)} />
                </Group>
              ) : (
                <Text size="sm" c="dimmed">
                  No new version
                </Text>
              )}
            </Stack>
            <Group gap="xs">
              <Button variant="default" onClick={discard} disabled={save.isPending}>
                Discard
              </Button>
              <Button
                onClick={saveClick}
                loading={save.isPending}
                disabled={rulesBroken || !s.title.trim()}
                leftSection={<IconCircleCheck size={16} />}
              >
                Save changes
              </Button>
            </Group>
          </Group>
        </Paper>
      )}
    </Stack>
  );
}

export default function EditProblem({ slug }: { slug: string }) {
  const q = useQuery({ queryKey: ['staff', 'problem', slug], queryFn: () => problemDetail(slug) });
  const [gen, setGen] = useState(0);
  if (q.isPending) return <PageSkeleton />;
  if (q.error)
    return (
      <Stack>
        <PageHeader title="Problem" breadcrumbs={[{ label: 'Course' }, { label: 'Problems', to: '/staff/problems' }, { label: slug }]} />
        <ErrorState error={q.error} onRetry={() => q.refetch()} backTo="/staff/problems" backLabel="Back to problems" />
      </Stack>
    );
  return (
    <Editor
      key={`${q.data.version}-${gen}`}
      p={q.data}
      onSaved={async () => {
        await q.refetch();
        setGen((g) => g + 1);
      }}
    />
  );
}

