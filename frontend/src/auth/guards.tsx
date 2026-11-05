import { useEffect, type ReactNode } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { Center, Loader, Stack, Text } from '@mantine/core';
import type { Role } from '../api/client';
import { useAuth } from './AuthProvider';
import { changePasswordPath, loginPath, setNavigator, takeLeavingTo, wasSessionExpired } from './session';
import ForbiddenPage from '../pages/system/ForbiddenPage';

export const STAFF: Role[] = ['ta', 'admin'];
export const STUDENT: Role[] = ['student'];

export function homeFor(role: Role | undefined): string {
  return role === 'ta' || role === 'admin' ? '/staff' : '/dashboard';
}

/** Full-height loader used only while `me` is first resolved. */
export function FullLoader({ label = 'Checking your session' }: { label?: string }) {
  return (
    <Center h="100vh" role="status" aria-live="polite">
      <Stack align="center" gap="xs">
        <Loader size="sm" />
        <Text size="sm" c="dimmed">
          {label}
        </Text>
      </Stack>
    </Center>
  );
}

/**
 * Gate for signed-in routes.
 * - anonymous: /login?from=<this path>
 * - must change password: /change-password?next=<this path>
 * - wrong role: the 403 page (not a silent redirect)
 */
export function RequireAuth({ roles, children }: { roles?: Role[]; children: ReactNode }) {
  const { user, loading } = useAuth();
  const loc = useLocation();
  const here = loc.pathname + loc.search;
  if (loading) return <FullLoader />;
  if (!user) return <Navigate to={takeLeavingTo() ?? loginPath(here, wasSessionExpired() ? 'expired' : undefined)} replace />;
  if (user.must_change_pw && loc.pathname !== '/change-password') {
    return <Navigate to={changePasswordPath(here)} replace />;
  }
  if (roles && !roles.includes(user.role)) return <ForbiddenPage />;
  return <>{children}</>;
}

export function HomeRedirect() {
  const { user, loading } = useAuth();
  if (loading) return <FullLoader />;
  return <Navigate to={user ? homeFor(user.role) : '/login'} replace />;
}

/** Lets session.ts navigate from the QueryCache error handler. Render once inside the router. */
export function NavigationBridge() {
  const nav = useNavigate();
  useEffect(() => {
    setNavigator((to, opts) => nav(to, opts));
    return () => setNavigator(null);
  }, [nav]);
  return null;
}
