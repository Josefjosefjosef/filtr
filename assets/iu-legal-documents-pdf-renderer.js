/**
 * infoUzel.cz — vizuální náhled a PDF export právních dokumentů (browser-only, text beze změny).
 */
export const IU_LEGAL_DOC_GREEN = "#16964E";
export const IU_LEGAL_DOC_GREEN_DARK = "#087A3A";
export const IU_LEGAL_DOC_GREEN_LIGHT = "rgba(22,150,78,0.08)";
export const IU_LEGAL_DOC_TEXT = "#111827";
export const IU_LEGAL_DOC_TOP_CREATED = "Vytvořeno pomocí infoUzel.cz";
export const IU_LEGAL_DOC_HEADER_SUBTITLE = "Generátor právních dokumentů";
export const IU_LEGAL_DOC_BRAND_HEADER = IU_LEGAL_DOC_TOP_CREATED;

export const IU_LEGAL_DOC_FOOTER_LINES = [
  "Vytvořeno pomocí infoUzel.cz",
  "Tento dokument byl vytvořen automaticky na základě údajů zadaných uživatelem.",
  "Za správnost údajů, obsah dokumentu a jeho použití odpovídá výhradně uživatel.",
  "www.infouzel.cz",
];

/** Stejný zdroj jako desktop top bar (#topbarWrap .iuBrand). */
export const IU_LEGAL_DOC_TOPBAR_BRAND_SELECTOR = "#topbarWrap .iuBrand";

const PDF_FONT = "IULegalNoto";
const PDF_FONT_FILE = "IULegalNoto-normal.ttf";
const PDF_FOOTER_RESERVE_MM = 24;
const PDF_HEADER_RESERVE_MM = 32;
const PLACEHOLDER_ONLY_LINE_RE = /^[\.·…\s_,\-]+$/;
const SECTION_HEADING_RE = /^(\d+)\.\s+(.+)$/;
const SIGNATURE_LINE_RE = /^_{5,}/;

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

function isPlaceholderOnlyLine(line) {
  const s = String(line || "").trim();
  if (!s) return true;
  if (/^[_\s]+$/.test(s)) return false;
  return PLACEHOLDER_ONLY_LINE_RE.test(s);
}

function isStructuralSectionHeading(line) {
  const s = String(line || "").trim();
  return s === "Místo a datum" || s === "Podpisy" || /^Závěrečná/i.test(s) || /^Přílohy$/i.test(s);
}

function shouldKeepVisualBlock(block) {
  const lines = String(block || "").split("\n");
  const nonEmpty = lines.filter((line) => String(line).trim());
  if (!nonEmpty.length) return false;
  if (nonEmpty.length === 1) {
    const only = nonEmpty[0].trim();
    if (/^\d+\.\s+/.test(only)) return false;
    if (isPlaceholderOnlyLine(only)) return false;
    return true;
  }
  const heading = nonEmpty[0];
  if (isStructuralSectionHeading(heading)) return true;
  const restNonEmpty = lines.slice(1).filter((line) => String(line).trim());
  if (!restNonEmpty.length) return false;
  if (restNonEmpty.every(isPlaceholderOnlyLine)) return false;
  return true;
}

/** Vizuální výstup/PDF: vynechá celé sekce bez uživatelských dat (bez úpravy zdrojového textu). */
export function filterEmptySectionsForVisualOutput(plainText) {
  const text = String(plainText || "");
  if (!text.trim()) return text;
  return text
    .split(/\n\n/)
    .filter(shouldKeepVisualBlock)
    .join("\n\n");
}

function parseSectionHeading(firstLine) {
  const s = String(firstLine || "").trim();
  const numbered = SECTION_HEADING_RE.exec(s);
  if (numbered) {
    return { num: numbered[1], heading: numbered[2], raw: s };
  }
  if (isStructuralSectionHeading(s)) {
    return { num: "", heading: s, raw: s };
  }
  return null;
}

/** @param {string} plainText */
export function parseLegalDocumentVisualStructure(plainText) {
  const visualText = filterEmptySectionsForVisualOutput(plainText);
  const blocks = visualText ? visualText.split(/\n\n/) : [];
  if (!blocks.length) {
    return { title: "", subtitle: "", sections: [], sourceText: visualText };
  }

  const titleLines = blocks[0].split("\n");
  const title = String(titleLines[0] || "").trim();
  const subtitle = titleLines.length > 1 ? titleLines.slice(1).join("\n").trim() : "";
  const sections = [];

  for (let i = 1; i < blocks.length; i++) {
    const block = String(blocks[i] || "");
    const lines = block.split("\n");
    const firstLine = lines[0];
    const parsed = parseSectionHeading(firstLine);
    if (parsed) {
      sections.push({
        num: parsed.num,
        heading: parsed.heading,
        body: lines.slice(1).join("\n"),
        isSignatures: /^podpisy$/i.test(parsed.heading),
        isPlaceDate: /^místo a datum$/i.test(parsed.heading),
      });
    } else {
      sections.push({ num: "", heading: "", body: block, isFreeBlock: true });
    }
  }

  return { title, subtitle, sections, sourceText: visualText };
}

/** Logo z desktop top baru — stejná značka .iuBrand, bez nového assetu. */
export function buildTopbarBrandHtml() {
  try {
    const el = document.querySelector(IU_LEGAL_DOC_TOPBAR_BRAND_SELECTOR);
    if (el) {
      const inner = String(el.innerHTML || "").trim();
      if (inner) {
        return (
          '<span class="iuBrand iu-legal-doc-paper__topbarBrand" data-iu-legal-doc-logo="1" aria-hidden="true">' +
          inner +
          "</span>"
        );
      }
    }
  } catch (_) {}
  return (
    '<span class="iuBrand iu-legal-doc-paper__topbarBrand" data-iu-legal-doc-logo="1" aria-hidden="true">' +
    '<span class="iuBrand__info">info</span><span class="iuBrand__uzel">Uzel</span><span class="iuBrand__cz">.cz</span>' +
    "</span>"
  );
}

function inferPartyLabelsFromSections(sections) {
  const labels = [];
  for (let i = 0; i < sections.length; i++) {
    const sec = sections[i];
    if (!sec || !sec.heading) continue;
    if (!/identifikace/i.test(sec.heading) && sec.num !== "1") continue;
    const lines = String(sec.body || "").split("\n");
    for (let j = 0; j < lines.length; j++) {
      const line = String(lines[j] || "").trim();
      if (!line || line.indexOf(":") >= 0) continue;
      if (/^typ$/i.test(line)) continue;
      if (labels.indexOf(line) < 0) labels.push(line);
      if (labels.length >= 2) break;
    }
    if (labels.length) break;
  }
  return { a: labels[0] || "Strana A", b: labels[1] || "Strana B" };
}

function buildSectionBarHtml(num, heading) {
  const numLabel = num ? String(num) + "." : "";
  const title = String(heading || "").trim().toUpperCase();
  return (
    '<div class="iu-legal-doc-paper__sectionBar" data-iu-legal-doc-visual-only="1" aria-hidden="true">' +
    '<span class="iu-legal-doc-paper__sectionNum">' +
    escHtml(numLabel) +
    "</span>" +
    '<span class="iu-legal-doc-paper__sectionTitle">' +
    escHtml(title) +
    "</span>" +
    "</div>"
  );
}

function buildSignatureVisualHtml(body, partyLabels) {
  const lines = String(body || "").split("\n");
  const sigLine = lines.find((line) => SIGNATURE_LINE_RE.test(String(line || "").trim()));
  const labels = partyLabels || { a: "Strana A", b: "Strana B" };
  if (!sigLine) {
    return '<div class="iu-legal-doc-paper__sectionBody">' + escHtml(body).replace(/\n/g, "<br>") + "</div>";
  }
  return (
    '<div class="iu-legal-doc-paper__signatureGrid" data-iu-legal-doc-visual-only="1">' +
    '<div class="iu-legal-doc-paper__signatureCol">' +
    '<span class="iu-legal-doc-paper__signatureLine" aria-hidden="true"></span>' +
    '<span class="iu-legal-doc-paper__signatureLabel">' +
    escHtml(labels.a) +
    "</span>" +
    "</div>" +
    '<div class="iu-legal-doc-paper__signatureCol">' +
    '<span class="iu-legal-doc-paper__signatureLine" aria-hidden="true"></span>' +
    '<span class="iu-legal-doc-paper__signatureLabel">' +
    escHtml(labels.b) +
    "</span>" +
    "</div>" +
    "</div>" +
    '<pre class="iu-legal-doc-paper__signatureSource" aria-hidden="true">' +
    escHtml(sigLine) +
    "</pre>"
  );
}

function buildSectionHtml(section, partyLabels) {
  if (section.isFreeBlock) {
    return '<div class="iu-legal-doc-paper__sectionBody">' + escHtml(section.body).replace(/\n/g, "<br>") + "</div>";
  }
  let html = "";
  if (section.heading) {
    html += buildSectionBarHtml(section.num, section.heading);
  }
  if (section.isSignatures) {
    html += buildSignatureVisualHtml(section.body, partyLabels);
  } else if (section.body) {
    html += '<div class="iu-legal-doc-paper__sectionBody">' + escHtml(section.body).replace(/\n/g, "<br>") + "</div>";
  }
  return '<section class="iu-legal-doc-paper__section">' + html + "</section>";
}

function buildLegalDocumentHeaderHtml() {
  return (
    '<header class="iu-legal-doc-paper__header" data-iu-legal-doc-visual-only="1">' +
    '<p class="iu-legal-doc-paper__createdTop">' +
    escHtml(IU_LEGAL_DOC_TOP_CREATED) +
    "</p>" +
    '<div class="iu-legal-doc-paper__headerGrid">' +
    '<div class="iu-legal-doc-paper__headerMain">' +
    buildTopbarBrandHtml() +
    '<p class="iu-legal-doc-paper__headerSubtitle">' +
    escHtml(IU_LEGAL_DOC_HEADER_SUBTITLE) +
    "</p>" +
    "</div>" +
    '<div class="iu-legal-doc-paper__headerAside">' +
    '<span class="iu-legal-doc-paper__headerIcon" aria-hidden="true">&#10003;</span>' +
    '<p class="iu-legal-doc-paper__headerAsideTitle">Spolehlivé dokumenty</p>' +
    '<p class="iu-legal-doc-paper__headerAsideSub">rychle a jednoduše</p>' +
    "</div>" +
    "</div>" +
    "</header>"
  );
}

function trimTrailingEmptyLines(lines) {
  const out = lines.slice();
  while (out.length > 0 && !String(out[out.length - 1]).trim()) {
    out.pop();
  }
  return out;
}

function pageHasRealContent(chunk) {
  return (chunk || []).some((line) => String(line).trim().length > 0);
}

function removeEmptyPdfPages(pages) {
  const nonEmpty = (pages || []).filter(pageHasRealContent);
  if (!nonEmpty.length) {
    return pages && pages.length ? [pages[0]] : [[""]];
  }
  return nonEmpty;
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

/** Ověření: vizuální tělo náhledu odpovídá filtrovanému textu (bez obalu a bez úpravy právního významu). */
export function verifyLegalDocumentPreviewContent(sourceText, previewHtml) {
  try {
    const host = document.createElement("div");
    host.innerHTML = previewHtml;
    const pre = host.querySelector("[data-iu-legal-doc-body]");
    const footer = host.querySelector("[data-iu-legal-doc-footer]");
    const logo = host.querySelector("[data-iu-legal-doc-logo]");
    if (!pre || !footer) return false;
    if (pre.closest("[data-iu-legal-doc-footer]") || footer.contains(pre)) return false;
    if (logo && pre.contains(logo)) return false;
    const expected = filterEmptySectionsForVisualOutput(sourceText);
    return String(pre.textContent || "") === String(expected || "");
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

function paginateDocumentLines(allLines, linesPerPage) {
  const pages = [];
  let idx = 0;
  while (idx < allLines.length) {
    pages.push(allLines.slice(idx, idx + linesPerPage));
    idx += linesPerPage;
  }
  if (!pages.length) pages.push([""]);
  return pages;
}

export function validateLegalDocumentPdfPageLayout(chunk, isLast, pageH, topY, lineH, normalBottom, lastPageBottom) {
  const bottomLimit = lastPageBottom;
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
  const footerTop = pageH - PDF_FOOTER_RESERVE_MM + 2;
  if (y > footerTop - 0.8) {
    return { valid: false, reason: "footer_overlap", contentEndY: y, footerTop };
  }
  if (topY < 10) {
    return { valid: false, reason: "header_overlap" };
  }
  return { valid: true, contentEndY: y, bottomLimit };
}

/** @param {string} _documentTitle @param {string} plainText */
export function buildLegalDocumentPreviewHtml(_documentTitle, plainText) {
  const structure = parseLegalDocumentVisualStructure(plainText);
  const partyLabels = inferPartyLabelsFromSections(structure.sections);
  const sectionsHtml = structure.sections.map((sec) => buildSectionHtml(sec, partyLabels)).join("");
  const titleHtml = structure.title
    ? '<h1 class="iu-legal-doc-paper__docTitle">' + escHtml(structure.title) + "</h1>"
    : "";
  const subtitleHtml = structure.subtitle
    ? '<p class="iu-legal-doc-paper__docSubtitle">' + escHtml(structure.subtitle).replace(/\n/g, "<br>") + "</p>"
    : "";

  return (
    '<article class="iu-legal-doc-paper" data-iu-legal-doc-paper="1" data-iu-legal-a4="1">' +
    '<div class="iu-legal-doc-paper__bar" data-iu-legal-doc-visual-only="1" aria-hidden="true"></div>' +
    buildLegalDocumentHeaderHtml() +
    '<div class="iu-legal-doc-paper__rule" data-iu-legal-doc-visual-only="1" aria-hidden="true"></div>' +
    '<div class="iu-legal-doc-paper__titleBlock">' +
    titleHtml +
    subtitleHtml +
    "</div>" +
    '<div class="iu-legal-doc-paper__sections">' +
    sectionsHtml +
    "</div>" +
    '<pre class="iu-legal-doc-paper__body iu-legal-doc-paper__body--source" data-iu-legal-doc-body hidden aria-hidden="true">' +
    escHtml(structure.sourceText || "") +
    "</pre>" +
    '<div class="iu-legal-doc-paper__rule iu-legal-doc-paper__rule--foot" data-iu-legal-doc-visual-only="1" aria-hidden="true"></div>' +
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

function drawTopbarBrandInPdf(doc, marginX, baseY) {
  const fontName = doc.getFont().fontName;
  doc.setTextColor(11, 31, 51);
  doc.setFontSize(14);
  let x = marginX;
  doc.setFont(fontName, "normal");
  doc.text("info", x, baseY);
  x += doc.getTextWidth("info");
  const rgb = hexToRgb(IU_LEGAL_DOC_GREEN);
  doc.setTextColor(rgb[0], rgb[1], rgb[2]);
  doc.setFont(fontName, "bold");
  doc.text("Uzel", x, baseY);
  x += doc.getTextWidth("Uzel");
  doc.setTextColor(11, 31, 51);
  doc.setFont(fontName, "normal");
  doc.text(".cz", x, baseY);
}

function drawPageHeader(doc, pageW, pageNum, totalPages, marginX) {
  const rgb = hexToRgb(IU_LEGAL_DOC_GREEN);
  doc.setFillColor(rgb[0], rgb[1], rgb[2]);
  doc.rect(0, 0, pageW, 1.2, "F");

  doc.setFontSize(6.5);
  doc.setTextColor(100, 116, 139);
  doc.setFont(doc.getFont().fontName, "normal");
  doc.text(IU_LEGAL_DOC_TOP_CREATED, marginX, 5.2);

  drawTopbarBrandInPdf(doc, marginX, 11.5);

  doc.setFontSize(7.5);
  doc.setTextColor(100, 116, 139);
  doc.text(IU_LEGAL_DOC_HEADER_SUBTITLE, marginX, 15.5);

  doc.setFontSize(7);
  doc.setTextColor(8, 122, 58);
  doc.text("Spolehlivé dokumenty", pageW - marginX, 10.5, { align: "right" });
  doc.setFontSize(6.5);
  doc.setTextColor(100, 116, 139);
  doc.text("rychle a jednoduše", pageW - marginX, 14, { align: "right" });

  doc.setDrawColor(rgb[0], rgb[1], rgb[2]);
  doc.setLineWidth(0.25);
  doc.line(marginX, 18.5, pageW - marginX, 18.5);

  doc.setDrawColor(209, 213, 219);
  doc.setLineWidth(0.15);
  doc.line(marginX, 19.8, pageW - marginX, 19.8);

  if (totalPages > 1) {
    doc.setFontSize(6.5);
    doc.setTextColor(148, 163, 184);
    doc.text(String(pageNum) + " / " + String(totalPages), pageW - marginX, 5.2, { align: "right" });
  }
}

function drawDocumentFooterBlock(doc, pageW, pageH, marginX) {
  const rgb = hexToRgb(IU_LEGAL_DOC_GREEN);
  const footerTop = pageH - PDF_FOOTER_RESERVE_MM + 2;
  doc.setDrawColor(rgb[0], rgb[1], rgb[2]);
  doc.setLineWidth(0.2);
  doc.line(marginX, footerTop, pageW - marginX, footerTop);

  doc.setFontSize(7);
  doc.setTextColor(148, 163, 184);
  let y = footerTop + 4;
  IU_LEGAL_DOC_FOOTER_LINES.forEach((line, idx) => {
    if (idx === IU_LEGAL_DOC_FOOTER_LINES.length - 1) {
      doc.setTextColor(rgb[0], rgb[1], rgb[2]);
      doc.text(String(line), marginX, y);
      y += 3.2;
      return;
    }
    if (idx === 0) {
      doc.setFont(doc.getFont().fontName, "bold");
      doc.setTextColor(100, 116, 139);
    } else {
      doc.setFont(doc.getFont().fontName, "normal");
      doc.setTextColor(148, 163, 184);
    }
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

function drawSectionBarInPdf(doc, marginX, pageW, y, num, heading) {
  const rgb = hexToRgb(IU_LEGAL_DOC_GREEN);
  const dark = hexToRgb(IU_LEGAL_DOC_GREEN_DARK);
  const barH = 6.5;
  const boxW = 7;
  doc.setFillColor(rgb[0], rgb[1], rgb[2]);
  doc.rect(marginX, y - 4.2, boxW, barH, "F");
  doc.setFontSize(7.5);
  doc.setFont(doc.getFont().fontName, "bold");
  doc.setTextColor(255, 255, 255);
  const numLabel = num ? String(num) + "." : "•";
  doc.text(numLabel, marginX + boxW / 2, y + 0.2, { align: "center" });
  doc.setFillColor(232, 245, 237);
  doc.rect(marginX + boxW, y - 4.2, pageW - marginX * 2 - boxW, barH, "F");
  doc.setFontSize(7.5);
  doc.setFont(doc.getFont().fontName, "bold");
  doc.setTextColor(dark[0], dark[1], dark[2]);
  doc.text(String(heading || "").trim().toUpperCase(), marginX + boxW + 2.5, y + 0.2);
  return y + barH - 1.5;
}

function drawCenteredTitleInPdf(doc, pageW, marginX, y, title, subtitle) {
  const fontName = doc.getFont().fontName;
  doc.setFont(fontName, "bold");
  doc.setFontSize(13);
  doc.setTextColor(17, 24, 39);
  const titleLines = doc.splitTextToSize(String(title || "").trim(), pageW - marginX * 2);
  titleLines.forEach((line) => {
    doc.text(String(line), pageW / 2, y, { align: "center" });
    y += 5.5;
  });
  if (subtitle) {
    doc.setFont(fontName, "normal");
    doc.setFontSize(8.5);
    doc.setTextColor(75, 85, 99);
    const subLines = doc.splitTextToSize(String(subtitle).trim(), pageW - marginX * 2 - 10);
    subLines.forEach((line) => {
      doc.text(String(line), pageW / 2, y, { align: "center" });
      y += 4.2;
    });
  }
  return y + 2;
}

function itemHeightForPdf(item) {
  if (!item) return 4.8;
  const kind =
    item.kind ||
    (item.type === "sectionBar"
      ? "sectionBar"
      : item.type === "signatureBlock"
        ? "signature"
        : item.type === "gap"
          ? "gap"
          : item.type === "titleBlock"
            ? "titleBlock"
            : "text");
  if (kind === "sectionBar") return 8;
  if (kind === "signature") return 16;
  if (kind === "gap") return 2;
  if (kind === "titleBlock") {
    return 12 + (item.subtitle ? 8 : 0);
  }
  return item.heightMm || 4.8;
}

function buildPdfRenderQueue(structure, doc, maxW) {
  const queue = [];
  if (structure.title) {
    queue.push({ type: "titleBlock", title: structure.title, subtitle: structure.subtitle, heightMm: 0 });
  }
  structure.sections.forEach((section) => {
    if (section.isFreeBlock) {
      const lines = plainTextToLayoutLines(doc, section.body, maxW);
      lines.forEach((line) => queue.push({ type: "line", text: line, heightMm: 4.8 }));
      queue.push({ type: "gap", heightMm: 2.5 });
      return;
    }
    if (section.heading) {
      queue.push({ type: "sectionBar", num: section.num, heading: section.heading, heightMm: 8.5 });
    }
    if (section.isSignatures) {
      queue.push({ type: "signatureBlock", body: section.body, heightMm: 16 });
      return;
    }
    const lines = plainTextToLayoutLines(doc, section.body, maxW);
    lines.forEach((line) => queue.push({ type: "line", text: line, heightMm: 4.8 }));
    queue.push({ type: "gap", heightMm: 2.5 });
  });
  return queue;
}

function paginatePdfQueue(queue, topY, bottomY, titleBlock) {
  const pages = [];
  let current = [];
  let y = topY;

  function flush() {
    if (current.length) pages.push(current);
    current = [];
    y = topY;
  }

  if (titleBlock) {
    const titleItem = {
      type: "titleBlock",
      title: titleBlock.title,
      subtitle: titleBlock.subtitle,
    };
    const need = itemHeightForPdf(titleItem);
    current.push(titleItem);
    y += need;
  }

  queue.forEach((item) => {
    const need = itemHeightForPdf(item);
    if (y + need > bottomY && current.length) flush();
    current.push(item);
    y += need;
  });

  if (current.length) pages.push(current);
  if (!pages.length) pages.push([]);
  return pages;
}

function renderPdfQueuePage(doc, pageW, marginX, topY, bottomY, queue, partyLabels) {
  let y = topY;
  queue.forEach((item) => {
    if (item.type === "titleBlock") {
      y = drawCenteredTitleInPdf(doc, pageW, marginX, y, item.title, item.subtitle);
      return;
    }
    if (item.type === "sectionBar") {
      y = drawSectionBarInPdf(doc, marginX, pageW, y, item.num, item.heading);
      return;
    }
    if (item.type === "signatureBlock") {
      if (y + 16 > bottomY) return;
      const labels = partyLabels || { a: "Strana A", b: "Strana B" };
      const colW = (pageW - marginX * 2 - 8) / 2;
      doc.setDrawColor(17, 24, 39);
      doc.setLineWidth(0.25);
      doc.line(marginX, y + 8, marginX + colW, y + 8);
      doc.line(marginX + colW + 8, y + 8, pageW - marginX, y + 8);
      doc.setFontSize(8);
      doc.setTextColor(75, 85, 99);
      doc.text(String(labels.a), marginX + colW / 2, y + 12, { align: "center" });
      doc.text(String(labels.b), marginX + colW + 8 + colW / 2, y + 12, { align: "center" });
      y += 16;
      return;
    }
    if (item.type === "gap") {
      y += item.heightMm || 2.5;
      return;
    }
    if (y + 4.8 > bottomY) return;
    doc.setFontSize(10);
    doc.setFont(doc.getFont().fontName, "normal");
    doc.setTextColor(17, 24, 39);
    doc.text(String(item.text || ""), marginX, y);
    y += item.heightMm || 4.8;
  });
  return y;
}

/** @param {string} documentTitle @param {string} plainText */
export async function exportLegalDocumentPdfBlob(documentTitle, plainText) {
  const sourceText = String(plainText || "");
  const visualText = filterEmptySectionsForVisualOutput(sourceText);
  const structure = parseLegalDocumentVisualStructure(sourceText);
  const partyLabels = inferPartyLabelsFromSections(structure.sections);
  const jsPDF = await loadJsPDF();
  const b64 = await loadFontBase64();
  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  const fontMode = registerFont(doc, b64);

  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const marginX = 16;
  const topY = PDF_HEADER_RESERVE_MM;
  const contentBottom = pageH - PDF_FOOTER_RESERVE_MM;
  const maxW = pageW - marginX * 2;
  const bodyQueue = buildPdfRenderQueue(structure, doc, maxW).filter((item) => item.type !== "titleBlock");
  const titleBlock = structure.title
    ? { type: "titleBlock", title: structure.title, subtitle: structure.subtitle }
    : null;
  const pages = paginatePdfQueue(bodyQueue, topY, contentBottom, titleBlock);
  let layoutValid = true;

  pages.forEach((chunk, idx) => {
    if (idx > 0) doc.addPage();
    drawPageHeader(doc, pageW, idx + 1, pages.length, marginX);
    renderPdfQueuePage(doc, pageW, marginX, topY, contentBottom, chunk, partyLabels);
    drawDocumentFooterBlock(doc, pageW, pageH, marginX);
  });

  const allLines = trimTrailingEmptyLines(plainTextToLayoutLines(doc, visualText, maxW));
  const layoutCheck = validateLegalDocumentPdfPageLayout(
    allLines.slice(0, Math.max(1, Math.floor((contentBottom - topY) / 4.8))),
    true,
    pageH,
    topY,
    4.8,
    contentBottom,
    contentBottom,
  );
  if (!layoutCheck.valid && pages.length === 1) {
    layoutValid = false;
  }

  const blob = doc.output("blob");
  return {
    blob,
    fileName: slugFileName(documentTitle),
    sourceText,
    visualText,
    contentIdentical: sourceText === plainText,
    pageCount: pages.length,
    layoutValid,
    layoutLines: allLines.length,
    fontMode,
    lastPageHasRealContent: pages.length ? chunkHasContent(pages[pages.length - 1]) : false,
  };
}

function chunkHasContent(chunk) {
  return (chunk || []).some((item) => {
    if (item.type === "line") return String(item.text || "").trim().length > 0;
    if (item.type === "titleBlock") return String(item.title || "").trim().length > 0;
    if (item.type === "sectionBar") return true;
    return false;
  });
}
