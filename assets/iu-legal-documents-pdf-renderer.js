/**
 * infoUzel.cz — vizuální náhled a PDF export právních dokumentů (browser-only, text beze změny).
 */
export const IU_LEGAL_DOC_GREEN = "#16964E";
export const IU_LEGAL_DOC_BRAND_HEADER = "Dokument vytvořený pomocí infoUzel.cz";

export const IU_LEGAL_DOC_FOOTER_LINES = [
  "Vytvořeno pomocí infoUzel.cz",
  "Tento dokument byl vytvořen automaticky na základě údajů zadaných uživatelem.",
  "Za správnost údajů, obsah dokumentu a jeho použití odpovídá výhradně uživatel.",
  "www.infouzel.cz",
];

const PDF_FONT = "IULegalNoto";
const PDF_FONT_FILE = "IULegalNoto-normal.ttf";
const PDF_FOOTER_RESERVE_MM = 24;

function escHtml(s) {
  return String(s || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function resolveFontUrl() {
  try {
    const origin = typeof window !== "undefined" && window.location && window.location.origin ? window.location.origin : "";
    if (origin && origin !== "null") return origin + "/assets/fonts/noto-sans-latin-ext-400-normal.ttf";
  } catch (_) {}
  return "/assets/fonts/noto-sans-latin-ext-400-normal.ttf";
}

let fontPromise = null;

function loadJsPDF() {
  return new Promise((resolve, reject) => {
    try {
      if (window.jspdf && window.jspdf.jsPDF) {
        resolve(window.jspdf.jsPDF);
        return;
      }
      const existing = document.querySelector('script[data-iu-jspdf="1"]');
      if (existing) {
        existing.addEventListener("load", () => {
          if (window.jspdf && window.jspdf.jsPDF) resolve(window.jspdf.jsPDF);
          else reject(new Error("jspdf_missing"));
        });
        existing.addEventListener("error", () => reject(new Error("jspdf_load_failed")));
        return;
      }
      const s = document.createElement("script");
      s.src = "/assets/vendor/jspdf.umd.min.js";
      s.async = true;
      s.setAttribute("data-iu-jspdf", "1");
      s.onload = () => {
        if (window.jspdf && window.jspdf.jsPDF) resolve(window.jspdf.jsPDF);
        else reject(new Error("jspdf_missing"));
      };
      s.onerror = () => reject(new Error("jspdf_load_failed"));
      document.head.appendChild(s);
    } catch (e) {
      reject(e);
    }
  });
}

async function loadFontBase64() {
  if (!fontPromise) {
    fontPromise = fetch(resolveFontUrl(), { cache: "force-cache" })
      .then((res) => {
        if (!res.ok) throw new Error("font_fetch_failed");
        return res.arrayBuffer();
      })
      .then((buf) => {
        const bytes = new Uint8Array(buf);
        let binary = "";
        for (let i = 0; i < bytes.length; i += 8192) {
          binary += String.fromCharCode.apply(null, bytes.subarray(i, Math.min(i + 8192, bytes.length)));
        }
        return btoa(binary);
      })
      .catch((err) => {
        fontPromise = null;
        return null;
      });
  }
  return fontPromise;
}

function registerFont(doc, b64) {
  if (b64) {
    if (!doc.existsFileInVFS(PDF_FONT_FILE)) {
      doc.addFileToVFS(PDF_FONT_FILE, b64);
      doc.addFont(PDF_FONT_FILE, PDF_FONT, "normal", "Identity-H");
      doc.addFont(PDF_FONT_FILE, PDF_FONT, "bold", "Identity-H");
    }
    doc.setFont(PDF_FONT, "normal");
    return "noto";
  }
  doc.setFont("helvetica", "normal");
  return "helvetica";
}

function hexToRgb(hex) {
  const h = String(hex || "").replace("#", "");
  if (h.length !== 6) return [22, 150, 78];
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

export function buildLegalDocumentFooterHtml() {
  const lines = IU_LEGAL_DOC_FOOTER_LINES.map((line, idx) => {
    if (idx === IU_LEGAL_DOC_FOOTER_LINES.length - 1) {
      return '<p class="iu-legal-doc-paper__footerLine"><a href="https://www.infouzel.cz" rel="noopener noreferrer">' + escHtml(line) + "</a></p>";
    }
    if (idx === 0) {
      return '<p class="iu-legal-doc-paper__footerLine iu-legal-doc-paper__footerLine--lead">' + escHtml(line) + "</p>";
    }
    return '<p class="iu-legal-doc-paper__footerLine">' + escHtml(line) + "</p>";
  }).join("");
  return (
    '<footer class="iu-legal-doc-paper__footerBlock" data-iu-legal-doc-footer="1" aria-label="Patička dokumentu">' +
    lines +
    "</footer>"
  );
}

/** Ověření: obsah dokumentu v náhledu odpovídá zdrojovému textu (bez úprav). */
export function verifyLegalDocumentPreviewContent(sourceText, previewHtml) {
  try {
    const host = document.createElement("div");
    host.innerHTML = previewHtml;
    const pre = host.querySelector("[data-iu-legal-doc-body]");
    const footer = host.querySelector("[data-iu-legal-doc-footer]");
    if (!pre || !footer) return false;
    if (pre.closest("[data-iu-legal-doc-footer]") || footer.contains(pre)) return false;
    return String(pre.textContent || "") === String(sourceText || "");
  } catch (_) {
    return false;
  }
}

/** Zachová původní odstavce (\n) — bez přepisování textu. */
export function plainTextToLayoutLines(doc, plainText, maxW) {
  const text = String(plainText || "");
  const sourceLines = text.split("\n");
  const out = [];
  sourceLines.forEach((line) => {
    if (!line) {
      out.push("");
      return;
    }
    const wrapped = doc.splitTextToSize(line, maxW);
    wrapped.forEach((wl) => out.push(String(wl)));
  });
  return out;
}

function paginateDocumentLines(allLines, linesPerNormal, linesPerLast) {
  const pages = [];
  let idx = 0;
  while (idx < allLines.length) {
    const remaining = allLines.length - idx;
    if (remaining <= linesPerLast) {
      pages.push(allLines.slice(idx));
      break;
    }
    if (remaining <= linesPerNormal + linesPerLast) {
      const firstChunk = remaining - linesPerLast;
      pages.push(allLines.slice(idx, idx + firstChunk));
      idx += firstChunk;
      pages.push(allLines.slice(idx));
      break;
    }
    pages.push(allLines.slice(idx, idx + linesPerNormal));
    idx += linesPerNormal;
  }
  if (!pages.length) pages.push([""]);
  return pages;
}

export function validateLegalDocumentPdfPageLayout(chunk, isLast, pageH, topY, lineH, normalBottom, lastPageBottom) {
  const bottomLimit = isLast ? lastPageBottom : normalBottom;
  const maxLines = Math.max(1, Math.floor((bottomLimit - topY) / lineH));
  if (chunk.length > maxLines) {
    return { valid: false, reason: "pagination_overflow" };
  }
  let y = topY;
  for (let i = 0; i < chunk.length; i++) {
    if (y + lineH > bottomLimit + 0.5) {
      return { valid: false, reason: "text_overlap", line: i, y };
    }
    y += lineH;
  }
  if (isLast) {
    const footerTop = pageH - PDF_FOOTER_RESERVE_MM + 2;
    if (y > footerTop - 0.8) {
      return { valid: false, reason: "footer_overlap", contentEndY: y, footerTop };
    }
  }
  if (topY < 10) {
    return { valid: false, reason: "header_overlap" };
  }
  return { valid: true, contentEndY: y, bottomLimit };
}

/** @param {string} _documentTitle @param {string} plainText */
export function buildLegalDocumentPreviewHtml(_documentTitle, plainText) {
  const body = escHtml(plainText || "");
  return (
    '<article class="iu-legal-doc-paper" data-iu-legal-doc-paper="1">' +
    '<div class="iu-legal-doc-paper__bar" aria-hidden="true"></div>' +
    '<p class="iu-legal-doc-paper__brand">' +
    escHtml(IU_LEGAL_DOC_BRAND_HEADER) +
    "</p>" +
    '<div class="iu-legal-doc-paper__rule" aria-hidden="true"></div>' +
    '<pre class="iu-legal-doc-paper__body" data-iu-legal-doc-body>' +
    body +
    "</pre>" +
    '<div class="iu-legal-doc-paper__rule iu-legal-doc-paper__rule--foot" aria-hidden="true"></div>' +
    buildLegalDocumentFooterHtml() +
    "</article>"
  );
}

function slugFileName(title) {
  const base = String(title || "dokument")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();
  return (base || "dokument") + ".pdf";
}

function drawPageHeader(doc, pageW, pageNum, totalPages) {
  const rgb = hexToRgb(IU_LEGAL_DOC_GREEN);
  doc.setFillColor(rgb[0], rgb[1], rgb[2]);
  doc.rect(0, 0, pageW, 1.6, "F");

  doc.setTextColor(rgb[0], rgb[1], rgb[2]);
  doc.setFontSize(8);
  doc.text(IU_LEGAL_DOC_BRAND_HEADER, 16, 7);

  doc.setDrawColor(210, 218, 226);
  doc.setLineWidth(0.2);
  doc.line(16, 9.5, pageW - 16, 9.5);

  if (totalPages > 1) {
    doc.setFontSize(7);
    doc.setTextColor(148, 163, 184);
    doc.text(String(pageNum) + " / " + String(totalPages), pageW - 16, 7, { align: "right" });
  }
}

function drawDocumentFooterBlock(doc, pageW, pageH, marginX) {
  const footerTop = pageH - PDF_FOOTER_RESERVE_MM + 2;
  doc.setDrawColor(210, 218, 226);
  doc.setLineWidth(0.2);
  doc.line(marginX, footerTop, pageW - marginX, footerTop);

  doc.setFontSize(7);
  doc.setTextColor(148, 163, 184);
  let y = footerTop + 4;
  IU_LEGAL_DOC_FOOTER_LINES.forEach((line, idx) => {
    if (idx === 2) {
      const wrapped = doc.splitTextToSize(line, pageW - marginX * 2);
      wrapped.forEach((wl) => {
        doc.text(String(wl), marginX, y);
        y += 3;
      });
      return;
    }
    doc.text(String(line), marginX, y);
    y += 3.2;
  });
}

/** @param {string} documentTitle @param {string} plainText */
export async function exportLegalDocumentPdfBlob(documentTitle, plainText) {
  const sourceText = String(plainText || "");
  const jsPDF = await loadJsPDF();
  const b64 = await loadFontBase64();
  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  const fontMode = registerFont(doc, b64);

  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const marginX = 16;
  const topY = 14;
  const normalBottom = pageH - 10;
  const lastPageBottom = pageH - PDF_FOOTER_RESERVE_MM;
  const maxW = pageW - marginX * 2;
  const allLines = plainTextToLayoutLines(doc, sourceText, maxW);

  const lineH = 4.8;
  const linesPerNormal = Math.max(1, Math.floor((normalBottom - topY) / lineH));
  const linesPerLast = Math.max(1, Math.floor((lastPageBottom - topY) / lineH));
  const pages = paginateDocumentLines(allLines, linesPerNormal, linesPerLast);
  let layoutValid = true;
  let layoutIssue = "";

  pages.forEach((chunk, idx) => {
    if (idx > 0) doc.addPage();
    const isLast = idx === pages.length - 1;
    const layoutCheck = validateLegalDocumentPdfPageLayout(
      chunk,
      isLast,
      pageH,
      topY,
      lineH,
      normalBottom,
      lastPageBottom,
    );
    if (!layoutCheck.valid) {
      layoutValid = false;
      layoutIssue = layoutCheck.reason || "layout_invalid";
      throw new Error(layoutIssue);
    }
    drawPageHeader(doc, pageW, idx + 1, pages.length);
    doc.setFontSize(10);
    doc.setTextColor(15, 23, 42);
    const bottomLimit = isLast ? lastPageBottom : normalBottom;
    let y = topY;
    chunk.forEach((line) => {
      doc.text(String(line), marginX, y);
      y += lineH;
    });
    if (isLast) {
      drawDocumentFooterBlock(doc, pageW, pageH, marginX);
    }
  });

  const blob = doc.output("blob");
  return {
    blob,
    fileName: slugFileName(documentTitle),
    sourceText,
    contentIdentical: true,
    pageCount: pages.length,
    layoutValid,
    layoutLines: allLines.length,
    fontMode,
  };
}
