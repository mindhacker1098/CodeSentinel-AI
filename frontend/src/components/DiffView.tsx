import { Fragment, useMemo, type ReactNode } from 'react';
import { Box, Group, SimpleGrid, Stack, Text } from '@mantine/core';
import { CodeBlock } from './CodeBlock';

export interface DiffViewProps {
  expected: string;
  got: string;
  /** Program input, shown above the diff. */
  input?: string;
  expectedLabel?: string;
  gotLabel?: string;
  maxHeight?: number;
  /** Extra explanation under the diff ("why"). */
  note?: ReactNode;
}

interface LineDiff {
  exp: string | null;
  got: string | null;
  same: boolean;
  /** [start, end) of the differing middle part in each line. */
  expRange: [number, number];
  gotRange: [number, number];
}

function midRange(a: string, b: string): { a: [number, number]; b: [number, number] } {
  let p = 0;
  while (p < a.length && p < b.length && a[p] === b[p]) p++;
  let s = 0;
  while (s < a.length - p && s < b.length - p && a[a.length - 1 - s] === b[b.length - 1 - s]) s++;
  return { a: [p, a.length - s], b: [p, b.length - s] };
}

function splitLines(s: string): string[] {
  if (s === '') return [];
  const out = s.split('\n');
  if (out[out.length - 1] === '') out.pop();
  return out;
}

/** Line-by-line comparison by position (test output is usually aligned), with in-line highlights. */
export function diffLines(expected: string, got: string): LineDiff[] {
  const e = splitLines(expected);
  const g = splitLines(got);
  const n = Math.max(e.length, g.length);
  const rows: LineDiff[] = [];
  for (let i = 0; i < n; i++) {
    const a = i < e.length ? e[i] : null;
    const b = i < g.length ? g[i] : null;
    if (a !== null && b !== null) {
      const same = a === b;
      const r = same ? { a: [0, 0] as [number, number], b: [0, 0] as [number, number] } : midRange(a, b);
      rows.push({ exp: a, got: b, same, expRange: r.a, gotRange: r.b });
    } else {
      rows.push({ exp: a, got: b, same: false, expRange: [0, a?.length ?? 0], gotRange: [0, b?.length ?? 0] });
    }
  }
  return rows;
}

function visible(s: string): string {
  // Make trailing spaces and tabs visible, since they are a common cause of a mismatch.
  return s.replace(/\t/g, '→   ').replace(/ +$/, (m) => '·'.repeat(m.length));
}

function Line({ text, range, side, n, same }: { text: string | null; range: [number, number]; side: 'exp' | 'got'; n: number; same: boolean }) {
  const changed = text !== null && range[1] > range[0];
  const missing = text === null;
  const bg = missing || same ? undefined : side === 'exp' ? 'rgba(61,190,139,0.10)' : 'rgba(242,112,107,0.12)';
  const mark = side === 'exp' ? 'rgba(61,190,139,0.35)' : 'rgba(242,112,107,0.40)';
  return (
    <div style={{ display: 'flex', background: bg, minHeight: '1.55em' }}>
      <span aria-hidden style={{ color: 'var(--ag-muted)', opacity: 0.6, userSelect: 'none', minWidth: '3ch', textAlign: 'right', marginRight: 10 }}>
        {missing ? '' : n}
      </span>
      {missing ? (
        <span style={{ color: 'var(--ag-muted)', fontStyle: 'italic' }}>{side === 'got' ? '(line missing)' : '(extra line)'}</span>
      ) : changed ? (
        <span>
          {visible(text.slice(0, range[0]))}
          <mark style={{ background: mark, color: 'inherit', borderRadius: 2 }}>{visible(text.slice(range[0], range[1])) || ' '}</mark>
          {visible(text.slice(range[1]))}
        </span>
      ) : (
        <span>{visible(text) || ' '}</span>
      )}
    </div>
  );
}

function Column({ title, rows, side, maxHeight }: { title: string; rows: LineDiff[]; side: 'exp' | 'got'; maxHeight: number }) {
  let n = 0;
  return (
    <Box style={{ border: '1px solid var(--ag-line)', borderRadius: 6, background: 'var(--ag-bg)', minWidth: 0, maxWidth: '100%', overflow: 'hidden' }}>
      <Group px="sm" h={32} style={{ borderBottom: '1px solid var(--ag-line)' }}>
        <Text size="sm" c="dimmed">
          {title}
        </Text>
      </Group>
      <Box style={{ maxHeight: maxHeight, overflow: 'auto' }}>
        <Box component="pre" m={0} p="sm" className="ag-mono" style={{ fontSize: 13, lineHeight: 1.55 }}>
          {rows.length === 0 ? (
            <span style={{ color: 'var(--ag-muted)', fontStyle: 'italic' }}>(no output)</span>
          ) : (
            rows.map((r, i) => {
              const text = side === 'exp' ? r.exp : r.got;
              if (text !== null) n++;
              return (
                <Fragment key={i}>
                  <Line text={text} range={side === 'exp' ? r.expRange : r.gotRange} side={side} n={n} same={r.same} />
                </Fragment>
              );
            })
          )}
        </Box>
      </Box>
    </Box>
  );
}

/** Expected vs got, side by side (stacked on phones), differing characters highlighted. */
export function DiffView({ expected, got, input, expectedLabel = 'Expected output', gotLabel = 'Your output', maxHeight = 320, note }: DiffViewProps) {
  const rows = useMemo(() => diffLines(expected, got), [expected, got]);
  const nDiff = rows.filter((r) => !r.same).length;
  const wsOnly = nDiff > 0 && expected.replace(/\s+/g, '') === got.replace(/\s+/g, '');
  return (
    <Stack gap="xs">
      {input !== undefined && <CodeBlock code={input} label="Input" maxHeight={160} />}
      <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="xs">
        <Column title={expectedLabel} rows={rows} side="exp" maxHeight={maxHeight} />
        <Column title={gotLabel} rows={rows} side="got" maxHeight={maxHeight} />
      </SimpleGrid>
      <Text size="sm" c="dimmed" aria-live="polite">
        {nDiff === 0
          ? 'The outputs match.'
          : wsOnly
            ? 'Only whitespace differs (trailing spaces shown as dots).'
            : `${nDiff} line${nDiff === 1 ? '' : 's'} differ${nDiff === 1 ? 's' : ''}.`}
      </Text>
      {note}
    </Stack>
  );
}
