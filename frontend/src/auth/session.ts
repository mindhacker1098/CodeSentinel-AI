// Session-level reactions to API errors, wired into the QueryCache and MutationCache in main.tsx.
// - 401 while signed in: forget `me`, drop cached data, go to /login?from=<path>&reason=expired
// - 403 "password change required": go to /change-password?next=<path>
import type { QueryClient } from '@tanstack/react-query';
import { ApiError, type User } from '../api/client';

type Navigate = (to: string, opts?: { replace?: boolean }) => void;

let navigateRef: Navigate | null = null;

// Set when a 401 ends a live session, so whichever redirect wins (ours or the route guard's) shows the notice.
let sessionExpired = false;
export const wasSessionExpired = () => sessionExpired;
export const clearSessionExpired = () => {
  sessionExpired = false;
};

/** Called by <NavigationBridge/> inside the router so code outside React can navigate. */
export function setNavigator(fn: Navigate | null) {
  navigateRef = fn;
}

function go(to: string) {
  if (navigateRef) navigateRef(to, { replace: true });
  else window.location.assign(to);
}

export function currentPath(): string {
  return window.location.pathname + window.location.search;
}

/** Only same-origin app paths are allowed as redirect targets. */
export function safeNext(raw: string | null | undefined): string | null {
  if (!raw || !raw.startsWith('/') || raw.startsWith('//') || raw.startsWith('/\\')) return null;
  if (/^\/(login|change-password)(\/|\?|$)/.test(raw)) return null;
  return raw;
}

export function loginPath(from?: string | null, reason?: 'expired'): string {
  const p = new URLSearchParams();
  const f = safeNext(from);
  if (f && f !== '/') p.set('from', f);
  if (reason) p.set('reason', reason);
  const s = p.toString();
  return s ? `/login?${s}` : '/login';
}

export function changePasswordPath(next?: string | null): string {
  const n = safeNext(next);
  return n && n !== '/' ? `/change-password?next=${encodeURIComponent(n)}` : '/change-password';
}

export const ME_KEY = ['me'] as const;

/** Clears every cached query except `me` (which is set to null). Order matters: `me` first (audit A1). */
export function forgetSession(qc: QueryClient) {
  qc.setQueryData(ME_KEY, null);
  qc.removeQueries({ predicate: (q) => q.queryKey[0] !== 'me' });
}

/** Navigate to `path` and forget the session in the same tick, so the guards do not add a stale ?from=. */
export function leaveSession(qc: QueryClient, path = '/login') {
  leavingTo = path;
  go(path);
  forgetSession(qc);
}

/** Where a sign-out or expiry is already heading; guards use it instead of adding their own ?from=. */
let leavingTo: string | null = null;
export function takeLeavingTo(): string | null {
  const to = leavingTo;
  leavingTo = null;
  return to;
}

export interface ErrorMeta extends Record<string, unknown> {
  /** Set on queries/mutations whose 401 is an expected answer (e.g. the login form). */
  skipAuthRedirect?: boolean;
}

export function handleApiError(qc: QueryClient, error: unknown, meta?: Record<string, unknown>) {
  if (!(error instanceof ApiError) || (meta as ErrorMeta | undefined)?.skipAuthRedirect) return;
  const me = qc.getQueryData<User | null>(ME_KEY);
  if (error.status === 401) {
    if (!me) return; // already signed out; the guards handle anonymous visitors
    sessionExpired = true;
    leaveSession(qc, loginPath(currentPath(), 'expired'));
    return;
  }
  if (error.isPasswordChangeRequired) {
    if (window.location.pathname === '/change-password') return;
    const next = currentPath();
    if (me && !me.must_change_pw) qc.setQueryData(['me'], { ...me, must_change_pw: true } as User);
    go(changePasswordPath(next));
  }
}
