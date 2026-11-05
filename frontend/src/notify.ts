import { notifications } from '@mantine/notifications';
import { createElement } from 'react';
import { IconAlertTriangle, IconCheck, IconInfoCircle } from '@tabler/icons-react';
import { ApiError } from './api/client';

/** Human text for any thrown value. ApiError already carries a readable sentence. */
export function errorText(e: unknown): string {
  if (e instanceof ApiError) return e.detail;
  if (e instanceof Error) return e.message;
  return String(e);
}

const icon = (C: typeof IconCheck) => createElement(C, { size: 18, stroke: 2 });

/**
 * Toasts. Use the same verb as the button that triggered the action:
 * button "Reset password" -> notify.success("Password reset for S01").
 */
export const notify = {
  success: (message: string, title?: string) =>
    notifications.show({ color: 'pass', icon: icon(IconCheck), title, message, autoClose: 4000 }),
  info: (message: string, title?: string) =>
    notifications.show({ color: 'info', icon: icon(IconInfoCircle), title, message, autoClose: 5000 }),
  error: (e: unknown, title?: string) =>
    notifications.show({ color: 'fail', icon: icon(IconAlertTriangle), title, message: errorText(e), autoClose: 8000 }),
};
