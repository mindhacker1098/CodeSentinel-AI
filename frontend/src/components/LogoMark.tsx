import { Group, Text } from '@mantine/core';
import { tokens } from '../theme/tokens';

/** The mark: a pass tick inside C angle brackets. Same drawing as public/favicon.svg. */
export function LogoMark({ size = 24, framed = false }: { size?: number; framed?: boolean }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="none" aria-hidden="true" focusable="false">
      {framed && <rect x="0.5" y="0.5" width="31" height="31" rx="6.5" fill={tokens.surface} stroke={tokens.line} />}
      <path d="M10.5 9 L4.5 16 L10.5 23" stroke={tokens.iris} strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M21.5 9 L27.5 16 L21.5 23" stroke={tokens.iris} strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M11.8 16.4 L14.8 19.4 L20.4 12.6" stroke={tokens.pass} strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** Mark plus the product name. */
export function Logo({ size = 22, hideName = false }: { size?: number; hideName?: boolean }) {
  return (
    <Group gap={8} wrap="nowrap">
      <LogoMark size={size} />
      {!hideName && (
        <Text fw={600} fz={15} c="var(--ag-text)" style={{ letterSpacing: '-0.01em' }}>
          AutoGrader
        </Text>
      )}
    </Group>
  );
}
