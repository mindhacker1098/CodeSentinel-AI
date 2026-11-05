/** Design tokens from docs/UI_DESIGN.md. Keep this file the single source of the hex values. */
export const tokens = {
  bg: '#141922',
  surface: '#1B2230',
  raised: '#232C3D',
  line: '#2E3A50',
  text: '#D7DEEA',
  muted: '#8A97AD',
  iris: '#8B9CFF',
  pass: '#3DBE8B',
  fail: '#F2706B',
  warn: '#E3AE45',
  info: '#5BB8E8',
} as const;

export type StatusTone = 'pass' | 'fail' | 'warn' | 'info' | 'muted';

/** Mantine colour names to use for each status tone. */
export const toneColor: Record<StatusTone, string> = {
  pass: 'pass',
  fail: 'fail',
  warn: 'warn',
  info: 'info',
  muted: 'gray',
};

export const fonts = {
  sans: "'IBM Plex Sans', system-ui, -apple-system, 'Segoe UI', sans-serif",
  mono: "'JetBrains Mono', ui-monospace, 'Cascadia Code', Consolas, monospace",
};
