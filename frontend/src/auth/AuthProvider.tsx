import { createContext, useCallback, useContext, useMemo, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError, type User } from '../api/client';
import { clearSessionExpired, leaveSession, ME_KEY } from './session';

interface AuthValue {
  user: User | null;
  loading: boolean;
  /** Signs in and stores `me`. Throws ApiError with a readable `detail` on failure. */
  login: (roll_no: string, password: string) => Promise<User>;
  /** Signs out on the server, goes to /login and forgets `me` and every cached query. Never throws. */
  logout: () => Promise<void>;
  refresh: () => Promise<User | null>;
  setUser: (u: User | null) => void;
}

const AuthContext = createContext<AuthValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  // GET /auth/me answers {user: null} for anonymous visitors (api.me also maps a v1 401 to null).
  const me = useQuery({ queryKey: ME_KEY, queryFn: api.me, staleTime: 60_000, retry: 1, meta: { skipAuthRedirect: true } });

  const setUser = useCallback((u: User | null) => qc.setQueryData(ME_KEY, u), [qc]);

  const login = useCallback(
    async (roll_no: string, password: string) => {
      let u = await api.login(roll_no, password);
      if (!u) u = await api.me();
      if (!u) throw new ApiError(401, 'You were signed in, but the browser did not keep the session cookie. Allow cookies for this site and try again.');
      // Drop anything cached for a previous user before storing the new one.
      qc.removeQueries({ predicate: (q) => q.queryKey[0] !== 'me' });
      clearSessionExpired();
      qc.setQueryData(ME_KEY, u);
      return u;
    },
    [qc],
  );

  const logout = useCallback(async () => {
    try {
      await api.logout();
    } catch {
      /* the cookie may already be gone; sign out locally anyway */
    }
    clearSessionExpired();
    leaveSession(qc, '/login');
  }, [qc]);

  const refresh = useCallback(async () => {
    const u = await api.me();
    qc.setQueryData(ME_KEY, u);
    return u;
  }, [qc]);

  const value = useMemo<AuthValue>(
    () => ({ user: me.data ?? null, loading: me.isPending, login, logout, refresh, setUser }),
    [me.data, me.isPending, login, logout, refresh, setUser],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthValue {
  const v = useContext(AuthContext);
  if (!v) throw new Error('useAuth must be used inside AuthProvider');
  return v;
}

export const isStaff = (u: User | null | undefined) => !!u && (u.role === 'ta' || u.role === 'admin');
export const isAdmin = (u: User | null | undefined) => !!u && u.role === 'admin';
