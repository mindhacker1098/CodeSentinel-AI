import { useEffect, useMemo, useState } from 'react';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ActionIcon,
  Alert,
  Badge,
  Box,
  Button,
  Checkbox,
  CloseButton,
  Drawer,
  Group,
  Menu,
  Modal,
  Pagination,
  Paper,
  SegmentedControl,
  Select,
  Stack,
  Stepper,
  Switch,
  Table,
  Text,
  TextInput,
  Tooltip,
} from '@mantine/core';
import { Dropzone } from '@mantine/dropzone';
import { useDebouncedValue } from '@mantine/hooks';
import {
  IconAlertCircle,
  IconCheck,
  IconCrown,
  IconDotsVertical,
  IconDownload,
  IconFileSpreadsheet,
  IconKey,
  IconPencil,
  IconCircleMinus,
  IconSchool,
  IconSearch,
  IconTrash,
  IconUpload,
  IconUserCheck,
  IconUserOff,
  IconUserPlus,
  IconUserShield,
  IconUsers,
  IconX,
} from '@tabler/icons-react';
import { api, ApiError, downloadBlob, type ImportRow, type Role, type User } from '../../api/client';
import { useAuth } from '../../auth';
import {
  confirm,
  EmptyState,
  ErrorState,
  OneTimeSecretModal,
  PageHeader,
  ResponsiveTable,
  StatusChip,
  type Column,
  type Secret,
} from '../../components';
import { fmtDate, fmtRelative } from '../../format';
import { notify } from '../../notify';

const ROLL_RE = /^[A-Z0-9][A-Z0-9_-]{1,31}$/;
const PAGE_SIZE = 50;

const ROLE_LABEL: Record<Role, string> = { student: 'Student', ta: 'TA', admin: 'Admin' };
const ROLE_ICON = { student: IconSchool, ta: IconUserShield, admin: IconCrown };
const ROLE_SEES: Record<Role, string> = {
  student: 'Sees published problems and their own submissions.',
  ta: 'Sees all submissions, grades and flags. Manages students.',
  admin: 'Full access, including staff, roles and problems.',
};

const normRoll = (s: string) => s.trim().toUpperCase();
function rollError(roll: string): string | null {
  if (!roll) return 'Enter a roll number.';
  if (!ROLL_RE.test(roll)) return 'Use 2 to 32 letters, digits, "-" or "_", starting with a letter or digit.';
  return null;
}
const who = (u: Pick<User, 'roll_no' | 'name'>) => `${u.roll_no} ${u.name}`;

function RoleChip({ role }: { role: Role }) {
  const I = ROLE_ICON[role] ?? IconSchool;
  return (
    <Badge variant="light" color="gray" size="sm" leftSection={<I size={12} stroke={1.8} />} tt="none" fw={500}>
      {ROLE_LABEL[role] ?? role}
    </Badge>
  );
}

function AccountChip({ u }: { u: User }) {
  if (!u.is_active) return <StatusChip kind="custom" tone="gray" icon={IconUserOff} label="Inactive" size="sm" />;
  if (u.must_change_pw) return <StatusChip kind="custom" tone="warn" icon={IconKey} label="Must change password" size="sm" />;
  return <StatusChip kind="custom" tone="pass" icon={IconCheck} label="Active" size="sm" />;
}

function csvCell(s: string) {
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

// ---------------------------------------------------------------- add
function AddUserModal({ opened, onClose, onCreated, isAdmin }: { opened: boolean; onClose: () => void; onCreated: (s: Secret) => void; isAdmin: boolean }) {
  const qc = useQueryClient();
  const [roll, setRoll] = useState('');
  const [name, setName] = useState('');
  const [role, setRole] = useState<Role>('student');
  const [touched, setTouched] = useState(false);
  const [rollTaken, setRollTaken] = useState<string | null>(null);
  useEffect(() => {
    if (opened) {
      setRoll('');
      setName('');
      setRole('student');
      setTouched(false);
      setRollTaken(null);
    }
  }, [opened]);
  const r = normRoll(roll);
  const rErr = rollError(r);
  const nErr = name.trim() ? null : 'Enter the name.';
  const m = useMutation({
    mutationFn: () => api.staff.createUser({ roll_no: r, name: name.trim(), role }),
    onSuccess: (res) => {
      notify.success(`Added ${who(res.user)}`);
      qc.invalidateQueries({ queryKey: ['staff', 'users'] });
      onClose();
      if (res.password) onCreated({ roll_no: res.user.roll_no, name: res.user.name, password: res.password });
    },
    onError: (e) => {
      if (e instanceof ApiError && e.status === 409) setRollTaken(e.detail);
      else notify.error(e);
    },
  });
  const what = role === 'student' ? 'student' : role === 'ta' ? 'TA' : 'admin';
  return (
    <Modal opened={opened} onClose={onClose} title={`Add ${what}`} size="md">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          setTouched(true);
          if (!rErr && !nErr) m.mutate();
        }}
      >
        <Stack gap="md">
          <TextInput
            label="Roll number"
            value={roll}
            onChange={(e) => {
              setRoll(e.currentTarget.value);
              setRollTaken(null);
            }}
            onBlur={() => setRoll(normRoll(roll))}
            error={rollTaken ?? (touched || roll ? (roll && rErr ? rErr : touched ? rErr : null) : null)}
            styles={{ input: { fontFamily: 'var(--mantine-font-family-monospace)' } }}
            data-autofocus
            required
          />
          <TextInput label="Name" value={name} onChange={(e) => setName(e.currentTarget.value)} error={touched ? nErr : null} required maxLength={200} />
          <Stack gap={6}>
            <Select
              label="Role"
              data={[
                { value: 'student', label: 'Student' },
                { value: 'ta', label: 'TA', disabled: !isAdmin },
                { value: 'admin', label: 'Admin', disabled: !isAdmin },
              ]}
              value={role}
              onChange={(v) => v && setRole(v as Role)}
              allowDeselect={false}
              description={isAdmin ? undefined : 'Only admins can add staff.'}
            />
            <Text size="sm" c="dimmed">
              {ROLE_SEES[role]}
            </Text>
          </Stack>
          <Group justify="flex-end">
            <Button variant="default" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" loading={m.isPending} leftSection={<IconUserPlus size={16} />}>
              Add {what}
            </Button>
          </Group>
        </Stack>
      </form>
    </Modal>
  );
}

// ---------------------------------------------------------------- import
const IMPORT_STATUS: Record<ImportRow['status'], { tone: 'pass' | 'gray' | 'fail'; label: string; icon: typeof IconCheck }> = {
  create: { tone: 'pass', label: 'Create', icon: IconUserPlus },
  skip: { tone: 'gray', label: 'Skip', icon: IconCircleMinus },
  reject: { tone: 'fail', label: 'Reject', icon: IconX },
};

function ImportModal({ opened, onClose, onImported }: { opened: boolean; onClose: () => void; onImported: (s: Secret[]) => void }) {
  const qc = useQueryClient();
  const [file, setFile] = useState<File | null>(null);
  const [rows, setRows] = useState<ImportRow[] | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [show, setShow] = useState<'all' | ImportRow['status']>('all');
  useEffect(() => {
    if (opened) {
      setFile(null);
      setRows(null);
      setFileError(null);
      setShow('all');
    }
  }, [opened]);

  const preview = useMutation({
    mutationFn: (f: File) => api.staff.importPreview(f),
    onSuccess: (r) => {
      setRows(r.rows);
      const rej = r.rows.filter((x) => x.status === 'reject').length;
      setShow(rej ? 'reject' : 'all');
    },
    onError: (e) => setFileError(e instanceof ApiError ? e.detail : String(e)),
  });
  const commit = useMutation({
    mutationFn: () => api.staff.importCommit(file!),
    onSuccess: (r) => {
      const created = r.created ?? r.rows.filter((x) => x.status === 'create').length;
      const extra = [r.skipped ? `${r.skipped} skipped` : '', r.rejected ? `${r.rejected} rejected` : ''].filter(Boolean).join(', ');
      notify.success(`Imported ${created} ${created === 1 ? 'person' : 'people'}${extra ? `; ${extra}` : ''}`);
      qc.invalidateQueries({ queryKey: ['staff', 'users'] });
      onClose();
      onImported(r.rows.filter((x) => x.password).map((x) => ({ roll_no: x.roll_no, name: x.name, password: x.password! })));
    },
    onError: (e) => notify.error(e),
  });

  const take = (files: File[]) => {
    const f = files[0];
    if (!f) return;
    if (!/\.csv$/i.test(f.name)) return setFileError(`"${f.name}" is not a .csv file.`);
    if (f.size > 5 * 1024 * 1024) return setFileError('The CSV is larger than 5 MB.');
    setFileError(null);
    setFile(f);
    preview.mutate(f);
  };

  const n = { create: 0, skip: 0, reject: 0 };
  for (const r of rows ?? []) n[r.status] += 1;
  const visible = (rows ?? []).filter((r) => show === 'all' || r.status === show);
  const step = rows ? 1 : 0;

  return (
    <Modal opened={opened} onClose={onClose} title="Import roster" size="xl" closeOnClickOutside={!rows}>
      <Stack gap="lg">
        <Stepper active={step} size="sm">
          <Stepper.Step label="Upload" />
          <Stepper.Step label="Preview" />
          <Stepper.Step label="Passwords" />
        </Stepper>
        {step === 0 && (
          <Stack gap="md">
            <Text size="sm" c="dimmed">
              Columns: <code>roll_no,name,role</code>. Empty role means student.
            </Text>
            <Group>
              <Button
                variant="default"
                leftSection={<IconDownload size={16} />}
                onClick={async () => {
                  try {
                    downloadBlob(await api.staff.userTemplateCsv(), 'roster_template.csv');
                  } catch (e) {
                    notify.error(e);
                  }
                }}
              >
                Download template
              </Button>
            </Group>
            <Dropzone
              onDrop={take}
              onReject={(r) => take(r.map((x) => x.file))}
              multiple={false}
              loading={preview.isPending}
              accept={{ 'text/csv': ['.csv'], 'application/vnd.ms-excel': ['.csv'], 'text/plain': ['.csv'] }}
              styles={{ root: { background: 'var(--ag-bg)', borderColor: fileError ? 'var(--ag-fail)' : 'var(--ag-line)' } }}
              aria-label="Choose the roster CSV"
            >
              <Group justify="center" gap="md" mih={120} style={{ pointerEvents: 'none' }} wrap="nowrap">
                <Dropzone.Idle>
                  <IconFileSpreadsheet size={34} stroke={1.5} color="var(--ag-muted)" />
                </Dropzone.Idle>
                <Dropzone.Accept>
                  <IconUpload size={34} stroke={1.5} color="var(--ag-iris)" />
                </Dropzone.Accept>
                <Dropzone.Reject>
                  <IconAlertCircle size={34} stroke={1.5} color="var(--ag-fail)" />
                </Dropzone.Reject>
                <div>
                  <Text size="md">Drop a CSV or click to choose</Text>
                  <Text size="sm" c="dimmed">
                    Up to 5 MB
                  </Text>
                </div>
              </Group>
            </Dropzone>
            {fileError && (
              <Alert color="fail" variant="light" icon={<IconAlertCircle size={18} />} role="alert">
                {fileError}
              </Alert>
            )}
          </Stack>
        )}
        {step === 1 && rows && (
          <Stack gap="md">
            <Group justify="space-between" wrap="wrap">
              <Text size="sm" c="dimmed">
                <span className="ag-mono">{file?.name}</span>, {rows.length} row{rows.length === 1 ? '' : 's'}
              </Text>
              <SegmentedControl
                size="xs"
                value={show}
                onChange={(v) => setShow(v as typeof show)}
                data={[
                  { value: 'all', label: `All (${rows.length})` },
                  { value: 'create', label: `Create (${n.create})` },
                  { value: 'skip', label: `Skip (${n.skip})` },
                  { value: 'reject', label: `Reject (${n.reject})` },
                ]}
              />
            </Group>
            {n.reject > 0 && (
              <Alert color="warn" variant="light" icon={<IconAlertCircle size={18} />}>
                {n.reject} row{n.reject === 1 ? '' : 's'} will not be imported.
              </Alert>
            )}
            <Paper p={0} style={{ overflow: 'hidden' }}>
              <Box mah={340} style={{ overflow: 'auto' }}>
                <Table stickyHeader verticalSpacing={6} miw={620}>
                  <Table.Thead>
                    <Table.Tr>
                      <Table.Th w={60}>Line</Table.Th>
                      <Table.Th>Roll number</Table.Th>
                      <Table.Th>Name</Table.Th>
                      <Table.Th>Role</Table.Th>
                      <Table.Th>Result</Table.Th>
                      <Table.Th>Reason</Table.Th>
                    </Table.Tr>
                  </Table.Thead>
                  <Table.Tbody>
                    {visible.map((r) => {
                      const s = IMPORT_STATUS[r.status];
                      return (
                        <Table.Tr key={`${r.line}-${r.roll_no}`}>
                          <Table.Td c="dimmed">{r.line}</Table.Td>
                          <Table.Td className="ag-mono" fz={13}>
                            {r.roll_no || <Text c="dimmed">(empty)</Text>}
                          </Table.Td>
                          <Table.Td>{r.name}</Table.Td>
                          <Table.Td>{ROLE_LABEL[r.role as Role] ?? r.role}</Table.Td>
                          <Table.Td>
                            <StatusChip kind="custom" tone={s.tone} icon={s.icon} label={s.label} size="sm" />
                          </Table.Td>
                          <Table.Td>
                            <Text size="sm" c={r.status === 'reject' ? 'fail.3' : 'dimmed'}>
                              {r.reason || (r.status === 'create' ? 'New account' : '')}
                            </Text>
                          </Table.Td>
                        </Table.Tr>
                      );
                    })}
                  </Table.Tbody>
                </Table>
              </Box>
            </Paper>
            <Group justify="space-between">
              <Button
                variant="default"
                onClick={() => {
                  setRows(null);
                  setFile(null);
                }}
              >
                Choose another file
              </Button>
              <Button onClick={() => commit.mutate()} loading={commit.isPending} disabled={n.create === 0} leftSection={<IconUsers size={16} />}>
                {n.create === 0 ? 'Nothing to import' : `Import ${n.create} ${n.create === 1 ? 'person' : 'people'}`}
              </Button>
            </Group>
          </Stack>
        )}
      </Stack>
    </Modal>
  );
}

// ---------------------------------------------------------------- edit
function EditDrawer({ user, onClose, me }: { user: User | null; onClose: () => void; me: User | null }) {
  const qc = useQueryClient();
  const [name, setName] = useState('');
  const [role, setRole] = useState<Role>('student');
  const [active, setActive] = useState(true);
  useEffect(() => {
    if (user) {
      setName(user.name);
      setRole(user.role);
      setActive(user.is_active);
    }
  }, [user]);
  const isAdmin = me?.role === 'admin';
  const self = !!user && me?.id === user.id;
  const canEditStaff = isAdmin || user?.role === 'student';
  const m = useMutation({
    mutationFn: (body: { name?: string; role?: Role; is_active?: boolean }) => api.staff.updateUser(user!.id, body),
    onSuccess: (r, body) => {
      notify.success(
        body.role
          ? `Changed ${r.user.roll_no} to ${ROLE_LABEL[body.role]}`
          : body.is_active === false
            ? `Deactivated ${r.user.roll_no}`
            : `Saved changes to ${r.user.roll_no}`,
      );
      qc.invalidateQueries({ queryKey: ['staff', 'users'] });
      onClose();
    },
    onError: (e) => notify.error(e),
  });
  if (!user) return <Drawer opened={false} onClose={onClose} />;
  const changed = name.trim() !== user.name || role !== user.role || active !== user.is_active;
  const save = async () => {
    if (role !== user.role) {
      const ok = await confirm({
        title: `Make ${user.name} ${role === 'ta' ? 'a TA' : role === 'admin' ? 'an admin' : 'a student'}?`,
        target: `${who(user)}: ${ROLE_LABEL[user.role]} to ${ROLE_LABEL[role]}`,
        message: `${ROLE_SEES[role]} They will be signed out.`,
        confirmLabel: `Change role to ${ROLE_LABEL[role]}`,
        danger: role !== 'student',
      });
      if (!ok) return;
    }
    if (!active && user.is_active) {
      const ok = await confirm({
        title: 'Deactivate this account?',
        target: who(user),
        message: 'They will be signed out. Grades are kept.',
        confirmLabel: 'Deactivate',
        danger: true,
      });
      if (!ok) return;
    }
    m.mutate({
      ...(name.trim() !== user.name ? { name: name.trim() } : {}),
      ...(role !== user.role ? { role } : {}),
      ...(active !== user.is_active ? { is_active: active } : {}),
    });
  };
  return (
    <Drawer opened={!!user} onClose={onClose} title={`Edit ${user.roll_no}`} position="right" size="md">
      <Stack gap="lg">
        <Stack gap={2}>
          <Text size="sm" c="dimmed">
            Roll number
          </Text>
          <Text className="ag-mono">{user.roll_no}</Text>
          <Text size="sm" c="dimmed" mt={6}>
            Added {fmtDate(user.created_at)} · Last sign-in {user.last_login_at ? fmtDate(user.last_login_at) : 'never'}
          </Text>
        </Stack>
        <TextInput label="Name" value={name} onChange={(e) => setName(e.currentTarget.value)} error={!name.trim() ? 'Enter the name.' : null} disabled={!canEditStaff} />
        <Stack gap={6}>
          <Select
            label="Role"
            data={(['student', 'ta', 'admin'] as Role[]).map((r) => ({ value: r, label: ROLE_LABEL[r] }))}
            value={role}
            onChange={(v) => v && setRole(v as Role)}
            allowDeselect={false}
            disabled={!isAdmin || self}
            description={self ? 'You cannot change your own role.' : !isAdmin ? 'Only admins can change roles.' : undefined}
          />
          <Text size="sm" c="dimmed">
            {ROLE_SEES[role]}
          </Text>
        </Stack>
        <Switch
          label="Active"
          description={active ? undefined : 'Cannot sign in. Grades are kept.'}
          checked={active}
          onChange={(e) => setActive(e.currentTarget.checked)}
          disabled={self || !canEditStaff}
        />
        {!canEditStaff && (
          <Alert color="gray" variant="light">
            Only admins can edit staff accounts.
          </Alert>
        )}
        <Group justify="flex-end">
          <Button variant="default" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={save} loading={m.isPending} disabled={!changed || !name.trim()}>
            Save changes
          </Button>
        </Group>
      </Stack>
    </Drawer>
  );
}

// ---------------------------------------------------------------- delete
type Blocked = { u: User; detail: string; n: number };

function BlockedModal({ blocked, onClose, onDeactivate, onForce }: { blocked: Blocked | null; onClose: () => void; onDeactivate: (u: User) => void; onForce: (b: Blocked) => void }) {
  return (
    <Modal opened={!!blocked} onClose={onClose} title={blocked ? `Can't delete ${blocked.u.name}` : ''} size="md">
      {blocked && (
        <Stack gap="md">
          <Text size="md">{blocked.detail}</Text>
          <Group justify="space-between">
            <Button variant="subtle" color="fail" leftSection={<IconTrash size={15} />} onClick={() => onForce(blocked)}>
              Delete with all submissions
            </Button>
            <Group gap="xs">
              <Button variant="default" onClick={onClose}>
                Cancel
              </Button>
              {blocked.u.is_active && (
                <Button leftSection={<IconUserOff size={15} />} onClick={() => onDeactivate(blocked.u)} data-autofocus>
                  Deactivate instead
                </Button>
              )}
            </Group>
          </Group>
        </Stack>
      )}
    </Modal>
  );
}

function ForceDeleteModal({ target, onClose, onConfirm, loading }: { target: Blocked | null; onClose: () => void; onConfirm: (u: User) => void; loading: boolean }) {
  const [typed, setTyped] = useState('');
  useEffect(() => setTyped(''), [target]);
  if (!target) return <Modal opened={false} onClose={onClose} />;
  const { u, n } = target;
  const match = normRoll(typed) === u.roll_no;
  return (
    <Modal opened onClose={onClose} title="Delete with all submissions?" size="md">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (match) onConfirm(u);
        }}
      >
        <Stack gap="md">
          <Box px="sm" py={8} style={{ border: '1px solid rgba(242,112,107,0.45)', background: 'rgba(242,112,107,0.08)', borderRadius: 4 }}>
            <Text fw={600}>{who(u)}</Text>
          </Box>
          <Text size="md">
            Removes the account and {n} submission{n === 1 ? '' : 's'} with their grades and flags. This cannot be undone.
          </Text>
          <TextInput
            label={
              <>
                Type <span className="ag-mono">{u.roll_no}</span> to confirm
              </>
            }
            value={typed}
            onChange={(e) => setTyped(e.currentTarget.value)}
            styles={{ input: { fontFamily: 'var(--mantine-font-family-monospace)' } }}
            autoComplete="off"
            data-autofocus
          />
          <Group justify="flex-end">
            <Button variant="default" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" color="fail" disabled={!match} loading={loading}>
              Delete {u.roll_no}
            </Button>
          </Group>
        </Stack>
      </form>
    </Modal>
  );
}

type BulkDeleteReport = { deleted: User[]; skipped: User[]; failed: string[] };

function BulkDeleteReportModal({ report, onClose, onDeactivate }: { report: BulkDeleteReport | null; onClose: () => void; onDeactivate: (users: User[]) => void }) {
  const active = report?.skipped.filter((u) => u.is_active) ?? [];
  const tried = report ? report.deleted.length + report.skipped.length + report.failed.length : 0;
  return (
    <Modal opened={!!report} onClose={onClose} title={report ? `Deleted ${report.deleted.length} of ${tried}` : ''} size="md">
      {report && (
        <Stack gap="md">
          {report.skipped.length > 0 && (
            <Stack gap={6}>
              <Text size="md">Skipped {report.skipped.length} with submissions. Deactivate them instead to keep their grades.</Text>
              <Text size="sm" className="ag-mono" c="dimmed">
                {report.skipped.map((u) => u.roll_no).join(', ')}
              </Text>
            </Stack>
          )}
          {report.failed.length > 0 && (
            <Alert color="fail" variant="light" icon={<IconAlertCircle size={18} />}>
              {report.failed.join(' ')}
            </Alert>
          )}
          <Group justify="flex-end">
            <Button variant="default" onClick={onClose}>
              Close
            </Button>
            {active.length > 0 && (
              <Button leftSection={<IconUserOff size={15} />} onClick={() => onDeactivate(active)}>
                Deactivate {active.length}
              </Button>
            )}
          </Group>
        </Stack>
      )}
    </Modal>
  );
}

// ---------------------------------------------------------------- page
type ActiveFilter = 'all' | 'active' | 'inactive';

export default function Users() {
  const qc = useQueryClient();
  const { user: me } = useAuth();
  const isAdmin = me?.role === 'admin';
  const [search, setSearch] = useState('');
  const [debounced] = useDebouncedValue(search.trim(), 300);
  const [role, setRole] = useState<Role | ''>('');
  const [active, setActive] = useState<ActiveFilter>('all');
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<Map<number, User>>(new Map());
  const [adding, setAdding] = useState(false);
  const [importing, setImporting] = useState(false);
  const [editing, setEditing] = useState<User | null>(null);
  const [secrets, setSecrets] = useState<Secret[] | null>(null);
  const [secretsTitle, setSecretsTitle] = useState<string | undefined>();
  const [blocked, setBlocked] = useState<Blocked | null>(null);
  const [forcing, setForcing] = useState<Blocked | null>(null);
  const [bulkReport, setBulkReport] = useState<BulkDeleteReport | null>(null);

  useEffect(() => setPage(1), [debounced, role, active]);

  const params = { q: debounced, role, active: active === 'all' ? ('' as const) : active === 'active', page, page_size: PAGE_SIZE };
  const q = useQuery({
    queryKey: ['staff', 'users', params],
    queryFn: () => api.staff.users(params),
    placeholderData: keepPreviousData,
  });
  const rows = q.data?.items ?? [];
  const total = q.data?.total ?? 0;
  const filtered = !!debounced || !!role || active !== 'all';

  const showSecrets = (s: Secret[], title?: string) => {
    if (!s.length) return;
    setSecretsTitle(title);
    setSecrets(s);
  };

  const patchOne = useMutation({
    mutationFn: ({ u, body }: { u: User; body: { is_active?: boolean; reset_password?: true } }) => api.staff.updateUser(u.id, body),
    onSuccess: (r, { body }) => {
      qc.invalidateQueries({ queryKey: ['staff', 'users'] });
      if (body.reset_password) {
        notify.success(`Password reset for ${r.user.roll_no}`);
        if (r.password) showSecrets([{ roll_no: r.user.roll_no, name: r.user.name, password: r.password }], `New password for ${r.user.roll_no}`);
      } else notify.success(`${body.is_active ? 'Reactivated' : 'Deactivated'} ${r.user.roll_no}`);
    },
    onError: (e) => notify.error(e),
  });

  const bulk = useMutation({
    mutationFn: async ({ users, body }: { users: User[]; body: { is_active?: boolean; reset_password?: true } }) => {
      const ok: { user: User; password?: string }[] = [];
      const failed: string[] = [];
      for (const u of users) {
        try {
          ok.push(await api.staff.updateUser(u.id, body));
        } catch (e) {
          failed.push(`${u.roll_no}: ${e instanceof ApiError ? e.detail : String(e)}`);
        }
      }
      return { ok, failed };
    },
    onSuccess: ({ ok, failed }, { body }) => {
      qc.invalidateQueries({ queryKey: ['staff', 'users'] });
      setSelected(new Map());
      const n = ok.length;
      if (body.reset_password) {
        if (n) notify.success(`Passwords reset for ${n} ${n === 1 ? 'person' : 'people'}`);
        showSecrets(ok.filter((r) => r.password).map((r) => ({ roll_no: r.user.roll_no, name: r.user.name, password: r.password! })));
      } else if (n) notify.success(`Deactivated ${n} ${n === 1 ? 'account' : 'accounts'}`);
      if (failed.length) notify.error(new Error(`${failed.length} not changed. ${failed.slice(0, 3).join(' ')}`));
    },
  });

  const unselect = (ids: number[]) =>
    setSelected((m) => {
      const n = new Map(m);
      for (const id of ids) n.delete(id);
      return n;
    });

  const delOne = useMutation({
    mutationFn: ({ u, force }: { u: User; force?: boolean }) => api.staff.deleteUser(u.id, { force }),
    onSuccess: (r, { u }) => {
      qc.invalidateQueries({ queryKey: ['staff'] });
      unselect([u.id]);
      setBlocked(null);
      setForcing(null);
      notify.success(r.submissions ? `Deleted ${u.roll_no} and ${r.submissions} submission${r.submissions === 1 ? '' : 's'}` : `Deleted ${u.roll_no}`);
    },
    onError: (e, { u }) => {
      if (e instanceof ApiError && e.status === 409 && e.extra.code === 'has_submissions') setBlocked({ u, detail: e.detail, n: Number(e.extra.submissions) || 0 });
      else notify.error(e);
    },
  });

  const bulkDel = useMutation({
    mutationFn: async (users: User[]) => {
      const out: BulkDeleteReport = { deleted: [], skipped: [], failed: [] };
      for (const u of users) {
        try {
          await api.staff.deleteUser(u.id);
          out.deleted.push(u);
        } catch (e) {
          if (e instanceof ApiError && e.extra.code === 'has_submissions') out.skipped.push(u);
          else out.failed.push(`${u.roll_no}: ${e instanceof ApiError ? e.detail : String(e)}`);
        }
      }
      return out;
    },
    onSuccess: (out) => {
      qc.invalidateQueries({ queryKey: ['staff'] });
      setSelected(new Map());
      if (out.skipped.length || out.failed.length) setBulkReport(out);
      else notify.success(`Deleted ${out.deleted.length} ${out.deleted.length === 1 ? 'account' : 'accounts'}`);
    },
    onError: (e) => notify.error(e),
  });

  const deleteOne = async (u: User) => {
    const ok = await confirm({
      title: `Delete ${u.name}?`,
      target: who(u),
      message: 'This cannot be undone.',
      confirmLabel: 'Delete',
      danger: true,
    });
    if (ok) delOne.mutate({ u });
  };

  const resetOne = async (u: User) => {
    const ok = await confirm({
      title: 'Reset this password?',
      target: who(u),
      message: 'The current password stops working. A new one-time password is shown next.',
      confirmLabel: 'Reset password',
    });
    if (ok) patchOne.mutate({ u, body: { reset_password: true } });
  };
  const toggleActive = async (u: User) => {
    const deactivate = u.is_active;
    const ok = await confirm({
      title: deactivate ? 'Deactivate this account?' : 'Reactivate this account?',
      target: who(u),
      message: deactivate
        ? 'They will be signed out. Grades are kept.'
        : undefined,
      confirmLabel: deactivate ? 'Deactivate' : 'Reactivate',
      danger: deactivate,
    });
    if (ok) patchOne.mutate({ u, body: { is_active: !deactivate } });
  };

  const sel = [...selected.values()];
  const selectable = (u: User) => u.id !== me?.id && (isAdmin || u.role === 'student');
  const pageSelectable = rows.filter(selectable);
  const allOnPage = pageSelectable.length > 0 && pageSelectable.every((u) => selected.has(u.id));
  const someOnPage = pageSelectable.some((u) => selected.has(u.id));
  const toggle = (u: User) =>
    setSelected((m) => {
      const n = new Map(m);
      if (n.has(u.id)) n.delete(u.id);
      else n.set(u.id, u);
      return n;
    });
  const toggleAll = () =>
    setSelected((m) => {
      const n = new Map(m);
      for (const u of pageSelectable) {
        if (allOnPage) n.delete(u.id);
        else n.set(u.id, u);
      }
      return n;
    });

  const bulkDeactivate = async () => {
    const targets = sel.filter((u) => u.is_active);
    if (!targets.length) return notify.info('Everyone selected is already inactive.');
    const names = targets.slice(0, 4).map(who).join(', ') + (targets.length > 4 ? ` and ${targets.length - 4} more` : '');
    const ok = await confirm({
      title: `Deactivate ${targets.length} ${targets.length === 1 ? 'account' : 'accounts'}?`,
      target: names,
      message: 'They will be signed out. Grades are kept.',
      confirmLabel: `Deactivate ${targets.length}`,
      danger: true,
    });
    if (ok) bulk.mutate({ users: targets, body: { is_active: false } });
  };
  const bulkDelete = async () => {
    const ok = await confirm({
      title: `Delete ${sel.length} ${sel.length === 1 ? 'account' : 'accounts'}?`,
      target: sel.slice(0, 4).map(who).join(', ') + (sel.length > 4 ? ` and ${sel.length - 4} more` : ''),
      message: 'Accounts with submissions are skipped. This cannot be undone.',
      confirmLabel: `Delete ${sel.length}`,
      danger: true,
    });
    if (ok) bulkDel.mutate(sel);
  };
  const bulkReset = async () => {
    const ok = await confirm({
      title: `Reset ${sel.length} ${sel.length === 1 ? 'password' : 'passwords'}?`,
      target: sel.slice(0, 4).map(who).join(', ') + (sel.length > 4 ? ` and ${sel.length - 4} more` : ''),
      message: 'New passwords are shown once.',
      confirmLabel: `Reset ${sel.length} ${sel.length === 1 ? 'password' : 'passwords'}`,
    });
    if (ok) bulk.mutate({ users: sel, body: { reset_password: true } });
  };
  const bulkExport = () => {
    const lines = ['roll_no,name,role,is_active,created_at,last_login_at'];
    for (const u of sel) lines.push([u.roll_no, u.name, u.role, u.is_active ? '1' : '0', u.created_at ?? '', u.last_login_at ?? ''].map(csvCell).join(','));
    downloadBlob(lines.join('\n') + '\n', `roster-selected-${new Date().toISOString().slice(0, 10)}.csv`, 'text/csv');
    notify.success(`Exported ${sel.length} ${sel.length === 1 ? 'row' : 'rows'}`);
  };
  const exportAll = async () => {
    try {
      downloadBlob(await api.staff.usersExportCsv(), `roster-${new Date().toISOString().slice(0, 10)}.csv`);
      notify.success('Exported the roster');
    } catch (e) {
      notify.error(e);
    }
  };

  const columns: Column<User>[] = useMemo(
    () => [
      {
        key: 'sel',
        header: (
          <Checkbox
            aria-label="Select everyone on this page"
            checked={allOnPage}
            indeterminate={someOnPage && !allOnPage}
            onChange={toggleAll}
            disabled={!pageSelectable.length}
          />
        ),
        cardLabel: 'Select',
        hideOnCard: true,
        width: 40,
        cell: (u) => (
          <Checkbox
            aria-label={`Select ${u.roll_no}`}
            checked={selected.has(u.id)}
            onChange={() => toggle(u)}
            disabled={!selectable(u)}
            onClick={(e) => e.stopPropagation()}
          />
        ),
      },
      { key: 'roll', header: 'Roll number', mono: true, hideOnCard: true, cell: (u) => u.roll_no },
      { key: 'name', header: 'Name', hideOnCard: true, cell: (u) => (u.id === me?.id ? `${u.name} (you)` : u.name) },
      { key: 'role', header: 'Role', cell: (u) => <RoleChip role={u.role} /> },
      { key: 'state', header: 'Account', cell: (u) => <AccountChip u={u} /> },
      {
        key: 'login',
        header: 'Last sign-in',
        cell: (u) =>
          u.last_login_at ? (
            <Tooltip label={fmtDate(u.last_login_at)}>
              <Text size="sm" component="span">
                {fmtRelative(u.last_login_at)}
              </Text>
            </Tooltip>
          ) : (
            <Text size="sm" c="dimmed" component="span">
              Never
            </Text>
          ),
      },
      { key: 'created', header: 'Added', cell: (u) => <Text size="sm" component="span">{u.created_at ? new Date(u.created_at).toLocaleDateString(undefined, { dateStyle: 'medium' }) : '-'}</Text> },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [selected, rows, me?.id, allOnPage, someOnPage],
  );

  const from = total ? (page - 1) * PAGE_SIZE + 1 : 0;
  const to = Math.min(total, page * PAGE_SIZE);

  return (
    <Stack gap="lg">
      <PageHeader
        title="Roster"
        description={q.data && !filtered ? `${total} ${total === 1 ? 'person' : 'people'}` : undefined}
        breadcrumbs={[{ label: 'Course' }, { label: 'Roster' }]}
        actions={
          <>
            <Button variant="default" leftSection={<IconFileSpreadsheet size={16} />} onClick={() => setImporting(true)}>
              Import roster
            </Button>
            <Button leftSection={<IconUserPlus size={16} />} onClick={() => setAdding(true)}>
              Add student
            </Button>
          </>
        }
      />

      <Group gap="sm" align="flex-end" wrap="wrap">
        <TextInput
          label="Search"
          placeholder="Roll number or name"
          leftSection={<IconSearch size={15} />}
          value={search}
          onChange={(e) => setSearch(e.currentTarget.value)}
          w={260}
          rightSection={search ? <CloseButton size="sm" aria-label="Clear search" onClick={() => setSearch('')} /> : null}
        />
        <Select
          label="Role"
          w={160}
          data={[
            { value: '', label: 'All roles' },
            { value: 'student', label: 'Students' },
            { value: 'ta', label: 'TAs' },
            { value: 'admin', label: 'Admins' },
          ]}
          value={role}
          onChange={(v) => setRole((v ?? '') as Role | '')}
          allowDeselect={false}
        />
        <Stack gap={4}>
          <Text size="sm" fw={500}>
            Account
          </Text>
          <SegmentedControl
            value={active}
            onChange={(v) => setActive(v as ActiveFilter)}
            data={[
              { value: 'all', label: 'All' },
              { value: 'active', label: 'Active' },
              { value: 'inactive', label: 'Inactive' },
            ]}
          />
        </Stack>
        <Box style={{ flex: 1 }} />
        <Button variant="subtle" leftSection={<IconDownload size={16} />} onClick={exportAll}>
          Export CSV
        </Button>
      </Group>

      {sel.length > 0 && (
        <Paper p="xs" px="sm" style={{ borderColor: 'var(--ag-iris)' }} role="region" aria-label="Bulk actions">
          <Group justify="space-between" wrap="wrap" gap="xs">
            <Text size="sm" fw={500}>
              {sel.length} selected
            </Text>
            <Group gap="xs">
              <Button size="xs" variant="default" leftSection={<IconKey size={14} />} onClick={bulkReset} loading={bulk.isPending && !!bulk.variables?.body.reset_password}>
                Reset passwords
              </Button>
              <Button size="xs" variant="light" color="fail" leftSection={<IconUserOff size={14} />} onClick={bulkDeactivate} loading={bulk.isPending && bulk.variables?.body.is_active === false}>
                Deactivate
              </Button>
              {isAdmin && (
                <Button size="xs" variant="light" color="fail" leftSection={<IconTrash size={14} />} onClick={bulkDelete} loading={bulkDel.isPending}>
                  Delete
                </Button>
              )}
              <Button size="xs" variant="default" leftSection={<IconDownload size={14} />} onClick={bulkExport}>
                Export CSV
              </Button>
              <Button size="xs" variant="subtle" color="gray" onClick={() => setSelected(new Map())}>
                Clear
              </Button>
            </Group>
          </Group>
        </Paper>
      )}

      {q.error ? (
        <ErrorState error={q.error} onRetry={() => q.refetch()} backTo={false} />
      ) : (
        <Stack gap="sm">
          <ResponsiveTable
            data={rows}
            loading={q.isPending}
            columns={columns}
            rowKey={(u) => u.id}
            minWidth={860}
            caption="Roster"
            rowStyle={(u) => (u.is_active ? undefined : { opacity: 0.65 })}
            cardTitle={(u) => (
              <Group gap={6}>
                <Checkbox aria-label={`Select ${u.roll_no}`} checked={selected.has(u.id)} onChange={() => toggle(u)} disabled={!selectable(u)} />
                <span className="ag-mono">{u.roll_no}</span>
                <span>{u.name}</span>
              </Group>
            )}
            empty={
              filtered ? (
                <EmptyState
                  compact
                  icon={IconSearch}
                  title="No matches"
                  action={
                    <Button
                      variant="default"
                      onClick={() => {
                        setSearch('');
                        setRole('');
                        setActive('all');
                      }}
                    >
                      Clear filters
                    </Button>
                  }
                />
              ) : (
                <EmptyState
                  icon={IconUsers}
                  title="No students yet"
                  action={
                    <>
                      <Button leftSection={<IconUserPlus size={16} />} onClick={() => setAdding(true)}>
                        Add student
                      </Button>
                      <Button variant="default" leftSection={<IconFileSpreadsheet size={16} />} onClick={() => setImporting(true)}>
                        Import roster
                      </Button>
                    </>
                  }
                />
              )
            }
            rowActions={(u) => {
              const self = u.id === me?.id;
              const canTouch = isAdmin || u.role === 'student';
              return (
                <Menu position="bottom-end" withinPortal>
                  <Menu.Target>
                    <ActionIcon variant="subtle" color="gray" aria-label={`Actions for ${u.roll_no}`}>
                      <IconDotsVertical size={16} />
                    </ActionIcon>
                  </Menu.Target>
                  <Menu.Dropdown>
                    <Menu.Item leftSection={<IconPencil size={15} />} onClick={() => setEditing(u)}>
                      Edit
                    </Menu.Item>
                    <Menu.Item leftSection={<IconKey size={15} />} onClick={() => resetOne(u)} disabled={!canTouch}>
                      Reset password
                    </Menu.Item>
                    <Menu.Divider />
                    {u.is_active ? (
                      <Menu.Item color="fail" leftSection={<IconUserOff size={15} />} onClick={() => toggleActive(u)} disabled={self || !canTouch}>
                        Deactivate
                      </Menu.Item>
                    ) : (
                      <Menu.Item leftSection={<IconUserCheck size={15} />} onClick={() => toggleActive(u)} disabled={!canTouch}>
                        Reactivate
                      </Menu.Item>
                    )}
                    {isAdmin && (
                      <Menu.Item color="fail" leftSection={<IconTrash size={15} />} onClick={() => deleteOne(u)} disabled={self}>
                        Delete
                      </Menu.Item>
                    )}
                  </Menu.Dropdown>
                </Menu>
              );
            }}
          />
          {total > 0 && (
            <Group justify="space-between">
              <Text size="sm" c="dimmed">
                Showing {from} to {to} of {total}
              </Text>
              {total > PAGE_SIZE && <Pagination value={page} onChange={setPage} total={Math.ceil(total / PAGE_SIZE)} size="sm" />}
            </Group>
          )}
        </Stack>
      )}

      <AddUserModal opened={adding} onClose={() => setAdding(false)} isAdmin={isAdmin} onCreated={(s) => showSecrets([s], `Password for ${s.roll_no}`)} />
      <ImportModal opened={importing} onClose={() => setImporting(false)} onImported={(s) => showSecrets(s, `${s.length} new ${s.length === 1 ? 'password' : 'passwords'}`)} />
      <EditDrawer user={editing} onClose={() => setEditing(null)} me={me} />
      <BlockedModal
        blocked={blocked}
        onClose={() => setBlocked(null)}
        onDeactivate={(u) => {
          setBlocked(null);
          patchOne.mutate({ u, body: { is_active: false } });
        }}
        onForce={(b) => {
          setBlocked(null);
          setForcing(b);
        }}
      />
      <ForceDeleteModal target={forcing} onClose={() => setForcing(null)} onConfirm={(u) => delOne.mutate({ u, force: true })} loading={delOne.isPending} />
      <BulkDeleteReportModal
        report={bulkReport}
        onClose={() => setBulkReport(null)}
        onDeactivate={(users) => {
          setBulkReport(null);
          bulk.mutate({ users, body: { is_active: false } });
        }}
      />
      <OneTimeSecretModal
        secrets={secrets}
        title={secretsTitle}
        onClose={() => {
          setSecrets(null);
          setSecretsTitle(undefined);
        }}
      />
    </Stack>
  );
}
