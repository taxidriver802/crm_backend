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
  drawRight,
} from './pdf-layout';

type LineItem = {
  name: string;
  description: string | null;
  quantity: number;
  unit_price: number;
  line_total: number;
};

type InvoicePdfInput = {
  invoice_number: string;
  status: string;
  notes: string | null;
  subtotal: number;
  tax_total: number;
  discount_total: number;
  grand_total: number;
  due_date: string | null;
  paid_at: string | null;
  job_title: string;
  job_address: string | null;
  lead_name: string | null;
  line_items: LineItem[];
};

function fmtDate(d: string | null) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

export async function buildInvoicePdfBuffer(
  data: InvoicePdfInput
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

  /** Break to a new page when needed; optionally repeat the table header. */
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
  page.drawText('INVOICE', {
    x: MARGIN,
    y: PAGE_H - 42,
    size: 22,
    font: fontBold,
    color: PRINT_PDF.onAccent,
  });
  drawRight(
    page,
    data.invoice_number,
    PAGE_W - MARGIN,
    PAGE_H - 36,
    14,
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

  // ── Meta: Bill to | Dates ────────────────────────────
  const metaTop = fromTop;
  page.drawText('BILL TO', {
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

  // Right column dates (aligned to meta block top)
  fromTop = metaTop;
  const rightX = MARGIN + CONTENT_W * 0.55;
  const labelSize = 8;
  const valueSize = 10;

  const metaRows: [string, string][] = [
    ['DUE DATE', fmtDate(data.due_date)],
    ['PAID', data.paid_at ? fmtDate(data.paid_at) : '—'],
    ['STATUS', data.status],
  ];

  for (const [label, value] of metaRows) {
    page.drawText(label, {
      x: rightX,
      y: yFor(labelSize),
      size: labelSize,
      font: fontBold,
      color: PRINT_PDF.muted,
    });
    fromTop += 12;
    page.drawText(value, {
      x: rightX,
      y: yFor(valueSize),
      size: valueSize,
      font,
      color: PRINT_PDF.ink,
    });
    fromTop += 18;
  }

  fromTop = Math.max(fromTop, leftBottom) + 16;

  // Divider
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

      // Qty
      page.drawText(String(item.quantity), {
        x: COL.qty,
        y: PAGE_H - cursor - 10,
        size: 10,
        font,
        color: PRINT_PDF.ink,
      });

      // Description
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

      // Rate & amount — top-aligned with first name line
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

      // Row rule
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
  const totalsNeeded = 90 + (data.notes ? 40 : 0);
  ensureSpace(totalsNeeded);
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
  drawTotalRow('Total Due', money(data.grand_total), {
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

  // ── Footers on every page ────────────────────────────
  const totalPages = pages.length;
  pages.forEach((p, i) => {
    p.drawRectangle({
      x: MARGIN,
      y: 28,
      width: CONTENT_W,
      height: 0.5,
      color: PRINT_PDF.rule,
    });
    p.drawText(`Invoice ${data.invoice_number}`, {
      x: MARGIN,
      y: 16,
      size: 8,
      font,
      color: PRINT_PDF.muted,
    });
    const pageLabel = `Page ${i + 1} of ${totalPages}`;
    drawRight(p, pageLabel, PAGE_W - MARGIN, 16, 8, font, PRINT_PDF.muted);
  });

  const bytes = await pdfDoc.save();
  return Buffer.from(bytes);
}
