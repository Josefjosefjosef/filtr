import type { PDFFont, PDFPage, RGB } from "pdf-lib";

export const PREMIUM_INVOICE_PAGE = { w: 595.28, h: 841.89 } as const;
export const PREMIUM_INVOICE_MARGIN = 48;
export const PREMIUM_INVOICE_CONTENT_W = PREMIUM_INVOICE_PAGE.w - PREMIUM_INVOICE_MARGIN * 2;
export const PREMIUM_INVOICE_FOOTER_RESERVE = 56;
export const PREMIUM_INVOICE_MIN_Y = PREMIUM_INVOICE_MARGIN + PREMIUM_INVOICE_FOOTER_RESERVE;

export type LayoutRect = { x: number; yTop: number; yBottom: number; w: number };

export function wrapTextLines(font: PDFFont, text: string, size: number, maxWidth: number): string[] {
  const normalized = String(text || "").replace(/\s+/g, " ").trim();
  if (!normalized) return [];
  const words = normalized.split(" ");
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const candidate = current ? current + " " + word : word;
    const width = font.widthOfTextAtSize(candidate, size);
    if (width <= maxWidth || !current) {
      current = candidate;
      continue;
    }
    lines.push(current);
    current = word;
  }
  if (current) lines.push(current);
  return lines;
}

export function measureWrappedHeight(lineCount: number, size: number, leadingMult = 1.35): number {
  if (lineCount <= 0) return 0;
  return lineCount * size * leadingMult;
}

export function drawWrappedText(
  page: PDFPage,
  font: PDFFont,
  text: string,
  x: number,
  yTop: number,
  maxWidth: number,
  size: number,
  color: RGB,
  leadingMult = 1.35
): number {
  const lines = wrapTextLines(font, text, size, maxWidth);
  let y = yTop;
  const step = size * leadingMult;
  for (const line of lines) {
    page.drawText(line, { x, y, size, font, color, maxWidth });
    y -= step;
  }
  return yTop - measureWrappedHeight(lines.length, size, leadingMult);
}

export type LayoutBlockMetric = { id: string; rect: LayoutRect };

export class PremiumInvoicePdfCursor {
  page: PDFPage;
  pages: PDFPage[];
  pdfDoc: { addPage: (size: [number, number]) => PDFPage };
  y: number;
  blocks: LayoutBlockMetric[] = [];

  constructor(page: PDFPage, pages: PDFPage[], pdfDoc: { addPage: (size: [number, number]) => PDFPage }, startY: number) {
    this.page = page;
    this.pages = pages;
    this.pdfDoc = pdfDoc;
    this.y = startY;
  }

  ensureSpace(needPt: number): void {
    if (this.y - needPt >= PREMIUM_INVOICE_MIN_Y) return;
    const newPage = this.pdfDoc.addPage([PREMIUM_INVOICE_PAGE.w, PREMIUM_INVOICE_PAGE.h]);
    this.pages.push(newPage);
    this.page = newPage;
    this.y = PREMIUM_INVOICE_PAGE.h - PREMIUM_INVOICE_MARGIN;
  }

  recordBlock(id: string, yTop: number, yBottom: number, x: number, w: number): void {
    this.blocks.push({ id, rect: { x, yTop, yBottom, w } });
  }

  /** Assert no vertical overlap between recorded blocks (test helper). */
  static assertNoBlockOverlap(blocks: LayoutBlockMetric[]): string[] {
    const errors: string[] = [];
    for (let i = 0; i < blocks.length; i++) {
      for (let j = i + 1; j < blocks.length; j++) {
        const a = blocks[i].rect;
        const b = blocks[j].rect;
        const hOverlap = !(a.x + a.w <= b.x || b.x + b.w <= a.x);
        if (!hOverlap) continue;
        const vOverlap = !(a.yBottom >= b.yTop || b.yBottom >= a.yTop);
        if (vOverlap) errors.push(blocks[i].id + "_overlaps_" + blocks[j].id);
      }
    }
    return errors;
  }
}
