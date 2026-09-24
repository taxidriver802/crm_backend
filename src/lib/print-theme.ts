import { rgb, type RGB } from 'pdf-lib';

/**
 * Default light print theme (Rooftop). Hex must match
 * crm_frontend/src/theme/themes/rooftop.js `print`.
 * PDFs stay on this map. Invite email uses resolveEmailTheme.
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

export type PrintTheme = {
  accent: string;
  accentSoft: string;
  ink: string;
  muted: string;
  rule: string;
  onAccent: string;
  paper: string;
  surface: string;
};

/**
 * Light print hex per company palette. Must match each theme's `print`
 * block in crm_frontend/src/theme/themes. PDFs stay on PRINT_THEME.
 */
const EMAIL_THEMES: Record<string, PrintTheme> = {
  rooftop: PRINT_THEME,
  azure: {
    accent: '#2563eb',
    accentSoft: '#e5ecfd',
    ink: '#111318',
    muted: '#5c6370',
    rule: '#e2e4ea',
    onAccent: '#ffffff',
    paper: '#f4f5f7',
    surface: '#ffffff',
  },
  slate: {
    accent: '#0f766e',
    accentSoft: '#e2eeed',
    ink: '#0f1417',
    muted: '#5a656c',
    rule: '#dde3e6',
    onAccent: '#ffffff',
    paper: '#f3f5f6',
    surface: '#ffffff',
  },
  emerald: {
    accent: '#059669',
    accentSoft: '#dff5ec',
    ink: '#101814',
    muted: '#52635b',
    rule: '#d9e3de',
    onAccent: '#ffffff',
    paper: '#f3f7f5',
    surface: '#ffffff',
  },
  violet: {
    accent: '#7c3aed',
    accentSoft: '#efe7fd',
    ink: '#16111c',
    muted: '#5e5668',
    rule: '#e4dde9',
    onAccent: '#ffffff',
    paper: '#f6f4f9',
    surface: '#ffffff',
  },
  rose: {
    accent: '#e11d48',
    accentSoft: '#fbe4e9',
    ink: '#1a1114',
    muted: '#6a575c',
    rule: '#e8dce0',
    onAccent: '#ffffff',
    paper: '#f8f3f4',
    surface: '#ffffff',
  },
  sand: {
    accent: '#9a3412',
    accentSoft: '#f3e7e3',
    ink: '#1c1610',
    muted: '#6b5e4e',
    rule: '#e4d9c8',
    onAccent: '#ffffff',
    paper: '#f6f1e8',
    surface: '#fffdf8',
  },
  graphite: {
    accent: '#3f3f46',
    accentSoft: '#e8e8e9',
    ink: '#09090b',
    muted: '#52525b',
    rule: '#d4d4d8',
    onAccent: '#ffffff',
    paper: '#f4f4f5',
    surface: '#ffffff',
  },
};

export function resolveEmailTheme(paletteId?: string | null): PrintTheme {
  if (paletteId && EMAIL_THEMES[paletteId]) return EMAIL_THEMES[paletteId];
  return PRINT_THEME;
}

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
