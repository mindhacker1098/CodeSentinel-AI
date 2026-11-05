import { useEffect, useState } from 'react';
import { ActionIcon, Alert, Button, Checkbox, CopyButton, Group, Modal, ScrollArea, Stack, Table, Text, Tooltip } from '@mantine/core';
import { IconCheck, IconCopy, IconDownload, IconKey } from '@tabler/icons-react';
import { downloadBlob } from '../api/client';

export interface Secret {
  roll_no: string;
  name?: string;
  password: string;
}

export interface OneTimeSecretModalProps {
  /** Open while non-empty. The parent must clear it in onClose so the passwords leave memory. */
  secrets: Secret[] | null;
  onClose: () => void;
  title?: string;
  /** e.g. "Give each student their password. They must change it when they first sign in." */
  description?: string;
  /** Download name, default "passwords-<date>.csv". */
  filename?: string;
}

function csvCell(s: string) {
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function secretsCsv(secrets: Secret[]): string {
  return ['roll_no,name,password', ...secrets.map((s) => [s.roll_no, s.name ?? '', s.password].map(csvCell).join(','))].join('\n') + '\n';
}

/** Shows generated passwords once, with copy and CSV download; closing needs an acknowledgement. */
export function OneTimeSecretModal({ secrets, onClose, title, description, filename }: OneTimeSecretModalProps) {
  const [ack, setAck] = useState(false);
  const open = !!secrets && secrets.length > 0;
  useEffect(() => {
    if (open) setAck(false);
  }, [open, secrets]);
  const list = secrets ?? [];
  const many = list.length > 1;
  const all = list.map((s) => `${s.roll_no}\t${s.password}`).join('\n');
  const name = filename ?? `passwords-${new Date().toISOString().slice(0, 10)}.csv`;

  return (
    <Modal
      opened={open}
      onClose={() => ack && onClose()}
      title={title ?? (many ? `${list.length} new passwords` : 'New password')}
      size={many ? 'lg' : 'md'}
      closeOnClickOutside={false}
      closeOnEscape={false}
      withCloseButton={false}
    >
      <Stack gap="md">
        <Alert color="warn" variant="light" icon={<IconKey size={18} />}>
          {description ?? 'Shown once. Must be changed at first sign-in.'}
        </Alert>
        <ScrollArea.Autosize mah={320} type="auto">
          <Table withRowBorders verticalSpacing={6}>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Roll number</Table.Th>
                {list.some((s) => s.name) && <Table.Th>Name</Table.Th>}
                <Table.Th>Password</Table.Th>
                <Table.Th style={{ width: 40 }}>
                  <span className="ag-sr-only">Copy</span>
                </Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {list.map((s) => (
                <Table.Tr key={s.roll_no}>
                  <Table.Td className="ag-mono" fz={13}>
                    {s.roll_no}
                  </Table.Td>
                  {list.some((x) => x.name) && <Table.Td>{s.name}</Table.Td>}
                  <Table.Td className="ag-mono" fz={13} style={{ userSelect: 'all' }}>
                    {s.password}
                  </Table.Td>
                  <Table.Td>
                    <CopyButton value={s.password} timeout={1500}>
                      {({ copied, copy }) => (
                        <Tooltip label={copied ? 'Copied' : 'Copy password'}>
                          <ActionIcon onClick={copy} aria-label={`Copy password for ${s.roll_no}`} color={copied ? 'pass' : 'gray'}>
                            {copied ? <IconCheck size={15} /> : <IconCopy size={15} />}
                          </ActionIcon>
                        </Tooltip>
                      )}
                    </CopyButton>
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </ScrollArea.Autosize>
        <Group gap="xs">
          <Button variant="default" leftSection={<IconDownload size={16} />} onClick={() => downloadBlob(secretsCsv(list), name, 'text/csv')}>
            Download CSV
          </Button>
          {many && (
            <CopyButton value={all}>
              {({ copied, copy }) => (
                <Button variant="default" leftSection={copied ? <IconCheck size={16} /> : <IconCopy size={16} />} onClick={copy}>
                  {copied ? 'Copied' : 'Copy all'}
                </Button>
              )}
            </CopyButton>
          )}
        </Group>
        <Checkbox
          checked={ack}
          onChange={(e) => setAck(e.currentTarget.checked)}
          label={many ? 'I have saved these passwords' : 'I have saved this password'}
        />
        <Text size="sm" c="dimmed">
          After you close this, {many ? 'the passwords' : 'the password'} cannot be shown again. You can reset {many ? 'them' : 'it'} later.
        </Text>
        <Group justify="flex-end">
          <Button onClick={onClose} disabled={!ack}>
            Done
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}
