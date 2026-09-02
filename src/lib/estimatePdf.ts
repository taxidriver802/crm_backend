import { PDFDocument, StandardFonts, type PDFPage } from 'pdf-lib';
import { PRINT_PDF } from './print-theme';
import {
  PAGE_W,
  PAGE_H,
  MARGIN,
  CONTENT_W,
  COL,
  DESC_W,
  money,
  wrapLines,
  truncateToWidth,
  drawRight,
} from './pdf-layout';

type LineItem = {
  name: string;
  description: string | null;
  quantity: number;
  unit_price: number;
  line_total: number;
};

type EstimatePdfInput = {
  title: string;
  status: string;
  notes: string | null;
  subtotal: number;
  tax_total: number;
  discount_total: number;
  grand_total: number;
  job_title: string;
  job_address: string | null;
  lead_name: string | null;
  line_items: LineItem[];
};

export async function buildEstimatePdfBuffer(
  data: EstimatePdfInput
): Promise<Buffer> {
  const pdfDoc = await PDFDocument.create();
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  const pages: PDFPage[] = [];
  let page = pdfDoc.addPage([PAGE_W, PAGE_H]);
  pages.push(page);
  /** Cursor from top of page (user space). */
  let fromTop = 0;

  function newPage() {
    page = pdfDoc.addPage([PAGE_W, PAGE_H]);
    pages.push(page);
    fromTop = MARGIN;
  }

  function yFor(size: number) {
    return PAGE_H - fromTop - size;
  }

  function drawTableHeader() {
    const rowH = 22;
    page.drawRectangle({
      x: MARGIN,
      y: PAGE_H - fromTop - rowH,
      width: CONTENT_W,
      height: rowH,
      color: PRINT_PDF.accentSoft,
    });
    const labelY = PAGE_H - fromTop - 15;
    page.drawText('QTY', {
      x: COL.qty,
      y: labelY,
      size: 8,
      font: fontBold,
      color: PRINT_PDF.muted,
    });
    page.drawText('DESCRIPTION', {
      x: COL.desc,
      y: labelY,
      size: 8,
      font: fontBold,
      color: PRINT_PDF.muted,
    });
    drawRight(page, 'RATE', COL.rate + 56, labelY, 8, fontBold, PRINT_PDF.muted);
    drawRight(page, 'AMOUNT', PAGE_W - MARGIN, labelY, 8, fontBold, PRINT_PDF.muted);
    fromTop += rowH + 2;
  }

  function ensureSpace(needed: number, repeatTableHeader = false) {
    if (fromTop + needed > PAGE_H - MARGIN - 28) {
      newPage();
      if (repeatTableHeader) drawTableHeader();
    }
  }

  // ── Header band ──────────────────────────────────────
  const headerH = 72;
  page.drawRectangle({
    x: 0,
    y: PAGE_H - headerH,
    width: PAGE_W,
    height: headerH,
    color: PRINT_PDF.accent,
  });
  page.drawText('ESTIMATE', {
    x: MARGIN,
    y: PAGE_H - 42,
    size: 22,
    font: fontBold,
    color: PRINT_PDF.onAccent,
  });

  const headerTitleMax = CONTENT_W * 0.48;
  const headerTitle = truncateToWidth(
    data.title || 'Estimate',
    fontBold,
    12,
    headerTitleMax
  );
  drawRight(
    page,
    headerTitle,
    PAGE_W - MARGIN,
    PAGE_H - 36,
    12,
    fontBold,
    PRINT_PDF.onAccent
  );
  drawRight(
    page,
    data.status.toUpperCase(),
    PAGE_W - MARGIN,
    PAGE_H - 54,
    9,
    font,
    PRINT_PDF.onAccent,
    0.85
  );
  fromTop = headerH + 28;

  // ── Meta: Prepared for | Status ──────────────────────
  const metaTop = fromTop;
  page.drawText('PREPARED FOR', {
    x: MARGIN,
    y: yFor(8),
    size: 8,
    font: fontBold,
    color: PRINT_PDF.muted,
  });
  fromTop += 14;

  const client = data.lead_name || '—';
  page.drawText(client, {
    x: MARGIN,
    y: yFor(11),
    size: 11,
    font: fontBold,
    color: PRINT_PDF.ink,
  });
  fromTop += 16;

  page.drawText(data.job_title, {
    x: MARGIN,
    y: yFor(10),
    size: 10,
    font,
    color: PRINT_PDF.ink,
  });
  fromTop += 14;

  if (data.job_address) {
    for (const ln of wrapLines(data.job_address, font, 9, CONTENT_W * 0.5)) {
      page.drawText(ln, {
        x: MARGIN,
        y: yFor(9),
        size: 9,
        font,
        color: PRINT_PDF.muted,
      });
      fromTop += 12;
    }
  }

  const leftBottom = fromTop;

  fromTop = metaTop;
  const rightX = MARGIN + CONTENT_W * 0.55;

  const metaRows: [string, string][] = [
    ['TITLE', data.title || '—'],
    ['STATUS', data.status],
  ];

  for (const [label, value] of metaRows) {
    page.drawText(label, {
      x: rightX,
      y: yFor(8),
      size: 8,
      font: fontBold,
      color: PRINT_PDF.muted,
    });
    fromTop += 12;
    const valueLines = wrapLines(value, font, 10, CONTENT_W * 0.42);
    for (const ln of valueLines) {
      page.drawText(ln, {
        x: rightX,
        y: yFor(10),
        size: 10,
        font,
        color: PRINT_PDF.ink,
      });
      fromTop += 14;
    }
    fromTop += 4;
  }

  fromTop = Math.max(fromTop, leftBottom) + 16;

  page.drawRectangle({
    x: MARGIN,
    y: PAGE_H - fromTop,
    width: CONTENT_W,
    height: 1,
    color: PRINT_PDF.rule,
  });
  fromTop += 18;

  // ── Line items table ─────────────────────────────────
  drawTableHeader();

  if (data.line_items.length === 0) {
    ensureSpace(20, true);
    page.drawText('No line items.', {
      x: COL.desc,
      y: yFor(10),
      size: 10,
      font,
      color: PRINT_PDF.muted,
    });
    fromTop += 20;
  } else {
    for (const item of data.line_items) {
      const nameLines = wrapLines(item.name, fontBold, 10, DESC_W);
      const descLines = item.description
        ? wrapLines(item.description, font, 8, DESC_W)
        : [];
      const rowContentH =
        nameLines.length * 13 + descLines.length * 11 + 10;

      ensureSpace(rowContentH + 4, true);

      const rowStart = fromTop;
      let cursor = fromTop + 2;

      page.drawText(String(item.quantity), {
        x: COL.qty,
        y: PAGE_H - cursor - 10,
        size: 10,
        font,
        color: PRINT_PDF.ink,
      });

      for (const ln of nameLines) {
        page.drawText(ln, {
          x: COL.desc,
          y: PAGE_H - cursor - 10,
          size: 10,
          font: fontBold,
          color: PRINT_PDF.ink,
        });
        cursor += 13;
      }
      for (const ln of descLines) {
        page.drawText(ln, {
          x: COL.desc,
          y: PAGE_H - cursor - 8,
          size: 8,
          font,
          color: PRINT_PDF.muted,
        });
        cursor += 11;
      }

      const valueY = PAGE_H - rowStart - 12;
      drawRight(
        page,
        money(item.unit_price),
        COL.rate + 56,
        valueY,
        10,
        font,
        PRINT_PDF.ink
      );
      drawRight(
        page,
        money(item.line_total),
        PAGE_W - MARGIN,
        valueY,
        10,
        fontBold,
        PRINT_PDF.ink
      );

      fromTop = Math.max(cursor, rowStart + 18) + 6;

      page.drawRectangle({
        x: MARGIN,
        y: PAGE_H - fromTop,
        width: CONTENT_W,
        height: 0.5,
        color: PRINT_PDF.rule,
      });
      fromTop += 8;
    }
  }

  // ── Totals ───────────────────────────────────────────
  const totalsW = 220;
  const totalsX = PAGE_W - MARGIN - totalsW;
  ensureSpace(90 + (data.notes ? 40 : 0));
  fromTop += 8;

  const drawTotalRow = (
    label: string,
    value: string,
    opts: { bold?: boolean; emphasize?: boolean } = {}
  ) => {
    const size = opts.emphasize ? 12 : 10;
    const f = opts.bold || opts.emphasize ? fontBold : font;
    const color = opts.emphasize ? PRINT_PDF.accent : PRINT_PDF.ink;
    if (opts.emphasize) {
      page.drawRectangle({
        x: totalsX - 8,
        y: PAGE_H - fromTop - size - 8,
        width: totalsW + 8,
        height: size + 14,
        color: PRINT_PDF.accentSoft,
      });
    }
    page.drawText(label, {
      x: totalsX,
      y: yFor(size),
      size,
      font: f,
      color: opts.emphasize ? PRINT_PDF.accent : PRINT_PDF.muted,
    });
    drawRight(page, value, PAGE_W - MARGIN, yFor(size), size, f, color);
    fromTop += size + (opts.emphasize ? 14 : 8);
  };

  drawTotalRow('Subtotal', money(data.subtotal));
  drawTotalRow('Tax', money(data.tax_total));
  if (data.discount_total) {
    drawTotalRow('Discounts', `-${money(data.discount_total)}`);
  }
  fromTop += 4;
  drawTotalRow('Total', money(data.grand_total), {
    bold: true,
    emphasize: true,
  });

  // ── Notes ────────────────────────────────────────────
  if (data.notes) {
    fromTop += 20;
    ensureSpace(40);
    page.drawText('NOTES', {
      x: MARGIN,
      y: yFor(8),
      size: 8,
      font: fontBold,
      color: PRINT_PDF.muted,
    });
    fromTop += 14;
    for (const ln of wrapLines(data.notes, font, 9, CONTENT_W)) {
      ensureSpace(14);
      page.drawText(ln, {
        x: MARGIN,
        y: yFor(9),
        size: 9,
        font,
        color: PRINT_PDF.ink,
      });
      fromTop += 12;
    }
  }

  // ── Footers ──────────────────────────────────────────
  const totalPages = pages.length;
  const footerTitle = truncateToWidth(
    data.title || 'Estimate',
    font,
    8,
    CONTENT_W * 0.65
  );
  pages.forEach((p, i) => {
    p.drawRectangle({
      x: MARGIN,
      y: 28,
      width: CONTENT_W,
      height: 0.5,
      color: PRINT_PDF.rule,
    });
    p.drawText(footerTitle, {
      x: MARGIN,
      y: 16,
      size: 8,
      font,
      color: PRINT_PDF.muted,
    });
    drawRight(
      p,
      `Page ${i + 1} of ${totalPages}`,
      PAGE_W - MARGIN,
      16,
      8,
      font,
      PRINT_PDF.muted
    );
  });

  const bytes = await pdfDoc.save();
  return Buffer.from(bytes);
}
