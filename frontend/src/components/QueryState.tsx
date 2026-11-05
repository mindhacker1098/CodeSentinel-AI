import type { ReactNode } from 'react';
import { ErrorState, PageSkeleton, ReportSkeleton, TableSkeleton, CardSkeleton } from './states';

interface Props {
  isPending: boolean;
  error: Error | null;
  children: () => ReactNode;
  /** What to show while loading. Default: a table skeleton. */
  skeleton?: 'table' | 'card' | 'report' | 'page' | ReactNode;
  onRetry?: () => void;
  backTo?: string | false;
}

/** Skeleton / error wrapper for a TanStack query; children render only once data is in. */
export default function QueryState({ isPending, error, children, skeleton = 'table', onRetry, backTo }: Props) {
  if (error) return <ErrorState error={error} onRetry={onRetry} backTo={backTo} />;
  if (isPending) {
    if (skeleton === 'table') return <TableSkeleton />;
    if (skeleton === 'card') return <CardSkeleton />;
    if (skeleton === 'report') return <ReportSkeleton />;
    if (skeleton === 'page') return <PageSkeleton />;
    return <>{skeleton}</>;
  }
  return <>{children()}</>;
}
