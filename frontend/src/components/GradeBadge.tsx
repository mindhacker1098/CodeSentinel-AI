import { GradeDisplay } from './GradeDisplay';

interface Props {
  grade: number | null | undefined;
  provisional?: boolean;
  partial?: boolean;
  size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl';
}

/** @deprecated Use <GradeDisplay/>. Kept so older pages compile; it renders a GradeDisplay chip. */
export default function GradeBadge({ grade, provisional, partial, size = 'md' }: Props) {
  return (
    <GradeDisplay grade={grade} provisional={provisional} incomplete={partial} size={size === 'xl' || size === 'lg' ? 'md' : 'sm'} emptyLabel="Not graded" />
  );
}
