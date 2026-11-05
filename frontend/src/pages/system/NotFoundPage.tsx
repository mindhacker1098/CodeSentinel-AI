import { Link, useLocation } from 'react-router-dom';
import { Button, Group, Stack, Text, Title } from '@mantine/core';
import { IconArrowLeft } from '@tabler/icons-react';
import { useAuth, homeFor } from '../../auth';
import { useDocumentTitle } from '../../layout/pageMeta';

export interface SystemPageProps {
  /** What was not found, e.g. "Submission 42" or "The problem two-sums". */
  what?: string;
  /** Where the primary button goes; defaults to the user's home. */
  backTo?: string;
  backLabel?: string;
}

/** 404 inside the shell. Also used for malformed route ids (never an endless spinner). */
export default function NotFoundPage({ what, backTo, backLabel }: SystemPageProps) {
  const { user } = useAuth();
  const loc = useLocation();
  useDocumentTitle('Not found');
  const home = backTo ?? homeFor(user?.role);
  return (
    <Stack gap="md" maw={560} py="xl">
      <Text className="ag-mono" c="dimmed" fz={13}>
        404
      </Text>
      <Title order={1}>{what ? `${what} not found` : 'Page not found'}</Title>
      {!what && (
        <Text c="dimmed" className="ag-mono">
          {loc.pathname}
        </Text>
      )}
      <Group gap="xs">
        <Button component={Link} to={home} leftSection={<IconArrowLeft size={16} />}>
          {backLabel ?? (user ? 'Home' : 'Sign in')}
        </Button>
      </Group>
    </Stack>
  );
}
