import { rgb, type RGB } from 'pdf-lib';

/**
 * Light print/email theme. Hex must match
 * crm_frontend/src/theme/themes/rooftop.js `print`.
 * Stay light — no dark mode.
 */
export const PRINT_THEME = {
  accent: '#f97316',
  accentSoft: '#feeee3',
  ink: '#111318',
  muted: '#5c6370',
  rule: '#e2e4ea',
  onAccent: '#111318',
  paper: '#f4f5f7',
  surface: '#ffffff',
} as const;

export type PrintTheme = typeof PRINT_THEME;

export function hexToPdfRgb(hex: string): RGB {
  const n = hex.replace('#', '');
  return rgb(
    parseInt(n.slice(0, 2), 16) / 255,
    parseInt(n.slice(2, 4), 16) / 255,
    parseInt(n.slice(4, 6), 16) / 255
  );
}

export const PRINT_PDF = {
  accent: hexToPdfRgb(PRINT_THEME.accent),
  accentSoft: hexToPdfRgb(PRINT_THEME.accentSoft),
  ink: hexToPdfRgb(PRINT_THEME.ink),
  muted: hexToPdfRgb(PRINT_THEME.muted),
  rule: hexToPdfRgb(PRINT_THEME.rule),
  onAccent: hexToPdfRgb(PRINT_THEME.onAccent),
};
