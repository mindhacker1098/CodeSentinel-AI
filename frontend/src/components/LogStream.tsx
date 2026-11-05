import { useEffect, useRef } from 'react';
import { Box, Paper, ScrollArea, Text } from '@mantine/core';
import type { LogEvent } from '../api/types';

const KIND_COLOR: Record<string, string> = {
  plan: '#5BB8E8',
  tool: '#8A97AD',
  sandbox: '#7FD1AE',
  llm: '#B9A6FF',
  cache: '#A9B5FF',
  result: '#E3AE45',
  verdict: '#3DBE8B',
  ok: '#3DBE8B',
  info: '#D7DEEA',
  warn: '#E3AE45',
  security: '#F2706B',
  error: '#F2706B',
  status: '#5BB8E8',
  stage: '#8B9CFF',
};

function time(ts: string): string {
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleTimeString(undefined, { hour12: false });
}

interface Props {
  events: LogEvent[];
  height?: number;
  follow?: boolean;
  emptyText?: string;
}

export default function LogStream({ events, height = 360, follow = true, emptyText = 'Waiting for grading to start' }: Props) {
  const viewport = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (follow && viewport.current) {
      viewport.current.scrollTo({ top: viewport.current.scrollHeight });
    }
  }, [events.length, follow]);

  return (
    <Paper radius="sm" bg="var(--ag-bg)" p={0}>
      <ScrollArea h={height} viewportRef={viewport} p="xs">
        {events.length === 0 && (
          <Text size="sm" c="dimmed" ff="monospace">
            {emptyText}
          </Text>
        )}
        {events.map((e, i) => {
          const color = KIND_COLOR[e.kind] ?? '#D7DEEA';
          return (
            <Box key={e.id ?? i} ff="monospace" fz={12} style={{ whiteSpace: 'pre-wrap', lineHeight: 1.5 }}>
              <span style={{ color: '#6B7891' }}>{time(e.ts)} </span>
              <span style={{ color, fontWeight: 600 }}>[{e.kind}]</span>
              {e.metric && <span style={{ color: '#8B9CFF' }}> {e.metric}</span>}
              <span style={{ color: e.kind === 'error' || e.kind === 'warn' || e.kind === 'security' ? color : '#D7DEEA' }}>
                {' '}
                {e.msg}
              </span>
            </Box>
          );
        })}
      </ScrollArea>
    </Paper>
  );
}
