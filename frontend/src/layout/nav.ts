import type { Icon } from '@tabler/icons-react';
import {
  IconChartBar,
  IconCopy,
  IconFileCode,
  IconFlag,
  IconHistory,
  IconHome,
  IconListCheck,
  IconListDetails,
  IconStack2,
  IconTable,
  IconUsers,
} from '@tabler/icons-react';
import type { Overview } from '../api/types';
import type { Crumb } from './pageMeta';

export interface NavItem {
  to: string;
  label: string;
  icon: Icon;
  /** Count badge from /staff/overview. */
  badge?: (o: Overview) => number;
  badgeTone?: 'warn' | 'info' | 'fail';
  /** Match only this exact path. */
  end?: boolean;
}

export interface NavGroup {
  label: string;
  items: NavItem[];
}

export const STUDENT_NAV: NavGroup[] = [
  {
    label: 'Student',
    items: [
      { to: '/dashboard', label: 'Problems', icon: IconListDetails },
      { to: '/history', label: 'My submissions', icon: IconHistory },
    ],
  },
];

export const STAFF_NAV: NavGroup[] = [
  {
    label: 'Course',
    items: [
      { to: '/staff', label: 'Overview', icon: IconHome, end: true },
      { to: '/staff/problems', label: 'Problems', icon: IconFileCode },
      { to: '/staff/users', label: 'Roster', icon: IconUsers },
    ],
  },
  {
    label: 'Grading',
    items: [
      { to: '/staff/submissions', label: 'Submissions', icon: IconListCheck },
      { to: '/staff/gradebook', label: 'Gradebook', icon: IconTable },
      { to: '/staff/leaderboard', label: 'Ranking', icon: IconChartBar },
    ],
  },
  {
    label: 'Integrity',
    items: [
      { to: '/staff/flags', label: 'Flag review', icon: IconFlag, badge: (o) => o.open_flags, badgeTone: 'warn' },
      { to: '/staff/plagiarism', label: 'Plagiarism', icon: IconCopy },
    ],
  },
  {
    label: 'System',
    items: [{ to: '/staff/queue', label: 'Queue', icon: IconStack2, badge: (o) => o.queued + o.running, badgeTone: 'info' }],
  },
];

/** Default title and breadcrumbs per route, used until a page's PageHeader sets its own. */
export function routeMeta(pathname: string): { title: string; crumbs: Crumb[] } {
  const p = pathname.replace(/\/+$/, '') || '/';
  for (const g of [...STAFF_NAV, ...STUDENT_NAV]) {
    for (const it of g.items) {
      const hit = it.end ? p === it.to : p === it.to || p.startsWith(it.to + '/');
      if (!hit) continue;
      const crumbs: Crumb[] = g.label === 'Student' ? [] : [{ label: g.label }];
      crumbs.push({ label: it.label, to: it.to });
      if (p !== it.to) {
        const rest = decodeURIComponent(p.slice(it.to.length + 1));
        crumbs.push({ label: rest === 'new' ? 'New' : rest });
      }
      return { title: crumbs[crumbs.length - 1].label, crumbs };
    }
  }
  if (p.startsWith('/problems/')) {
    const slug = decodeURIComponent(p.slice('/problems/'.length));
    return { title: slug, crumbs: [{ label: 'Problems', to: '/dashboard' }, { label: slug }] };
  }
  if (p.startsWith('/submissions/')) {
    const id = p.slice('/submissions/'.length);
    return { title: `Submission ${id}`, crumbs: [{ label: 'My submissions', to: '/history' }, { label: `Submission ${id}` }] };
  }
  return { title: 'AutoGrader', crumbs: [] };
}
