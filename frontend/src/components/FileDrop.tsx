import { useEffect, useState } from 'react';
import { Alert, Box, Button, Group, Paper, Stack, Text } from '@mantine/core';
import { Dropzone } from '@mantine/dropzone';
import { IconAlertCircle, IconFileCode, IconTrash, IconUpload } from '@tabler/icons-react';
import { CodeBlock } from './CodeBlock';

export const MAX_SOURCE_BYTES = 200 * 1024;
export const C_FILENAME = /^[A-Za-z0-9_.-]+\.c$/;

export function fmtBytes(n: number): string {
  if (n < 1024) return `${n} bytes`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

/** Client-side checks for a C submission. Returns a readable sentence, or null when it is fine. */
export function validateCFile(f: { name: string; size: number }, maxBytes = MAX_SOURCE_BYTES): string | null {
  if (!/\.c$/i.test(f.name)) return `Only .c files can be handed in. "${f.name}" is not a .c file.`;
  if (!C_FILENAME.test(f.name))
    return `"${f.name}" is not a valid file name. Use letters, digits, "-", "_" or "." only, ending in .c.`;
  if (f.size === 0) return 'This file is empty.';
  if (f.size > maxBytes) return `This file is ${fmtBytes(f.size)}. The limit is ${fmtBytes(maxBytes)}.`;
  return null;
}

export interface FileDropProps {
  value: File | null;
  onChange: (file: File | null) => void;
  maxBytes?: number;
  disabled?: boolean;
  /** Show the first lines of the file once chosen (default true). */
  preview?: boolean;
  /** Called with the file text after it is read (for drafts or a paste editor). */
  onRead?: (text: string) => void;
  /** Custom validator; replaces validateCFile. */
  validate?: (f: File) => string | null;
  /** Hint under the drop zone. */
  hint?: string;
}

/** Drop or choose one .c file: name, size, preview, remove, and checks before upload. */
export function FileDrop({ value, onChange, maxBytes = MAX_SOURCE_BYTES, disabled, preview = true, onRead, validate, hint }: FileDropProps) {
  const [error, setError] = useState<string | null>(null);
  const [text, setText] = useState<string | null>(null);
  const check = validate ?? ((f: File) => validateCFile(f, maxBytes));

  useEffect(() => {
    let alive = true;
    setText(null);
    if (!value) return;
    value.text().then((t) => {
      if (!alive) return;
      setText(t);
      onRead?.(t);
    });
    return () => {
      alive = false;
    };
  }, [value]); // eslint-disable-line react-hooks/exhaustive-deps

  const take = (files: File[]) => {
    const f = files[0];
    if (!f) return;
    const err = check(f);
    setError(err);
    onChange(err ? null : f);
  };

  if (value) {
    const lines = text ? text.split('\n') : [];
    return (
      <Stack gap="xs">
        <Paper p="sm">
          <Group justify="space-between" wrap="nowrap">
            <Group gap="sm" wrap="nowrap" style={{ minWidth: 0 }}>
              <IconFileCode size={22} stroke={1.6} color="var(--ag-iris)" aria-hidden />
              <Box style={{ minWidth: 0 }}>
                <Text className="ag-mono" fz={13} truncate>
                  {value.name}
                </Text>
                <Text size="sm" c="dimmed">
                  {fmtBytes(value.size)}
                  {text !== null ? `, ${lines.length} lines` : ''}
                </Text>
              </Box>
            </Group>
            <Button
              variant="subtle"
              color="gray"
              size="xs"
              leftSection={<IconTrash size={14} />}
              onClick={() => {
                setError(null);
                onChange(null);
              }}
              disabled={disabled}
            >
              Remove
            </Button>
          </Group>
        </Paper>
        {preview && text !== null && <CodeBlock code={text} label="Preview" lineNumbers maxHeight={280} />}
      </Stack>
    );
  }

  return (
    <Stack gap="xs">
      <Dropzone
        onDrop={take}
        onReject={(rej) => take(rej.map((r) => r.file))}
        multiple={false}
        disabled={disabled}
        // Accept by extension: Windows often reports .c files with an empty or odd MIME type.
        accept={{ 'text/x-c': ['.c'], 'text/plain': ['.c'], 'application/octet-stream': ['.c'] }}
        styles={{
          root: {
            background: 'var(--ag-bg)',
            borderColor: error ? 'var(--ag-fail)' : 'var(--ag-line)',
          },
        }}
        aria-label="Choose a .c file"
      >
        <Group justify="center" gap="md" mih={110} style={{ pointerEvents: 'none' }} wrap="nowrap">
          <Dropzone.Accept>
            <IconUpload size={32} stroke={1.5} color="var(--ag-iris)" />
          </Dropzone.Accept>
          <Dropzone.Reject>
            <IconAlertCircle size={32} stroke={1.5} color="var(--ag-fail)" />
          </Dropzone.Reject>
          <Dropzone.Idle>
            <IconFileCode size={32} stroke={1.5} color="var(--ag-muted)" />
          </Dropzone.Idle>
          <div>
            <Text size="md">Drop a .c file or click to choose</Text>
            <Text size="sm" c="dimmed" mt={2}>
              {hint ?? `Up to ${fmtBytes(maxBytes)}`}
            </Text>
          </div>
        </Group>
      </Dropzone>
      {error && (
        <Alert color="fail" variant="light" icon={<IconAlertCircle size={18} />} role="alert">
          {error}
        </Alert>
      )}
    </Stack>
  );
}
