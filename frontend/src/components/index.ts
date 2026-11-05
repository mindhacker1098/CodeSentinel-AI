// ---- foundation (v2 design system); see docs/UI_DESIGN.md
export { PageHeader, CrumbTrail, type PageHeaderProps } from './PageHeader';
export {
  EmptyState,
  ErrorState,
  TableSkeleton,
  CardSkeleton,
  ReportSkeleton,
  PageSkeleton,
  type EmptyStateProps,
  type ErrorStateProps,
} from './states';
export { StatCard, type StatCardProps } from './StatCard';
export {
  VerdictBar,
  metricsToSegments,
  metricLabel,
  segmentStatus,
  type VerdictBarProps,
  type VerdictSegment,
  type SegmentStatus,
} from './VerdictBar';
export { GradeDisplay, gradeTone, type GradeDisplayProps } from './GradeDisplay';
export { StatusChip, type StatusChipProps } from './StatusChip';
export { CodeBlock, type CodeBlockProps } from './CodeBlock';
export { DiffView, diffLines, type DiffViewProps } from './DiffView';
export { ResponsiveTable, type Column, type SortState, type ResponsiveTableProps } from './ResponsiveTable';
export { confirm, type ConfirmOptions } from './confirm';
export { OneTimeSecretModal, secretsCsv, type Secret, type OneTimeSecretModalProps } from './OneTimeSecretModal';
export { Countdown, type CountdownProps } from './Countdown';
export { FileDrop, validateCFile, fmtBytes, MAX_SOURCE_BYTES, C_FILENAME, type FileDropProps } from './FileDrop';
export { Histogram, Sparkline, type HistogramProps, type SparklineProps } from './MiniCharts';
export { Logo, LogoMark } from './LogoMark';
export { default as QueryState } from './QueryState';
export { ErrorBoundary } from './ErrorBoundary';
export { useDocumentTitle, useBreadcrumbs, type Crumb } from '../layout/pageMeta';

// ---- report and editor pieces (pre-v2, restyled by the theme)
export { default as LogStream } from './LogStream';
export { default as MetricTable } from './MetricTable';
export { default as CounterexampleCard } from './CounterexampleCard';
export { default as FlagBadge, FlagList } from './FlagBadge';
/** @deprecated use GradeDisplay */
export { default as GradeBadge } from './GradeBadge';
export { default as AiBand, type Band } from './AiBand';
export { CodeViewer, MatchedRegionsView } from './lazyEditors';
export type { CodeViewerProps } from './CodeViewer';
export type { MatchedRegionsProps } from './MatchedRegionsView';
export { EDITOR_OPTIONS } from './editorOptions';
export { normalizeRegion, REGION_COLORS } from './regions';
export { default as Markdown, renderMarkdown } from './Markdown';
export { default as CodacyFindings } from './CodacyFindings';
