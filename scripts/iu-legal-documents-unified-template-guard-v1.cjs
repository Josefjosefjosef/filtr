#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");

const RENDERER = path.join(__dirname, "..", "assets", "iu-legal-documents-pdf-renderer.js");
const CSS = path.join(__dirname, "..", "assets", "iu-legal-documents-mobile-template-v1.css");
const INDEX = path.join(__dirname, "..", "projects", "index.html");
const REPORT = path.join(__dirname, "iu-legal-documents-unified-template-guard-v1-report.json");

const REQUIRED = [
  { id: "unified_template_marker", file: RENDERER, pattern: /iu-legal-documents-unified-template-v1/ },
  { id: "strip_parenthetical_bar_title", file: RENDERER, pattern: /function stripParentheticalForBarTitle|export function stripParentheticalForBarTitle/ },
  { id: "resolve_section_bar_segments_export", file: RENDERER, pattern: /export function resolveSectionBarSegments\(/ },
  { id: "format_field_content_html", file: RENDERER, pattern: /function formatFieldContentHtml\(/ },
  { id: "place_date_section_class", file: RENDERER, pattern: /iu-legal-doc-paper__section--placeDate/ },
  { id: "mobile_template_marker", file: CSS, pattern: /iu-legal-documents-mobile-template-v1/ },
  { id: "mobile_max_1024", file: CSS, pattern: /@media \(max-width: 1024px\)/ },
  { id: "pdf_section_bar_body_gap", file: RENDERER, pattern: /PDF_SECTION_BAR_BODY_GAP_MM/ },
  { id: "empty_section_num_html", file: RENDERER, pattern: /sectionNum" aria-hidden="true"><\/span>/ },
  { id: "section_body_padding_top", file: path.join(__dirname, "..", "assets", "iu-legal-documents-overlay.css"), pattern: /\.iu-legal-doc-paper__sectionBody\{[^}]*padding-top:\s*4px/ },
  { id: "index_css_link", file: INDEX, pattern: /iu-legal-documents-mobile-template-v1\.css/ },
  { id: "index_css_bump", file: INDEX, pattern: /legal-docs-mobile-template-v1-20260713/ },
];

function main() {
  const checks = REQUIRED.map((item) => {
    const src = fs.readFileSync(item.file, "utf8");
    return { id: item.id, pass: item.pattern.test(src) };
  });
  const pass = checks.every((c) => c.pass);
  const report = {
    guard: "IU_LEGAL_DOCUMENTS_UNIFIED_TEMPLATE_GUARD_V1",
    pass,
    checks,
    ts: new Date().toISOString(),
  };
  fs.writeFileSync(REPORT, JSON.stringify(report, null, 2) + "\n");
  process.stdout.write(JSON.stringify({ pass, failed: checks.filter((c) => !c.pass).map((c) => c.id) }) + "\n");
  if (!pass) process.exitCode = 1;
}

main();
