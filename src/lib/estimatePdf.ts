import { PDFDocument, StandardFonts, rgb, type PDFFont } from 'pdf-lib';

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
const MARGIN = 50;
const MAX_W = PAGE_W - MARGIN * 2;

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
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length === 0) return [''];
  const lines: string[] = [];
  let current = '';
  for (const word of words) {
    const test = current ? `${current} ${word}` : word;
    const w = font.widthOfTextAtSize(test, size);
    if (w > maxWidth && current) {
      lines.push(current);
      current = word;
    } else {
      current = test;
    }
  }
  if (current) lines.push(current);
  return lines;
}

export async function buildEstimatePdfBuffer(
  data: EstimatePdfInput
): Promise<Buffer> {
  const pdfDoc = await PDFDocument.create();
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  let page = pdfDoc.addPage([PAGE_W, PAGE_H]);
  /** Distance from top of page downward (user coordinates). */
  let fromTop = MARGIN;

  function ensurePage(extra: number) {
    if (fromTop + extra > PAGE_H - MARGIN) {
      page = pdfDoc.addPage([PAGE_W, PAGE_H]);
      fromTop = MARGIN;
    }
  }

  function baselineY(size: number) {
    return PAGE_H - fromTop - size;
  }

  function drawLine(text: string, size: number, bold = false, gray = false) {
    const f = bold ? fontBold : font;
    const color = gray ? rgb(0.27, 0.27, 0.27) : rgb(0, 0, 0);
    const lines = wrapLines(text, f, size, MAX_W);
    for (const ln of lines) {
      ensurePage(size + 6);
      page.drawText(ln, {
        x: MARGIN,
        y: baselineY(size),
        size,
        font: f,
        color,
      });
      fromTop += size + 4;
    }
  }

  drawLine(data.title, 18, true);
  fromTop += 4;
  drawLine(`Status: ${data.status}`, 10, false, true);
  fromTop += 8;

  drawLine('Job', 11, true);
  drawLine(data.job_title, 10);
  if (data.job_address) {
    drawLine(data.job_address, 10);
  }
  if (data.lead_name) {
    drawLine(`Client: ${data.lead_name}`, 10);
  }
  fromTop += 8;

  drawLine('Line items', 11, true);
  fromTop += 4;

  for (const line of data.line_items) {
    drawLine(`${line.name} — ${money(line.line_total)}`, 10, true);
    if (line.description) {
      drawLine(line.description, 9, false, true);
    }
    drawLine(
      `Qty ${line.quantity} × ${money(line.unit_price)}`,
      9,
      false,
      true
    );
    fromTop += 6;
  }

  fromTop += 8;
  const rightAlign = (
    label: string,
    value: string,
    size: number,
    bold = false
  ) => {
    const text = `${label}${value}`;
    const f = bold ? fontBold : font;
    const tw = f.widthOfTextAtSize(text, size);
    ensurePage(size + 6);
    page.drawText(text, {
      x: PAGE_W - MARGIN - tw,
      y: baselineY(size),
      size,
      font: f,
      color: rgb(0, 0, 0),
    });
    fromTop += size + 4;
  };

  rightAlign('Subtotal: ', money(data.subtotal), 10);
  rightAlign('Tax: ', money(data.tax_total), 10);
  rightAlign('Discounts: ', money(data.discount_total), 10);
  rightAlign('Total: ', money(data.grand_total), 12, true);

  if (data.notes) {
    fromTop += 12;
    drawLine('Notes', 11, true);
    drawLine(data.notes, 10);
  }

  const bytes = await pdfDoc.save();
  return Buffer.from(bytes);
}
