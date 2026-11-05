import type { ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Box, Button, Group, Paper, Skeleton, Stack, Text, ThemeIcon, Title } from '@mantine/core';
import {
  IconArrowLeft,
  IconCloudOff,
  IconLock,
  IconLogin,
  IconMapPinOff,
  IconRefresh,
  IconServerOff,
  type Icon,
} from '@tabler/icons-react';
import { ApiError } from '../api/client';
import { loginPath, currentPath } from '../auth/session';

// ---------------------------------------------------------------- EmptyState
export interface EmptyStateProps {
  icon?: Icon;
  /** What is empty, e.g. "No students yet." */
  title: ReactNode;
  /** What to do next, e.g. "Add one or import a CSV roster." */
  message?: ReactNode;
  /** The button that fixes it. */
  action?: ReactNode;
  /** Smaller padding for use inside a panel or table. */
  compact?: boolean;
}

export function EmptyState({ icon: I, title, message, action, compact }: EmptyStateProps) {
  return (
    <Box py={compact ? 'lg' : 48} px="md">
      <Stack gap="xs" align="flex-start" maw={520}>
        {I && (
          <ThemeIcon variant="light" color="gray" size={36} radius="md" aria-hidden>
            <I size={20} stroke={1.6} />
          </ThemeIcon>
        )}
        <Text fw={600} size="md">
          {title}
        </Text>
        {message && (
          <Text size="md" c="dimmed">
            {message}
          </Text>
        )}
        {action && <Group mt={6}>{action}</Group>}
      </Stack>
    </Box>
  );
}

// ---------------------------------------------------------------- ErrorState
interface ErrorCopy {
  icon: Icon;
  title: string;
  hint: string;
}

function copyFor(status: number): ErrorCopy {
  if (status === 0) return { icon: IconCloudOff, title: 'Could not reach the server', hint: 'Check your connection.' };
  if (status === 401) return { icon: IconLogin, title: 'Your session ended', hint: 'Sign in again.' };
  if (status === 403) return { icon: IconLock, title: 'No access', hint: 'Ask your admin for access.' };
  if (status === 404) return { icon: IconMapPinOff, title: 'Not found', hint: 'The link is wrong or the item was removed.' };
  if (status >= 500) return { icon: IconServerOff, title: 'Server error', hint: 'Retry in a moment.' };
  return { icon: IconServerOff, title: 'Could not load this', hint: '' };
}

export interface ErrorStateProps {
  error: unknown;
  /** Shows a Retry button (refetch). Not shown for 401/403/404. */
  onRetry?: () => void;
  /** Where Back goes; defaults to the previous page. Set to false to hide. */
  backTo?: string | false;
  backLabel?: string;
  compact?: boolean;
}

export function ErrorState({ error, onRetry, backTo, backLabel = 'Go back', compact }: ErrorStateProps) {
  const nav = useNavigate();
  const status = error instanceof ApiError ? error.status : -1;
  const c = copyFor(status);
  const detail = error instanceof ApiError ? error.detail : error instanceof Error ? error.message : null;
  const showDetail = detail && detail !== c.title + '.' && status !== 404;
  const retry = onRetry && status !== 401 && status !== 403 && status !== 404;
  return (
    <Paper p={compact ? 'md' : 'xl'} role="alert" style={{ borderColor: status >= 500 || status === 0 ? 'var(--ag-fail)' : undefined }}>
      <Stack gap="xs" align="flex-start" maw={560}>
        <ThemeIcon variant="light" color={status === 404 || status === 403 ? 'gray' : 'fail'} size={36} radius="md" aria-hidden>
          <c.icon size={20} stroke={1.6} />
        </ThemeIcon>
        <Title order={2} fz={16}>
          {c.title}
        </Title>
        {showDetail && <Text size="md">{detail}</Text>}
        {c.hint && (
          <Text size="md" c="dimmed">
            {c.hint}
          </Text>
        )}
        <Group gap="xs" mt={6}>
          {retry && (
            <Button size="sm" leftSection={<IconRefresh size={16} />} onClick={onRetry}>
              Retry
            </Button>
          )}
          {status === 401 && (
            <Button size="sm" component={Link} to={loginPath(currentPath())}>
              Sign in
            </Button>
          )}
          {backTo !== false &&
            (backTo ? (
              <Button size="sm" variant="default" leftSection={<IconArrowLeft size={16} />} component={Link} to={backTo}>
                {backLabel}
              </Button>
            ) : (
              <Button size="sm" variant="default" leftSection={<IconArrowLeft size={16} />} onClick={() => nav(-1)}>
                {backLabel}
              </Button>
            ))}
        </Group>
      </Stack>
    </Paper>
  );
}

// ---------------------------------------------------------------- Skeleton presets
export function TableSkeleton({ rows = 6, cols = 5 }: { rows?: number; cols?: number }) {
  return (
    <Paper p={0} aria-busy="true" aria-label="Loading" style={{ overflow: 'hidden' }}>
      <Group gap="md" px="sm" h={36} wrap="nowrap" style={{ borderBottom: '1px solid var(--ag-line)' }}>
        {Array.from({ length: cols }, (_, c) => (
          <Skeleton key={c} h={10} w={c === 0 ? 120 : 70} radius="sm" />
        ))}
      </Group>
      {Array.from({ length: rows }, (_, r) => (
        <Group key={r} gap="md" px="sm" h={36} wrap="nowrap" style={{ borderBottom: '1px solid var(--ag-line)' }}>
          {Array.from({ length: cols }, (_, c) => (
            <Skeleton key={c} h={10} w={c === 0 ? 160 : 60 + ((r * 7 + c * 13) % 40)} radius="sm" />
          ))}
        </Group>
      ))}
    </Paper>
  );
}

export function CardSkeleton({ count = 3, height = 96 }: { count?: number; height?: number }) {
  return (
    <Group gap="md" grow aria-busy="true" aria-label="Loading" wrap="wrap">
      {Array.from({ length: count }, (_, i) => (
        <Paper key={i} h={height} miw={180}>
          <Skeleton h={10} w="40%" mb="md" />
          <Skeleton h={22} w="30%" />
        </Paper>
      ))}
    </Group>
  );
}

export function ReportSkeleton() {
  return (
    <Stack gap="lg" aria-busy="true" aria-label="Loading the report">
      <Group gap="lg" align="flex-end">
        <Skeleton h={44} w={90} />
        <Stack gap={8} style={{ flex: 1 }}>
          <Skeleton h={10} w="30%" />
          <Skeleton h={14} />
        </Stack>
      </Group>
      <Group gap="xs">
        {[80, 70, 90, 110].map((w, i) => (
          <Skeleton key={i} h={28} w={w} />
        ))}
      </Group>
      <TableSkeleton rows={5} cols={4} />
    </Stack>
  );
}

export function PageSkeleton() {
  return (
    <Stack gap="lg" aria-busy="true" aria-label="Loading">
      <Stack gap={8}>
        <Skeleton h={26} w={220} />
        <Skeleton h={12} w={360} maw="100%" />
      </Stack>
      <TableSkeleton />
    </Stack>
  );
}
