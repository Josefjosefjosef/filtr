/**
 * infoUzel.cz — vizuální náhled a PDF export právních dokumentů (browser-only, text beze změny).
 */
import { IU_BRAND_BLUE, IU_BRAND_BLUE_DARK, IU_BRAND_BLUE_LIGHT } from "./iu-brand-colors.js";

export const IU_LEGAL_DOC_GREEN = IU_BRAND_BLUE;
export const IU_LEGAL_DOC_GREEN_DARK = IU_BRAND_BLUE_DARK;
export const IU_LEGAL_DOC_GREEN_LIGHT = IU_BRAND_BLUE_LIGHT;
export const IU_LEGAL_DOC_TEXT = "#111827";
export const IU_LEGAL_DOC_TOP_CREATED = "Vytvořeno pomocí infoUzel.cz";
export const IU_LEGAL_DOC_HEADER_SUBTITLE = "Generátor dokumentů";
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
/** Výška modrého pruhu sekce v PDF (mm). */
const PDF_SECTION_BAR_H_MM = 6.5;
/** Mezera mezi spodkem modrého pruhu a prvním řádkem obsahu v PDF (mm). */
export const PDF_SECTION_BAR_BODY_GAP_MM = 4.5;
const PDF_SECTION_BAR_TOTAL_MM = PDF_SECTION_BAR_H_MM + PDF_SECTION_BAR_BODY_GAP_MM;
const PLACEHOLDER_ONLY_LINE_RE = /^[\.·…\s_,\-]+$/;
const SECTION_HEADING_RE = /^(\d+)\.\s+(.+)$/;
const SIGNATURE_LINE_RE = /^_{5,}/;
const GENERIC_PARTY_FALLBACK_RE = /^strana\s+[ab]$/i;
const PARTY_SECTION_HEADING_RE = /identifikace|strany|prohlásivící/i;

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
  if (h.length !== 6) return [0, 60, 255];
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

function isNumberedSectionStartLine(line) {
  return SECTION_HEADING_RE.test(String(line || "").trim());
}

function isSectionStartLine(line) {
  const trimmed = String(line || "").trim();
  return isNumberedSectionStartLine(trimmed) || isStructuralSectionHeading(trimmed);
}

function parseDocumentSectionsFromText(visualText) {
  const lines = String(visualText || "").split("\n");
  const titleLines = [];
  const sections = [];
  let mode = "title";
  let current = null;

  function pushCurrent() {
    if (!current) return;
    sections.push({
      num: current.num || "",
      heading: current.heading || "",
      body: current.bodyLines.join("\n").trim(),
      isSignatures: /^podpisy$/i.test(current.heading || ""),
      isPlaceDate: /^místo a datum$/i.test(current.heading || ""),
    });
    current = null;
  }

  lines.forEach((line) => {
    const trimmed = String(line || "").trim();
    if (mode === "title") {
      if (isSectionStartLine(trimmed)) {
        mode = "body";
        pushCurrent();
        const numbered = parseSectionHeading(trimmed);
        current = {
          num: numbered ? numbered.num : "",
          heading: numbered ? numbered.heading : trimmed,
          bodyLines: [],
        };
        return;
      }
      titleLines.push(line);
      return;
    }

    if (isSectionStartLine(trimmed)) {
      pushCurrent();
      const numbered = parseSectionHeading(trimmed);
      current = {
        num: numbered ? numbered.num : "",
        heading: numbered ? numbered.heading : trimmed,
        bodyLines: [],
      };
      return;
    }

    if (current) current.bodyLines.push(line);
  });

  pushCurrent();

  const title = String(titleLines[0] || "").trim();
  const subtitle = titleLines.slice(1).join("\n").trim();
  return { title, subtitle, sections };
}

/** Vizuální výstup/PDF: vynechá celé sekce bez uživatelských dat (bez úpravy zdrojového textu). */
export function filterEmptySectionsForVisualOutput(plainText) {
  const text = String(plainText || "");
  if (!text.trim()) return text;
  const parsed = parseDocumentSectionsFromText(text);
  const kept = parsed.sections.filter((section) => {
    const block = section.heading
      ? (section.num ? `${section.num}. ${section.heading}` : section.heading) + "\n\n" + section.body
      : section.body;
    return shouldKeepVisualBlock(block);
  });
  const parts = [];
  if (parsed.title) {
    parts.push(parsed.subtitle ? `${parsed.title}\n${parsed.subtitle}` : parsed.title);
  }
  kept.forEach((section) => {
    const head = section.num ? `${section.num}. ${section.heading}` : section.heading;
    parts.push(section.body ? `${head}\n\n${section.body}` : head);
  });
  return parts.join("\n\n");
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
  const parsed = parseDocumentSectionsFromText(visualText);
  if (!parsed.title && !parsed.sections.length) {
    return { title: "", subtitle: "", sections: [], sourceText: visualText };
  }
  return {
    title: parsed.title,
    subtitle: parsed.subtitle,
    sections: parsed.sections,
    sourceText: visualText,
  };
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

function isGenericPartyFallback(label) {
  return GENERIC_PARTY_FALLBACK_RE.test(String(label || "").trim());
}

function isPartyIdentificationSection(section) {
  if (!section) return false;
  if (section.num === "1") return true;
  if (PARTY_SECTION_HEADING_RE.test(String(section.heading || ""))) return true;
  return /identifikace/i.test(String(section.heading || ""));
}

function findPartyRoleLabels(body) {
  const lines = String(body || "").split("\n");
  const roles = [];
  for (let i = 0; i < lines.length; i++) {
    const s = String(lines[i] || "").trim();
    if (!s || s.indexOf(":") >= 0) continue;
    if (/^\(neuvedeno\)$/i.test(s)) continue;
    if (/^typ$/i.test(s)) continue;
    const next = String(lines[i + 1] || "").trim();
    if (/^typ(\s+subjektu)?:/i.test(next)) {
      if (roles.indexOf(s) < 0) roles.push(s);
    }
  }
  return roles;
}

function inferPartyLabelsFromPartyBody(body) {
  const roles = findPartyRoleLabels(body);
  if (roles.length >= 2) return { a: roles[0], b: roles[1] };
  if (roles.length === 1) return { a: roles[0], b: "" };
  const labels = [];
  const lines = String(body || "").split("\n");
  for (let j = 0; j < lines.length; j++) {
    const line = String(lines[j] || "").trim();
    if (!line || line.indexOf(":") >= 0) continue;
    if (/^typ$/i.test(line)) continue;
    if (/^\(neuvedeno\)$/i.test(line)) continue;
    if (labels.indexOf(line) < 0) labels.push(line);
    if (labels.length >= 2) break;
  }
  if (labels.length >= 2) return { a: labels[0], b: labels[1] };
  if (labels.length === 1) return { a: labels[0], b: "" };
  return { a: "Strana A", b: "Strana B" };
}

function extractPartySectionBodyFromPlainText(plainText) {
  const lines = String(plainText || "").split("\n");
  let inParty = false;
  const bodyLines = [];
  for (let i = 0; i < lines.length; i++) {
    const trimmed = String(lines[i] || "").trim();
    if (/^1\.\s+(Identifikace stran|Identifikace strany|Strany|Prohlásivší)/i.test(trimmed)) {
      inParty = true;
      continue;
    }
    if (inParty && /^\d+\.\s+/.test(trimmed)) break;
    if (inParty) bodyLines.push(lines[i]);
  }
  return bodyLines.join("\n").trim();
}

function inferPartyLabelsFromSections(sections) {
  for (let i = 0; i < sections.length; i++) {
    const sec = sections[i];
    if (!isPartyIdentificationSection(sec)) continue;
    const labels = inferPartyLabelsFromPartyBody(sec.body);
    if (labels.a !== "Strana A" || labels.b !== "Strana B") return labels;
    if (labels.a && labels.a !== "Strana A") return labels;
  }
  return { a: "Strana A", b: "Strana B" };
}

function extractPartyDisplayNameFromBlock(block) {
  const lines = String(block || "").split("\n");
  let first = "";
  let last = "";
  let company = "";
  let tradeName = "";
  let acting = "";
  lines.forEach((line) => {
    const s = String(line || "").trim();
    const fn = /^Jméno:\s*(.+)$/i.exec(s);
    if (fn) first = fn[1].trim();
    const ln = /^Příjmení:\s*(.+)$/i.exec(s);
    if (ln) last = ln[1].trim();
    const co = /^Obchodní firma.*:\s*(.+)$/i.exec(s);
    if (co) company = co[1].trim();
    const tf = /^Obchodní firma \(pokud používá\):\s*(.+)$/i.exec(s);
    if (tf) tradeName = tf[1].trim();
    const ap = /^Osoba jednající:\s*(.+)$/i.exec(s);
    if (ap) acting = ap[1].trim();
  });
  const personName = [first, last].filter(Boolean).join(" ");
  if (personName) return personName;
  if (acting) return acting;
  if (company) return company;
  if (tradeName) return tradeName;
  return "";
}

function splitPartyBlocks(body, labelA, labelB) {
  const roles = findPartyRoleLabels(body);
  const la = roles[0] || labelA;
  const lb = roles[1] || labelB;
  const lines = String(body || "").split("\n");
  const blocks = { a: [], b: [] };
  let current = "";
  lines.forEach((line) => {
    const s = String(line || "").trim();
    if (s === la) {
      current = "a";
      return;
    }
    if (lb && s === lb) {
      current = "b";
      return;
    }
    if (current === "a") blocks.a.push(line);
    if (current === "b") blocks.b.push(line);
  });
  return {
    a: blocks.a.join("\n"),
    b: blocks.b.join("\n"),
  };
}

function inferPartySignatureMeta(sections) {
  const labels = inferPartyLabelsFromSections(sections);
  const meta = { a: labels.a, b: labels.b || labels.a, nameA: "", nameB: "" };
  for (let i = 0; i < sections.length; i++) {
    const sec = sections[i];
    if (!isPartyIdentificationSection(sec)) continue;
    const blocks = splitPartyBlocks(sec.body, labels.a, labels.b);
    meta.nameA = extractPartyDisplayNameFromBlock(blocks.a);
    meta.nameB = extractPartyDisplayNameFromBlock(blocks.b);
    if (!labels.b) meta.b = "";
    break;
  }
  return meta;
}

/** @param {string} plainText */
export function derivePartySignatureMetaFromPlainText(plainText) {
  const rawBody = extractPartySectionBodyFromPlainText(plainText);
  if (rawBody) {
    const labels = inferPartyLabelsFromPartyBody(rawBody);
    const blocks = splitPartyBlocks(rawBody, labels.a, labels.b);
    const meta = {
      a: labels.a,
      b: labels.b || labels.a,
      nameA: extractPartyDisplayNameFromBlock(blocks.a),
      nameB: extractPartyDisplayNameFromBlock(blocks.b),
    };
    if (!labels.b) meta.b = "";
    return meta;
  }
  const structure = parseLegalDocumentVisualStructure(plainText);
  return inferPartySignatureMeta(structure.sections);
}

function shouldShowSecondSignatureColumn(labels) {
  if (labels.nameB) return true;
  if (labels.b && labels.b !== labels.a && !isGenericPartyFallback(labels.b)) return true;
  return false;
}

function resolveSignatureDisplayLabels(labels) {
  const meta = labels || { a: "Strana A", b: "Strana B", nameA: "", nameB: "" };
  const displayA = meta.nameA || meta.a;
  const displayB = meta.nameB || meta.b;
  return { displayA, displayB, showSecond: shouldShowSecondSignatureColumn(meta) };
}

function isPartyHeadingLine(line, partyMeta) {
  const s = String(line || "").trim();
  if (!s || s.indexOf(":") >= 0) return false;
  if (partyMeta && (s === partyMeta.a || s === partyMeta.b)) return true;
  return false;
}

function isFieldLabelLine(line) {
  const s = String(line || "").trim();
  if (!s || s.indexOf(":") >= 0) return false;
  if (/^\d+\.\s+/.test(s)) return false;
  if (isPlaceholderOnlyLine(s)) return false;
  if (/^_{5,}/.test(s)) return false;
  if (/^(podpisy|místo a datum|závěrečná)/i.test(s)) return false;
  return s.length <= 120;
}

/** Náhled/PDF: pomocný text v závorkách z názvu pruhu (formulářové popisky beze změny). */
export function stripParentheticalForBarTitle(text) {
  return String(text || "")
    .replace(/\s*\([^)]*\)/g, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function splitBodyIntoLabeledParts(body) {
  const chunks = String(body || "").split(/\n\n+/);
  const result = [];
  for (let c = 0; c < chunks.length; c += 1) {
    const chunk = String(chunks[c] || "").trim();
    if (!chunk) continue;
    const chunkLines = chunk.split("\n");
    const first = String(chunkLines[0] || "").trim();
    if (!first || first.indexOf(":") >= 0) continue;

    if (chunkLines.length === 1 && isFieldLabelLine(first)) {
      const nextChunk = c + 1 < chunks.length ? String(chunks[c + 1] || "").trim() : "";
      if (nextChunk && !isPlaceholderOnlyLine(nextChunk)) {
        result.push({ label: first, content: nextChunk });
        c += 1;
      }
      continue;
    }

    if (isFieldLabelLine(first)) {
      const rest = chunkLines.slice(1).join("\n").trim();
      if (rest && !isPlaceholderOnlyLine(rest)) {
        result.push({ label: first, content: rest });
      }
    }
  }
  return result;
}

function formatPlainContentHtml(text) {
  return escHtml(String(text || "")).replace(/\n/g, "<br>");
}

/** iu-legal-documents-unified-template-v1: jednotné modré pruhy pro každou vyplňovanou část (vč. stran). */
export function resolveSectionBarSegments(section) {
  const segments = [];
  const body = String((section && section.body) || "");
  const heading = String((section && section.heading) || "").trim();
  const num = String((section && section.num) || "");

  if (section && section.isSignatures) {
    segments.push({
      num,
      heading: stripParentheticalForBarTitle(heading || "Podpisy"),
      content: "",
      isSignatures: true,
      rawBody: body,
    });
    return segments;
  }

  const labeled = splitBodyIntoLabeledParts(body);
  if (labeled.length) {
    labeled.forEach((part, idx) => {
      let barNum = "";
      if (labeled.length === 1 && num) {
        barNum = num;
      }
      segments.push({
        num: barNum,
        heading: stripParentheticalForBarTitle(part.label),
        content: part.content,
      });
    });
    return segments;
  }

  if (heading) {
    segments.push({ num, heading: stripParentheticalForBarTitle(heading), content: body });
    return segments;
  }
  if (body.trim()) {
    segments.push({ num: "", heading: "", content: body, freeText: true });
  }
  return segments;
}

function resolveFreeBlockBarSegments(body) {
  const labeled = splitBodyIntoLabeledParts(body);
  if (!labeled.length) return [];
  return labeled.map((part) => ({
    num: "",
    heading: stripParentheticalForBarTitle(part.label),
    content: part.content,
  }));
}

function formatFieldContentHtml(text) {
  return String(text || "")
    .split("\n")
    .map((line) => {
      const trimmed = String(line || "").trim();
      if (!trimmed) return "";
      const colonIdx = trimmed.indexOf(":");
      if (colonIdx > 0 && colonIdx < 48) {
        const label = trimmed.slice(0, colonIdx + 1);
        const value = trimmed.slice(colonIdx + 1).trimStart();
        return (
          '<span class="iu-legal-doc-paper__fieldLabel">' +
          escHtml(label) +
          "</span>" +
          (value ? " " + escHtml(value) : "")
        );
      }
      return escHtml(line);
    })
    .filter(Boolean)
    .join("<br>");
}

function formatBodyHtml(text, partyMeta) {
  return formatFieldContentHtml(text);
}

function buildSectionBodyVisualHtml(section, partyMeta) {
  if (!section.body && !section.isSignatures) return "";
  const segments = resolveSectionBarSegments(section);
  let html = "";
  segments.forEach((seg) => {
    if (seg.isSignatures) {
      if (seg.heading) html += buildSectionBarHtml(seg.num, seg.heading);
      html += buildSignatureVisualHtml(seg.rawBody, partyMeta);
      return;
    }
    if (seg.heading) html += buildSectionBarHtml(seg.num, seg.heading);
    if (seg.content) {
      html +=
        '<div class="iu-legal-doc-paper__sectionBody">' + formatFieldContentHtml(seg.content) + "</div>";
    }
  });
  return html;
}

function pdfLineBlockHeight(doc, line, maxW) {
  const trimmed = String(line || "").trim();
  if (!trimmed) return 2.4;
  doc.setFontSize(10);
  const colonIdx = trimmed.indexOf(":");
  if (colonIdx > 0 && colonIdx < 48) {
    const label = trimmed.slice(0, colonIdx + 1);
    const value = trimmed.slice(colonIdx + 1).trimStart();
    const labelW = doc.getTextWidth(label + " ");
    const valueLines = value ? doc.splitTextToSize(value, Math.max(20, maxW - labelW)) : [""];
    return Math.max(4.8, valueLines.length * 4.8);
  }
  const wrapped = doc.splitTextToSize(String(line || ""), maxW);
  return Math.max(4.8, wrapped.length * 4.8);
}

function buildSectionBodyPdfItems(section, doc, maxW) {
  const items = [];
  const segments = resolveSectionBarSegments(section);
  segments.forEach((seg) => {
    if (seg.isSignatures) {
      if (seg.heading) {
        items.push({ type: "sectionBar", num: seg.num, heading: seg.heading, heightMm: PDF_SECTION_BAR_TOTAL_MM });
      }
      items.push({ type: "signatureBlock", body: seg.rawBody, heightMm: 20 });
      return;
    }
    if (seg.heading) {
      items.push({ type: "sectionBar", num: seg.num, heading: seg.heading, heightMm: PDF_SECTION_BAR_TOTAL_MM });
    }
    if (seg.content) {
      String(seg.content || "")
        .split("\n")
        .forEach((line) => {
          items.push({
            type: "line",
            text: line,
            heightMm: pdfLineBlockHeight(doc, line, maxW),
          });
        });
    }
  });
  return items;
}

function buildSectionBarHtml(_num, heading) {
  const title = stripParentheticalForBarTitle(String(heading || "")).toUpperCase();
  return (
    '<div class="iu-legal-doc-paper__sectionBar" data-iu-legal-doc-visual-only="1" aria-hidden="true">' +
    '<span class="iu-legal-doc-paper__sectionNum" aria-hidden="true"></span>' +
    '<span class="iu-legal-doc-paper__sectionTitle">' +
    escHtml(title) +
    "</span>" +
    "</div>"
  );
}

function buildSignatureVisualHtml(body, partyMeta) {
  const lines = String(body || "").split("\n");
  const sigLine = lines.find((line) => SIGNATURE_LINE_RE.test(String(line || "").trim()));
  const resolved = resolveSignatureDisplayLabels(partyMeta);
  const displayA = resolved.displayA;
  const displayB = resolved.displayB;
  if (!sigLine) {
    return '<div class="iu-legal-doc-paper__sectionBody">' + formatBodyHtml(body, partyMeta) + "</div>";
  }
  const secondCol =
    resolved.showSecond
      ? '<div class="iu-legal-doc-paper__signatureCol">' +
        '<span class="iu-legal-doc-paper__signatureLine" aria-hidden="true"></span>' +
        '<span class="iu-legal-doc-paper__signatureLabel">' +
        escHtml(displayB) +
        "</span>" +
        "</div>"
      : "";
  return (
    '<div class="iu-legal-doc-paper__signatureGrid' +
    (resolved.showSecond ? "" : " iu-legal-doc-paper__signatureGrid--single") +
    '" data-iu-legal-doc-visual-only="1">' +
    '<div class="iu-legal-doc-paper__signatureCol">' +
    '<span class="iu-legal-doc-paper__signatureLine" aria-hidden="true"></span>' +
    '<span class="iu-legal-doc-paper__signatureLabel">' +
    escHtml(displayA) +
    "</span>" +
    "</div>" +
    secondCol +
    "</div>" +
    '<pre class="iu-legal-doc-paper__signatureSource" aria-hidden="true">' +
    escHtml(sigLine) +
    "</pre>"
  );
}

function buildSectionHtml(section, partyMeta) {
  let sectionClass = "iu-legal-doc-paper__section";
  if (section.isPlaceDate) sectionClass += " iu-legal-doc-paper__section--placeDate";
  if (section.isSignatures) sectionClass += " iu-legal-doc-paper__section--signatures";
  if (section.isFreeBlock) {
    const segments = resolveFreeBlockBarSegments(section.body);
    if (segments.length) {
      const inner = segments
        .map((seg) => {
          return (
            buildSectionBarHtml(seg.num, seg.heading) +
            '<div class="iu-legal-doc-paper__sectionBody">' +
            formatFieldContentHtml(seg.content) +
            "</div>"
          );
        })
        .join("");
      return '<section class="' + sectionClass + '">' + inner + "</section>";
    }
    return (
      '<section class="' +
      sectionClass +
      '">' +
      '<div class="iu-legal-doc-paper__sectionBody">' +
      formatFieldContentHtml(section.body) +
      "</div>" +
      "</section>"
    );
  }
  const inner = buildSectionBodyVisualHtml(section, partyMeta);
  return '<section class="' + sectionClass + '">' + inner + "</section>";
}

function buildLegalDocumentHeaderHtml() {
  return (
    '<header class="iu-legal-doc-paper__header" data-iu-legal-doc-visual-only="1">' +
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
function breakLongUnspacedToken(token, maxChars) {
  const s = String(token || "");
  const limit = Math.max(8, maxChars || 24);
  if (s.length <= limit) return s;
  const chunks = [];
  for (let i = 0; i < s.length; i += limit) {
    chunks.push(s.slice(i, i + limit));
  }
  return chunks.join("\u200b");
}

export function plainTextToLayoutLines(doc, plainText, maxW) {
  const text = String(plainText || "");
  const sourceLines = text.split("\n");
  const out = [];
  const approxChars = Math.max(12, Math.floor(maxW / 2.1));
  sourceLines.forEach((line) => {
    if (!line) {
      out.push("");
      return;
    }
    const prepared = String(line)
      .split(/(\s+)/)
      .map((part) => {
        if (!part || /^\s+$/.test(part)) return part;
        if (part.length > approxChars && !/\s/.test(part)) return breakLongUnspacedToken(part, approxChars);
        return part;
      })
      .join("");
    const wrapped = doc.splitTextToSize(prepared, maxW);
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
  const partyMeta = derivePartySignatureMetaFromPlainText(plainText);
  const sectionsHtml = structure.sections.map((sec) => buildSectionHtml(sec, partyMeta)).join("");
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

  drawTopbarBrandInPdf(doc, marginX, 9.5);

  doc.setFontSize(7.5);
  doc.setTextColor(100, 116, 139);
  doc.setFont(doc.getFont().fontName, "normal");
  doc.text(IU_LEGAL_DOC_HEADER_SUBTITLE, marginX, 13.5);

  doc.setFontSize(7);
  const asideRgb = hexToRgb(IU_BRAND_BLUE);
  doc.setTextColor(asideRgb[0], asideRgb[1], asideRgb[2]);
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

function drawSectionBarInPdf(doc, marginX, pageW, y, _num, heading) {
  const rgb = hexToRgb(IU_LEGAL_DOC_GREEN);
  const dark = hexToRgb(IU_LEGAL_DOC_GREEN_DARK);
  const barH = PDF_SECTION_BAR_H_MM;
  const boxW = 7;
  const barTop = y;
  const textY = barTop + barH / 2 + 1.1;
  const titleStripW = pageW - marginX * 2 - boxW - 5;
  const titleText = stripParentheticalForBarTitle(String(heading || "")).toUpperCase();
  doc.setFillColor(rgb[0], rgb[1], rgb[2]);
  doc.rect(marginX, barTop, boxW, barH, "F");
  doc.setFillColor(230, 238, 255);
  doc.rect(marginX + boxW, barTop, pageW - marginX * 2 - boxW, barH, "F");
  doc.setTextColor(dark[0], dark[1], dark[2]);
  let titleFontSize = 7.5;
  doc.setFont(doc.getFont().fontName, "bold");
  doc.setFontSize(titleFontSize);
  while (titleFontSize > 5.5 && doc.getTextWidth(titleText) > titleStripW) {
    titleFontSize -= 0.4;
    doc.setFontSize(titleFontSize);
  }
  doc.text(titleText, marginX + boxW + 2.5, textY);
  return barTop + barH + PDF_SECTION_BAR_BODY_GAP_MM;
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
  if (kind === "sectionBar") return PDF_SECTION_BAR_TOTAL_MM;
  if (kind === "signature") return 20;
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
      const segments = resolveFreeBlockBarSegments(section.body);
      if (segments.length) {
        segments.forEach((seg) => {
          queue.push({ type: "sectionBar", num: seg.num, heading: seg.heading, heightMm: PDF_SECTION_BAR_TOTAL_MM });
          String(seg.content || "")
            .split("\n")
            .forEach((line) => {
              queue.push({
                type: "line",
                text: line,
                heightMm: pdfLineBlockHeight(doc, line, maxW),
              });
            });
        });
        queue.push({ type: "gap", heightMm: 2.5 });
        return;
      }
      const lines = plainTextToLayoutLines(doc, section.body, maxW);
      lines.forEach((line) => queue.push({ type: "line", text: line, heightMm: 4.8 }));
      queue.push({ type: "gap", heightMm: 2.5 });
      return;
    }
    const bodyItems = buildSectionBodyPdfItems(section, doc, maxW);
    bodyItems.forEach((item) => queue.push(item));
    queue.push({ type: "gap", heightMm: 2.5 });
  });
  return queue;
}

function bundleHeightForPdfItem(queue, index) {
  const item = queue[index];
  if (!item) return 0;
  let need = itemHeightForPdf(item);
  if (item.type === "sectionBar") {
    const next = queue[index + 1];
    if (next) need += itemHeightForPdf(next);
  }
  return need;
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
    if (y + need > bottomY && current.length) flush();
    current.push(titleItem);
    y += need;
  }

  for (let i = 0; i < queue.length; i += 1) {
    const item = queue[i];
    const need = bundleHeightForPdfItem(queue, i);
    if (y + need > bottomY && current.length) flush();
    current.push(item);
    y += itemHeightForPdf(item);
  }

  if (current.length) pages.push(current);
  if (!pages.length) pages.push([]);
  return pages;
}

function drawBodyLineInPdf(doc, marginX, y, line, partyMeta, maxW) {
  const text = String(line || "");
  const trimmed = text.trim();
  if (!trimmed) return y + 2.4;
  const fontName = doc.getFont().fontName;
  doc.setFontSize(10);
  doc.setTextColor(17, 24, 39);
  const contentW = maxW || doc.internal.pageSize.getWidth() - marginX * 2;
  const colonIdx = trimmed.indexOf(":");
  if (colonIdx > 0 && colonIdx < 48) {
    const label = trimmed.slice(0, colonIdx + 1);
    const value = trimmed.slice(colonIdx + 1).trimStart();
    doc.setFont(fontName, "bold");
    const labelW = doc.getTextWidth(label + " ");
    doc.setFont(fontName, "normal");
    const valueLines = value ? doc.splitTextToSize(value, Math.max(20, contentW - labelW)) : [""];
    valueLines.forEach((valueLine, idx) => {
      if (idx === 0) {
        doc.setFont(fontName, "bold");
        doc.text(label, marginX, y);
        doc.setFont(fontName, "normal");
        if (valueLine) doc.text(String(valueLine), marginX + labelW, y);
      } else {
        doc.text(String(valueLine), marginX + labelW, y);
      }
      y += 4.8;
    });
    return y;
  }
  doc.setFont(fontName, "normal");
  const wrapped = doc.splitTextToSize(text, contentW);
  wrapped.forEach((wl) => {
    doc.text(String(wl), marginX, y);
    y += 4.8;
  });
  return y;
}

function renderPdfQueuePage(doc, pageW, marginX, topY, bottomY, queue, partyMeta) {
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
      if (y + 20 > bottomY) return;
      const resolved = resolveSignatureDisplayLabels(partyMeta);
      const displayA = resolved.displayA;
      const displayB = resolved.displayB;
      const colW = resolved.showSecond ? (pageW - marginX * 2 - 8) / 2 : pageW - marginX * 2;
      doc.setDrawColor(17, 24, 39);
      doc.setLineWidth(0.25);
      doc.line(marginX, y + 8, marginX + colW, y + 8);
      if (resolved.showSecond) {
        doc.line(marginX + colW + 8, y + 8, pageW - marginX, y + 8);
      }
      doc.setFontSize(8);
      doc.setFont(doc.getFont().fontName, "bold");
      doc.setTextColor(55, 65, 81);
      doc.text(String(displayA), marginX + colW / 2, y + 12, { align: "center" });
      if (resolved.showSecond) {
        doc.text(String(displayB), marginX + colW + 8 + colW / 2, y + 12, { align: "center" });
      }
      y += 20;
      return;
    }
    if (item.type === "gap") {
      y += item.heightMm || 2.5;
      return;
    }
    if (y + (item.heightMm || 4.8) > bottomY) return;
    y = drawBodyLineInPdf(doc, marginX, y, item.text, partyMeta, pageW - marginX * 2);
  });
  return y;
}

/** @param {string} documentTitle @param {string} plainText */
export async function exportLegalDocumentPdfBlob(documentTitle, plainText) {
  const sourceText = String(plainText || "");
  const visualText = filterEmptySectionsForVisualOutput(sourceText);
  const structure = parseLegalDocumentVisualStructure(sourceText);
  const partyMeta = derivePartySignatureMetaFromPlainText(plainText);
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
    renderPdfQueuePage(doc, pageW, marginX, topY, contentBottom, chunk, partyMeta);
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
