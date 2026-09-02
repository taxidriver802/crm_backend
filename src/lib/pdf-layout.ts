import { type PDFFont, type PDFPage, type RGB } from 'pdf-lib';
import { PRINT_PDF } from './print-theme';

export const PAGE_W = 612;
export const PAGE_H = 792;
export const MARGIN = 48;
export const CONTENT_W = PAGE_W - MARGIN * 2;

export const COL = {
  qty: MARGIN,
  desc: MARGIN + 48,
  rate: MARGIN + CONTENT_W - 160,
  amount: MARGIN + CONTENT_W - 72,
};

export const DESC_W = COL.rate - COL.desc - 12;

export function money(n: number) {
  return n.toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
  });
}

export function wrapLines(
  text: string,
  font: PDFFont,
  size: number,
  maxWidth: number
): string[] {
  const words = String(text || '')
    .split(/\s+/)
    .filter(Boolean);
  if (words.length === 0) return [''];
  const lines: string[] = [];
  let current = '';
  for (const word of words) {
    const test = current ? `${current} ${word}` : word;
    if (font.widthOfTextAtSize(test, size) > maxWidth && current) {
      lines.push(current);
      current = word;
    } else {
      current = test;
    }
  }
  if (current) lines.push(current);
  return lines;
}

export function truncateToWidth(
  text: string,
  font: PDFFont,
  size: number,
  maxWidth: number
): string {
  if (font.widthOfTextAtSize(text, size) <= maxWidth) return text;
  let t = text;
  while (t.length > 0 && font.widthOfTextAtSize(`${t}...`, size) > maxWidth) {
    t = t.slice(0, -1);
  }
  return `${t}...`;
}

export function drawRight(
  page: PDFPage,
  text: string,
  xRight: number,
  y: number,
  size: number,
  font: PDFFont,
  color: RGB = PRINT_PDF.ink,
  opacity = 1
) {
  const w = font.widthOfTextAtSize(text, size);
  page.drawText(text, { x: xRight - w, y, size, font, color, opacity });
}
