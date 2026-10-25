#!/usr/bin/env node
/**
 * Phase 3E — evidence-based CJ partner reconciliation (fetch ≠ publish).
 *
 * Assigns sectionId only from:
 *  1) existing managed-public / slot-policy section
 *  2) existing catalog button (normalized name match; unique section)
 *  3) conservative unambiguous CJ category → section (rare)
 *
 * Never invents categories. Never mutates catalog JS / MANUAL_PROTECTED.
 * Never arms liveEnabled / R2 publish.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  CJ_ADVERTISER_LOOKUP_BASE,
  clearCjEnvFromProcess,
  cjGet,
  finishNodeProcessAfterNetwork,
  parseAdvertiserBlocks,
  parseAdvertiserRecord,
  parseListMeta,
  readJson,
} from "./iu-cj-affiliate-phase1-lib.mjs";
import { readCjPatFromEnv } from "./iu-cj-affiliate-phase2-cj-api-adapter.mjs";
import {
  buildCatalogSlotInventory,
  parseAffiliateCatalogOrdered,
} from "./iu-cj-affiliate-phase2-partner-slot-inventory-v1.mjs";
import { reconcilePartners } from "./iu-cj-affiliate-phase3d-complete-validation-v1.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function redact(s, pat) {
  const p = String(pat || "");
  let out = String(s || "");
  if (p) out = out.split(p).join("[REDACTED_PAT]");
  return out;
}

/** Unambiguous CJ parent/child → section (only when single safe target). */
export const CJ_CATEGORY_SECTION_EVIDENCE = Object.freeze({
  "food & drinks|groceries": {
    sectionId: "aff-jidlo",
    reason: "cj_category_food_drinks_groceries",
  },
  "travel|hotel": {
    sectionId: "aff-ubytovani-hotely",
    reason: "cj_category_travel_hotel",
  },
  "accessories|shoes": {
    sectionId: "aff-boty",
    reason: "cj_category_accessories_shoes",
  },
  "beauty|cosmetics": {
    sectionId: "aff-kosmetika",
    reason: "cj_category_beauty_cosmetics",
  },
  "beauty|fragrance": {
    sectionId: "aff-kosmetika",
    reason: "cj_category_beauty_fragrance",
  },
  "home & garden|pets": {
    sectionId: "aff-zvirata",
    reason: "cj_category_home_garden_pets",
  },
});

export function normalizePartnerBrand(s) {
  return String(s || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/[''`´]/g, "")
    .replace(/\.cz|\.sk|\.com|\.eu|\.net/g, "")
    .replace(
      /\b(europe|international|int|central and eastern europe|cz\/sk\/hu|cz\/sk|pl\/ro|cz|sk|hu|us|eu|pl|ro)\b/g,
      ""
    )
    .replace(/[^a-z0-9]+/g, "")
    .trim();
}

export function parseCjPrimaryCategory(raw) {
  const s = String(raw || "");
  const parent = ((s.match(/<parent>(.*?)<\/parent>/i) || [])[1] || "")
    .replace(/&amp;/g, "&")
    .trim();
  const child = ((s.match(/<child>(.*?)<\/child>/i) || [])[1] || "")
    .replace(/&amp;/g, "&")
    .trim();
  return { parent, child, key: (parent + "|" + child).toLowerCase() };
}

export function buildCatalogBrandIndex(catalogOrdered) {
  const byNorm = new Map();
  for (const sec of catalogOrdered.sections || []) {
    for (const it of sec.items || []) {
      if (!it.title || !it.url) continue;
      const variants = [it.title];
      // Dual titles like "A/B" — index first brand too
      if (String(it.title).includes("/")) {
        variants.push(String(it.title).split("/")[0]);
      }
      for (const title of variants) {
        const n = normalizePartnerBrand(title);
        if (n.length < 4) continue;
        const row = {
          sectionId: sec.sectionId,
          title: it.title,
          url: it.url,
          advertiserId: it.advertiserId || null,
        };
        if (!byNorm.has(n)) byNorm.set(n, []);
        const list = byNorm.get(n);
        if (!list.some((x) => x.sectionId === row.sectionId && x.title === row.title)) {
          list.push(row);
        }
      }
    }
  }
  return byNorm;
}

function brandLookup(byNorm, partnerName) {
  const raw = String(partnerName || "");
  const candidates = [raw];
  if (raw.includes("/")) candidates.push(raw.split("/")[0]);
  for (const c of candidates) {
    let n = normalizePartnerBrand(c);
    if (n.length < 4) continue;
    if (byNorm.has(n)) return { norm: n, hits: byNorm.get(n) };
    const stripped = n.replace(/eshop$|shop$/, "");
    if (stripped.length >= 4 && byNorm.has(stripped)) {
      return { norm: stripped, hits: byNorm.get(stripped) };
    }
  }
  return null;
}

/**
 * Propose section assignments for MANUAL_REVIEW partners using evidence only.
 */
export function proposeSectionAssignments({
  joined = [],
  managedPartners = [],
  slotPolicyPartners = [],
  catalogSrc = null,
  existingSectionMap = {},
}) {
  const src =
    catalogSrc != null
      ? catalogSrc
      : fs.readFileSync(path.join(ROOT, "assets", "iu-affiliate-catalog.js"), "utf8");
  const catalogOrdered = parseAffiliateCatalogOrdered(src);
  const inv = buildCatalogSlotInventory({ catalogSrc: src });
  const brandIndex = buildCatalogBrandIndex(catalogOrdered);

  const baseRecon = reconcilePartners({
    joined,
    managedPartners,
    slotPolicyPartners,
    inventory: inv,
    sectionMap: existingSectionMap,
  });

  const autoAssigned = [];
  const stillManual = [];
  const sectionMapOut = { ...stripMeta(existingSectionMap) };

  for (const row of baseRecon.manualReview || []) {
    const cat = parseCjPrimaryCategory(row.primaryCategory);
    const lookup = brandLookup(brandIndex, row.partnerName);
    const uniqueSections = lookup
      ? [...new Set(lookup.hits.map((h) => h.sectionId))]
      : [];

    if (uniqueSections.length === 1) {
      const hit = lookup.hits[0];
      const decision = {
        advertiserId: row.advertiserId,
        partnerName: row.partnerName,
        sectionId: uniqueSections[0],
        evidence: "catalog_existing_button_normalized_name",
        catalogTitle: hit.title,
        relationshipStatus: row.relationshipStatus,
        primaryCategory: row.primaryCategory,
        confidence: "high",
      };
      autoAssigned.push(decision);
      sectionMapOut[row.advertiserId] = uniqueSections[0];
      continue;
    }

    if (uniqueSections.length > 1) {
      stillManual.push({
        ...row,
        reason: "catalog_multi_section_collision",
        candidateSections: uniqueSections,
        catalogHits: lookup.hits,
        note: "Partner name matches multiple catalog sections — keep MANUAL_REVIEW",
      });
      continue;
    }

    const catHit = CJ_CATEGORY_SECTION_EVIDENCE[cat.key];
    if (catHit) {
      const decision = {
        advertiserId: row.advertiserId,
        partnerName: row.partnerName,
        sectionId: catHit.sectionId,
        evidence: catHit.reason,
        catalogTitle: null,
        relationshipStatus: row.relationshipStatus,
        primaryCategory: row.primaryCategory,
        confidence: "medium",
      };
      autoAssigned.push(decision);
      sectionMapOut[row.advertiserId] = catHit.sectionId;
      continue;
    }

    const options = suggestManualOptions(cat);
    stillManual.push({
      ...row,
      reason: "unmapped_no_trusted_section",
      candidateSections: options,
      note: "Insufficient evidence for automatic section; options listed without preference",
    });
  }

  // Re-run reconcile with new section map
  const finalRecon = reconcilePartners({
    joined,
    managedPartners,
    slotPolicyPartners,
    inventory: inv,
    sectionMap: sectionMapOut,
  });

  return {
    ok: true,
    liveEnabled: false,
    publishArmed: false,
    catalogMutated: false,
    joinedCount: (joined || []).length,
    autoAssignedCount: autoAssigned.length,
    stillManualReviewCount: stillManual.length,
    autoAssigned,
    stillManualReview: stillManual,
    sectionMap: sectionMapOut,
    reconciliation: finalRecon,
    capacity: summarizeCapacity(inv),
    managedNotJoined: finalRecon.managedNotJoined,
    note:
      "Section map feeds unlimited dynamic overlay (Phase 3F). freeEmpty is informational only — not a gate. DISARMED.",
  };
}

function suggestManualOptions(cat) {
  const opts = [];
  const p = String(cat.parent || "").toLowerCase();
  const c = String(cat.child || "").toLowerCase();
  if (p.includes("education") || c.includes("children")) opts.push("aff-deti-hracky");
  if (p.includes("clothing") || p.includes("accessories")) {
    opts.push("aff-moda");
    if (c.includes("jewelry")) opts.push("aff-sperky-hodinky");
    if (c.includes("shoes")) opts.push("aff-boty");
  }
  if (p.includes("games") || c.includes("electronic games")) opts.push("aff-knihy");
  if (p.includes("sports")) {
    opts.push("aff-sport-outdoor");
    opts.push("aff-sportovni-obleceni");
  }
  return [...new Set(opts)];
}

function stripMeta(map) {
  const out = {};
  for (const [k, v] of Object.entries(map || {})) {
    if (k.startsWith("_")) continue;
    if (typeof v === "string" && v.startsWith("aff-")) out[k] = v;
  }
  return out;
}

export function summarizeCapacity(inventory) {
  const sections = (inventory.sections || []).map((s) => ({
    sectionId: s.sectionId,
    sectionTitle: s.sectionTitle,
    slotCount: (s.slots || []).length,
    occupied: s.occupiedCount,
    freeEmpty: s.freeEmptyCount,
    reserved: s.reservedCount,
    paid: s.paidCount || 0,
    blocked: s.blockedCount || 0,
  }));
  return {
    sectionCount: inventory.sectionCount,
    occupiedButtonCount: inventory.occupiedButtonCount,
    freeEmptySlotCount: inventory.freeEmptySlotCount,
    reservedSlotCount: inventory.reservedSlotCount,
    blockedSlotCount: inventory.blockedSlotCount || 0,
    paidSlotCount: inventory.paidSlotCount || 0,
    emptySections: sections.filter((s) => s.slotCount === 0).map((s) => s.sectionId),
    sections,
    uiNote:
      "Phase 3F: dynamic CJ_MANAGED buttons append via managed-public overlay with NO freeEmpty / overflow limit. MANUAL_PROTECTED / paid positions stay immutable.",
    dynamicModel: "unlimited_overlay",
    businessProposal: {
      overflowCatalogOutsidePaidSlots: {
        status: "RETIRED_PHASE_3F",
        retired: true,
        description:
          "Overflow lists retired. New joined partners append unlimited into the correct section via CJ managed-public overlay.",
        doNotImplementWithoutGo: false,
      },
      populateEmptySections: {
        status: "ALLOWED_VIA_DYNAMIC_OVERLAY",
        sectionIds: sections.filter((s) => s.slotCount === 0).map((s) => s.sectionId),
        description:
          "Empty section shells may receive CJ_MANAGED chips through overlay when sectionMap assigns them — still DISARMED until promote GO.",
        doNotImplementWithoutGo: false,
      },
    },
  };
}

export function buildSectionMapFile(sectionMap, meta = {}) {
  return {
    _comment:
      "advertiserId → sectionId evidence map for CJ sync/readiness (data-only; does not mutate catalog JS).",
    _updatedAt: meta.updatedAt || new Date().toISOString(),
    _source: meta.source || "phase3e_partner_recon_v1",
    _liveEnabled: false,
    _publishArmed: false,
    _note: "DISARMED. Catalog buttons not auto-added. freeEmpty slots unchanged.",
    ...sectionMap,
  };
}

export async function runPhase3ePartnerRecon(opts = {}) {
  const env = opts.env || process.env;
  const outDir = opts.outDir || path.join(process.env.TEMP || osTmp(), "iu-cj-phase3e-recon");
  const pat = readCjPatFromEnv(env);
  const publisherCid = String(env.IU_CJ_PUBLISHER_CID || "").trim();
  const report = {
    schema: "iu-cj-phase3e-partner-recon-v1",
    at: new Date().toISOString(),
    liveEnabled: false,
    publishArmed: false,
    ok: false,
    reason: null,
  };

  if (!pat || !publisherCid) {
    report.reason = "credentials_missing";
    fs.mkdirSync(outDir, { recursive: true });
    const p = path.join(outDir, "phase3e-partner-recon-report.json");
    fs.writeFileSync(p, JSON.stringify(report, null, 2) + "\n");
    return { ok: false, report, reportPath: p };
  }

  const all = [];
  let page = 1;
  let total = null;
  while (page <= 40) {
    const url =
      CJ_ADVERTISER_LOOKUP_BASE +
      "?requestor-cid=" +
      encodeURIComponent(publisherCid) +
      "&advertiser-ids=joined&page-number=" +
      page +
      "&records-per-page=100";
    const res = await cjGet(url, pat);
    if (res.status === 401 || res.status === 403) {
      report.reason = "auth_" + res.status;
      break;
    }
    if (!res.ok) {
      report.reason = "http_" + res.status;
      break;
    }
    const meta = parseListMeta(res.body || "");
    if (total == null) total = meta.totalMatched;
    const recs = parseAdvertiserBlocks(res.body || "").map(parseAdvertiserRecord);
    all.push(...recs);
    if (!recs.length || (total != null && all.length >= total)) break;
    page += 1;
  }

  if (report.reason) {
    fs.mkdirSync(outDir, { recursive: true });
    const p = path.join(outDir, "phase3e-partner-recon-report.json");
    fs.writeFileSync(p, JSON.stringify(report, null, 2) + "\n");
    return { ok: false, report, reportPath: p };
  }

  const managed = readJson(path.join(ROOT, "projects", "data", "iu-affiliate-cj-managed-public-v1.json"), {
    partners: [],
  });
  const policy = readJson(path.join(ROOT, "projects", "data", "iu-affiliate-slot-policy-v1.json"), {
    partners: [],
  });
  const existingMap = readJson(path.join(ROOT, "projects", "data", "iu-affiliate-cj-section-map-v1.json"), {});

  const proposal = proposeSectionAssignments({
    joined: all,
    managedPartners: managed.partners || [],
    slotPolicyPartners: policy.partners || [],
    existingSectionMap: existingMap,
  });

  report.ok = true;
  report.reason = "phase3e_partner_recon_complete";
  report.joined = all.length;
  report.totalMatched = total;
  report.autoAssignedCount = proposal.autoAssignedCount;
  report.stillManualReviewCount = proposal.stillManualReviewCount;
  report.assignedToSections = proposal.reconciliation.assignedToSections;
  report.manualReviewCount = proposal.reconciliation.manualReviewCount;
  report.freeEmptySlots = proposal.reconciliation.freeEmptySlots;
  report.capacity = proposal.capacity;
  report.managedNotJoined = proposal.managedNotJoined;
  report.catalogMutated = false;

  fs.mkdirSync(outDir, { recursive: true });
  const reportPath = path.join(outDir, "phase3e-partner-recon-report.json");
  const mapPath = path.join(outDir, "iu-affiliate-cj-section-map-proposed-v1.json");
  const detailPath = path.join(outDir, "phase3e-partner-recon-detail.json");
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2) + "\n");
  fs.writeFileSync(
    mapPath,
    JSON.stringify(buildSectionMapFile(proposal.sectionMap, { source: "phase3e_live_recon" }), null, 2) + "\n"
  );
  fs.writeFileSync(
    detailPath,
    JSON.stringify(
      {
        autoAssigned: proposal.autoAssigned,
        stillManualReview: proposal.stillManualReview,
        managedNotJoined: proposal.managedNotJoined,
      },
      null,
      2
    ) + "\n"
  );

  return { ok: true, report, reportPath, mapPath, detailPath, proposal, outDir };
}

function osTmp() {
  return process.env.TEMP || process.env.TMPDIR || "/tmp";
}

const isMain =
  process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;

if (isMain) {
  runPhase3ePartnerRecon()
    .then(async (r) => {
      console.log(
        JSON.stringify({
          IU_CJ_PHASE3E_PARTNER_RECON: r.ok ? "OK" : "FAIL",
          reason: r.report.reason,
          reportPath: r.reportPath,
          mapPath: r.mapPath || null,
          joined: r.report.joined || null,
          autoAssigned: r.report.autoAssignedCount || null,
          stillManual: r.report.stillManualReviewCount || null,
          assignedToSections: r.report.assignedToSections || null,
          freeEmptySlots: r.report.freeEmptySlots ?? null,
          liveEnabled: false,
          publishArmed: false,
        })
      );
      await finishNodeProcessAfterNetwork(r.ok ? 0 : 1);
    })
    .catch(async (e) => {
      console.error(redact(e?.stack || String(e), readCjPatFromEnv(process.env)));
      clearCjEnvFromProcess();
      process.exit(1);
    });
}
