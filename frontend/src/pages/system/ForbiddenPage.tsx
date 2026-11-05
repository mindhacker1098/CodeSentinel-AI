import { Link } from 'react-router-dom';
import { Button, Group, Stack, Text, Title } from '@mantine/core';
import { IconArrowLeft } from '@tabler/icons-react';
import { useAuth, homeFor } from '../../auth';
import { useDocumentTitle } from '../../layout/pageMeta';

/** 403: signed in, but this page is for another role. */
export default function ForbiddenPage() {
  const { user } = useAuth();
  useDocumentTitle('No access');
  const staffPage = !!user && user.role === 'student';
  return (
    <Stack gap="md" maw={560} py="xl">
      <Text className="ag-mono" c="dimmed" fz={13}>
        403
      </Text>
      <Title order={1}>No access</Title>
      <Text c="dimmed">{staffPage ? 'Staff only.' : 'Students only.'}</Text>
      <Group gap="xs">
        <Button component={Link} to={homeFor(user?.role)} leftSection={<IconArrowLeft size={16} />}>
          Home
        </Button>
      </Group>
    </Stack>
  );
}
