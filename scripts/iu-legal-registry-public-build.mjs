/**
 * Build public-safe legal sources registry for /zdroje-a-licence/.
 * Authoritative input: projects/data/info_events/legal_source_registry.json
 * Output: legal_source_registry.public.json (allowlisted fields only) + embed snapshot in HTML.
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { APPROVED_STATUSES, loadLegalRegistry } from "./iu-info-events-legal-registry-lib.mjs";

const __filename = fileURLToPath(import.meta.url);
const REPO = path.resolve(path.dirname(__filename), "..");

/** Explicit public allowlist — never publish other keys. */
export const PUBLIC_SOURCE_KEYS = Object.freeze([
  "id",
  "sourceId",
  "name",
  "category",
  "purpose",
  "status",
  "statusLabel",
  "licenseLabel",
  "licenseUrl",
  "termsUrl",
  "officialUrl",
  "attribution",
  "transformations",
  "lastVerified",
]);

export const FORBIDDEN_PUBLIC_KEYS = Object.freeze([
  "token",
  "secret",
  "apiKey",
  "api_key",
  "credentials",
  "internalNotes",
  "legalNotes",
  "legalInternal",
  "rationale",
  "evidence",
  "contact",
  "internalEndpoint",
  "private",
  "fieldAllowlist",
  "commercialUseAllowed",
  "adSupportedUseAllowed",
]);

const STATUS_LABELS = {
  APPROVED_CC0: "Aktivní",
  APPROVED_CC_BY: "Aktivní",
  APPROVED_OPEN_DATA: "Aktivní",
  APPROVED_WITH_ATTRIBUTION: "Aktivní",
  APPROVED_WITH_SPECIFIC_CONDITIONS: "Aktivní",
  VERIFICATION_REQUIRED: "Ověření podmínek probíhá",
};

function pick(obj, keys) {
  const out = {};
  for (const k of keys) {
    if (obj[k] !== undefined && obj[k] !== null && obj[k] !== "") out[k] = obj[k];
  }
  return out;
}

function attributionFor(legal, entry) {
  const tpls = legal.attributionTemplates || {};
  for (const v of Object.values(tpls)) {
    if (v && v.id === entry.attributionTemplateId) {
      return String(v.template || "")
        .replace("{institution}", entry.institution || "")
        .replace("{datasetLabel}", entry.datasetLabel || "")
        .replace("{licenseLabel}", entry.licenseLabel || "")
        .replace("{licenseUrl}", entry.licenseUrl || "")
        .replace("{sourceUrl}", entry.distributionUrl || entry.catalogUrl || "");
    }
  }
  return "";
}

/**
 * Related UI data sources that are not part of info_events ingest,
 * but are used on Přehled dne / homepage. Honest legal status only.
 */
function relatedUiSources() {
  return [
    pick(
      {
        id: "ui-open-meteo",
        sourceId: "open-meteo",
        name: "Open-Meteo",
        category: "data-source",
        purpose: "Předpověď počasí v Přehledu dne (UI)",
        status: "VERIFICATION_REQUIRED",
        statusLabel: STATUS_LABELS.VERIFICATION_REQUIRED,
        licenseLabel:
          "Data: CC BY 4.0. Hostovaný Free API endpoint je dle podmínek Open-Meteo omezen na nekomerční použití; komerční provoz hosted API vyžaduje samostatné oprávnění.",
        licenseUrl: "https://open-meteo.com/en/licence",
        termsUrl: "https://open-meteo.com/en/terms",
        officialUrl: "https://open-meteo.com/",
        attribution: "Weather data by Open-Meteo.com (CC BY 4.0)",
        lastVerified: "2026-09-04",
      },
      PUBLIC_SOURCE_KEYS
    ),
  ];
}

export function buildPublicRegistry(legal = loadLegalRegistry(REPO)) {
  const approved = new Set(APPROVED_STATUSES);
  const sources = [];
  for (const e of legal.entries || []) {
    if (!e || e.productionSourceActive !== true || !approved.has(e.status)) continue;
    const row = pick(
      {
        id: e.id || e.sourceId,
        sourceId: e.sourceId,
        name: e.institution || e.providerLabel || e.sourceId,
        category: "data-source",
        purpose: e.datasetLabel
          ? "Informační položky Přehledu dne — " + e.datasetLabel
          : "Informační položky Přehledu dne (schválená metadata / link-only)",
        status: e.status,
        statusLabel: STATUS_LABELS[e.status] || "Aktivní",
        licenseLabel: e.licenseLabel || "",
        licenseUrl: e.licenseUrl || "",
        termsUrl: e.termsUrl || e.conditionsEvidenceUrl || e.licenseUrl || "",
        officialUrl: e.catalogUrl || e.distributionUrl || "",
        attribution: attributionFor(legal, e),
        transformations: Array.isArray(e.transformations) ? e.transformations : [],
        lastVerified: String(e.lastReviewedAt || "").slice(0, 10),
      },
      PUBLIC_SOURCE_KEYS
    );
    sources.push(row);
  }

  return {
    version: 1,
    schema: "iu-legal-source-registry-public-v1",
    generatedAt: new Date().toISOString(),
    scope:
      "Veřejný sanitizovaný výpis produkčně aktivních schválených zdrojů Přehledu dne + související UI datové služby.",
    sources,
    relatedUiSources: relatedUiSources(),
  };
}

export function assertPublicSafe(doc) {
  const blob = JSON.stringify(doc);
  for (const bad of FORBIDDEN_PUBLIC_KEYS) {
    if (new RegExp('"' + bad + '"\\s*:', "i").test(blob)) {
      throw new Error("forbidden_public_key:" + bad);
    }
  }
  for (const listName of ["sources", "relatedUiSources"]) {
    for (const row of doc[listName] || []) {
      for (const k of Object.keys(row)) {
        if (!PUBLIC_SOURCE_KEYS.includes(k)) throw new Error("non_allowlisted_key:" + listName + ":" + k);
      }
    }
  }
}

function embedSnapshot(html, publicDoc) {
  const json = JSON.stringify(publicDoc);
  const markerOpen = '<script type="application/json" id="iuLegalRegistrySnapshot">';
  const markerClose = "</script>";
  if (html.includes('id="iuLegalRegistrySnapshot"')) {
    return html.replace(
      /<script type="application\/json" id="iuLegalRegistrySnapshot">[\s\S]*?<\/script>/,
      markerOpen + json + markerClose
    );
  }
  return html.replace(
    '<script type="module">',
    markerOpen + json + markerClose + "\n    <script type=\"module\">"
  );
}

export function writePublicRegistryArtifacts(repoRoot = REPO) {
  const legal = loadLegalRegistry(repoRoot);
  const pub = buildPublicRegistry(legal);
  assertPublicSafe(pub);
  const outPath = path.join(repoRoot, "projects/data/info_events/legal_source_registry.public.json");
  fs.writeFileSync(outPath, JSON.stringify(pub, null, 2) + "\n", "utf8");
  const pagePath = path.join(repoRoot, "projects/zdroje-a-licence/index.html");
  let html = fs.readFileSync(pagePath, "utf8");
  html = embedSnapshot(html, pub);
  fs.writeFileSync(pagePath, html, "utf8");
  return { outPath, pagePath, count: pub.sources.length, related: pub.relatedUiSources.length };
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === __filename;
if (isMain) {
  const r = writePublicRegistryArtifacts();
  console.log(
    "[iu-legal-registry-public-build] OK sources=" +
      r.count +
      " relatedUi=" +
      r.related +
      " -> " +
      path.relative(REPO, r.outPath)
  );
}
