import { useParams } from 'react-router-dom';
import { isValidSlug } from '../../api/client';
import NotFoundPage from '../system/NotFoundPage';
import CreateWizard from './problems/CreateWizard';
import EditProblem from './problems/EditProblem';

/** /staff/problems/new is the create wizard; /staff/problems/:slug is the tabbed editor. */
export default function ProblemEditor() {
  const { slug } = useParams();
  if (!slug) return <CreateWizard />;
  if (!isValidSlug(slug)) return <NotFoundPage what={`The problem "${slug}"`} backTo="/staff/problems" backLabel="Back to problems" />;
  return <EditProblem key={slug} slug={slug} />;
}
