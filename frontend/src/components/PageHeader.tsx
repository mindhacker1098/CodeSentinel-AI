import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Anchor, Box, Breadcrumbs, Group, Text, Title } from '@mantine/core';
import { useBreadcrumbs, useDocumentTitle, type Crumb } from '../layout/pageMeta';

export interface PageHeaderProps {
  /** Rendered as the page's only h1. */
  title: ReactNode;
  /** One plain sentence saying what the page is for. */
  description?: ReactNode;
  /** Primary action (and at most one or two secondary ones), right-aligned. */
  actions?: ReactNode;
  /** Shown in the top bar on desktop and above the title on small screens. Last crumb = this page. */
  breadcrumbs?: Crumb[];
  /** Browser tab title; defaults to `title` when it is a string. */
  documentTitle?: string;
  /** Extra row under the description (status chips, meta). */
  children?: ReactNode;
}

export function CrumbTrail({ crumbs, size = 'sm' }: { crumbs: Crumb[]; size?: 'xs' | 'sm' }) {
  return (
    <Breadcrumbs separator="/" separatorMargin={6} aria-label="Breadcrumb" styles={{ separator: { color: 'var(--ag-line)' } }}>
      {crumbs.map((c, i) =>
        c.to && i < crumbs.length - 1 ? (
          <Anchor key={i} component={Link} to={c.to} size={size} c="dimmed" underline="hover">
            {c.label}
          </Anchor>
        ) : (
          <Text key={i} size={size} c={i === crumbs.length - 1 ? 'var(--ag-text)' : 'dimmed'} aria-current={i === crumbs.length - 1 ? 'page' : undefined}>
            {c.label}
          </Text>
        ),
      )}
    </Breadcrumbs>
  );
}

/** Title, one-line description, primary action. Every page starts with this. */
export function PageHeader({ title, description, actions, breadcrumbs, documentTitle, children }: PageHeaderProps) {
  useBreadcrumbs(breadcrumbs);
  useDocumentTitle(documentTitle ?? (typeof title === 'string' ? title : undefined));
  return (
    <Box component="header" mb="lg">
      {breadcrumbs && breadcrumbs.length > 1 && (
        <Box hiddenFrom="sm" mb={6}>
          <CrumbTrail crumbs={breadcrumbs} size="xs" />
        </Box>
      )}
      <Group justify="space-between" align="flex-start" wrap="wrap" gap="sm">
        <Box style={{ minWidth: 0, flex: '1 1 320px' }}>
          <Title order={1}>{title}</Title>
          {description && (
            <Text c="dimmed" size="md" mt={4} className="ag-prose">
              {description}
            </Text>
          )}
        </Box>
        {actions && (
          <Group gap="xs" wrap="wrap" style={{ flexShrink: 0, maxWidth: '100%' }}>
            {actions}
          </Group>
        )}
      </Group>
      {children && <Box mt="sm">{children}</Box>}
    </Box>
  );
}
