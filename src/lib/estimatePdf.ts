import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from 'pdf-lib';

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

const PAGE_W = 612;
const PAGE_H = 792;
const MARGIN = 48;
const CONTENT_W = PAGE_W - MARGIN * 2;

// App accent (#2563eb) — keep in sync with invoicePdf
const ACCENT = rgb(0.145, 0.388, 0.922);
const ACCENT_SOFT = rgb(0.925, 0.937, 0.98);
const INK = rgb(0.12, 0.14, 0.18);
const MUTED = rgb(0.42, 0.45, 0.5);
const RULE = rgb(0.86, 0.88, 0.9);
const WHITE = rgb(1, 1, 1);

const COL = {
  qty: MARGIN,
  desc: MARGIN + 48,
  rate: MARGIN + CONTENT_W - 160,
  amount: MARGIN + CONTENT_W - 72,
};
const DESC_W = COL.rate - COL.desc - 12;

function money(n: number) {
  return n.toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
  });
}

function wrapLines(
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

function truncateToWidth(
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

function drawRight(
  page: PDFPage,
  text: string,
  xRight: number,
  y: number,
  size: number,
  font: PDFFont,
  color = INK
) {
  const w = font.widthOfTextAtSize(text, size);
  page.drawText(text, { x: xRight - w, y, size, font, color });
}

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
      color: ACCENT_SOFT,
    });
    const labelY = PAGE_H - fromTop - 15;
    page.drawText('QTY', {
      x: COL.qty,
      y: labelY,
      size: 8,
      font: fontBold,
      color: MUTED,
    });
    page.drawText('DESCRIPTION', {
      x: COL.desc,
      y: labelY,
      size: 8,
      font: fontBold,
      color: MUTED,
    });
    drawRight(page, 'RATE', COL.rate + 56, labelY, 8, fontBold, MUTED);
    drawRight(page, 'AMOUNT', PAGE_W - MARGIN, labelY, 8, fontBold, MUTED);
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
    color: ACCENT,
  });
  page.drawText('ESTIMATE', {
    x: MARGIN,
    y: PAGE_H - 42,
    size: 22,
    font: fontBold,
    color: WHITE,
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
    WHITE
  );
  drawRight(
    page,
    data.status.toUpperCase(),
    PAGE_W - MARGIN,
    PAGE_H - 54,
    9,
    font,
    rgb(0.85, 0.9, 1)
  );
  fromTop = headerH + 28;

  // ── Meta: Prepared for | Status ──────────────────────
  const metaTop = fromTop;
  page.drawText('PREPARED FOR', {
    x: MARGIN,
    y: yFor(8),
    size: 8,
    font: fontBold,
    color: MUTED,
  });
  fromTop += 14;

  const client = data.lead_name || '—';
  page.drawText(client, {
    x: MARGIN,
    y: yFor(11),
    size: 11,
    font: fontBold,
    color: INK,
  });
  fromTop += 16;

  page.drawText(data.job_title, {
    x: MARGIN,
    y: yFor(10),
    size: 10,
    font,
    color: INK,
  });
  fromTop += 14;

  if (data.job_address) {
    for (const ln of wrapLines(data.job_address, font, 9, CONTENT_W * 0.5)) {
      page.drawText(ln, {
        x: MARGIN,
        y: yFor(9),
        size: 9,
        font,
        color: MUTED,
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
      color: MUTED,
    });
    fromTop += 12;
    const valueLines = wrapLines(value, font, 10, CONTENT_W * 0.42);
    for (const ln of valueLines) {
      page.drawText(ln, {
        x: rightX,
        y: yFor(10),
        size: 10,
        font,
        color: INK,
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
    color: RULE,
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
      color: MUTED,
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
        color: INK,
      });

      for (const ln of nameLines) {
        page.drawText(ln, {
          x: COL.desc,
          y: PAGE_H - cursor - 10,
          size: 10,
          font: fontBold,
          color: INK,
        });
        cursor += 13;
      }
      for (const ln of descLines) {
        page.drawText(ln, {
          x: COL.desc,
          y: PAGE_H - cursor - 8,
          size: 8,
          font,
          color: MUTED,
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
        INK
      );
      drawRight(
        page,
        money(item.line_total),
        PAGE_W - MARGIN,
        valueY,
        10,
        fontBold,
        INK
      );

      fromTop = Math.max(cursor, rowStart + 18) + 6;

      page.drawRectangle({
        x: MARGIN,
        y: PAGE_H - fromTop,
        width: CONTENT_W,
        height: 0.5,
        color: RULE,
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
    const color = opts.emphasize ? ACCENT : INK;
    if (opts.emphasize) {
      page.drawRectangle({
        x: totalsX - 8,
        y: PAGE_H - fromTop - size - 8,
        width: totalsW + 8,
        height: size + 14,
        color: ACCENT_SOFT,
      });
    }
    page.drawText(label, {
      x: totalsX,
      y: yFor(size),
      size,
      font: f,
      color: opts.emphasize ? ACCENT : MUTED,
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
      color: MUTED,
    });
    fromTop += 14;
    for (const ln of wrapLines(data.notes, font, 9, CONTENT_W)) {
      ensureSpace(14);
      page.drawText(ln, {
        x: MARGIN,
        y: yFor(9),
        size: 9,
        font,
        color: INK,
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
      color: RULE,
    });
    p.drawText(footerTitle, {
      x: MARGIN,
      y: 16,
      size: 8,
      font,
      color: MUTED,
    });
    drawRight(
      p,
      `Page ${i + 1} of ${totalPages}`,
      PAGE_W - MARGIN,
      16,
      8,
      font,
      MUTED
    );
  });

  const bytes = await pdfDoc.save();
  return Buffer.from(bytes);
}
