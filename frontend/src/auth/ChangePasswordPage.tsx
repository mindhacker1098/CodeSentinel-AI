import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Alert, Box, Button, Group, Paper, PasswordInput, Progress, Stack, Text, Title } from '@mantine/core';
import { useForm } from '@mantine/form';
import { IconAlertCircle, IconArrowLeft, IconLogout, IconShieldLock } from '@tabler/icons-react';
import { api, ApiError } from '../api/client';
import { Logo } from '../components/LogoMark';
import { useDocumentTitle } from '../layout/pageMeta';
import { notify } from '../notify';
import { useAuth } from './AuthProvider';
import { homeFor } from './guards';
import { safeNext } from './session';
import classes from './auth.module.css';

export const PASSWORD_MIN = 8;
export const PASSWORD_MAX = 72;
export const PASSWORD_POLICY = 'Password must be 8 to 72 characters.';

export function passwordPolicyError(pw: string): string | null {
  return pw.length < PASSWORD_MIN || pw.length > PASSWORD_MAX ? PASSWORD_POLICY : null;
}

/** 0-4: a rough strength estimate from length and character variety. */
export function passwordStrength(pw: string): { score: number; label: string; color: string } {
  if (!pw) return { score: 0, label: '', color: 'gray' };
  let s = 0;
  if (pw.length >= PASSWORD_MIN) s++;
  if (pw.length >= 12) s++;
  const kinds = [/[a-z]/, /[A-Z]/, /\d/, /[^A-Za-z0-9]/].filter((r) => r.test(pw)).length;
  if (kinds >= 2) s++;
  if (kinds >= 3 && pw.length >= 10) s++;
  if (/^(.)\1+$/.test(pw) || /^(password|12345678|qwerty)/i.test(pw)) s = Math.min(s, 1);
  if (pw.length < PASSWORD_MIN) s = Math.min(s, 1);
  const table = [
    { label: 'Too short', color: 'fail' },
    { label: 'Weak', color: 'fail' },
    { label: 'Fair', color: 'warn' },
    { label: 'Good', color: 'pass' },
    { label: 'Strong', color: 'pass' },
  ];
  return { score: s, ...table[s] };
}

function StrengthMeter({ value }: { value: string }) {
  const st = passwordStrength(value);
  const tooLong = value.length > PASSWORD_MAX;
  return (
    <Stack gap={4} aria-live="polite">
      <Group gap={4} grow aria-hidden>
        {[1, 2, 3, 4].map((i) => (
          <Progress key={i} value={value && st.score >= i ? 100 : 0} color={st.color} size={4} radius="xs" bg="var(--ag-raised)" transitionDuration={0} />
        ))}
      </Group>
      <Group justify="space-between" wrap="nowrap" align="flex-start" gap="sm">
        <Text size="sm" c={tooLong ? 'fail.5' : 'dimmed'} style={{ flex: 1 }}>
          {tooLong ? `${value.length} characters. The limit is ${PASSWORD_MAX}.` : '8 to 72 characters. A short phrase works well.'}
        </Text>
        {value && !tooLong && (
          <Text size="sm" c={`${st.color}.5`} fw={500} style={{ whiteSpace: 'nowrap' }}>
            {st.label}
          </Text>
        )}
      </Group>
    </Stack>
  );
}

/** Standalone page (no app navigation). Forced after a reset; also reachable from the user menu. */
export default function ChangePasswordPage() {
  const { user, logout, login, setUser } = useAuth();
  const nav = useNavigate();
  const [params] = useSearchParams();
  const next = safeNext(params.get('next'));
  const forced = !!user?.must_change_pw;
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useDocumentTitle(forced ? 'Set a new password' : 'Change password');

  const form = useForm({
    mode: 'controlled',
    initialValues: { old: '', next: '', again: '' },
    validate: {
      old: (v) => (v ? null : 'Enter your current password.'),
      next: (v, all) => passwordPolicyError(v) ?? (v === all.old ? 'Must differ from the current password.' : null),
      again: (v, all) => (v === all.next ? null : 'Passwords do not match.'),
    },
    validateInputOnBlur: true,
  });

  const dest = next ?? homeFor(user?.role);

  const submit = form.onSubmit(async (v) => {
    if (!user) return;
    setBusy(true);
    setErr(null);
    try {
      await api.changePassword(v.old, v.next);
      // The server revokes older sessions on a change; if this one went too, sign in with the new password.
      let u = await api.me();
      if (!u) u = await login(user.roll_no, v.next);
      setUser({ ...u, must_change_pw: false });
      notify.success('Password changed.');
      nav(dest, { replace: true });
    } catch (e) {
      if (e instanceof ApiError && e.status === 400 && /old|current/i.test(e.detail) && /wrong|incorrect|not right/i.test(e.detail)) {
        form.setFieldError('old', 'Wrong password.');
      } else if (e instanceof ApiError && (e.status === 422 || /8 to 72/.test(e.detail))) {
        form.setFieldError('next', e.detail);
      } else {
        setErr(e instanceof ApiError ? e.detail : (e as Error).message);
      }
    } finally {
      setBusy(false);
    }
  });

  return (
    <div className={classes.standalone}>
      <header className={classes.standaloneBar}>
        <Logo />
        {forced ? (
          <Button
            variant="subtle"
            color="gray"
            leftSection={<IconLogout size={16} />}
            onClick={async () => {
              await logout();
            }}
          >
            Sign out
          </Button>
        ) : (
          <Button variant="subtle" color="gray" leftSection={<IconArrowLeft size={16} />} component={Link} to={dest}>
            Back
          </Button>
        )}
      </header>
      <main className={classes.standaloneBody} id="main" tabIndex={-1}>
        <Box w="100%" maw={420}>
          <Stack gap="lg">
            <div>
              <Title order={1} fz={22}>
                {forced ? 'Set a new password' : 'Change password'}
              </Title>
            </div>
            <Paper p="lg">
              <form onSubmit={submit} noValidate>
                <Stack gap="md">
                  {err && (
                    <Alert color="fail" variant="light" icon={<IconAlertCircle size={18} />} role="alert">
                      {err}
                    </Alert>
                  )}
                  {user && (
                    <Text size="sm" c="dimmed">
                      Signed in as <span className="ag-mono">{user.roll_no}</span>
                      {user.name ? `, ${user.name}` : ''}
                    </Text>
                  )}
                  <PasswordInput
                    label={forced ? 'Temporary password' : 'Current password'}
                    autoComplete="current-password"
                    autoFocus
                    {...form.getInputProps('old')}
                  />
                  <Stack gap={6}>
                    <PasswordInput label="New password" autoComplete="new-password" maxLength={200} {...form.getInputProps('next')} />
                    <StrengthMeter value={form.values.next} />
                  </Stack>
                  <PasswordInput label="Repeat new password" autoComplete="new-password" {...form.getInputProps('again')} />
                  <Button type="submit" loading={busy} leftSection={<IconShieldLock size={16} />}>
                    {forced ? 'Set password' : 'Change password'}
                  </Button>
                </Stack>
              </form>
            </Paper>
          </Stack>
        </Box>
      </main>
    </div>
  );
}
