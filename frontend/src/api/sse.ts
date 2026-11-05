import { useEffect, useState } from 'react';
import { api } from './client';
import type { JobStatus, LogEvent, StageEvent } from './types';

export interface JobEventsState {
  events: LogEvent[];
  /** Latest grading stage (v2 `stage` event), for the student step view. */
  stage: StageEvent | null;
  status: JobStatus | null;
  result: { submission_id: number; grade: number | null } | null;
  done: boolean;
  error: string | null;
  connected: boolean;
}

const initial: JobEventsState = {
  events: [],
  stage: null,
  status: null,
  result: null,
  done: false,
  error: null,
  connected: false,
};

function parse<T>(data: string): T | null {
  try {
    return JSON.parse(data) as T;
  } catch {
    return null;
  }
}

/** Subscribe to /api/jobs/{id}/events. The browser resends Last-Event-ID on reconnect. */
export function useJobEvents(jobId: number | null | undefined): JobEventsState {
  const [state, setState] = useState<JobEventsState>(initial);

  useEffect(() => {
    setState(initial);
    if (!jobId) return;
    const es = new EventSource(api.jobEventsUrl(jobId), { withCredentials: true });
    const seen = new Set<string>();
    let finished = false;

    es.onopen = () => setState((s) => ({ ...s, connected: true, error: null }));

    es.addEventListener('log', (e) => {
      const ev = e as MessageEvent<string>;
      if (ev.lastEventId) {
        if (seen.has(ev.lastEventId)) return;
        seen.add(ev.lastEventId);
      }
      const d = parse<LogEvent>(ev.data);
      if (!d) return;
      setState((s) => ({ ...s, events: [...s.events, { ...d, id: ev.lastEventId || undefined }] }));
    });

    es.addEventListener('stage', (e) => {
      const d = parse<StageEvent>((e as MessageEvent<string>).data);
      if (d) setState((s) => ({ ...s, stage: d }));
    });

    es.addEventListener('status', (e) => {
      const d = parse<{ status: JobStatus }>((e as MessageEvent<string>).data);
      if (d) setState((s) => ({ ...s, status: d.status }));
    });

    es.addEventListener('result', (e) => {
      const d = parse<{ submission_id: number; grade: number | null }>((e as MessageEvent<string>).data);
      if (d) setState((s) => ({ ...s, result: d }));
    });

    es.addEventListener('done', () => {
      finished = true;
      es.close();
      setState((s) => ({ ...s, done: true, connected: false }));
    });

    es.onerror = () => {
      if (finished) return;
      if (es.readyState === EventSource.CLOSED) {
        setState((s) => ({ ...s, connected: false, error: 'The live log disconnected. Reload to see the latest status.' }));
      } else {
        setState((s) => ({ ...s, connected: false }));
      }
    };

    return () => {
      finished = true;
      es.close();
    };
  }, [jobId]);

  return state;
}
