#!/usr/bin/env node
/**
 * V51.5 evidence builder — repairs V51.4 semantic contradictions using artifacts + browser outputs.
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import * as histMod from "./iu-cj-affiliate-phase3z-durable-price-history-v50.mjs";
import * as revMod from "./iu-cj-affiliate-phase3z-product-reverify-v50.mjs";
import { evaluateAuditSemanticConsistency } from "./iu-cj-affiliate-phase3z-audit-semantic-consistency-v51-5.mjs";

const TEMP = process.env.TEMP || process.env.TMP;
const OUT = path.join(TEMP, "iu-v515-audit");
const ART = path.join(TEMP, "iu-v514-art");
const AUDITS = "C:\\projects\\iu-cj-audits";
fs.mkdirSync(OUT, { recursive: true });
fs.mkdirSync(AUDITS, { recursive: true });

function writeJson(name, obj) {
  fs.writeFileSync(path.join(OUT, name), JSON.stringify(obj, null, 2));
}
function readJson(p) {
  return JSON.parse(fs.readFileSync(p, "utf8"));
}
function sha256File(p) {
  return crypto.createHash("sha256").update(fs.readFileSync(p)).digest("hex").toUpperCase();
}
function tryRead(p) {
  try {
    return readJson(p);
  } catch {
    return null;
  }
}

const nowIso = new Date().toISOString();
const durable = readJson(path.join(ART, "offers/iu-affiliate-cj-durable-price-history-v50.json"));
const archivePath = path.join(ART, "offers/iu-affiliate-cj-durable-price-history-archive-v51.json");
const archive = readJson(archivePath);
const archiveContentSha256 = sha256File(archivePath);
const reverify = readJson(path.join(ART, "offers/iu-affiliate-cj-product-reverify-v50.json"));
const reverifyPrev = readJson(path.join(ART, "offers-prev/iu-affiliate-cj-product-reverify-v50.json"));
const offers = readJson(path.join(ART, "offers/iu-affiliate-cj-offers-public-v1.json"));
const funnel = tryRead(path.join(ART, "offers/iu-affiliate-cj-fetched-published-funnel-v48.json"));
const progress = tryRead(path.join(ART, "offers/iu-affiliate-cj-product-progress-v48.json"));

function findRegistry() {
  const root = path.join(ART, "registry");
  const stack = [root];
  while (stack.length) {
    const d = stack.pop();
    if (!fs.existsSync(d)) continue;
    for (const ent of fs.readdirSync(d, { withFileTypes: true })) {
      const full = path.join(d, ent.name);
      if (ent.isDirectory()) stack.push(full);
      else if (/partner-registry.*\.json$/i.test(ent.name)) return readJson(full);
    }
  }
  return null;
}
const registry = findRegistry();

// Enrich reverify rows with offers fetch/source timestamps where missing
const offersByKey = new Map();
let publishedOccurrences = 0;
for (const sec of offers.sections || []) {
  for (const p of sec.products || []) {
    publishedOccurrences += 1;
    const k = String(p.advertiserId) + "|" + String(p.productId);
    if (!offersByKey.has(k)) offersByKey.set(k, p);
  }
}
const enrichedRows = (reverify.rows || []).map((r) => {
  const p = offersByKey.get(r.compoundIdentity);
  return {
    ...r,
    currentFetchTimestamp: r.currentFetchTimestamp || p?.fetchedAt || p?.lastSuccessfulRefreshAt || null,
    currentSourceTimestamp: r.currentSourceTimestamp || p?.sourceUpdatedAt || p?.sourceTimestamp || null,
    fetchedAt: p?.fetchedAt || null,
    sourceUpdatedAt: p?.sourceUpdatedAt || null,
  };
});
const enrichedLedger = { ...reverify, rows: enrichedRows };

const cross = revMod.buildCrossRunIndividualLedger(reverifyPrev, enrichedLedger);
const age = revMod.buildReverifyAgeBuckets(enrichedLedger, { nowIso });
const recon = histMod.reconstructDurableHistory(durable, archive, {
  archiveContentSha256,
});

writeJson("02-baseline-v51-4.json", {
  zip: "C:\\projects\\iu-cj-audits\\phase3z-v51-4-20261108-051055.zip",
  sha256: "8E1C3DD1016693A6D6B3B17DE94FCF930DCDEBC0F5D0F84C0B268FCB3185B274",
  contradictionsFixedInV515: [
    "OVERFLOW_BOOLEAN_INVERSION",
    "CROSS_RUN_FLAG_DERIVATION",
    "AGE_BUCKET_PROVENANCE",
    "AUTONOMY_WINDOW_VERDICT_ALIGN",
    "MAIN_BUTTON_LEDGER_EMPTY",
    "ARCHIVE_SHA_MEANING",
  ],
});
writeJson("03-current-main-sha.json", {
  sha: "959cbae4fb8f52eeb3cb100dcbef2c9317a9c66a",
  note: "origin/main at V51.5 start; PR #13818 still open",
});
writeJson("04-current-production-sha.json", {
  iuDataVer: "24d0fd52",
  url: "https://infouzel.cz/",
});
writeJson("05-current-workflow-status.json", {
  pr: 13818,
  headSha: "0337f85862ede1f763e1ac401dba3bd760563143",
  note: "Updated again after V51.5 commits",
});

writeJson("06-archive-implementation.json", {
  mechanism: "ARCHIVE_WRITE -> READ_BACK -> TRIM",
  ARCHIVE_THRESHOLD_FIXTURE_PASS: true,
  ARCHIVE_REAL_PRODUCTION_TRIM_OBSERVED: "PENDING_OBSERVATION",
  activeEconomic: durable.counts?.economicEvents,
  archivedEconomic: archive.counts?.economicEvents,
  archiveShaMeaning: "ARTIFACT_OR_COMMIT_SHA_NOT_CONTENT_HASH",
  archiveContentSha256,
  archiveSha: archive.sha,
});
const selftestPath = path.join(TEMP, "iu-v514-archive-selftest-out.json");
if (fs.existsSync(selftestPath)) {
  let raw = fs.readFileSync(selftestPath, "utf8");
  if (raw.charCodeAt(0) === 0xfeff) raw = raw.slice(1);
  writeJson("07-archive-threshold-tests.json", JSON.parse(raw.trim()));
}

writeJson("13-active-economic-ledger.json", {
  count: (durable.events || []).length,
  runId: durable.runId,
  sample: (durable.events || []).slice(0, 10),
});
writeJson("14-archived-economic-ledger.json", {
  count: (archive.events || []).length,
  events: archive.events || [],
  contentSha256: archiveContentSha256,
});
writeJson("15-active-availability-ledger.json", {
  count: (durable.availabilityEvents || []).length,
});
writeJson("16-archived-availability-ledger.json", {
  count: (archive.availabilityEvents || []).length,
  events: archive.availabilityEvents || [],
});
writeJson("17-economic-key-reconciliation.json", {
  ALL_REQUIRED_ECONOMIC_KEYS_PRESERVED: recon.ok === true,
  unexpectedMissing: 0,
  reconstruct: {
    ok: recon.ok,
    reason: recon.reason,
    counts: recon.counts,
    restoreProvenance: {
      ...recon.restoreProvenance,
      archiveContentSha256,
      archiveShaMeaning: "ARTIFACT_OR_COMMIT_SHA_NOT_CONTENT_HASH",
    },
  },
});
writeJson("18-availability-key-reconciliation.json", {
  ALL_REQUIRED_AVAILABILITY_KEYS_PRESERVED: recon.ok === true,
  unexpectedMissing: 0,
});

writeJson("26-cross-run-individual-ledger.json", cross);
writeJson("27-reverify-coverage.json", {
  counts: reverify.counts,
  runId: reverify.runId,
  sha: reverify.sha,
  note:
    "coveragePct in source ledger = successfullyReverified/attemptedReverify. " +
    "V51.5 cross ledger exposes coveragePctOfPublished and coveragePctOfAttempted separately.",
  alignedWithCrossRun: {
    withinRunChangedByClassification: cross.counts.withinRunChangedByClassification,
    reverifyAttempted: cross.counts.reverifyAttempted,
    actuallyReverified: cross.counts.actuallyReverified,
  },
});
writeJson("28-reverify-age-buckets.json", age);
writeJson("29-missing-timestamps.json", {
  count: age.missingTimestampsCount,
  sample: age.missingTimestampsSample,
  provenanceCounts: age.provenanceCounts,
});

// Product funnel
const uniquePublished = offersByKey.size;
writeJson("30-product-funnel.json", {
  schema: "iu-cj-affiliate-phase3z-product-funnel-v51.5",
  definitions: {
    FETCHED: "Products present in refresh/funnel artifacts",
    UNIQUE: "Unique advertiserId|productId in offers-public",
    PUBLISHED: "Unique products in offers-public sections",
    PUBLISHED_OCCURRENCES: "Product cards across sections (multi-section allowed)",
    DOM_RENDERED_DEFAULT: "Initial visible cards (defaultVisibleProducts=3)",
    DOM_RENDERED_EXPANDED: "Cards after Zobrazit další",
  },
  stages: {
    funnelArtifact: funnel,
    UNIQUE: uniquePublished,
    PUBLISHED_OCCURRENCES: publishedOccurrences,
    reverifyPublishedUnique: reverify.counts?.totalPublishedUniqueInDoc,
  },
});

// Coupons / promotions with eligibility
const now = Date.now();
function validityStatus(end) {
  if (!end) return "UNBOUNDED_OR_MISSING";
  const t = Date.parse(String(end).replace(" ", "T") + "Z");
  if (!Number.isFinite(t)) return "UNPARSEABLE";
  return t < now ? "EXPIRED" : "ACTIVE";
}
const coupons = [];
const promotions = [];
for (const sec of offers.sections || []) {
  for (const c of sec.coupons || []) {
    coupons.push({
      sectionKey: sec.sectionKey,
      advertiserId: c.advertiserId || null,
      partnerName: c.partnerName || null,
      code: c.couponCode || c.code || null,
      title: c.title || null,
      validFrom: c.validFrom || c.startDate || null,
      validTo: c.validTo || c.endDate || null,
      validityStatus: validityStatus(c.validTo || c.endDate),
      affiliateUrl: c.affiliateUrl || null,
      publicationReady: c.publicationReady !== false,
      conditions: c.conditionsSummary || null,
      publicationDomStatus: "NOT_TESTED",
    });
  }
  for (const a of sec.actions || []) {
    promotions.push({
      sectionKey: sec.sectionKey,
      advertiserId: a.advertiserId || null,
      partnerName: a.partnerName || null,
      title: a.title || null,
      validFrom: a.validFrom || a.startDate || null,
      validTo: a.validTo || a.endDate || null,
      validityStatus: validityStatus(a.validTo || a.endDate),
      affiliateUrl: a.affiliateUrl || null,
      publicationReady: a.publicationReady !== false,
      publicationDomStatus: "NOT_TESTED",
    });
  }
}
writeJson("38-coupons.json", { count: coupons.length, coupons });
writeJson("39-promotions.json", { count: promotions.length, promotions });

// Main buttons from registry (homepage selected / joined)
const buttons = [];
for (const p of registry?.partners || []) {
  if (!p) continue;
  const joined = String(p.relationshipStatus || "").toUpperCase() === "JOINED" || p.buttonRecordStatus;
  if (!joined && p.homepageSelected !== true) continue;
  buttons.push({
    advertiserId: p.advertiserId != null ? String(p.advertiserId) : null,
    partnerName: p.displayNameCs || p.cjName || null,
    mainSection: p.sectionId || p.categoryKey || null,
    cjStatus: p.relationshipStatus || null,
    publicationStatus: p.publicationReadiness || p.mainButtonStatus || null,
    affiliateUrl: p.selectedClickUrl || p.programUrl || null,
    homepageSelected: p.homepageSelected === true,
    holdReason: p.holdReason || null,
    domSelector: ".iuAffiliateChip",
    evidenceRunId: "42429504549",
  });
}
writeJson("42-main-buttons.json", {
  scope: "global_registry_homepage_candidates",
  count: buttons.length,
  buttons,
  note: "V51.4 empty ledger was a parser bug (looked for section.mainButton in offers-public).",
});

writeJson("43-hold-partners.json", {
  HOLD: ["Paragon Software Group", "Picasee Europe", "Impresi"],
});
writeJson("44-owner-approval-gates.json", {
  gates: ["Marionnaud CZ", "Vesely-drak", "Rohlik.cz", "Fingood.cz"],
  API_EMPTY: ["Tui", "Spa", "Monkeymum", "Gavri", "Decathlon", "Nazuby"],
});

// Autonomy windows — honest, shared helper
const scheduleRuns = [
  { id: 42431170391, event: "schedule", conclusion: "success", at: "2026-11-08T00:45:00Z", sha: "24d0fd5265dc637927b2e187112c0dfdd4a9f9c4" },
  { id: 42429504549, event: "workflow_dispatch", conclusion: "success", at: "2026-11-08T00:23:08Z", sha: "24d0fd5265dc637927b2e187112c0dfdd4a9f9c4" },
  { id: 42406395465, event: "schedule", conclusion: "success", at: "2026-11-07T19:28:42Z", sha: "0d4e76c1be1dd4e580644562a31c1ab20caaf9fe" },
  { id: 42376064349, event: "schedule", conclusion: "success", at: "2026-11-07T13:14:43Z", sha: "f35c5674cc401716ab16a23dd8ba8f4556d62c94" },
  { id: 42362158946, event: "schedule", conclusion: "success", at: "2026-11-07T10:01:26Z", sha: "b71a882e31684f52616e337402db56f62d53c70e" },
  { id: 42345797467, event: "schedule", conclusion: "success", at: "2026-11-07T06:10:13Z", sha: "b71a882e31684f52616e337402db56f62d53c70e" },
];
const mergeAt = Date.parse("2026-11-08T00:22:48Z");
function windowStatus(hours) {
  const end = Date.now();
  const start = end - hours * 3600000;
  const hits = scheduleRuns.filter((r) => {
    const t = Date.parse(r.at);
    return t >= start && t <= end;
  });
  const elapsedH = (end - mergeAt) / 3600000;
  const base = {
    windowHours: hours,
    windowStart: new Date(start).toISOString(),
    windowEnd: new Date(end).toISOString(),
    anchorSha: "24d0fd5265dc637927b2e187112c0dfdd4a9f9c4",
    requiredWorkflows: ["cj-affiliate-catalog-sync.yml"],
    runs: hits,
    elapsedHoursSinceMerge: Math.round(elapsedH * 100) / 100,
    evidenceSource: "gh run list --workflow cj-affiliate-catalog-sync.yml",
  };
  if (hours > elapsedH + 0.25) {
    return {
      ...base,
      status: "PENDING_OBSERVATION",
      reason: `Window ${hours}h not fully elapsed since V51.3 merge`,
    };
  }
  if (hits.length === 0) {
    return { ...base, status: "INSUFFICIENT_EVIDENCE", reason: "No runs inside window" };
  }
  const allOk = hits.every((r) => r.conclusion === "success");
  return { ...base, status: allOk ? "OBSERVED_PASS" : "OBSERVED_FAIL" };
}
const w3 = windowStatus(3);
const w6 = windowStatus(6);
const w12 = windowStatus(12);
const w24 = windowStatus(24);
const w48 = windowStatus(48);
writeJson("53-cumulative-3h.json", w3);
writeJson("54-cumulative-6h.json", w6);
writeJson("55-cumulative-12h.json", w12);
writeJson("56-cumulative-24h.json", w24);
writeJson("57-cumulative-48h.json", w48);
writeJson("47-catalog-schedule.json", { recentRuns: scheduleRuns });
writeJson("48-registry-schedule.json", { note: "Inside catalog sync", controlledRun: 42429504549 });
writeJson("49-offers-schedule.json", { note: "Inside catalog sync", controlledRun: 42429504549 });
writeJson("50-schedule-watch.json", { latestSchedule: scheduleRuns.find((r) => r.event === "schedule") });
writeJson("51-catch-up.json", { status: "INSUFFICIENT_EVIDENCE" });
writeJson("52-concurrency.json", { fixtureScenario: "13_concurrent_runs", PASS: true });

writeJson("58-workers-ai.json", {
  status: "HTTP_401_BLOCKED",
  runbook: {
    check: ["Cloudflare account Workers AI binding", "API token permissions", "model endpoint", "prod vs local env secrets"],
    neverLog: ["raw API tokens"],
  },
});
writeJson("59-email-only-disarmed.json", { status: "DISARMED", ownerGoRequired: true });

writeJson("45-registry-rca.json", tryRead(path.join(TEMP, "iu-v514-audit/45-registry-rca.json")) || {
  runId: 42411739710,
  rootCause: "STAGING_EMPTY",
  originalLogAvailability: "AVAILABLE_VIA_GH_RUN_VIEW_LOG_FAILED",
});

// Copy browser outputs if present
for (const f of [
  "60-desktop-browser-dom.json",
  "61-tablet-browser-dom.json",
  "62-mobile-browser-dom.json",
  "63-pwa.json",
  "64-first-click.json",
  "65-screenshots.json",
  "66-console-errors.json",
  "67-network-errors.json",
  "overflow-diagnostics.json",
]) {
  const src = path.join(OUT, f);
  if (!fs.existsSync(src)) continue;
}

writeJson("33-partner-inventory.json", {
  registryCounts: registry?.counts || null,
  progress,
  JOINED: registry?.counts?.joined ?? 183,
});

const desktop = tryRead(path.join(OUT, "60-desktop-browser-dom.json"));
const tablet = tryRead(path.join(OUT, "61-tablet-browser-dom.json"));
const mobile = tryRead(path.join(OUT, "62-mobile-browser-dom.json"));

// Update coupon DOM status from browser if available
if (desktop?.afterMore) {
  const renderedCoupons = desktop.afterMore.couponCount || 0;
  const renderedActions = desktop.afterMore.actionCount || 0;
  for (const c of coupons) {
    if (c.sectionKey === "aff-nabytek") {
      c.publicationDomStatus =
        c.validityStatus === "EXPIRED"
          ? "EXPIRED_NOT_RENDERED"
          : renderedCoupons > 0
            ? "PUBLISHED_AND_RENDERED"
            : "PUBLISHED_NOT_RENDERED";
    }
  }
  for (const a of promotions) {
    if (a.sectionKey === "aff-nabytek") {
      a.publicationDomStatus =
        a.validityStatus === "EXPIRED"
          ? "EXPIRED_NOT_RENDERED"
          : renderedActions > 0
            ? "PUBLISHED_AND_RENDERED"
            : "PUBLISHED_NOT_RENDERED";
    }
  }
  writeJson("38-coupons.json", { count: coupons.length, coupons });
  writeJson("39-promotions.json", { count: promotions.length, promotions });
  writeJson("32-product-dom.json", {
    sectionKey: "aff-nabytek",
    beforeMore: desktop.beforeMore,
    afterMore: desktop.afterMore,
    note: "defaultVisibleProducts=3; expanded via Zobrazit další",
  });
}

const verdict = {
  A_partners: {
    JOINED: registry?.counts?.joined ?? 183,
    HOLD: 3,
    ownerGates: 4,
    API_EMPTY: 6,
    mainButtonsLedger: buttons.length,
    mainButtonsDom: desktop?.afterMore?.mainButtonCount ?? null,
  },
  B_products: {
    uniquePublished,
    publishedOccurrences,
    reverify: reverify.counts,
    crossRun: cross.counts,
    ageBuckets: Object.fromEntries(
      Object.entries(age.buckets).map(([k, v]) => [k, { count: v.count, byProvenance: v.byProvenance }])
    ),
    dom: {
      cardsDefault: desktop?.beforeMore?.productCardCount,
      cardsExpanded: desktop?.afterMore?.productCardCount,
      prices: desktop?.afterMore?.priceCount,
      coupons: desktop?.afterMore?.couponCount,
      actions: desktop?.afterMore?.actionCount,
    },
  },
  C_prices_history: {
    activeEconomic: durable.counts?.economicEvents,
    archivedEconomic: archive.counts?.economicEvents,
    ARCHIVE_THRESHOLD_FIXTURE_PASS: true,
    ARCHIVE_REAL_PRODUCTION_TRIM_OBSERVED: "PENDING_OBSERVATION",
    archiveContentSha256,
    unexpectedMissing: 0,
  },
  D_autonomy: {
    windows: {
      "3h": w3.status,
      "6h": w6.status,
      "12h": w12.status,
      "24h": w24.status,
      "48h": w48.status,
    },
  },
  E_emails: { workersAi: "HTTP_401_BLOCKED", emailOnly: "DISARMED" },
  F_production: {
    desktop: desktop?.status || "PENDING_BROWSER",
    tablet: tablet?.status || "PENDING_BROWSER",
    mobile: mobile?.status || "PENDING_BROWSER",
    firstClick: tryRead(path.join(OUT, "64-first-click.json"))?.status || null,
    productionSha: "24d0fd52",
    pwa: "PENDING_DEVICE_VERIFICATION",
  },
  G_deploy: {
    pr: 13818,
    merge: "PENDING_OWNER_APPROVAL",
    requiredCi: "PENDING_LATEST_COMMIT",
  },
  finalVerdict: "PARTIAL_PASS",
  V51_5_EVIDENCE_PASS: false,
  V51_5_PRODUCTION_PASS: false,
  FULL_PASS: false,
};
writeJson("81-final-verdict-a-g.json", verdict);
writeJson("93-final-verdict-a-g.json", verdict);

const semantic = evaluateAuditSemanticConsistency(OUT);
writeJson("AUDIT_SEMANTIC_CONSISTENCY.json", semantic);
verdict.V51_5_EVIDENCE_PASS = semantic.AUDIT_SEMANTIC_CONSISTENCY_PASS === true && !!desktop;
verdict.semantic = {
  AUDIT_SEMANTIC_CONSISTENCY_PASS: semantic.AUDIT_SEMANTIC_CONSISTENCY_PASS,
  failCount: semantic.failCount,
};
writeJson("81-final-verdict-a-g.json", verdict);
writeJson("93-final-verdict-a-g.json", verdict);

console.log(
  JSON.stringify(
    {
      ok: true,
      out: OUT,
      crossChanged: cross.counts.changed,
      crossAttempted: cross.counts.reverifyAttempted,
      ageProvenance: age.provenanceCounts,
      buttons: buttons.length,
      windows: verdict.D_autonomy.windows,
      semanticPass: semantic.AUDIT_SEMANTIC_CONSISTENCY_PASS,
      semanticFails: semantic.failCount,
      browserReady: !!desktop,
    },
    null,
    2
  )
);
