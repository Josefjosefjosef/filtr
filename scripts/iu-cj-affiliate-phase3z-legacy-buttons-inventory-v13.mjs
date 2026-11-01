#!/usr/bin/env node
/**
 * Phase 3Z V13 — inventory of baked/static + managed/dynamic CJ buttons vs CJ-FIRST registry.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { isCjTrackingUrl, assertAllowedDataWrite } from "./iu-cj-affiliate-catalog-sync-publish-gate-v1.mjs";
import { parseAffiliateCatalogOrdered } from "./iu-cj-affiliate-phase2-partner-slot-inventory-v1.mjs";

export const PHASE3Z_LEGACY_INVENTORY_SCHEMA = "iu-affiliate-cj-legacy-buttons-inventory-v13";

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

function extractLinkId(url) {
  const m = String(url || "").match(/click-\d+-(\d+)/i);
  return m ? m[1] : null;
}

export function inventoryLegacyButtons({
  catalogJsText,
  registry = null,
  managedPublic = null,
  slotPolicy = null,
} = {}) {
  const ordered = parseAffiliateCatalogOrdered(catalogJsText || "");
  const regById = new Map(
    (registry?.partners || []).map((p) => [String(p.advertiserId), p])
  );
  const managedById = new Map(
    (managedPublic?.partners || []).map((p) => [String(p.advertiserId), p])
  );
  const paidOrManual = new Set();
  for (const p of slotPolicy?.partners || []) {
    const mgmt = String(p.management || "").toUpperCase();
    if (mgmt === "PAID_RESERVED" || mgmt === "MANUAL_PROTECTED") {
      if (p.advertiserId != null) paidOrManual.add(String(p.advertiserId));
    }
  }

  const baked = [];
  let bakedCj = 0;
  let bakedNonCj = 0;
  for (const sec of ordered?.sections || []) {
    for (const it of sec.items || []) {
      if (it.kind && it.kind !== "partner") continue;
      const url = String(it.url || "");
      const cj = isCjTrackingUrl(url);
      const advId = it.advertiserId != null ? String(it.advertiserId) : null;
      const reg = advId ? regById.get(advId) : null;
      const row = {
        origin: "baked_static",
        sectionId: sec.sectionId,
        title: it.title || "",
        url,
        advertiserId: advId,
        isCjTracking: cj,
        linkId: extractLinkId(url),
        inRegistry: Boolean(reg),
        mainButtonReady: reg?.mainButtonReady === true,
        registrySectionId: reg?.sectionId || null,
        protectedPaidOrManual: advId ? paidOrManual.has(advId) : false,
        publiclyRendered: true,
        replacement: reg?.mainButtonReady
          ? {
              advertiserId: advId,
              sectionId: reg.sectionId,
              url: reg.selectedClickUrl,
              decision: "MIGRATE_TO_STATIC_CATALOG_ON_SWAP",
            }
          : cj
            ? { decision: "DEFER_UNTIL_AUTHORIZED_OR_ENDED" }
            : { decision: "KEEP_NON_CJ" },
        removalAfterSwap: cj && !paidOrManual.has(String(advId || "")),
      };
      baked.push(row);
      if (cj) bakedCj += 1;
      else bakedNonCj += 1;
    }
  }

  const managed = [];
  for (const [advId, p] of managedById) {
    const reg = regById.get(advId);
    const url = String(p.url || "");
    managed.push({
      origin: "managed_dynamic",
      sectionId: p.sectionId || null,
      title: p.title || "",
      url,
      advertiserId: advId,
      isCjTracking: isCjTrackingUrl(url),
      active: p.active !== false,
      inRegistry: Boolean(reg),
      mainButtonReady: reg?.mainButtonReady === true,
      protectedPaidOrManual: paidOrManual.has(advId),
      publiclyRendered: p.active !== false,
      replacement: reg?.mainButtonReady
        ? {
            advertiserId: advId,
            sectionId: reg.sectionId,
            url: reg.selectedClickUrl,
            decision: "MIGRATE_TO_STATIC_CATALOG_ON_SWAP",
          }
        : { decision: "DEFER_UNTIL_AUTHORIZED_OR_ENDED" },
      removalAfterSwap: true,
    });
  }

  const bakedIds = new Set(baked.filter((b) => b.advertiserId).map((b) => b.advertiserId));
  const managedIds = new Set(managed.map((m) => m.advertiserId));
  const overlap = [...bakedIds].filter((id) => managedIds.has(id));

  const cleanupDecisions = [
    {
      id: "baked_cj_chips",
      decision: "DEFER_UNTIL_SWAP",
      role: "Production baked CJ partner chips in assets/iu-affiliate-catalog.js",
      note: "Remain active until explicit PUBLIC_SWAP GO; then replaced by static catalog",
    },
    {
      id: "managed_public_overlay",
      decision: "DEFER_UNTIL_SWAP",
      role: "Runtime overlay iu-affiliate-cj-managed-public-v1.json",
      note: "After swap, CJ chips come only from static catalog; overlay CJ path retired",
    },
    {
      id: "static_main_catalog_v13",
      decision: "KEEP",
      role: "Authoritative pre-generated CJ main buttons",
      note: "Single post-swap CJ renderer source",
    },
    {
      id: "non_cj_and_paid",
      decision: "KEEP",
      role: "Non-CJ links and PAID_RESERVED / MANUAL_PROTECTED",
      note: "Never removed by CJ swap",
    },
    {
      id: "deep_content_crawl_main_gate",
      decision: "KEEP",
      role: "Crawl retained for future coupon/product phase only",
      note: "Must not gate MAIN_BUTTON_READY",
    },
  ];

  return {
    schema: PHASE3Z_LEGACY_INVENTORY_SCHEMA,
    publicButtonSwapArmed: false,
    counts: {
      bakedTotal: baked.length,
      bakedCj,
      bakedNonCj,
      managedDynamic: managed.length,
      overlapBakedAndManaged: overlap.length,
      registryJoined: (registry?.partners || []).filter(
        (p) => String(p.relationshipStatus || "").toLowerCase() === "joined"
      ).length,
      registryMainButtonReady: (registry?.partners || []).filter((p) => p.mainButtonReady === true)
        .length,
    },
    overlapAdvertiserIds: overlap,
    baked,
    managed,
    cleanupDecisions,
    singlePostSwapCjRenderer: "iu-affiliate-cj-main-buttons-static-v13.json",
    note: "Inventory only — no public swap. Dual CJ render paths remain until explicit GO.",
  };
}

function main() {
  const argv = process.argv.slice(2);
  const catalogJs = fs.readFileSync(path.join(ROOT, "assets", "iu-affiliate-catalog.js"), "utf8");
  const registry = readJson(path.join(ROOT, "projects", "data", "iu-affiliate-cj-partner-registry-v1.json"));
  const managedPublic = readJson(
    path.join(ROOT, "projects", "data", "iu-affiliate-cj-managed-public-v1.json")
  );
  const slotPolicy = readJson(path.join(ROOT, "projects", "data", "iu-affiliate-slot-policy-v1.json"));
  const inv = inventoryLegacyButtons({ catalogJsText: catalogJs, registry, managedPublic, slotPolicy });
  const out = path.join(ROOT, "projects", "data", "iu-affiliate-cj-legacy-buttons-inventory-v13.json");
  const writeRepo = argv.includes("--write-repo") || process.env.IU_CJ_PHASE3Z_WRITE_REPO === "1";
  if (writeRepo) {
    assertAllowedDataWrite(out);
    writeJson(out, inv);
  }
  console.log(
    JSON.stringify(
      {
        ok: true,
        wrote: writeRepo,
        publicButtonSwapArmed: false,
        counts: inv.counts,
        overlap: inv.overlapAdvertiserIds.length,
        cleanupDecisions: inv.cleanupDecisions.map((d) => d.id + ":" + d.decision),
        out: writeRepo ? out : null,
      },
      null,
      2
    )
  );
}

const isMain =
  process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) main();
