import type { ReactNode } from 'react';
import { Box, Stack, Text } from '@mantine/core';
import { openConfirmModal } from '@mantine/modals';

export interface ConfirmOptions {
  /** A question naming the action, e.g. "Deactivate this student?" */
  title: string;
  /** What will happen, in one or two plain sentences. */
  message?: ReactNode;
  /** The thing acted on, shown prominently: "S01 Asha Rao", "Two sums (14 submissions)". */
  target?: ReactNode;
  /** Button text naming what happens: "Deactivate", "Regrade 14 submissions". */
  confirmLabel: string;
  cancelLabel?: string;
  /** Red confirm button for destructive or hard-to-undo actions. */
  danger?: boolean;
}

/**
 * Promise-based confirm modal. Resolves true on confirm, false on cancel or close.
 *
 *   if (await confirm({ title: 'Deactivate this student?', target: `${u.roll_no} ${u.name}`,
 *                       message: 'They will be signed out and cannot sign in again until reactivated.',
 *                       confirmLabel: 'Deactivate', danger: true })) mutate();
 */
export function confirm({ title, message, target, confirmLabel, cancelLabel = 'Cancel', danger }: ConfirmOptions): Promise<boolean> {
  return new Promise((resolve) => {
    let settled = false;
    const done = (v: boolean) => {
      if (settled) return;
      settled = true;
      resolve(v);
    };
    openConfirmModal({
      title,
      size: 'md',
      children: (
        <Stack gap="sm">
          {target && (
            <Box
              px="sm"
              py={8}
              style={{
                border: `1px solid ${danger ? 'rgba(242,112,107,0.45)' : 'var(--ag-line)'}`,
                background: danger ? 'rgba(242,112,107,0.08)' : 'var(--ag-bg)',
                borderRadius: 4,
              }}
            >
              <Text size="md" fw={600}>
                {target}
              </Text>
            </Box>
          )}
          {message && (typeof message === 'string' ? <Text size="md">{message}</Text> : message)}
        </Stack>
      ),
      labels: { confirm: confirmLabel, cancel: cancelLabel },
      // Danger: focus starts on Cancel, so Enter does not destroy anything by accident.
      confirmProps: { color: danger ? 'fail' : 'iris', ...((danger ? {} : { 'data-autofocus': 'true' }) as Record<string, string>) },
      cancelProps: { variant: 'default', ...((danger ? { 'data-autofocus': 'true' } : {}) as Record<string, string>) },
      onConfirm: () => done(true),
      onCancel: () => done(false),
      onClose: () => done(false),
    });
  });
}
