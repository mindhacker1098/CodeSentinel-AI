import { useCallback, useEffect, useRef, useState } from 'react';
import { Badge, Group, SimpleGrid, Stack, Text, UnstyledButton } from '@mantine/core';
import { MONACO_THEME } from '../monaco';
import Editor, { type OnMount } from '@monaco-editor/react';
import type { Region } from '../api/types';
import { monaco } from '../monaco';
import { EDITOR_OPTIONS } from './editorOptions';
import { normalizeRegion, REGION_COLORS } from './regions';

type Ed = Parameters<OnMount>[0];

function decorations(regions: Region[], side: 'a' | 'b') {
  return regions.map((r, i) => ({
    range: new monaco.Range(side === 'a' ? r.a_start : r.b_start, 1, side === 'a' ? r.a_end : r.b_end, 1),
    options: {
      isWholeLine: true,
      className: `ag-region-${i % REGION_COLORS.length}`,
      linesDecorationsClassName: `ag-region-gutter-${i % REGION_COLORS.length}`,
      hoverMessage: { value: `matched region ${i + 1}` },
    },
  }));
}

export interface MatchedRegionsProps {
  a: string;
  b: string;
  regions: (Region | Record<string, unknown>)[];
  aLabel?: string;
  bLabel?: string;
  height?: number;
}

export default function MatchedRegionsView({ a, b, regions, aLabel = 'A', bLabel = 'B', height = 520 }: MatchedRegionsProps) {
  const edA = useRef<Ed | null>(null);
  const edB = useRef<Ed | null>(null);
  const colA = useRef<ReturnType<Ed['createDecorationsCollection']> | null>(null);
  const colB = useRef<ReturnType<Ed['createDecorationsCollection']> | null>(null);
  const [ready, setReady] = useState(0);
  const list = regions.map(normalizeRegion).filter((r): r is Region => r !== null);

  useEffect(() => {
    if (edA.current) {
      colA.current?.clear();
      colA.current = edA.current.createDecorationsCollection(decorations(list, 'a'));
    }
    if (edB.current) {
      colB.current?.clear();
      colB.current = edB.current.createDecorationsCollection(decorations(list, 'b'));
    }
  }, [JSON.stringify(list), ready, a, b]);

  const reveal = useCallback((r: Region) => {
    edA.current?.revealLinesInCenter(r.a_start, r.a_end);
    edB.current?.revealLinesInCenter(r.b_start, r.b_end);
  }, []);

  const opts = { ...EDITOR_OPTIONS, readOnly: true, domReadOnly: true, glyphMargin: false };

  return (
    <Stack gap="xs">
      <Group gap={6}>
        <Text size="sm" c="dimmed">
          {list.length} matched region{list.length === 1 ? '' : 's'}:
        </Text>
        {list.map((r, i) => (
          <UnstyledButton key={i} onClick={() => reveal(r)}>
            <Badge
              radius="sm"
              variant="filled"
              style={{ background: REGION_COLORS[i % REGION_COLORS.length], color: '#212529' }}
            >
              {r.a_start}-{r.a_end} / {r.b_start}-{r.b_end}
            </Badge>
          </UnstyledButton>
        ))}
      </Group>
      <SimpleGrid cols={2} spacing="xs">
        {[
          { label: aLabel, src: a, ref: edA },
          { label: bLabel, src: b, ref: edB },
        ].map((s) => (
          <Stack key={s.label} gap={4}>
            <Text size="sm" fw={600}>
              {s.label}
            </Text>
            <div style={{ border: '1px solid var(--ag-line)', borderRadius: 4, overflow: 'hidden' }}>
              <Editor
                theme={MONACO_THEME}
                height={height}
                language="c"
                value={s.src}
                options={opts}
                onMount={(ed) => {
                  s.ref.current = ed;
                  setReady((n) => n + 1);
                }}
              />
            </div>
          </Stack>
        ))}
      </SimpleGrid>
    </Stack>
  );
}
