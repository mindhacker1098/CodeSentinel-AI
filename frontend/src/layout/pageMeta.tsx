import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useLocation } from 'react-router-dom';

export interface Crumb {
  label: string;
  /** Omit for the current page. */
  to?: string;
}

interface PageMeta {
  crumbs: Crumb[] | null;
  setCrumbs: (c: Crumb[] | null) => void;
}

const Ctx = createContext<PageMeta>({ crumbs: null, setCrumbs: () => {} });

export function PageMetaProvider({ children }: { children: ReactNode }) {
  const [crumbs, setCrumbs] = useState<Crumb[] | null>(null);
  const value = useMemo(() => ({ crumbs, setCrumbs }), [crumbs]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function usePageMeta() {
  return useContext(Ctx);
}

/** Publishes breadcrumbs to the top bar while the calling page is mounted. */
export function useBreadcrumbs(crumbs: Crumb[] | undefined) {
  const { setCrumbs } = useContext(Ctx);
  const key = crumbs ? JSON.stringify(crumbs) : '';
  useEffect(() => {
    if (!key) return;
    setCrumbs(JSON.parse(key) as Crumb[]);
    return () => setCrumbs(null);
  }, [key, setCrumbs]);
}

export const APP_NAME = 'AutoGrader';

/** Sets document.title to "<title> - AutoGrader" while mounted. */
export function useDocumentTitle(title: string | null | undefined) {
  const { pathname } = useLocation();
  useEffect(() => {
    if (title) document.title = `${title} - ${APP_NAME}`;
  }, [title, pathname]);
}
