import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Alert, Anchor, Box, Button, Group, Paper, SimpleGrid, Stack, Stepper, Table, Text, TextInput } from '@mantine/core';
import { IconAlertTriangle, IconArrowLeft, IconArrowRight, IconCircleCheck } from '@tabler/icons-react';
import { api, ApiError, type ValidateResult } from '../../../api/client';
import { confirm, FileDrop, PageHeader } from '../../../components';
import { notify } from '../../../notify';
import { rulesLookValid, RulesEditor } from './RulesEditor';
import { fromLocalInput, parseRules, rulesText, SLUG_RE, slugify, templateRules } from './shared';
import { useLeaveGuard } from './useLeaveGuard';
import { ValidatePanel } from './ValidatePanel';
import { AssetDrop, StatementEditor } from './widgets';

interface Files {
  reference_c: File | null;
  sample_in: File | null;
  tests_zip: File | null;
}
const NO_FILES: Files = { reference_c: null, sample_in: null, tests_zip: null };

interface Saved {
  title: string;
  statement: string;
  rules: string;
  files: Files;
}

function rulesErrors(e: unknown): string[] | null {
  if (!(e instanceof ApiError)) return null;
  const errs = e.extra.errors;
  return Array.isArray(errs) ? errs.map(String) : null;
}

export function useAnalyzers() {
  const h = useQuery({ queryKey: ['staff', 'health'], queryFn: api.staff.health, staleTime: 5 * 60_000 });
  return h.data?.analyzers?.available;
}

/** /staff/problems/new: basics, rules, files, validate, publish. Creation only; editing uses tabs. */
export default function CreateWizard() {
  const nav = useNavigate();
  const qc = useQueryClient();
  const analyzers = useAnalyzers();
  const existing = useQuery({ queryKey: ['staff', 'problems'], queryFn: api.staff.problems });

  const [step, setStep] = useState(0);
  const [title, setTitle] = useState('');
  const [slugOwn, setSlugOwn] = useState<string | null>(null);
  const [statement, setStatement] = useState('');
  const [rulesOwn, setRulesOwn] = useState<string | null>(null);
  const [files, setFiles] = useState<Files>(NO_FILES);
  const [due, setDue] = useState('');
  const [opens, setOpens] = useState('');
  const [serverErrors, setServerErrors] = useState<string[]>([]);
  const [created, setCreated] = useState<string | null>(null);
  const [saved, setSaved] = useState<Saved | null>(null);
  const [result, setResult] = useState<ValidateResult | null>(null);
  const [finished, setFinished] = useState(false);

  const slug = created ?? slugOwn ?? slugify(title);
  const rules = rulesOwn ?? rulesText(templateRules(slug));
  const taken = !created && !!existing.data?.some((p) => p.slug === slug);
  const slugError = !slug ? null : !SLUG_RE.test(slug) ? 'Use a-z, 0-9, _ and -, starting with a letter or digit.' : taken ? `A problem called ${slug} already exists.` : null;

  const metaChanged = !!saved && (saved.title !== title || saved.statement !== statement);
  const gradingChanged = !!saved && (saved.rules !== rules || (Object.keys(files) as (keyof Files)[]).some((k) => files[k] !== saved.files[k]));
  const anyInput = !!(title || statement || rulesOwn || files.reference_c || files.tests_zip || files.sample_in);
  useLeaveGuard(!finished && (created ? metaChanged || gradingChanged : anyInput), created ? 'Unsaved changes.' : 'Not created yet.');

  const setFile = (k: keyof Files) => (f: File | null) => setFiles((s) => ({ ...s, [k]: f }));

  const steps = [
    { label: 'Basics', ok: !!title.trim() && !!slug && !slugError },
    { label: 'Grading rules', ok: rulesLookValid(rules) },
    { label: 'Files', ok: !!files.reference_c && !!files.tests_zip },
    { label: 'Validate', ok: !!created },
    { label: 'Publish', ok: true },
  ];
  const blockers = steps.slice(0, 3).filter((s) => !s.ok).map((s) => s.label.toLowerCase());

  const validate = useMutation({
    mutationFn: async () => {
      let s = created;
      if (!s) {
        const fd = new FormData();
        fd.append('slug', slug);
        fd.append('title', title.trim());
        fd.append('statement_md', statement);
        fd.append('rules_json', rules);
        fd.append('status', 'draft');
        for (const [k, f] of Object.entries(files)) if (f) fd.append(k, f, f.name);
        const p = await api.staff.createProblem(fd);
        s = p.slug;
        setCreated(s);
        notify.success(`Created ${title.trim() || s} as a draft`);
      } else {
        if (gradingChanged) {
          const fd = new FormData();
          if (saved!.rules !== rules) fd.append('rules_json', rules);
          for (const [k, f] of Object.entries(files)) if (f && f !== saved!.files[k as keyof Files]) fd.append(k, f, f.name);
          await api.staff.updateGrading(s, fd);
        }
        if (metaChanged) await api.staff.updateMeta(s, { title: title.trim(), statement_md: statement });
      }
      setSaved({ title, statement, rules, files });
      setServerErrors([]);
      qc.invalidateQueries({ queryKey: ['staff', 'problems'] });
      return api.staff.validate(s);
    },
    onSuccess: (r) => {
      setResult(r);
      if (r.ok) notify.success(`Validation passed: ${r.tests.length} of ${r.tests.length} tests`);
      else notify.info('Validation failed');
    },
    onError: (e) => {
      const errs = rulesErrors(e);
      if (errs) {
        setServerErrors(errs);
        setStep(1);
      }
      notify.error(e);
    },
  });

  const finish = useMutation({
    mutationFn: (publish: boolean) =>
      api.staff.updateMeta(created!, {
        ...(publish ? { status: 'published' as const } : {}),
        due_at: fromLocalInput(due),
        opens_at: fromLocalInput(opens),
      }),
    onSuccess: (p, publish) => {
      setFinished(true);
      qc.invalidateQueries({ queryKey: ['staff', 'problems'] });
      notify.success(publish ? `Published ${p.title}` : `Saved ${p.title} as a draft`);
      nav(`/staff/problems/${p.slug}`);
    },
    onError: (e) => notify.error(e),
  });

  const publish = async () => {
    if (!result) {
      const ok = await confirm({
        title: 'Publish without validation?',
        target: title,
        message: 'The reference has not been checked against the tests.',
        confirmLabel: 'Publish anyway',
        danger: true,
      });
      if (!ok) return;
    } else if (!result.ok) {
      const ok = await confirm({
        title: 'Publish despite failed validation?',
        target: title,
        message: 'Students may get wrong grades.',
        confirmLabel: 'Publish anyway',
        danger: true,
      });
      if (!ok) return;
    }
    finish.mutate(true);
  };

  const metrics = useMemo(() => parseRules(rules).value?.metrics ?? [], [rules]);
  const next = () => setStep((s) => Math.min(4, s + 1));
  const back = () => setStep((s) => Math.max(0, s - 1));

  return (
    <Stack gap="lg">
      <PageHeader
        title="New problem"
        breadcrumbs={[{ label: 'Course' }, { label: 'Problems', to: '/staff/problems' }, { label: 'New problem' }]}
      />
      <Paper p="lg">
        <Stepper
          active={step}
          onStepClick={(i) => (i <= step || steps.slice(0, i).every((s) => s.ok) ? setStep(i) : undefined)}
          size="sm"
          allowNextStepsSelect={false}
        >
          <Stepper.Step label="Basics" description="Title and statement">
            <Stack gap="md" mt="lg">
              <SimpleGrid cols={{ base: 1, sm: 2 }} maw={760}>
                <TextInput
                  label="Title"
                  placeholder="Problem title"
                  value={title}
                  onChange={(e) => setTitle(e.currentTarget.value)}
                  required
                  data-autofocus
                />
                <TextInput
                  label="Short name"
                  description={created ? 'Fixed' : 'Used in URLs. Cannot change later.'}
                  value={slug}
                  onChange={(e) => setSlugOwn(e.currentTarget.value.trim().toLowerCase())}
                  disabled={!!created}
                  error={slugError}
                  styles={{ input: { fontFamily: 'var(--mantine-font-family-monospace)' } }}
                  required
                />
              </SimpleGrid>
              <StatementEditor value={statement} onChange={setStatement} />
            </Stack>
          </Stepper.Step>

          <Stepper.Step label="Grading rules" description="Metrics and weights">
            <Box mt="lg">
              <RulesEditor
                text={rules}
                onChange={(t) => {
                  setRulesOwn(t);
                  setServerErrors([]);
                }}
                slug={slug}
                serverErrors={serverErrors}
                analyzers={analyzers}
              />
            </Box>
          </Stepper.Step>

          <Stepper.Step label="Files" description="Reference and tests">
            <Stack gap="lg" mt="lg" maw={640}>
              <Stack gap={6}>
                <Text size="sm" fw={500}>
                  Reference solution{' '}
                  <Text span c="fail.4" aria-hidden>
                    *
                  </Text>
                </Text>
                <Text size="sm" c="dimmed">
                  Its output is the expected output.
                </Text>
                <FileDrop value={files.reference_c} onChange={setFile('reference_c')} maxBytes={5 * 1024 * 1024} hint="Up to 5 MB" />
              </Stack>
              <AssetDrop
                label="Tests"
                description=".zip of 01.in, 02.in, ... (.out files optional)"
                extensions={['.zip']}
                value={files.tests_zip}
                onChange={setFile('tests_zip')}
                required
              />
              <AssetDrop
                label="Sample input"
                description="Shown to students"
                extensions={['.in', '.txt']}
                value={files.sample_in}
                onChange={setFile('sample_in')}
              />
            </Stack>
          </Stepper.Step>

          <Stepper.Step label="Validate" description="Check the reference">
            <Stack gap="md" mt="lg">
              {blockers.length > 0 ? (
                <Alert color="warn" variant="light" icon={<IconAlertTriangle size={18} />}>
                  Finish {blockers.join(', ')} first.
                </Alert>
              ) : (
                <ValidatePanel
                  result={result}
                  running={validate.isPending}
                  onRun={() => validate.mutate()}
                  error={validate.error}
                  runLabel={!created ? 'Create draft and validate' : gradingChanged || metaChanged ? 'Save changes and validate' : 'Validate again'}
                  note={
                    created
                      ? `Draft: ${created}`
                      : 'Creates a draft first'
                  }
                />
              )}
            </Stack>
          </Stepper.Step>

          <Stepper.Step label="Publish" description="Or keep as draft">
            <Stack gap="lg" mt="lg" maw={720}>
              {!result && (
                <Alert color="warn" variant="light" icon={<IconAlertTriangle size={18} />}>
                  Not validated yet.
                </Alert>
              )}
              {result && !result.ok && (
                <Alert color="warn" variant="light" icon={<IconAlertTriangle size={18} />}>
                  Validation failed.
                </Alert>
              )}
              <Table withRowBorders={false} verticalSpacing={4} maw={560}>
                <Table.Tbody>
                  <Table.Tr>
                    <Table.Td c="dimmed" w={160}>
                      Title
                    </Table.Td>
                    <Table.Td>{title}</Table.Td>
                  </Table.Tr>
                  <Table.Tr>
                    <Table.Td c="dimmed">Short name</Table.Td>
                    <Table.Td className="ag-mono">{slug}</Table.Td>
                  </Table.Tr>
                  <Table.Tr>
                    <Table.Td c="dimmed">Metrics</Table.Td>
                    <Table.Td>{metrics.map((m) => `${m.name} ${Math.round(m.weight * 100)}%`).join(', ')}</Table.Td>
                  </Table.Tr>
                  <Table.Tr>
                    <Table.Td c="dimmed">Validation</Table.Td>
                    <Table.Td>
                      {result ? (
                        result.ok ? (
                          <Group gap={4} c="pass.4">
                            <IconCircleCheck size={16} aria-hidden /> Passed, {result.tests.length} tests
                          </Group>
                        ) : (
                          <Text c="fail.4">Did not pass</Text>
                        )
                      ) : (
                        'Not run'
                      )}
                    </Table.Td>
                  </Table.Tr>
                </Table.Tbody>
              </Table>
              <SimpleGrid cols={{ base: 1, sm: 2 }}>
                <TextInput
                  type="datetime-local"
                  label="Deadline"
                  description="Local time. Optional."
                  value={due}
                  onChange={(e) => setDue(e.currentTarget.value)}
                />
                <TextInput
                  type="datetime-local"
                  label="Opens at"
                  description="Empty means now"
                  value={opens}
                  onChange={(e) => setOpens(e.currentTarget.value)}
                />
              </SimpleGrid>
              <Group>
                <Button onClick={publish} loading={finish.isPending && finish.variables === true} disabled={!created}>
                  Publish problem
                </Button>
                <Button variant="default" onClick={() => finish.mutate(false)} loading={finish.isPending && finish.variables === false} disabled={!created}>
                  Keep as draft
                </Button>
              </Group>
            </Stack>
          </Stepper.Step>
        </Stepper>

        <Group justify="space-between" mt="xl" pt="md" style={{ borderTop: '1px solid var(--ag-line)' }}>
          {step === 0 ? (
            <Anchor component={Link} to="/staff/problems" size="sm">
              Cancel
            </Anchor>
          ) : (
            <Button variant="default" leftSection={<IconArrowLeft size={16} />} onClick={back}>
              Back
            </Button>
          )}
          {step < 4 && (
            <Button rightSection={<IconArrowRight size={16} />} onClick={next} disabled={!steps[step].ok}>
              {step === 3 ? 'Next: publish' : 'Next'}
            </Button>
          )}
        </Group>
      </Paper>
    </Stack>
  );
}
