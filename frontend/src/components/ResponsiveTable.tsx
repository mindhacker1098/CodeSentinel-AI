import type { CSSProperties, ReactNode } from 'react';
import { Box, Group, Paper, Stack, Table, Text, UnstyledButton } from '@mantine/core';
import { useMediaQuery } from '@mantine/hooks';
import { IconArrowDown, IconArrowUp, IconArrowsSort } from '@tabler/icons-react';
import { TableSkeleton } from './states';

export interface Column<T> {
  key: string;
  header: ReactNode;
  cell: (row: T, index: number) => ReactNode;
  align?: 'left' | 'right' | 'center';
  width?: number | string;
  /** JetBrains Mono, for roll numbers, ids and code. */
  mono?: boolean;
  /** Hidden in the stacked card layout (e.g. the column used as the card title). */
  hideOnCard?: boolean;
  /** Label in the card layout when `header` is not plain text. */
  cardLabel?: string;
  sortable?: boolean;
  /** Keep the column visible while scrolling sideways (first column only). */
  sticky?: boolean;
}

export interface SortState {
  key: string;
  dir: 'asc' | 'desc';
}

export interface ResponsiveTableProps<T> {
  data: T[];
  columns: Column<T>[];
  rowKey: (row: T) => string | number;
  /** Width below which the table scrolls sideways instead of squeezing. */
  minWidth?: number;
  loading?: boolean;
  /** Rendered when data is empty and not loading (use <EmptyState compact/>). */
  empty?: ReactNode;
  /** Kebab menu etc. Rendered in a last, right-aligned column (and in the card header on phones). */
  rowActions?: (row: T) => ReactNode;
  /** Whole-row click (also Enter on the focused row). Prefer links in a cell for navigation. */
  onRowClick?: (row: T) => void;
  /** Card title on phones; defaults to the first column's cell. */
  cardTitle?: (row: T) => ReactNode;
  sort?: SortState | null;
  onSortChange?: (s: SortState) => void;
  /** Accessible table caption (visually hidden). */
  caption?: string;
  /** Force the card layout breakpoint, default 'sm' (48em). */
  stackBelow?: string;
  rowStyle?: (row: T) => CSSProperties | undefined;
  /** Max height for a sticky header inside the table box (px). */
  maxHeight?: number;
}

function SortHeader({ label, state, onClick }: { label: ReactNode; state: 'asc' | 'desc' | null; onClick: () => void }) {
  const I = state === 'asc' ? IconArrowUp : state === 'desc' ? IconArrowDown : IconArrowsSort;
  return (
    <UnstyledButton onClick={onClick} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, color: 'inherit', font: 'inherit' }}>
      {label}
      <I size={13} stroke={1.8} style={{ opacity: state ? 1 : 0.45 }} aria-hidden />
    </UnstyledButton>
  );
}

/** Dense table that scrolls sideways when narrow and becomes stacked cards on phones. */
export function ResponsiveTable<T>({
  data,
  columns,
  rowKey,
  minWidth = 640,
  loading,
  empty,
  rowActions,
  onRowClick,
  cardTitle,
  sort,
  onSortChange,
  caption,
  stackBelow = '48em',
  rowStyle,
  maxHeight,
}: ResponsiveTableProps<T>) {
  const stacked = useMediaQuery(`(max-width: ${stackBelow})`);

  if (loading) return <TableSkeleton cols={Math.min(columns.length, 6)} />;
  if (!data.length && empty) return <Paper p={0}>{empty}</Paper>;

  const toggle = (key: string) => {
    if (!onSortChange) return;
    const dir = sort?.key === key && sort.dir === 'desc' ? 'asc' : 'desc';
    onSortChange({ key, dir });
  };

  if (stacked) {
    const titleCol = columns[0];
    return (
      <Stack gap="xs" role="list" aria-label={caption}>
        {data.map((row, i) => (
          <Paper
            key={rowKey(row)}
            p="sm"
            role="listitem"
            onClick={onRowClick ? () => onRowClick(row) : undefined}
            style={{ cursor: onRowClick ? 'pointer' : undefined, ...rowStyle?.(row) }}
          >
            <Group justify="space-between" align="flex-start" wrap="nowrap" mb={6}>
              <Box style={{ minWidth: 0, fontWeight: 600 }}>{cardTitle ? cardTitle(row) : titleCol.cell(row, i)}</Box>
              {rowActions && <Box onClick={(e) => e.stopPropagation()}>{rowActions(row)}</Box>}
            </Group>
            <Stack gap={4}>
              {columns
                .filter((c, ci) => !c.hideOnCard && (cardTitle ? true : ci !== 0))
                .map((c) => (
                  <Group key={c.key} justify="space-between" wrap="nowrap" gap="sm" align="flex-start">
                    <Text size="sm" c="dimmed" style={{ flexShrink: 0 }}>
                      {c.cardLabel ?? c.header}
                    </Text>
                    <Box className={c.mono ? 'ag-mono' : undefined} style={{ textAlign: 'right', minWidth: 0, fontSize: 14 }}>
                      {c.cell(row, i)}
                    </Box>
                  </Group>
                ))}
            </Stack>
          </Paper>
        ))}
      </Stack>
    );
  }

  const table = (
    <Table stickyHeader={!!maxHeight}>
      {caption && <caption className="ag-sr-only">{caption}</caption>}
      <Table.Thead>
        <Table.Tr>
          {columns.map((c) => (
            <Table.Th
              key={c.key}
              style={{
                textAlign: c.align,
                width: c.width,
                ...(c.sticky ? { position: 'sticky', left: 0, zIndex: 2, background: 'var(--ag-surface)' } : null),
              }}
              aria-sort={sort?.key === c.key ? (sort.dir === 'asc' ? 'ascending' : 'descending') : undefined}
            >
              {c.sortable && onSortChange ? (
                <SortHeader label={c.header} state={sort?.key === c.key ? sort.dir : null} onClick={() => toggle(c.key)} />
              ) : (
                c.header
              )}
            </Table.Th>
          ))}
          {rowActions && (
            <Table.Th style={{ width: 48 }}>
              <span className="ag-sr-only">Actions</span>
            </Table.Th>
          )}
        </Table.Tr>
      </Table.Thead>
      <Table.Tbody>
        {data.map((row, i) => (
          <Table.Tr
            key={rowKey(row)}
            onClick={onRowClick ? () => onRowClick(row) : undefined}
            onKeyDown={onRowClick ? (e) => e.key === 'Enter' && e.currentTarget === e.target && onRowClick(row) : undefined}
            tabIndex={onRowClick ? 0 : undefined}
            style={{ cursor: onRowClick ? 'pointer' : undefined, ...rowStyle?.(row) }}
          >
            {columns.map((c) => (
              <Table.Td
                key={c.key}
                className={c.mono ? 'ag-mono' : undefined}
                style={{
                  textAlign: c.align,
                  fontSize: c.mono ? 13 : undefined,
                  ...(c.sticky ? { position: 'sticky', left: 0, zIndex: 1, background: 'var(--ag-surface)' } : null),
                }}
              >
                {c.cell(row, i)}
              </Table.Td>
            ))}
            {rowActions && (
              <Table.Td style={{ textAlign: 'right' }} onClick={(e) => e.stopPropagation()}>
                {rowActions(row)}
              </Table.Td>
            )}
          </Table.Tr>
        ))}
      </Table.Tbody>
    </Table>
  );

  return (
    <Paper p={0} style={{ overflow: 'hidden' }}>
      {maxHeight ? (
        <Box style={{ maxHeight, overflow: 'auto' }}>
          <Box miw={minWidth}>{table}</Box>
        </Box>
      ) : (
        <Table.ScrollContainer minWidth={minWidth} type="native">
          {table}
        </Table.ScrollContainer>
      )}
    </Paper>
  );
}
