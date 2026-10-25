#!/usr/bin/env node
/**
 * Phase 3H — full CID coverage reconcile (joined → section → button → offers).
 * Counts baked catalog buttons (name match) separately from CJ_MANAGED overlay.
 * Never invents sections. Never duplicates baked buttons via overlay.
 * DISARMED: does not arm liveEnabled / R2 publish.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { isCjTrackingUrl } from "./iu-cj-affiliate-catalog-sync-publish-gate-v1.mjs";
import {
  DYNAMIC_DECISION,
  syncUnlimitedDynamicCatalog,
} from "./iu-cj-affiliate-phase3f-dynamic-catalog-v1.mjs";
import { auditCjManagedPublicR2Readiness } from "./iu-cj-affiliate-phase3d-r2-infra-readiness-v1.mjs";
import { buildCjR2ProductionGoPlan } from "./iu-cj-affiliate-phase3e-r2-production-go-plan-v1.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const WEBSITE_PID = "101883843";

export function normalizePartnerBrand(s) {
  return String(s || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/&amp;/g, "and")
    .replace(/[^a-z0-9]+/g, "");
}

/** Strict fuzzy: require >=4 chars and prefix/containment with length guard. */
export function matchCatalogByName(partnerName, byTitle) {
  const n = normalizePartnerBrand(partnerName);
  if (n.length < 4) return null;
  if (byTitle.has(n)) return byTitle.get(n);
  let best = null;
  let bestScore = 0;
  for (const [k, v] of byTitle) {
    if (k.length < 4) continue;
    let score = 0;
    if (k === n) score = 100;
    else if (k.startsWith(n) || n.startsWith(k)) score = 80;
    else if (k.includes(n) || n.includes(k)) score = Math.min(k.length, n.length);
    if (score > bestScore && score >= 6) {
      bestScore = score;
      best = v;
    }
  }
  return best;
}

export function parseCatalogPartners(catalogSrc) {
  const byTitle = new Map();
  const byAdv = new Map();
  const re =
    /affPartner\(\s*"((?:\\.|[^"\\])*)"\s*,\s*"(https:\/\/[^"]+)"(?:\s*,\s*"([^"]*)")?\s*\)/g;
  let m;
  while ((m = re.exec(String(catalogSrc || ""))) !== null) {
    const title = m[1].replace(/\\"/g, '"');
    const url = m[2];
    const advertiserId = m[3] && String(m[3]).trim() ? String(m[3]).trim() : null;
    const row = { title, url, advertiserId, management: advertiserId ? "BAKED_WITH_CID" : "BAKED" };
    byTitle.set(normalizePartnerBrand(title), row);
    if (advertiserId) byAdv.set(advertiserId, row);
  }
  return { byTitle, byAdv, count: byTitle.size };
}

export function stripCjUrlTimestamp(url) {
  const s = String(url || "");
  const m = s.match(
    /^(https:\/\/www\.(?:anrdoezrs|jdoqocy|dpbolvw|kqzyfj|tkqlhce)\.(?:com|net)\/click-\d+-\d+)(?:-\d+)?$/i
  );
  return m ? m[1] : s;
}

export function loadSectionMap(root = ROOT) {
  const raw = JSON.parse(
    fs.readFileSync(path.join(root, "projects", "data", "iu-affiliate-cj-section-map-v1.json"), "utf8")
  );
  const map = {};
  for (const [k, v] of Object.entries(raw)) {
    if (!String(k).startsWith("_")) map[String(k)] = v;
  }
  return map;
}

export function buildOfferUrlIndex(liveDoc) {
  const byAdv = new Map();
  for (const row of [...(liveDoc.coupons || []), ...(liveDoc.actions || [])]) {
    const id = String(row.advertiserId || "");
    let url = row.affiliateUrl;
    if (!id || !url) continue;
    url = stripCjUrlTimestamp(url);
    if (!isCjTrackingUrl(url)) continue;
    if (!byAdv.has(id)) byAdv.set(id, url);
  }
  return byAdv;
}

/**
 * @param {{ liveDoc, root?, catalogSrc? }} opts
 */
export function reconcileCjPartnerCoverage(opts = {}) {
  const root = opts.root || ROOT;
  const liveDoc = opts.liveDoc;
  if (!liveDoc) return { ok: false, reason: "missing_live_doc" };

  const catalogSrc =
    opts.catalogSrc ||
    fs.readFileSync(path.join(root, "assets", "iu-affiliate-catalog.js"), "utf8");
  const catalog = parseCatalogPartners(catalogSrc);
  const sectionMap = loadSectionMap(root);
  const managed = JSON.parse(
    fs.readFileSync(path.join(root, "projects", "data", "iu-affiliate-cj-managed-public-v1.json"), "utf8")
  );
  const managedById = new Map((managed.partners || []).map((p) => [String(p.advertiserId), p]));
  const offerUrls = buildOfferUrlIndex(liveDoc);

  const assigned = liveDoc.partners?.assigned || [];
  const mrLive = liveDoc.partners?.manualReview || [];
  const mnj = liveDoc.partners?.managedNotJoined || [];

  const joined = [];
  const seen = new Set();
  for (const row of [...assigned, ...mrLive]) {
    const id = String(row.advertiserId || "");
    if (!id || seen.has(id)) continue;
    seen.add(id);
    joined.push(row);
  }

  const partners = [];
  const missingButton = [];
  const enrichCandidates = []; // would duplicate baked — DO NOT overlay-add
  let bakedCovered = 0;
  let managedCovered = 0;
  let withSection = 0;

  for (const j of joined) {
    const id = String(j.advertiserId);
    const sectionId = sectionMap[id] || j.sectionId || null;
    if (sectionId) withSection += 1;
    const mp = managedById.get(id);
    const bakedDirect = catalog.byAdv.get(id) || null;
    const bakedName = bakedDirect || matchCatalogByName(j.partnerName, catalog.byTitle);
    const offerUrl = offerUrls.get(id) || null;
    const url = (mp && mp.url) || (bakedName && bakedName.url) || offerUrl || j.affiliateUrl || null;
    const hasManaged = Boolean(mp && mp.active !== false);
    const hasBaked = Boolean(bakedName);
    const hasButton = hasManaged || hasBaked;
    let buttonKind = null;
    if (hasManaged) {
      buttonKind = "CJ_MANAGED";
      managedCovered += 1;
    } else if (hasBaked) {
      buttonKind = "BAKED";
      bakedCovered += 1;
    }

    const row = {
      advertiserId: id,
      partnerName: j.partnerName,
      relationshipStatus: j.relationshipStatus || "joined",
      sectionId,
      hasSection: Boolean(sectionId),
      hasButton,
      buttonKind,
      url: url && isCjTrackingUrl(stripCjUrlTimestamp(url)) ? stripCjUrlTimestamp(url) : null,
      offerUrl,
      inManagedPublic: hasManaged,
      bakedTitle: bakedName?.title || null,
      decision: j.decision || null,
    };
    partners.push(row);

    if (!hasButton) {
      missingButton.push({
        ...row,
        reason: !sectionId
          ? "unmapped_no_trusted_section"
          : !row.url
            ? "missing_stable_affiliate_url"
            : "missing_button_despite_section_url",
      });
    } else if (hasBaked && !hasManaged && sectionId && row.url) {
      enrichCandidates.push({
        advertiserId: id,
        sectionId,
        title: bakedName.title || j.partnerName,
        url: row.url,
        note: "BAKED already covers — do not overlay-append (duplicate risk)",
      });
    }
  }

  // Offer linkage against any button (managed OR baked)
  const buttonIds = new Set(partners.filter((p) => p.hasButton).map((p) => p.advertiserId));
  const couponsReady = (liveDoc.coupons || []).filter((c) => c.publicationReady === true);
  const actionsReady = (liveDoc.actions || []).filter((a) => a.publicationReady === true);
  const productsReady = (liveDoc.products || []).filter(
    (p) => p.publicationReady === true && p.imageUrl && p.currentPrice != null
  );
  const couponsLinked = couponsReady.filter((c) => buttonIds.has(String(c.advertiserId)));
  const actionsLinked = actionsReady.filter((a) => buttonIds.has(String(a.advertiserId)));
  const productsLinked = productsReady.filter((p) => buttonIds.has(String(p.advertiserId)));
  const couponsUnlinked = couponsReady.filter((c) => !buttonIds.has(String(c.advertiserId)));
  const unlinkedReasons = {};
  for (const c of couponsUnlinked) {
    const id = String(c.advertiserId);
    const p = partners.find((x) => x.advertiserId === id);
    let reason = "advertiser_not_joined";
    if (p && !p.hasSection) reason = "no_section";
    else if (p && !p.hasButton) reason = "no_button";
    else if (!p) reason = "advertiser_not_in_joined";
    unlinkedReasons[reason] = (unlinkedReasons[reason] || 0) + 1;
  }

  return {
    ok: true,
    liveEnabled: false,
    publishArmed: false,
    cjLivePublishing: "DISARMED",
    at: new Date().toISOString(),
    counts: {
      joined: partners.length,
      withSection,
      withButton: partners.filter((p) => p.hasButton).length,
      bakedButtons: bakedCovered,
      managedButtons: managedCovered,
      missingButton: missingButton.length,
      manualReviewNoSection: partners.filter((p) => !p.hasSection).length,
      managedNotJoined: mnj.length,
      couponsPublicationReady: couponsReady.length,
      couponsLinkedToButton: couponsLinked.length,
      actionsPublicationReady: actionsReady.length,
      actionsLinkedToButton: actionsLinked.length,
      productsWithPhotoAndPrice: productsReady.length,
      productsLinkedToButton: productsLinked.length,
    },
    missingButton,
    enrichCandidatesDoNotDuplicate: enrichCandidates.length,
    couponUnlinkedReasons: unlinkedReasons,
    managedNotJoined: mnj,
    partners,
  };
}

/**
 * Real auth-error scenario: 401-like failure must keep LKG + stay DISARMED.
 */
export function runAuthErrorKeepsDisarmedScenario(opts = {}) {
  const previous = opts.previousManaged || [
    {
      advertiserId: "6179554",
      sectionId: "aff-cestovni-kancelare",
      title: "Cedok.cz",
      url: "https://www.anrdoezrs.net/click-101883843-15686662",
      active: true,
    },
  ];
  const beforeJson = JSON.stringify(previous);

  // Simulate credentials missing / 401: treat as apiOutage + incomplete fetch
  const sync = syncUnlimitedDynamicCatalog({
    joined: [],
    previousManaged: previous,
    fetchComplete: false,
    apiOutage: true,
  });

  const afterActive = (sync.nextManagedPublic?.partners || []).filter((p) => p.active !== false);
  const lkgIntact =
    afterActive.length === previous.filter((p) => p.active !== false).length &&
    sync.removed.length === 0 &&
    JSON.stringify(previous) === beforeJson;

  const pass =
    sync.ok === false &&
    (sync.reason === "api_outage_keep_lkg" || sync.reason === "fetch_incomplete_keep_lkg") &&
    sync.liveEnabled === false &&
    sync.publishArmed === false &&
    sync.removed.length === 0 &&
    lkgIntact &&
    afterActive.some((p) => String(p.advertiserId) === "6179554");

  return {
    id: "auth_error_keeps_disarmed",
    pass,
    detail: {
      syncOk: sync.ok,
      reason: sync.reason,
      removed: sync.removed.length,
      liveEnabled: sync.liveEnabled,
      publishArmed: sync.publishArmed,
      lkgIntact,
      decisions: (sync.decisions || []).slice(0, 3).map((d) => d.decision),
    },
  };
}

export function proposePhase3hCoverageActions(recon) {
  const actions = [];
  for (const m of recon.missingButton || []) {
    if (m.reason === "unmapped_no_trusted_section") {
      actions.push({
        type: "MANUAL_REVIEW",
        advertiserId: m.advertiserId,
        partnerName: m.partnerName,
        note: "Do not invent section",
      });
      continue;
    }
    if (m.advertiserId === "5954793" && m.sectionId === "aff-jidlo" && m.url) {
      actions.push({
        type: "ADD_MANAGED_BUTTON",
        advertiserId: m.advertiserId,
        partnerName: m.partnerName || "lidl-shop.cz",
        sectionId: "aff-jidlo",
        url: m.url,
        note: "No baked button; stable CJ URL available from offers",
      });
    }
  }
  return actions;
}

const isMain =
  process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;

if (isMain) {
  const livePath =
    process.env.IU_CJ_LIVE_READINESS_PATH ||
    path.join(
      process.env.TEMP || "",
      "iu-cj-phase3e-validation",
      "readiness",
      "iu-affiliate-cj-publication-readiness-live.json"
    );
  if (!fs.existsSync(livePath)) {
    console.log(JSON.stringify({ IU_CJ_PHASE3H_COVERAGE: "SKIP", reason: "live_pack_missing", livePath }));
    process.exit(0);
  }
  const liveDoc = JSON.parse(fs.readFileSync(livePath, "utf8"));
  const recon = reconcileCjPartnerCoverage({ liveDoc });
  const auth = runAuthErrorKeepsDisarmedScenario();
  const r2 = auditCjManagedPublicR2Readiness({ root: ROOT });
  const plan = buildCjR2ProductionGoPlan({ root: ROOT });
  const outDir = path.join(process.env.TEMP || "", "iu-cj-phase3h-coverage");
  fs.mkdirSync(outDir, { recursive: true });
  const report = {
    ...recon,
    authScenario: auth,
    r2: {
      infraPending: r2.infraPending,
      secretsReady: r2.secretsReady,
      productionPublishAllowed: r2.productionPublishAllowed,
      goSteps: plan.steps.length,
    },
    proposedActions: proposePhase3hCoverageActions(recon),
  };
  fs.writeFileSync(path.join(outDir, "phase3h-coverage-report.json"), JSON.stringify(report, null, 2));
  console.log(
    JSON.stringify({
      IU_CJ_PHASE3H_COVERAGE: recon.ok && auth.pass ? "OK" : "FAIL",
      counts: recon.counts,
      authPass: auth.pass,
      missing: recon.missingButton.map((m) => m.advertiserId + ":" + m.reason),
      reportPath: path.join(outDir, "phase3h-coverage-report.json"),
    })
  );
  process.exit(recon.ok && auth.pass ? 0 : 1);
}
