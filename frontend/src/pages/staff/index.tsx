import type { ReactNode } from 'react';
import type { Icon } from '@tabler/icons-react';
import {
  IconChartBar,
  IconCopy,
  IconFileCode,
  IconFlag,
  IconHome,
  IconListCheck,
  IconStack2,
  IconTable,
  IconUsers,
} from '@tabler/icons-react';
import Flags from './Flags';
import Gradebook from './Gradebook';
import Leaderboard from './Leaderboard';
import Overview from './Overview';
import PairView from './PairView';
import Plagiarism from './Plagiarism';
import ProblemEditor from './ProblemEditor';
import Problems from './Problems';
import Queue from './Queue';
import SubmissionView from './SubmissionView';
import Submissions from './Submissions';
import Users from './Users';

export interface StaffRoute {
  /** Relative to /staff ("" is the index route). */
  path: string;
  element: ReactNode;
}

export interface NavItem {
  to: string;
  label: string;
  icon: Icon;
}

export const staffRoutes: StaffRoute[] = [
  { path: '', element: <Overview /> },
  { path: 'problems', element: <Problems /> },
  { path: 'problems/new', element: <ProblemEditor /> },
  { path: 'problems/:slug', element: <ProblemEditor /> },
  { path: 'submissions', element: <Submissions /> },
  { path: 'submissions/:id', element: <SubmissionView /> },
  { path: 'flags', element: <Flags /> },
  { path: 'gradebook', element: <Gradebook /> },
  { path: 'plagiarism', element: <Plagiarism /> },
  { path: 'plagiarism/pair', element: <PairView /> },
  { path: 'leaderboard', element: <Leaderboard /> },
  { path: 'queue', element: <Queue /> },
  { path: 'users', element: <Users /> },
];

export const staffNav: NavItem[] = [
  { to: '/staff', label: 'Overview', icon: IconHome },
  { to: '/staff/problems', label: 'Problems', icon: IconFileCode },
  { to: '/staff/submissions', label: 'Submissions', icon: IconListCheck },
  { to: '/staff/flags', label: 'Flag review', icon: IconFlag },
  { to: '/staff/gradebook', label: 'Gradebook', icon: IconTable },
  { to: '/staff/plagiarism', label: 'Plagiarism', icon: IconCopy },
  { to: '/staff/leaderboard', label: 'Leaderboard', icon: IconChartBar },
  { to: '/staff/queue', label: 'Queue', icon: IconStack2 },
  { to: '/staff/users', label: 'Users', icon: IconUsers },
];
