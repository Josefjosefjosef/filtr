#!/usr/bin/env node
/**
 * Phase 3Z V13 — static CJ-FIRST main-button catalog generator.
 *
 * CJ registry → MAIN_BUTTON_READY → deterministic static JSON.
 * Browser never calls CJ API. PUBLIC_SWAP stays DISARMED unless explicit GO.
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { isCjTrackingUrl, assertAllowedDataWrite } from "./iu-cj-affiliate-catalog-sync-publish-gate-v1.mjs";
import { parseAffiliateCatalogOrdered } from "./iu-cj-affiliate-phase2-partner-slot-inventory-v1.mjs";

export const PHASE3Z_STATIC_CATALOG_SCHEMA = "iu-affiliate-cj-main-buttons-static-v13";
export const PHASE3Z_STATIC_PREVIEW_SCHEMA = "iu-affiliate-cj-main-buttons-static-preview-v13";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function readJson(p, fallback = null) {
  try {
    if (!fs.existsSync(p)) return fallback;
    return JSON.parse(fs.readFileSync(p, "utf8"));
  } catch {
    return fallback;
  }
}

function writeJson(p, obj) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  const tmp = p + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(obj, null, 2) + "\n", "utf8");
  fs.renameSync(tmp, p);
}

function stableSortButtons(a, b) {
  const ta = String(a.title || "").localeCompare(String(b.title || ""), "cs", { sensitivity: "base" });
  if (ta !== 0) return ta;
  return String(a.advertiserId).localeCompare(String(b.advertiserId));
}

function sectionTitleMap(root = ROOT) {
  const catalogJs = path.join(root, "assets", "iu-affiliate-catalog.js");
  const ordered = parseAffiliateCatalogOrdered(fs.readFileSync(catalogJs, "utf8"));
  const map = new Map();
  for (const s of ordered?.sections || []) {
    map.set(String(s.sectionId), s.titleCs || s.title || s.sectionId);
  }
  return map;
}

/**
 * Build static main-button catalog from registry MAIN_BUTTON_READY partners.
 */
export function buildStaticMainButtonCatalog(registry, opts = {}) {
  const titles = opts.sectionTitles || new Map();
  const seen = new Set();
  const buttons = [];
  const blockers = [];
  const bySection = new Map();

  for (const p of registry?.partners || []) {
    const advId = String(p.advertiserId || "");
    const joined = String(p.relationshipStatus || "").toLowerCase() === "joined";
    if (!joined) continue;
    if (p.mainButtonReady !== true) {
      blockers.push({
        advertiserId: advId,
        name: p.displayNameCs || p.cjName || p.advertiserName || "",
        status: p.mainButtonStatus || "NOT_READY",
        blockers: p.mainButtonReadiness?.blockers || [],
        destinationType: p.destinationType || null,
        holdReason: p.holdReason || null,
        autoRetry: true,
      });
      continue;
    }
    if (!advId || seen.has(advId)) continue;
    const url = String(p.selectedClickUrl || "");
    const sectionId = String(p.sectionId || "");
    const title = String(p.displayNameCs || p.cjName || p.advertiserName || "").trim();
    if (!url || !isCjTrackingUrl(url) || !sectionId || !title) {
      blockers.push({
        advertiserId: advId,
        name: title,
        status: "TECHNICAL_INVALID",
        blockers: ["static_catalog_validation_failed"],
        autoRetry: true,
      });
      continue;
    }
    seen.add(advId);
    const button = {
      advertiserId: advId,
      title,
      url,
      sectionId,
      target: "_blank",
      rel: "sponsored noopener",
      source: "cj_first_main_button_v13",
      stableId: "cj-main-" + advId,
    };
    buttons.push(button);
    if (!bySection.has(sectionId)) bySection.set(sectionId, []);
    bySection.get(sectionId).push(button);
  }

  buttons.sort(stableSortButtons);
  const sections = [...bySection.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([sectionId, list]) => {
      const sorted = [...list].sort(stableSortButtons);
      return {
        sectionId,
        titleCs: titles.get(sectionId) || sectionId,
        buttonCount: sorted.length,
        buttons: sorted,
      };
    });

  const bodyForHash = JSON.stringify({
    schema: PHASE3Z_STATIC_CATALOG_SCHEMA,
    buttons: buttons.map((b) => ({
      advertiserId: b.advertiserId,
      title: b.title,
      url: b.url,
      sectionId: b.sectionId,
    })),
  });
  const sha256 = crypto.createHash("sha256").update(bodyForHash).digest("hex");

  const joined = (registry?.partners || []).filter(
    (p) => String(p.relationshipStatus || "").toLowerCase() === "joined"
  ).length;

  return {
    schema: PHASE3Z_STATIC_CATALOG_SCHEMA,
    version: 1,
    generatedAt: opts.generatedAt || new Date().toISOString(),
    websitePid: "101883843",
    publicButtonSwapArmed: false,
    liveEnabled: false,
    browserCjApiDependency: false,
    merchantWebCrawlRequiredForMainButton: false,
    couponProductRefactor: "DEFERRED",
    counts: {
      joined,
      mainButtonReady: buttons.length,
      missingMainButtons: blockers.length,
      sections: sections.length,
      buttons: buttons.length,
      duplicates: 0,
    },
    sectionCounts: Object.fromEntries(sections.map((s) => [s.sectionId, s.buttonCount])),
    sections,
    buttons,
    remainingBlockers: blockers,
    manifest: {
      sha256,
      buttonCount: buttons.length,
      sectionCount: sections.length,
      deterministic: true,
    },
    note: "Static pre-generated CJ main buttons. PUBLIC_SWAP DISARMED until explicit GO.",
  };
}

/** Preview wrapper — never arms swap; for visual/inventory QA only. */
export function buildStaticMainButtonPreview(catalog) {
  return {
    schema: PHASE3Z_STATIC_PREVIEW_SCHEMA,
    publicButtonSwapArmed: false,
    previewOnly: true,
    generatedAt: new Date().toISOString(),
    counts: catalog.counts,
    sectionCounts: catalog.sectionCounts,
    sections: catalog.sections,
    remainingBlockers: catalog.remainingBlockers,
    manifest: catalog.manifest,
    cssHints: {
      compactGeometryFrom: "radio_chip_dimensions_only",
      colorsFrom: "per_section_affiliate_accents",
      gateAttr: "data-iu-phase3z-chips=1",
      previewClass: "iuAffiliatePhase3zPreview",
    },
    buttonAttrs: { target: "_blank", rel: "sponsored noopener" },
  };
}

export function assertCatalogDeterministic(catalogA, catalogB) {
  return catalogA?.manifest?.sha256 && catalogA.manifest.sha256 === catalogB?.manifest?.sha256;
}

function main() {
  const argv = process.argv.slice(2);
  const regPath =
    process.env.IU_CJ_PHASE3Z_REGISTRY_PATH &&
    /projects[\\/]+data[\\/]+iu-affiliate-cj-partner-registry-v1\.json$/i.test(
      process.env.IU_CJ_PHASE3Z_REGISTRY_PATH
    )
      ? process.env.IU_CJ_PHASE3Z_REGISTRY_PATH
      : path.join(ROOT, "projects", "data", "iu-affiliate-cj-partner-registry-v1.json");
  const outStatic = path.join(ROOT, "projects", "data", "iu-affiliate-cj-main-buttons-static-v13.json");
  const outPreview = path.join(
    ROOT,
    "projects",
    "data",
    "iu-affiliate-cj-main-buttons-static-preview-v13.json"
  );

  const registry = readJson(regPath);
  if (!registry?.partners) {
    console.error(JSON.stringify({ ok: false, error: "registry_missing" }));
    process.exit(1);
  }

  const titles = sectionTitleMap(ROOT);
  const catalog = buildStaticMainButtonCatalog(registry, { sectionTitles: titles });
  const preview = buildStaticMainButtonPreview(catalog);
  const again = buildStaticMainButtonCatalog(registry, {
    sectionTitles: titles,
    generatedAt: catalog.generatedAt,
  });
  const deterministic = assertCatalogDeterministic(catalog, again);

  const writeRepo = argv.includes("--write-repo") || process.env.IU_CJ_PHASE3Z_WRITE_REPO === "1";
  if (writeRepo) {
    assertAllowedDataWrite(outStatic);
    assertAllowedDataWrite(outPreview);
    writeJson(outStatic, catalog);
    writeJson(outPreview, preview);
  }

  console.log(
    JSON.stringify(
      {
        ok: deterministic && catalog.publicButtonSwapArmed === false,
        wrote: writeRepo,
        deterministic,
        publicButtonSwapArmed: false,
        browserCjApiDependency: false,
        counts: catalog.counts,
        sectionCounts: catalog.sectionCounts,
        remainingBlockers: catalog.remainingBlockers,
        manifestSha256: catalog.manifest.sha256,
        outStatic: writeRepo ? outStatic : null,
        outPreview: writeRepo ? outPreview : null,
      },
      null,
      2
    )
  );
  if (!deterministic) process.exitCode = 2;
}

const isMain =
  process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) main();
