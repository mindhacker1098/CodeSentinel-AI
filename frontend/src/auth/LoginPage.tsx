import { useState } from 'react';
import { Navigate, useSearchParams } from 'react-router-dom';
import { Alert, Box, Button, PasswordInput, Stack, Text, TextInput, Title } from '@mantine/core';
import { useForm } from '@mantine/form';
import { IconAlertCircle, IconClockHour4 } from '@tabler/icons-react';
import { ApiError } from '../api/client';
import { Logo } from '../components/LogoMark';
import { useDocumentTitle } from '../layout/pageMeta';
import { useAuth } from './AuthProvider';
import { homeFor } from './guards';
import { changePasswordPath, safeNext } from './session';
import classes from './auth.module.css';

function loginError(e: unknown): { title: string; body: string } {
  if (e instanceof ApiError) {
    if (e.status === 401)
      return { title: 'Roll number or password is wrong', body: 'Check both and try again. Passwords are case-sensitive.' };
    if (e.status === 429) return { title: 'Too many attempts', body: 'Wait a minute, then try again.' };
    if (e.status === 403) return { title: 'This account cannot sign in', body: e.detail };
    if (e.status === 0) return { title: 'Could not reach the server', body: 'Check your connection.' };
    return { title: 'Sign-in failed', body: e.detail };
  }
  return { title: 'Sign-in failed', body: e instanceof Error ? e.message : String(e) };
}

function Identity() {
  return (
    <Box className={classes.identity}>
      <Stack gap="xl" maw={460}>
        <Logo size={28} />
        <Stack gap="sm">
          <Title order={2} fz={26} fw={600} lh={1.25}>
            Hand in your C program. See exactly where the marks went.
          </Title>
        </Stack>
        <Text c="dimmed">
          Submit assignments, inspect test results, and review source-specific feedback.
          Sign in with your Admin, TA, or Student account.
        </Text>
        <Text size="sm" c="dimmed">
          CS5103 lab, IIT Patna
        </Text>
      </Stack>
    </Box>
  );
}

export default function LoginPage() {
  const { user, login } = useAuth();
  const [params] = useSearchParams();
  const from = safeNext(params.get('from'));
  const expired = params.get('reason') === 'expired';
  const [err, setErr] = useState<{ title: string; body: string } | null>(null);
  const [busy, setBusy] = useState(false);
  useDocumentTitle('Sign in');

  const form = useForm({
    mode: 'controlled',
    initialValues: { roll_no: '', password: '' },
    validate: {
      roll_no: (v) => (v.trim() ? null : 'Enter your roll number.'),
      password: (v) => (v ? null : 'Enter your password.'),
    },
  });

  // Signed in (now or already): go to the deep link, via the forced password change if needed.
  if (user) {
    const dest = from ?? homeFor(user.role);
    return <Navigate to={user.must_change_pw ? changePasswordPath(dest) : dest} replace />;
  }

  const submit = form.onSubmit(async (v) => {
    setBusy(true);
    setErr(null);
    try {
      await login(v.roll_no.trim(), v.password);
      // the `if (user)` branch above does the redirect on the next render
    } catch (e) {
      setErr(loginError(e));
      form.setFieldValue('password', '');
    } finally {
      setBusy(false);
    }
  });

  return (
    <div className={classes.split}>
      <Identity />
      <main className={classes.formSide} id="main">
        <Box w="100%" maw={360}>
          <Box hiddenFrom="md" mb="xl">
            <Logo size={26} />
          </Box>
          <form onSubmit={submit} noValidate>
            <Stack gap="md">
              <div>
                <Title order={1} fz={22}>
                  Sign in
                </Title>
              </div>
              {expired && !err && (
                <Alert color="info" variant="light" icon={<IconClockHour4 size={18} />} role="status">
                  Your session ended. Sign in again.
                </Alert>
              )}
              {err && (
                <Alert color="fail" variant="light" icon={<IconAlertCircle size={18} />} title={err.title} role="alert">
                  {err.body}
                </Alert>
              )}
              <TextInput
                label="Roll number"
                placeholder="e.g. 2401CS17"
                autoComplete="username"
                autoCapitalize="characters"
                spellCheck={false}
                autoFocus
                classNames={{ input: 'ag-mono' }}
                {...form.getInputProps('roll_no')}
              />
              <PasswordInput label="Password" autoComplete="current-password" {...form.getInputProps('password')} />
              <Button type="submit" loading={busy} fullWidth mt={4}>
                Sign in
              </Button>
              <Text size="sm" c="dimmed">
                Forgot your password? Ask your TA.
              </Text>
            </Stack>
          </form>
        </Box>
      </main>
    </div>
  );
}
