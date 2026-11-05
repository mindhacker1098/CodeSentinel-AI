import { useEffect, useState } from 'react';
import { useQueries } from '@tanstack/react-query';
import { api, type SubmissionDetail } from '../../api/client';

/** The same cache entry as the report page, so opening a report from a list is instant. */
export const submissionKey = (id: number) => ['submission', id] as const;

/**
 * Submission details (for the small verdict bars in lists). Only graded ids are fetched; reports
 * rarely change, so they stay fresh for a few minutes.
 */
export function useSubmissionDetails(ids: number[]): Map<number, SubmissionDetail> {
  const results = useQueries({
    queries: ids.map((id) => ({
      queryKey: submissionKey(id),
      queryFn: () => api.submission(id),
      staleTime: 5 * 60_000,
    })),
  });
  const out = new Map<number, SubmissionDetail>();
  results.forEach((r, i) => {
    if (r.data) out.set(ids[i], r.data);
  });
  return out;
}

/** localStorage-backed string state; errors (private mode, quota) are ignored. */
export function useLocalDraft(key: string | null, initial: string) {
  const read = () => {
    if (!key) return null;
    try {
      return window.localStorage.getItem(key);
    } catch {
      return null;
    }
  };
  const [value, setValue] = useState<string>(() => read() ?? initial);
  const [savedAt, setSavedAt] = useState<number | null>(() => (read() !== null ? Date.now() : null));
  const [loadedKey, setLoadedKey] = useState(key);

  if (key !== loadedKey) {
    setLoadedKey(key);
    const v = read();
    setValue(v ?? initial);
    setSavedAt(v !== null ? Date.now() : null);
  }

  useEffect(() => {
    if (!key) return;
    const id = window.setTimeout(() => {
      try {
        if (value === initial) window.localStorage.removeItem(key);
        else window.localStorage.setItem(key, value);
        setSavedAt(value === initial ? null : Date.now());
      } catch {
        /* storage unavailable */
      }
    }, 600);
    return () => window.clearTimeout(id);
  }, [key, value, initial]);

  const clear = () => {
    if (key) {
      try {
        window.localStorage.removeItem(key);
      } catch {
        /* ignore */
      }
    }
    setValue(initial);
    setSavedAt(null);
  };

  return { value, setValue, savedAt, clear, isDraft: value !== initial };
}
