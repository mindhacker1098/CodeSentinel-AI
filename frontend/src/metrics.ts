import type { MetricEntry } from './api/types';

export function isInformational(m: MetricEntry): boolean {
  // only results marked informational are review-only; older reports counted every metric in the grade
  return !!m.informational;
}

export function reviewStatus(m: MetricEntry): string {
  if (m.status === 'error') return 'Unavailable';
  if (m.status === 'skipped') return 'Not checked';
  const evidence = m.evidence ?? {};
  if (m.analyzer === 'ai_detector') {
    return evidence.band === 'insufficient_evidence' ? 'Insufficient evidence' : 'Heuristic only';
  }
  if (m.analyzer === 'similarity_flag') {
    const assessment = evidence.assessment;
    if (assessment === 'not_assessed' || evidence.comparison_count === 0 ||
      (evidence.comparison_count === undefined && (!Array.isArray(evidence.top_matches) || !evidence.top_matches.length))) {
      return 'Not assessed';
    }
    if (assessment === 'review_required' || evidence.confidence === 'high') return 'Review required';
    if (evidence.confidence === 'low') return 'Limited evidence';
    return 'Compared';
  }
  return 'Review only';
}
