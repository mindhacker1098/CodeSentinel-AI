import { useLayoutEffect, useState } from 'react';
import { Link, NavLink as RouterLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  ActionIcon,
  AppShell,
  Avatar,
  Badge,
  Box,
  Burger,
  Group,
  Menu,
  Modal,
  NavLink,
  ScrollArea,
  Stack,
  Table,
  Text,
  Tooltip,
  UnstyledButton,
} from '@mantine/core';
import { useDisclosure, useLocalStorage, useMediaQuery } from '@mantine/hooks';
import {
  IconChevronDown,
  IconKey,
  IconLayoutSidebarLeftCollapse,
  IconLayoutSidebarLeftExpand,
  IconLogout,
  IconUser,
} from '@tabler/icons-react';
import { api, type Overview, type User } from '../api/client';
import { isStaff, useAuth } from '../auth';
import { changePasswordPath } from '../auth/session';
import { CrumbTrail } from '../components/PageHeader';
import { ErrorBoundary } from '../components/ErrorBoundary';
import { Logo } from '../components/LogoMark';
import { fmtDate } from '../format';
import { notify } from '../notify';
import { STAFF_NAV, STUDENT_NAV, routeMeta, type NavGroup, type NavItem } from './nav';
import { APP_NAME, PageMetaProvider, usePageMeta } from './pageMeta';
import classes from './Layout.module.css';

const ROLE_LABEL: Record<User['role'], string> = { student: 'Student', ta: 'Teaching assistant', admin: 'Admin' };

export function useStaffOverview(enabled: boolean) {
  return useQuery({
    queryKey: ['staff', 'overview'],
    queryFn: api.staff.overview,
    enabled,
    refetchInterval: 15_000,
    retry: false,
    staleTime: 10_000,
  });
}

function isActive(pathname: string, it: NavItem) {
  return it.end ? pathname === it.to : pathname === it.to || pathname.startsWith(it.to + '/');
}

function NavGroups({ groups, compact, overview, onNavigate }: { groups: NavGroup[]; compact: boolean; overview?: Overview; onNavigate: () => void }) {
  const loc = useLocation();
  return (
    <Stack gap={compact ? 4 : 'md'}>
      {groups.map((g, gi) => (
        <Box key={g.label} component="nav" aria-label={g.label}>
          {compact ? (
            gi > 0 && <Box className={classes.groupRule} />
          ) : (
            <Text size="xs" c="dimmed" fw={500} px={10} mb={4} className={classes.groupLabel}>
              {g.label}
            </Text>
          )}
          <Stack gap={2}>
            {g.items.map((it) => {
              const count = overview && it.badge ? it.badge(overview) : 0;
              const active = isActive(loc.pathname, it);
              const countLabel = count ? `${count} ${it.badgeTone === 'warn' ? 'open' : 'in queue'}` : '';
              const link = (
                <NavLink
                  key={it.to}
                  component={RouterLink}
                  to={it.to}
                  end={it.end}
                  label={compact ? undefined : it.label}
                  aria-label={compact ? `${it.label}${countLabel ? `, ${countLabel}` : ''}` : undefined}
                  leftSection={
                    <Box pos="relative" style={{ display: 'flex' }}>
                      <it.icon size={18} stroke={1.6} aria-hidden />
                      {compact && count > 0 && <span className={classes.dot} data-tone={it.badgeTone} aria-hidden />}
                    </Box>
                  }
                  rightSection={
                    !compact && count > 0 ? (
                      <Badge size="sm" color={it.badgeTone ?? 'gray'} variant="light" aria-label={countLabel} className="ag-num">
                        {count}
                      </Badge>
                    ) : undefined
                  }
                  active={active}
                  aria-current={active ? 'page' : undefined}
                  onClick={onNavigate}
                  className={classes.navLink}
                  data-compact={compact || undefined}
                />
              );
              return compact ? (
                <Tooltip key={it.to} label={`${it.label}${count ? ` (${count})` : ''}`} position="right" withArrow>
                  {link}
                </Tooltip>
              ) : (
                link
              );
            })}
          </Stack>
        </Box>
      ))}
    </Stack>
  );
}

function QueueDot({ overview, failed }: { overview?: Overview; failed: boolean }) {
  if (failed || !overview) return null;
  const { queued, running, workers_online, failed_jobs } = overview;
  let tone: 'pass' | 'info' | 'warn' | 'fail' = 'pass';
  let short = 'Idle';
  if (workers_online === 0) {
    tone = 'fail';
    short = 'No worker';
  } else if (running > 0) {
    tone = 'info';
    short = `${running} grading`;
  } else if (queued > 0) {
    tone = 'warn';
    short = `${queued} waiting`;
  }
  const parts = [
    `${running} running`,
    `${queued} waiting`,
    `${workers_online} worker${workers_online === 1 ? '' : 's'} online`,
    failed_jobs ? `${failed_jobs} failed today` : null,
  ].filter(Boolean);
  const label = `Queue: ${parts.join(', ')}`;
  return (
    <Tooltip label={label}>
      <UnstyledButton component={Link} to="/staff/queue" className={classes.queueBtn} aria-label={label}>
        <span className={classes.queueDot} data-tone={tone} data-live={running > 0 || undefined} aria-hidden />
        <Text size="sm" c="dimmed" visibleFrom="md" className="ag-num">
          {short}
        </Text>
      </UnstyledButton>
    </Tooltip>
  );
}

function initials(u: User) {
  const src = u.name?.trim() || u.roll_no;
  const p = src.replace(/^(dr|prof|mr|ms|mrs)\.?\s+/i, '').split(/\s+/);
  return ((p[0]?.[0] ?? '') + (p.length > 1 ? p[p.length - 1][0] : '')).toUpperCase();
}

function ProfileModal({ user, opened, onClose }: { user: User; opened: boolean; onClose: () => void }) {
  const rows: [string, React.ReactNode][] = [
    ['Name', user.name || '-'],
    ['Roll number', <span className="ag-mono">{user.roll_no}</span>],
    ['Role', ROLE_LABEL[user.role]],
    ['Last sign-in', user.last_login_at ? fmtDate(user.last_login_at) : '-'],
    ['Account created', user.created_at ? fmtDate(user.created_at) : '-'],
  ];
  return (
    <Modal opened={opened} onClose={onClose} title="Your profile" size="sm">
      <Table withRowBorders={false} verticalSpacing={6} highlightOnHover={false}>
        <Table.Tbody>
          {rows.map(([k, v]) => (
            <Table.Tr key={k}>
              <Table.Td c="dimmed" w={140}>
                {k}
              </Table.Td>
              <Table.Td>{v}</Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>
      <Text size="sm" c="dimmed" mt="sm">
        Ask your admin to change these.
      </Text>
    </Modal>
  );
}

function UserMenu({ user }: { user: User }) {
  const { logout } = useAuth();
  const nav = useNavigate();
  const loc = useLocation();
  const [profile, { open, close }] = useDisclosure(false);
  return (
    <>
      <Menu position="bottom-end" width={240} withinPortal>
        <Menu.Target>
          <UnstyledButton className={classes.userBtn} aria-label={`Account menu for ${user.name || user.roll_no}`}>
            <Group gap={8} wrap="nowrap">
              <Avatar size={28} radius="xl" color="iris" variant="light">
                {initials(user)}
              </Avatar>
              <Text size="sm" className="ag-mono" visibleFrom="xs">
                {user.roll_no}
              </Text>
              <IconChevronDown size={14} stroke={1.8} color="var(--ag-muted)" aria-hidden />
            </Group>
          </UnstyledButton>
        </Menu.Target>
        <Menu.Dropdown>
          <Box px="sm" py={8}>
            <Text size="md" fw={600} truncate>
              {user.name || user.roll_no}
            </Text>
            <Text size="sm" c="dimmed">
              {ROLE_LABEL[user.role]}
            </Text>
          </Box>
          <Menu.Divider />
          <Menu.Item leftSection={<IconUser size={16} />} onClick={open}>
            Profile
          </Menu.Item>
          <Menu.Item leftSection={<IconKey size={16} />} onClick={() => nav(changePasswordPath(loc.pathname + loc.search))}>
            Change password
          </Menu.Item>
          <Menu.Divider />
          <Menu.Item
            leftSection={<IconLogout size={16} />}
            onClick={async () => {
              await logout();
              notify.info('You are signed out.');
            }}
          >
            Sign out
          </Menu.Item>
        </Menu.Dropdown>
      </Menu>
      <ProfileModal user={user} opened={profile} onClose={close} />
    </>
  );
}

function TopCrumbs() {
  const { crumbs } = usePageMeta();
  const loc = useLocation();
  const list = crumbs ?? routeMeta(loc.pathname).crumbs;
  if (list.length < 2) return null;
  return (
    <Box visibleFrom="sm" style={{ minWidth: 0 }}>
      <CrumbTrail crumbs={list} />
    </Box>
  );
}

function Shell() {
  const { user } = useAuth();
  const staff = isStaff(user);
  const [mobileOpen, { toggle, close }] = useDisclosure(false);
  const loc = useLocation();
  const narrow = useMediaQuery('(max-width: 1100px)');
  const mobile = useMediaQuery('(max-width: 48em)');
  const [userCollapsed, setUserCollapsed] = useLocalStorage<boolean>({ key: 'ag-nav-collapsed', defaultValue: false });
  const [manualWide, setManualWide] = useState(false);
  const compact = !mobile && ((narrow && !manualWide) || (!narrow && userCollapsed));
  const overview = useStaffOverview(staff);
  const groups = staff ? STAFF_NAV : STUDENT_NAV;

  // Default tab title per route; PageHeader overrides it (its passive effect runs after this layout effect).
  useLayoutEffect(() => {
    const t = routeMeta(loc.pathname).title;
    document.title = t && t !== APP_NAME ? `${t} - ${APP_NAME}` : APP_NAME;
  }, [loc.pathname]);

  const toggleCompact = () => {
    if (narrow) setManualWide((v) => !v);
    else setUserCollapsed((v) => !v);
  };

  return (
    <AppShell
      header={{ height: 52 }}
      navbar={{ width: { base: 260, sm: compact ? 64 : 220 }, breakpoint: 'sm', collapsed: { mobile: !mobileOpen } }}
      padding={0}
      className={classes.shell}
    >
      <a href="#main" className="ag-skip">
        Skip to content
      </a>
      <AppShell.Header className={classes.header}>
        <Group h="100%" px="md" justify="space-between" wrap="nowrap" gap="md">
          <Group gap="md" wrap="nowrap" style={{ minWidth: 0 }}>
            <Burger opened={mobileOpen} onClick={toggle} hiddenFrom="sm" size="sm" aria-label={mobileOpen ? 'Close navigation' : 'Open navigation'} />
            <UnstyledButton component={Link} to="/" aria-label="AutoGrader home" style={{ borderRadius: 4 }}>
              <Logo />
            </UnstyledButton>
            <TopCrumbs />
          </Group>
          <Group gap="sm" wrap="nowrap">
            {staff && <QueueDot overview={overview.data} failed={overview.isError} />}
            {user && <UserMenu user={user} />}
          </Group>
        </Group>
      </AppShell.Header>

      <AppShell.Navbar className={classes.navbar} aria-label="Main">
        <AppShell.Section grow component={ScrollArea} px={compact ? 8 : 'xs'} py="md" type="never">
          <NavGroups groups={groups} compact={compact} overview={overview.data} onNavigate={close} />
        </AppShell.Section>
        <AppShell.Section px={compact ? 8 : 'xs'} py="sm" className={classes.navFooter}>
          {compact ? (
            <Tooltip label="Expand sidebar" position="right">
              <ActionIcon onClick={toggleCompact} aria-label="Expand sidebar" size="lg" mx="auto" display="flex">
                <IconLayoutSidebarLeftExpand size={18} stroke={1.6} />
              </ActionIcon>
            </Tooltip>
          ) : (
            <Group justify="space-between" wrap="nowrap" px={6}>
              <Text size="xs" c="dimmed">
                CS5103 lab
              </Text>
              <Tooltip label="Collapse sidebar">
                <ActionIcon onClick={toggleCompact} aria-label="Collapse sidebar" visibleFrom="sm">
                  <IconLayoutSidebarLeftCollapse size={18} stroke={1.6} />
                </ActionIcon>
              </Tooltip>
            </Group>
          )}
        </AppShell.Section>
      </AppShell.Navbar>

      <AppShell.Main id="main" tabIndex={-1} className={classes.main}>
        <Box className={classes.content}>
          <ErrorBoundary resetKey={loc.pathname}>
            <Outlet />
          </ErrorBoundary>
        </Box>
      </AppShell.Main>
    </AppShell>
  );
}

export default function Layout() {
  return (
    <PageMetaProvider>
      <Shell />
    </PageMetaProvider>
  );
}
