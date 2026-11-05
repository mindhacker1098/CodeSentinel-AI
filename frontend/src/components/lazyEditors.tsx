import { lazy, Suspense } from 'react';
import { Center, Loader } from '@mantine/core';
import type { CodeViewerProps } from './CodeViewer';
import type { MatchedRegionsProps } from './MatchedRegionsView';

// Monaco is large, so it is split into its own chunk and loaded on first use.
const CodeViewerImpl = lazy(() => import('./CodeViewer'));
const MatchedRegionsImpl = lazy(() => import('./MatchedRegionsView'));

function Fallback({ height }: { height?: number | string }) {
  return (
    <Center h={height ?? 200}>
      <Loader size="sm" />
    </Center>
  );
}

export function CodeViewer(props: CodeViewerProps) {
  return (
    <Suspense fallback={<Fallback height={props.height ?? 420} />}>
      <CodeViewerImpl {...props} />
    </Suspense>
  );
}

export function MatchedRegionsView(props: MatchedRegionsProps) {
  return (
    <Suspense fallback={<Fallback height={props.height ?? 520} />}>
      <MatchedRegionsImpl {...props} />
    </Suspense>
  );
}
