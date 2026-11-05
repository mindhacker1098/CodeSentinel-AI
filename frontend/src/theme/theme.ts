import {
  Badge,
  Button,
  createTheme,
  Modal,
  Notification,
  Paper,
  Table,
  Tooltip,
  ActionIcon,
  Card,
  Menu,
  Tabs,
  type CSSVariablesResolver,
  type VariantColorsResolver,
  defaultVariantColorsResolver,
  parseThemeColor,
  rgba,
  type MantineColorsTuple,
} from '@mantine/core';
import { fonts, tokens } from './tokens';

// Index 5 is the token itself; primaryShade points there so filled variants use the exact hex.
const iris: MantineColorsTuple = ['#EEF0FF', '#DCE1FF', '#C3CBFF', '#AEB9FF', '#9DAAFF', '#8B9CFF', '#7385F2', '#5D6FE0', '#4A5AC4', '#3A479E'];
const pass: MantineColorsTuple = ['#E6F8F0', '#C5EEDD', '#9FE2C6', '#78D5AE', '#58C99B', '#3DBE8B', '#31A578', '#268A63', '#1C6E4F', '#13533B'];
const fail: MantineColorsTuple = ['#FEECEB', '#FBD3D1', '#F8B6B3', '#F59A95', '#F3837E', '#F2706B', '#DB5853', '#BD4440', '#9C3330', '#7A2421'];
const warn: MantineColorsTuple = ['#FCF4E3', '#F7E5BD', '#F1D394', '#EBC26C', '#E7B656', '#E3AE45', '#CB9530', '#AA7B22', '#886118', '#66480F'];
const info: MantineColorsTuple = ['#E8F5FC', '#C9E7F7', '#A6D7F2', '#84C8ED', '#6DBEEA', '#5BB8E8', '#3FA0D3', '#2E86B5', '#216B91', '#16516E'];
// Mantine's dark scheme reads text, borders and surfaces from the "dark" tuple.
const dark: MantineColorsTuple = [
  tokens.text, // 0 body text
  '#B8C2D3', // 1
  tokens.muted, // 2 dimmed text
  '#6B7891', // 3 placeholders
  tokens.line, // 4 borders
  '#2A3447', // 5 hover
  tokens.raised, // 6 inputs, popovers
  tokens.surface, // 7 panels
  tokens.bg, // 8
  '#0F131A', // 9
];
const gray: MantineColorsTuple = ['#EEF1F6', '#D7DEEA', '#B8C2D3', '#8A97AD', '#6B7891', '#56627A', '#434E63', '#343E52', '#2E3A50', '#232C3D'];

// Light and outline variants: Mantine's default picks a near-white shade in dark mode, which drops the status hue.
// Use the token itself for text/borders and a translucent token for backgrounds.
const TONED = new Set(['iris', 'pass', 'fail', 'warn', 'info']);
const variantColorResolver: VariantColorsResolver = (input) => {
  const base = defaultVariantColorsResolver(input);
  const parsed = parseThemeColor({ color: input.color || input.theme.primaryColor, theme: input.theme });
  if (!parsed.isThemeColor || !TONED.has(parsed.color)) return base;
  const hex = input.theme.colors[parsed.color][5];
  const text = input.theme.colors[parsed.color][3];
  if (input.variant === 'light') {
    return { ...base, background: rgba(hex, 0.14), hover: rgba(hex, 0.22), color: text, border: `1px solid ${rgba(hex, 0.0)}` };
  }
  if (input.variant === 'outline') {
    return { ...base, color: text, border: `1px solid ${rgba(hex, 0.7)}`, hover: rgba(hex, 0.1) };
  }
  if (input.variant === 'subtle') {
    return { ...base, color: text, hover: rgba(hex, 0.12) };
  }
  return base;
};

export const theme = createTheme({
  variantColorResolver,
  primaryColor: 'iris',
  primaryShade: 5,
  autoContrast: true,
  luminanceThreshold: 0.35,
  colors: { iris, pass, fail, warn, info, dark, gray },
  white: '#FFFFFF',
  black: tokens.bg,
  fontFamily: fonts.sans,
  fontFamilyMonospace: fonts.mono,
  fontSizes: { xs: '12px', sm: '13px', md: '14px', lg: '16px', xl: '20px' },
  lineHeights: { xs: '1.4', sm: '1.45', md: '1.55', lg: '1.55', xl: '1.4' },
  headings: {
    fontFamily: fonts.sans,
    fontWeight: '600',
    sizes: {
      h1: { fontSize: '26px', lineHeight: '1.25' },
      h2: { fontSize: '20px', lineHeight: '1.3' },
      h3: { fontSize: '16px', lineHeight: '1.4' },
      h4: { fontSize: '14px', lineHeight: '1.4' },
    },
  },
  defaultRadius: 'sm',
  radius: { xs: '2px', sm: '4px', md: '6px', lg: '8px', xl: '12px' },
  spacing: { xs: '6px', sm: '10px', md: '16px', lg: '24px', xl: '32px' },
  focusRing: 'auto',
  cursorType: 'pointer',
  shadows: {
    xs: '0 1px 2px rgba(5, 8, 14, 0.4)',
    sm: '0 2px 6px rgba(5, 8, 14, 0.45)',
    md: '0 8px 24px rgba(5, 8, 14, 0.5)',
    lg: '0 16px 40px rgba(5, 8, 14, 0.55)',
    xl: '0 24px 60px rgba(5, 8, 14, 0.6)',
  },
  components: {
    Table: Table.extend({
      defaultProps: { verticalSpacing: 7, horizontalSpacing: 'sm', highlightOnHover: true, stickyHeader: true, fz: 'md' },
    }),
    Badge: Badge.extend({
      defaultProps: { radius: 'sm', variant: 'light' },
      styles: { root: { textTransform: 'none', fontWeight: 500, letterSpacing: 0 } },
    }),
    Button: Button.extend({ defaultProps: { radius: 'sm' }, styles: { root: { fontWeight: 500 } } }),
    ActionIcon: ActionIcon.extend({ defaultProps: { variant: 'subtle', color: 'gray' } }),
    Paper: Paper.extend({ defaultProps: { radius: 'md', withBorder: true, p: 'md' } }),
    Card: Card.extend({ defaultProps: { radius: 'md', withBorder: true } }),
    Modal: Modal.extend({
      defaultProps: { radius: 'md', centered: true, overlayProps: { backgroundOpacity: 0.6 } },
      styles: { title: { fontWeight: 600, fontSize: '16px' } },
    }),
    Notification: Notification.extend({ defaultProps: { radius: 'md', withBorder: true } }),
    Tooltip: Tooltip.extend({ defaultProps: { withArrow: true, openDelay: 150, multiline: true, maw: 320 } }),
    Menu: Menu.extend({ defaultProps: { radius: 'md', shadow: 'md' } }),
    Tabs: Tabs.extend({ defaultProps: { keepMounted: false } }),
  },
});

/** Extra CSS variables: the raw tokens, plus the body colour (Mantine uses dark[7] by default). */
export const cssVariablesResolver: CSSVariablesResolver = () => ({
  variables: {
    '--ag-bg': tokens.bg,
    '--ag-surface': tokens.surface,
    '--ag-raised': tokens.raised,
    '--ag-line': tokens.line,
    '--ag-text': tokens.text,
    '--ag-muted': tokens.muted,
    '--ag-iris': tokens.iris,
    '--ag-pass': tokens.pass,
    '--ag-fail': tokens.fail,
    '--ag-warn': tokens.warn,
    '--ag-info': tokens.info,
    '--ag-content-max': '1200px',
    '--ag-prose-max': '72ch',
  },
  light: {},
  dark: {
    '--mantine-color-body': tokens.bg,
    '--mantine-color-text': tokens.text,
    '--mantine-color-dimmed': tokens.muted,
    '--mantine-color-default': tokens.raised,
    '--mantine-color-default-hover': '#2A3447',
    '--mantine-color-default-border': tokens.line,
    '--mantine-color-placeholder': '#6B7891',
    '--mantine-color-anchor': tokens.iris,
  },
});
