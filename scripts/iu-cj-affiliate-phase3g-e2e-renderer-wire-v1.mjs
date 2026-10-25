#!/usr/bin/env node
/**
 * Phase 3G — end-to-end wire: live CJ readiness → unlimited sync → REAL catalog.js
 * overlay applicator → chip HTML (same template as renderAffiliateSection).
 *
 * Never arms liveEnabled / publishArmed. Never writes Cloudflare / R2.
 * Live packs stay under %TEMP% (or IU_CJ_LIVE_READINESS_PATH). Repo stays DISARMED.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseAffiliateCatalogOrdered } from "./iu-cj-affiliate-phase2-partner-slot-inventory-v1.mjs";
import {
  DYNAMIC_DECISION,
  syncUnlimitedDynamicCatalog,
  stressUnlimitedSectionRender,
} from "./iu-cj-affiliate-phase3f-dynamic-catalog-v1.mjs";
import { auditCjManagedPublicR2Readiness } from "./iu-cj-affiliate-phase3d-r2-infra-readiness-v1.mjs";
import { buildCjR2ProductionGoPlan } from "./iu-cj-affiliate-phase3e-r2-production-go-plan-v1.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const WEBSITE_PID = "101883843";

function escapeHtml(s) {
  return String(s || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Extract + eval the exact overlay helpers from assets/iu-affiliate-catalog.js. */
export function extractCatalogJsOverlayApplicator(catalogSrc) {
  const src = String(catalogSrc || "");
  const start = src.indexOf("function __iuAffIsProtectedItem(it)");
  const mid = src.indexOf("function applyManagedPublicOverlay(overlay)", start);
  if (start < 0 || mid < 0) {
    throw new Error("catalog_js_overlay_helpers_not_found");
  }
  let i = mid;
  let depth = 0;
  let started = false;
  for (; i < src.length; i++) {
    const ch = src[i];
    if (ch === "{") {
      depth++;
      started = true;
    } else if (ch === "}") {
      depth--;
      if (started && depth === 0) {
        i++;
        break;
      }
    }
  }
  const helpersSrc = src.slice(start, i);
  if (!/function applyManagedPublicOverlay/.test(helpersSrc)) {
    throw new Error("catalog_js_overlay_extract_incomplete");
  }
  // Factory closes over a mutable catalog array named IU_AFFILIATE_CATALOG (same as browser).
  const factory = new Function(
    "IU_AFFILIATE_CATALOG",
    `${helpersSrc}\nreturn { applyManagedPublicOverlay, __iuAffIsProtectedItem };`
  );
  return {
    helpersSrc,
    bind(catalogArray) {
      return factory(catalogArray);
    },
  };
}

/** Same chip HTML contract as renderAffiliateSection in catalog.js. */
export function renderSectionChipsFromCatalogJs(section) {
  const chips = [];
  const parts = [];
  for (const it of section.items || []) {
    const ready = it.affiliateUrlReady === true && /^https:\/\//i.test(String(it.url || ""));
    if (!ready) continue;
    const attrs =
      ' class="iuRadioChip iuAffiliateChip" role="listitem" href="' +
      escapeHtml(String(it.url)) +
      '" data-aff-ready="1" target="_blank" rel="sponsored noopener"';
    parts.push(
      "<a" + attrs + '><span class="iuRadioChipTitle">' + escapeHtml(it.title) + "</span></a>"
    );
    chips.push({
      title: it.title,
      url: it.url,
      advertiserId: it.advertiserId != null ? String(it.advertiserId) : null,
      management: it.management || null,
      target: "_blank",
      rel: "sponsored noopener",
      html: parts[parts.length - 1],
    });
  }
  return { html: parts.join(""), chips, count: chips.length, sectionId: section.id || section.sectionId };
}

export function cloneCatalogForOverlay(catalogSrc) {
  const parsed = parseAffiliateCatalogOrdered(catalogSrc);
  return parsed.sections.map((sec) => ({
    id: sec.sectionId,
    title: sec.sectionTitle,
    items: (sec.items || []).map((it) => ({
      title: it.title,
      url: it.url || null,
      advertiserId: it.advertiserId || null,
      affiliateUrlReady: it.affiliateUrlReady === true,
      management: it.advertiserId ? "BAKED" : it.affiliateUrlReady ? "BAKED" : null,
    })),
  }));
}

function loadJson(p) {
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

function defaultLiveReadinessPath() {
  if (process.env.IU_CJ_LIVE_READINESS_PATH) return process.env.IU_CJ_LIVE_READINESS_PATH;
  return path.join(
    process.env.TEMP || process.env.TMPDIR || osTmp(),
    "iu-cj-phase3e-validation",
    "readiness",
    "iu-affiliate-cj-publication-readiness-live.json"
  );
}

function osTmp() {
  return process.platform === "win32" ? "C:\\Users\\spedk\\AppData\\Local\\Temp" : "/tmp";
}

function loadSectionMap(root = ROOT) {
  const raw = loadJson(path.join(root, "projects", "data", "iu-affiliate-cj-section-map-v1.json"));
  const map = {};
  for (const [k, v] of Object.entries(raw)) {
    if (k.startsWith("_")) continue;
    map[String(k)] = v;
  }
  return map;
}

function loadManagedPublic(root = ROOT) {
  return loadJson(path.join(root, "projects", "data", "iu-affiliate-cj-managed-public-v1.json"));
}

function loadSlotPolicyPartners(root = ROOT) {
  const pol = loadJson(path.join(root, "projects", "data", "iu-affiliate-slot-policy-v1.json"));
  return Array.isArray(pol.partners) ? pol.partners : [];
}

/**
 * Build joined + URL hints from neveřejný live readiness pack (+ repo managed-public).
 */
export function buildLiveSyncInput(opts = {}) {
  const root = opts.root || ROOT;
  const readinessPath = opts.readinessPath || defaultLiveReadinessPath();
  if (!fs.existsSync(readinessPath)) {
    return { ok: false, reason: "live_readiness_missing", readinessPath };
  }
  const live = loadJson(readinessPath);
  const assigned = live.partners?.assigned || [];
  const mr = live.partners?.manualReview || [];
  const mnj = live.partners?.managedNotJoined || [];
  const sectionMap = loadSectionMap(root);
  // Apply current repo map (Phase 3F Klik etc.) over live pack
  for (const row of assigned) {
    const id = String(row.advertiserId);
    if (sectionMap[id]) row.sectionId = sectionMap[id];
  }
  const stillManual = [];
  for (const row of mr) {
    const id = String(row.advertiserId);
    if (sectionMap[id]) {
      assigned.push({
        ...row,
        sectionId: sectionMap[id],
        decision: "ASSIGNED_SECTION_MAP_PHASE3G",
      });
    } else {
      stillManual.push(row);
    }
  }

  const managed = loadManagedPublic(root);
  const urlByAdvertiser = {};
  const titleByAdvertiser = {};
  for (const p of managed.partners || []) {
    if (p?.advertiserId == null) continue;
    const id = String(p.advertiserId);
    if (p.url) urlByAdvertiser[id] = p.url;
    if (p.title) titleByAdvertiser[id] = p.title;
  }
  for (const a of assigned) {
    const id = String(a.advertiserId);
    if (a.affiliateUrl) urlByAdvertiser[id] = a.affiliateUrl;
    if (a.partnerName) titleByAdvertiser[id] = a.partnerName;
  }

  const joined = [];
  const seen = new Set();
  for (const a of [...assigned, ...stillManual]) {
    const id = String(a.advertiserId || "");
    if (!id || seen.has(id)) continue;
    seen.add(id);
    joined.push({
      advertiserId: id,
      advertiserName: a.partnerName || titleByAdvertiser[id] || id,
      relationshipStatus: a.relationshipStatus || "joined",
      primaryCategory: a.primaryCategory || null,
      sectionId: a.sectionId || sectionMap[id] || null,
    });
  }

  return {
    ok: true,
    readinessPath,
    liveEnabled: live.liveEnabled === true,
    publishArmed: live.publishArmed === true,
    stats: live.stats || null,
    coupons: live.coupons || [],
    actions: live.actions || [],
    products: live.products || [],
    joined,
    stillManual,
    managedNotJoined: mnj,
    sectionMap,
    previousManaged: managed.partners || [],
    urlByAdvertiser,
    titleByAdvertiser,
    slotPolicyPartners: loadSlotPolicyPartners(root),
  };
}

export function countRenderedChips(catalogAfterOverlay) {
  let total = 0;
  let dynamicManaged = 0;
  let protectedKept = 0;
  const bySection = {};
  const urls = new Set();
  const advSeen = new Set();
  const duplicateAdv = [];
  const chips = [];
  for (const sec of catalogAfterOverlay) {
    const rendered = renderSectionChipsFromCatalogJs(sec);
    bySection[sec.id] = rendered.count;
    total += rendered.count;
    for (const c of rendered.chips) {
      chips.push({ ...c, sectionId: sec.id });
      if (c.url) {
        if (urls.has(c.url + "|" + (c.advertiserId || c.title))) {
          /* allow same URL only once per adv */
        }
        urls.add(c.url);
      }
      if (c.advertiserId) {
        const key = c.advertiserId;
        if (advSeen.has(key)) duplicateAdv.push(key);
        else advSeen.add(key);
      }
      if (c.management === "CJ_MANAGED") dynamicManaged += 1;
      if (c.management === "MANUAL_PROTECTED" || c.management === "PAID_RESERVED") protectedKept += 1;
    }
  }
  return {
    total,
    dynamicManaged,
    protectedKept,
    bySection,
    uniqueUrls: urls.size,
    duplicateAdvertiserIds: [...new Set(duplicateAdv)],
    chips,
  };
}

/**
 * Full E2E (offline-capable when live pack present under TEMP).
 */
export function runPhase3gE2e(opts = {}) {
  const root = opts.root || ROOT;
  const catalogSrc = fs.readFileSync(path.join(root, "assets", "iu-affiliate-catalog.js"), "utf8");
  const extractor = extractCatalogJsOverlayApplicator(catalogSrc);
  const live = buildLiveSyncInput({ root, readinessPath: opts.readinessPath });

  const report = {
    schema: "iu-cj-phase3g-e2e-renderer-wire-v1",
    at: new Date().toISOString(),
    liveEnabled: false,
    publishArmed: false,
    cjLivePublishing: "DISARMED",
    ok: false,
    livePack: live.ok
      ? { path: live.readinessPath, joined: live.joined.length, stats: live.stats }
      : { ok: false, reason: live.reason, path: live.readinessPath },
  };

  if (!live.ok) {
    report.reason = live.reason;
    return report;
  }
  if (live.liveEnabled || live.publishArmed) {
    report.reason = "live_pack_unexpectedly_armed";
    return report;
  }

  const sync = syncUnlimitedDynamicCatalog({
    joined: live.joined,
    previousManaged: live.previousManaged,
    sectionMap: live.sectionMap,
    urlByAdvertiser: live.urlByAdvertiser,
    titleByAdvertiser: live.titleByAdvertiser,
    slotPolicyPartners: live.slotPolicyPartners,
    fetchComplete: true,
    confirmedEndedAdvertiserIds: opts.confirmedEndedAdvertiserIds || [],
  });

  const catalog = cloneCatalogForOverlay(catalogSrc);
  const bakedBefore = countRenderedChips(catalog);
  const { applyManagedPublicOverlay } = extractor.bind(catalog);
  applyManagedPublicOverlay(sync.nextManagedPublic);
  const after = countRenderedChips(catalog);

  // Viewport contract: same chip list for all viewports (responsive CSS only)
  const viewports = ["pc", "tablet", "mobile", "pwa"].map((vp) => ({
    viewport: vp,
    chipCount: after.total,
    note: "Same IU_AFFILIATE_CATALOG items; layout via CSS — no viewport cap",
  }));

  // Fail-closed outage: must not mass-delete
  const outage = syncUnlimitedDynamicCatalog({
    joined: [],
    previousManaged: live.previousManaged,
    fetchComplete: false,
    apiOutage: true,
  });

  // Confirmed ENDED remove (synthetic on a dynamic id if present)
  const sampleDyn = (sync.nextManagedPublic.partners || []).find(
    (p) => p.active !== false && p.management !== "MANUAL_PROTECTED"
  );
  let endedTest = { skipped: true };
  if (sampleDyn) {
    const endedSync = syncUnlimitedDynamicCatalog({
      joined: live.joined.filter((j) => String(j.advertiserId) !== String(sampleDyn.advertiserId)),
      previousManaged: sync.nextManagedPublic.partners,
      sectionMap: live.sectionMap,
      urlByAdvertiser: live.urlByAdvertiser,
      titleByAdvertiser: live.titleByAdvertiser,
      slotPolicyPartners: live.slotPolicyPartners,
      fetchComplete: true,
      confirmedEndedAdvertiserIds: [String(sampleDyn.advertiserId)],
    });
    const cat2 = cloneCatalogForOverlay(catalogSrc);
    extractor.bind(cat2).applyManagedPublicOverlay(endedSync.nextManagedPublic);
    const afterEnded = countRenderedChips(cat2);
    endedTest = {
      skipped: false,
      advertiserId: String(sampleDyn.advertiserId),
      removedDecision: endedSync.removed.some((r) => String(r.advertiserId) === String(sampleDyn.advertiserId)),
      chipStillVisible: afterEnded.chips.some((c) => String(c.advertiserId) === String(sampleDyn.advertiserId)),
    };
  }

  // Protected: mark one baked item as MANUAL_PROTECTED and try hide via overlay
  const catProt = cloneCatalogForOverlay(catalogSrc);
  let protSection = catProt.find((s) => (s.items || []).some((it) => it.affiliateUrlReady));
  let protItem = protSection?.items?.find((it) => it.affiliateUrlReady);
  let protectedTest = { skipped: true };
  if (protItem) {
    protItem.management = "MANUAL_PROTECTED";
    const hideId = protItem.advertiserId || "900001";
    if (!protItem.advertiserId) protItem.advertiserId = hideId;
    extractor.bind(catProt).applyManagedPublicOverlay({
      partners: [
        {
          advertiserId: hideId,
          sectionId: protSection.id,
          title: protItem.title,
          url: protItem.url,
          active: false,
        },
      ],
    });
    const afterProt = renderSectionChipsFromCatalogJs(protSection);
    protectedTest = {
      skipped: false,
      stillVisible: afterProt.chips.some((c) => c.title === protItem.title),
    };
  }

  const stress = stressUnlimitedSectionRender(150);

  // Explicit net-new partner add through REAL catalog.js applicator (proves unlimited append).
  const NEW_ID = "900314159";
  const newUrl = "https://www.kqzyfj.com/click-" + WEBSITE_PID + "-900314159";
  const addSync = syncUnlimitedDynamicCatalog({
    joined: [
      ...live.joined,
      { advertiserId: NEW_ID, advertiserName: "Phase3G NewPartner", relationshipStatus: "joined" },
    ],
    previousManaged: sync.nextManagedPublic.partners,
    sectionMap: { ...live.sectionMap, [NEW_ID]: "aff-pojisteni" },
    urlByAdvertiser: { ...live.urlByAdvertiser, [NEW_ID]: newUrl },
    titleByAdvertiser: { ...live.titleByAdvertiser, [NEW_ID]: "Phase3G NewPartner" },
    slotPolicyPartners: live.slotPolicyPartners,
    fetchComplete: true,
  });
  const catAdd = cloneCatalogForOverlay(catalogSrc);
  extractor.bind(catAdd).applyManagedPublicOverlay(addSync.nextManagedPublic);
  const afterAdd = countRenderedChips(catAdd);
  const addTest = {
    syncAdded: addSync.added.some((a) => String(a.advertiserId) === NEW_ID),
    chipVisible: afterAdd.chips.some((c) => String(c.advertiserId) === NEW_ID),
    chipInPojisteni: afterAdd.chips.some(
      (c) => String(c.advertiserId) === NEW_ID && c.sectionId === "aff-pojisteni"
    ),
    renderedGrew: afterAdd.total === after.total + 1,
    before: after.total,
    after: afterAdd.total,
  };

  // Offer linkage: publication-ready coupons/actions/products whose advertiser has a rendered chip
  const chipAdv = new Set(after.chips.map((c) => c.advertiserId).filter(Boolean));
  const couponsReady = (live.coupons || []).filter((c) => c.publicationReady === true);
  const actionsReady = (live.actions || []).filter((a) => a.publicationReady === true);
  const productsReady = (live.products || []).filter(
    (p) =>
      p.publicationReady === true &&
      p.imageUrl &&
      (p.currentPrice != null || p.originalPrice != null)
  );
  const couponsLinked = couponsReady.filter((c) => chipAdv.has(String(c.advertiserId))).length;
  const actionsLinked = actionsReady.filter((a) => chipAdv.has(String(a.advertiserId))).length;
  const productsLinked = productsReady.filter((p) => chipAdv.has(String(p.advertiserId))).length;

  const assignedWithSection = live.joined.filter((j) => live.sectionMap[String(j.advertiserId)] || j.sectionId).length;

  const r2 = auditCjManagedPublicR2Readiness({ root });
  const r2Plan = buildCjR2ProductionGoPlan({ root });

  const relOk = after.chips.every((c) => c.rel === "sponsored noopener");
  const targetOk = after.chips.every((c) => c.target === "_blank");
  const urlOk = after.chips.every((c) => /^https:\/\//i.test(String(c.url || "")));
  const klikMapped = live.sectionMap["5871720"] === "aff-pojisteni";

  report.ok =
    sync.ok === true &&
    after.total >= bakedBefore.total &&
    after.dynamicManaged >= 1 &&
    after.duplicateAdvertiserIds.length === 0 &&
    relOk &&
    targetOk &&
    urlOk &&
    outage.removed.length === 0 &&
    (endedTest.skipped || (endedTest.removedDecision && !endedTest.chipStillVisible)) &&
    (protectedTest.skipped || protectedTest.stillVisible === true) &&
    stress.ok === true &&
    stress.rendered === 150 &&
    addTest.syncAdded &&
    addTest.chipVisible &&
    addTest.chipInPojisteni &&
    addTest.renderedGrew &&
    klikMapped;

  report.counts = {
    joined: live.joined.length,
    assignedWithSection,
    stillManualReview: live.stillManual.length,
    managedNotJoined: live.managedNotJoined.length,
    bakedChipsBeforeOverlay: bakedBefore.total,
    renderedChipsAfterOverlay: after.total,
    dynamicManagedChips: after.dynamicManaged,
    syncActivePartners: sync.counts.nextActive,
    syncAdded: sync.counts.added,
    syncRemoved: sync.counts.removed,
    couponsPublicationReady: couponsReady.length,
    actionsPublicationReady: actionsReady.length,
    productsWithPhotoAndPrice: productsReady.length,
    couponsLinkedToRenderedChip: couponsLinked,
    actionsLinkedToRenderedChip: actionsLinked,
    productsLinkedToRenderedChip: productsLinked,
  };
  report.sync = {
    ok: sync.ok,
    unlimited: sync.unlimited,
    freeEmptyGateRemoved: sync.freeEmptyGateRemoved,
    decisionsSample: sync.decisions.slice(0, 5),
  };
  report.renderer = {
    source: "assets/iu-affiliate-catalog.js#applyManagedPublicOverlay",
    helpersExtractedBytes: extractor.helpersSrc.length,
    relSponsoredNoopener: relOk,
    targetBlank: targetOk,
    httpsUrls: urlOk,
    duplicateAdvertiserIds: after.duplicateAdvertiserIds,
    bySectionTop: Object.entries(after.bySection)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8),
  };
  report.tests = {
    apiOutageNoMassDelete: outage.removed.length === 0,
    confirmedEndedRemove: endedTest,
    manualProtectedSurvives: protectedTest,
    unlimitedStress150: stress,
    autoAddNetNewPartner: addTest,
    klikPrimaryPojisteni: klikMapped,
    viewports,
  };
  report.remainingManualReview = live.stillManual.map((m) => ({
    advertiserId: m.advertiserId,
    partnerName: m.partnerName,
    reason: m.reason || "unmapped_no_trusted_section",
    primaryCategory: m.primaryCategory,
  }));
  report.gavri = live.managedNotJoined.find((x) => String(x.advertiserId) === "5614135") || null;
  report.r2 = {
    infraPending: r2.infraPending,
    productionPublishAllowed: r2.productionPublishAllowed,
    codeReady: r2.codeReady,
    secretsReady: r2.secretsReady,
    goSteps: r2Plan.steps.length,
    productionActionsArmed: r2Plan.productionActionsArmed,
  };
  report.productionGoBlockers = [
    ...r2.remainingGoSteps,
    "Resolve remaining MANUAL_REVIEW partners without inventing sections",
    "Confirm Gavri.cz ENDED in CJ before auto-remove",
    "Explicit GO: arm_publish + promote_managed_public / R2 publish",
    "Explicit GO: CJ_MANAGED_PUBLIC_LIVE_ENABLED=true only after staging burn-in",
  ];

  return report;
}

const isMain =
  process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;

if (isMain) {
  const report = runPhase3gE2e();
  const outDir = path.join(process.env.TEMP || osTmp(), "iu-cj-phase3g-e2e");
  fs.mkdirSync(outDir, { recursive: true });
  const outFile = path.join(outDir, "phase3g-e2e-report.json");
  fs.writeFileSync(outFile, JSON.stringify(report, null, 2));
  console.log(
    JSON.stringify({
      IU_CJ_PHASE3G_E2E: report.ok ? "OK" : "FAIL",
      liveEnabled: report.liveEnabled,
      publishArmed: report.publishArmed,
      cjLivePublishing: report.cjLivePublishing,
      joined: report.counts?.joined,
      assignedWithSection: report.counts?.assignedWithSection,
      renderedChips: report.counts?.renderedChipsAfterOverlay,
      stillManual: report.counts?.stillManualReview,
      couponsReady: report.counts?.couponsPublicationReady,
      actionsReady: report.counts?.actionsPublicationReady,
      productsReady: report.counts?.productsWithPhotoAndPrice,
      reportPath: outFile,
      reason: report.reason || null,
    })
  );
  process.exit(report.ok ? 0 : 1);
}
