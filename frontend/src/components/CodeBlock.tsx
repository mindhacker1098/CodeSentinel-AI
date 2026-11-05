import type { ReactNode } from 'react';
import { ActionIcon, Box, CopyButton, Group, Text, Tooltip } from '@mantine/core';
import { IconCheck, IconCopy } from '@tabler/icons-react';

export interface CodeBlockProps {
  code: string;
  /** Small header label, e.g. "Input" or "reference output". */
  label?: ReactNode;
  /** Right side of the header, next to the copy button. */
  extra?: ReactNode;
  /** Max height before it scrolls (px). */
  maxHeight?: number;
  copyable?: boolean;
  /** Wrap long lines instead of scrolling sideways. */
  wrap?: boolean;
  /** Show line numbers. */
  lineNumbers?: boolean;
  startLine?: number;
  /** Shown instead of an empty block. */
  emptyText?: string;
}

/** Mono block for program I/O, diagnostics and short source excerpts. */
export function CodeBlock({
  code,
  label,
  extra,
  maxHeight = 360,
  copyable = true,
  wrap = false,
  lineNumbers = false,
  startLine = 1,
  emptyText = '(empty)',
}: CodeBlockProps) {
  const empty = code.length === 0;
  const lines = code.replace(/\n$/, '').split('\n');
  const hasHeader = label || extra || copyable;
  return (
    <Box style={{ border: '1px solid var(--ag-line)', borderRadius: 6, background: 'var(--ag-bg)', minWidth: 0, maxWidth: '100%', overflow: 'hidden' }}>
      {hasHeader && (
        <Group justify="space-between" px="sm" h={32} wrap="nowrap" style={{ borderBottom: '1px solid var(--ag-line)' }}>
          <Text size="sm" c="dimmed" truncate>
            {label}
          </Text>
          <Group gap={4} wrap="nowrap">
            {extra}
            {copyable && !empty && (
              <CopyButton value={code} timeout={1500}>
                {({ copied, copy }) => (
                  <Tooltip label={copied ? 'Copied' : 'Copy'} events={{ hover: true, focus: true, touch: false }}>
                    <ActionIcon size="sm" onClick={copy} aria-label={copied ? 'Copied' : `Copy ${typeof label === 'string' ? label.toLowerCase() : 'code'}`} color={copied ? 'pass' : 'gray'}>
                      {copied ? <IconCheck size={14} /> : <IconCopy size={14} />}
                    </ActionIcon>
                  </Tooltip>
                )}
              </CopyButton>
            )}
          </Group>
        </Group>
      )}
      <Box style={{ maxHeight: maxHeight, overflow: 'auto' }}>
        {empty ? (
          <Text size="sm" c="dimmed" fs="italic" p="sm">
            {emptyText}
          </Text>
        ) : (
          <Box
            component="pre"
            m={0}
            p="sm"
            className="ag-mono"
            style={{ fontSize: 13, lineHeight: 1.55, whiteSpace: wrap ? 'pre-wrap' : 'pre', wordBreak: wrap ? 'break-word' : undefined, tabSize: 4 }}
          >
            {lineNumbers
              ? lines.map((l, i) => (
                  <div key={i} style={{ display: 'flex' }}>
                    <span aria-hidden style={{ color: 'var(--ag-muted)', userSelect: 'none', minWidth: '3ch', textAlign: 'right', marginRight: 12, opacity: 0.7 }}>
                      {i + startLine}
                    </span>
                    <span>{l || ' '}</span>
                  </div>
                ))
              : code}
          </Box>
        )}
      </Box>
    </Box>
  );
}
