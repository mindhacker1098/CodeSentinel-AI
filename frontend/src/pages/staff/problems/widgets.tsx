import { lazy, Suspense, useEffect, useState } from 'react';
import {
  Alert,
  Badge,
  Box,
  Button,
  Group,
  Paper,
  SegmentedControl,
  SimpleGrid,
  Skeleton,
  Stack,
  Text,
  Textarea,
} from '@mantine/core';
import { Dropzone } from '@mantine/dropzone';
import {
  IconAlertCircle,
  IconArchive,
  IconCircleCheck,
  IconFile,
  IconFileZip,
  IconPencil,
  IconTrash,
  IconUpload,
} from '@tabler/icons-react';
import type { ProblemStatus } from '../../../api/client';
import { fmtBytes, Markdown, StatusChip } from '../../../components';
import type { JsonEditorProps } from './JsonEditorImpl';
import { STATUS_LABEL } from './shared';

const JsonEditorImpl = lazy(() => import('./JsonEditorImpl'));

export function JsonEditor(props: JsonEditorProps) {
  return (
    <Suspense fallback={<Skeleton h={props.height ?? 420} />}>
      <JsonEditorImpl {...props} />
    </Suspense>
  );
}

export function ProblemStatusChip({ status, size = 'sm' }: { status: ProblemStatus; size?: 'sm' | 'md' }) {
  if (status === 'published') return <StatusChip kind="custom" tone="pass" icon={IconCircleCheck} label={STATUS_LABEL.published} size={size} />;
  if (status === 'archived') return <StatusChip kind="custom" tone="gray" icon={IconArchive} label={STATUS_LABEL.archived} size={size} />;
  return <StatusChip kind="custom" tone="info" icon={IconPencil} label={STATUS_LABEL.draft} size={size} />;
}

export interface AssetDropProps {
  label: string;
  description: string;
  /** e.g. ['.zip'] */
  extensions: string[];
  value: File | null;
  onChange: (f: File | null) => void;
  maxBytes?: number;
  required?: boolean;
  /** Shown when nothing is chosen, e.g. "Keeps reference.c from version 2". */
  keepHint?: string;
}

/** Drop or choose one non-C asset (tests zip, sample input). Same look as the shared FileDrop. */
export function AssetDrop({ label, description, extensions, value, onChange, maxBytes = 5 * 1024 * 1024, required, keepHint }: AssetDropProps) {
  const [error, setError] = useState<string | null>(null);
  const zip = extensions.includes('.zip');
  const Icon = zip ? IconFileZip : IconFile;
  const take = (files: File[]) => {
    const f = files[0];
    if (!f) return;
    const lower = f.name.toLowerCase();
    let err: string | null = null;
    if (!extensions.some((e) => lower.endsWith(e))) err = `"${f.name}" is not a ${extensions.join(' or ')} file.`;
    else if (f.size === 0) err = 'This file is empty.';
    else if (f.size > maxBytes) err = `This file is ${fmtBytes(f.size)}. The limit is ${fmtBytes(maxBytes)}.`;
    setError(err);
    onChange(err ? null : f);
  };
  return (
    <Stack gap={6}>
      <Box>
        <Text size="sm" fw={500}>
          {label}
          {required && (
            <Text span c="fail.4" aria-hidden>
              {' '}
              *
            </Text>
          )}
        </Text>
        <Text size="sm" c="dimmed">
          {description}
        </Text>
      </Box>
      {value ? (
        <Paper p="sm">
          <Group justify="space-between" wrap="nowrap">
            <Group gap="sm" wrap="nowrap" style={{ minWidth: 0 }}>
              <Icon size={22} stroke={1.6} color="var(--ag-iris)" aria-hidden />
              <Box style={{ minWidth: 0 }}>
                <Text className="ag-mono" fz={13} truncate>
                  {value.name}
                </Text>
                <Text size="sm" c="dimmed">
                  {fmtBytes(value.size)}
                </Text>
              </Box>
            </Group>
            <Button variant="subtle" color="gray" size="xs" leftSection={<IconTrash size={14} />} onClick={() => onChange(null)}>
              Remove
            </Button>
          </Group>
        </Paper>
      ) : (
        <Dropzone
          onDrop={take}
          onReject={(rej) => take(rej.map((r) => r.file))}
          multiple={false}
          styles={{ root: { background: 'var(--ag-bg)', borderColor: error ? 'var(--ag-fail)' : 'var(--ag-line)', padding: 12 } }}
          aria-label={`Choose ${label}`}
        >
          <Group gap="sm" mih={48} style={{ pointerEvents: 'none' }} wrap="nowrap">
            <Dropzone.Idle>
              <Icon size={26} stroke={1.5} color="var(--ag-muted)" />
            </Dropzone.Idle>
            <Dropzone.Accept>
              <IconUpload size={26} stroke={1.5} color="var(--ag-iris)" />
            </Dropzone.Accept>
            <Dropzone.Reject>
              <IconAlertCircle size={26} stroke={1.5} color="var(--ag-fail)" />
            </Dropzone.Reject>
            <div>
              <Text size="sm">Drop a {extensions.join(' or ')} file or click to choose</Text>
              {keepHint && (
                <Text size="sm" c="dimmed">
                  {keepHint}
                </Text>
              )}
            </div>
          </Group>
        </Dropzone>
      )}
      {error && (
        <Alert color="fail" variant="light" icon={<IconAlertCircle size={18} />} role="alert" py={6}>
          {error}
        </Alert>
      )}
    </Stack>
  );
}

/** Markdown source with a live preview; side by side on wide screens, toggled on narrow ones. */
export function StatementEditor({ value, onChange, minRows = 18 }: { value: string; onChange: (v: string) => void; minRows?: number }) {
  const [view, setView] = useState<'write' | 'preview'>('write');
  const [wide, setWide] = useState(() => window.matchMedia('(min-width: 75em)').matches);
  useEffect(() => {
    const mq = window.matchMedia('(min-width: 75em)');
    const on = () => setWide(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  const editor = (
    <Textarea
      label="Statement (Markdown)"
      description="Put samples in fenced code blocks"
      value={value}
      onChange={(e) => onChange(e.currentTarget.value)}
      autosize
      minRows={minRows}
      maxRows={40}
      spellCheck
      styles={{ input: { fontFamily: 'var(--mantine-font-family-monospace)', fontSize: 13 } }}
    />
  );
  const preview = (
    <Stack gap={6}>
      <Text size="sm" fw={500}>
        Preview
      </Text>
      <Paper p="md" mih={200} className="ag-prose">
        {value.trim() ? <Markdown source={value} /> : <Text c="dimmed">Nothing to preview</Text>}
      </Paper>
    </Stack>
  );
  if (wide)
    return (
      <SimpleGrid cols={2} spacing="lg">
        {editor}
        {preview}
      </SimpleGrid>
    );
  return (
    <Stack gap="sm">
      <SegmentedControl
        w="fit-content"
        value={view}
        onChange={(v) => setView(v as 'write' | 'preview')}
        data={[
          { value: 'write', label: 'Write' },
          { value: 'preview', label: 'Preview' },
        ]}
      />
      {view === 'write' ? editor : preview}
    </Stack>
  );
}

export function Count({ n, tone }: { n: number; tone: 'pass' | 'warn' | 'fail' | 'gray' }) {
  return (
    <Badge color={tone} variant="light" size="sm">
      {n}
    </Badge>
  );
}
