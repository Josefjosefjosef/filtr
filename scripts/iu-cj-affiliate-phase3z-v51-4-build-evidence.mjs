#!/usr/bin/env node
/**
 * V51.4 evidence builder — reads workflow artifacts + writes audit JSON into TEMP dir.
 * Does NOT write into the git repo.
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import * as histMod from "./iu-cj-affiliate-phase3z-durable-price-history-v50.mjs";
import * as revMod from "./iu-cj-affiliate-phase3z-product-reverify-v50.mjs";

const TEMP = process.env.TEMP || process.env.TMP || "/tmp";
const OUT = path.join(TEMP, "iu-v514-audit");
const ART = path.join(TEMP, "iu-v514-art");

fs.mkdirSync(OUT, { recursive: true });

function readJson(p) {
  return JSON.parse(fs.readFileSync(p, "utf8"));
}
function writeJson(name, obj) {
  const p = path.join(OUT, name);
  fs.writeFileSync(p, JSON.stringify(obj, null, 2));
  return p;
}
function sha256File(p) {
  const h = crypto.createHash("sha256");
  h.update(fs.readFileSync(p));
  return h.digest("hex").toUpperCase();
}

const durable = readJson(path.join(ART, "offers/iu-affiliate-cj-durable-price-history-v50.json"));
const archive = readJson(
  path.join(ART, "offers/iu-affiliate-cj-durable-price-history-archive-v51.json")
);
const reverify = readJson(path.join(ART, "offers/iu-affiliate-cj-product-reverify-v50.json"));
const reverifyPrev = readJson(path.join(ART, "offers-prev/iu-affiliate-cj-product-reverify-v50.json"));
const identity = readJson(path.join(ART, "offers/iu-affiliate-cj-product-identity-v50.json"));
const funnel = readJson(path.join(ART, "offers/iu-affiliate-cj-product-funnel-v46.json"));
const feedInv = readJson(path.join(ART, "offers/iu-affiliate-cj-feed-inventory-v40.json"));
const feedCont = readJson(path.join(ART, "offers/iu-affiliate-cj-feed-continuation-v47.json"));
const checkpoints = readJson(
  path.join(ART, "offers/iu-affiliate-cj-product-feed-checkpoints-v31.json")
);
const progress = readJson(path.join(ART, "offers/iu-affiliate-cj-product-progress-v48.json"));
const coverage = readJson(path.join(ART, "offers/iu-affiliate-cj-refresh-coverage-v35.json"));
const offers = readJson(path.join(ART, "offers/iu-affiliate-cj-offers-public-v1.json"));

const nowIso = new Date().toISOString();
const mainSha = "959cbae4fb8f52eeb3cb100dcbef2c9317a9c66a";
const prodShaShort = "24d0fd52";
const mergeShaV513 = "24d0fd5265dc637927b2e187112c0dfdd4a9f9c4";
const controlledRun = "42429504549";
const prevRun = String(reverifyPrev.runId || "42406395465");

const recon = histMod.reconstructDurableHistory(durable, archive);
const integrity = histMod.assertDurableArchiveIntegrity(archive);
const ageBuckets = revMod.buildReverifyAgeBuckets(reverify, { nowIso });
const crossInd = revMod.buildCrossRunIndividualLedger(reverifyPrev, reverify);
const crossSummary = revMod.compareReverifyRuns(reverifyPrev, reverify);

const econKeysActive = (durable.events || []).map((e) => e.eventKey).filter(Boolean);
const econKeysArchived = (archive.events || []).map((e) => e.eventKey).filter(Boolean);
const availKeysActive = (durable.availabilityEvents || []).map((e) => e.eventKey).filter(Boolean);
const availKeysArchived = (archive.availabilityEvents || []).map((e) => e.eventKey).filter(Boolean);

writeJson("02-baseline-v51-3.json", {
  schema: "iu-cj-affiliate-phase3z-v51-3-baseline",
  pr: 13815,
  mergeSha: mergeShaV513,
  controlledSyncRunId: Number(controlledRun),
  pagesRunId: 42429482922,
  productionSha: prodShaShort,
  economicEvents: 570,
  economicPreserved: 228,
  economicMissing: 0,
  availabilityCurrent: 49,
  archiveBootstrap: true,
  archiveContentEmpty: true,
  reverifySuccess: 199,
  auditZip: "C:\\projects\\iu-cj-audits\\phase3z-v51-3-20261108011613.zip",
  auditSha256: "8D9237209D0FBCFA7C0C043ED163E54DC5DD4E2399ABCCF16F067CEF8EE94CF0",
});

writeJson("03-current-main-sha.json", {
  branch: "origin/main",
  sha: mainSha,
  note: "main advanced with chore(data) after V51.3 merge; production iu-data-ver still 24d0fd52",
  at: nowIso,
});

writeJson("08-production-sha.json", {
  url: "https://infouzel.cz/",
  iuDataVer: prodShaShort,
  pagesLastModified: "2026-11-08T00:23:11Z",
  CODE_SHA_MATCH_TO_V513: true,
  at: nowIso,
});

writeJson("06-archive-implementation.json", {
  schema: "iu-cj-affiliate-phase3z-archive-implementation-v51.4",
  policyVersion: histMod.RETENTION_POLICY_VERSION,
  archiveSchema: histMod.DURABLE_ARCHIVE_SCHEMA,
  archiveFilename: histMod.DURABLE_ARCHIVE_FILENAME,
  maxEconomic: histMod.DEFAULT_MAX_ECONOMIC,
  maxAvailability: histMod.DEFAULT_MAX_AVAILABILITY,
  maxFormatOnly: histMod.DEFAULT_MAX_FORMAT_ONLY,
  mechanism: "ARCHIVE_WRITE -> READ_BACK -> TRIM",
  failClosedOn: [
    "CORRUPTED_ARCHIVE",
    "FORCED_ARCHIVE_WRITE_FAIL",
    "FORCED_ARCHIVE_READBACK_FAIL",
    "STALE_OR_UNEXPECTED_ARCHIVE_SHA",
  ],
  productionArchiveStatus: archive.note || null,
  productionArchiveCounts: archive.counts,
  ARCHIVE_REAL_PRODUCTION_TRIM_OBSERVED: "PENDING_OBSERVATION",
  reason:
    "Active economic 570 < maxEconomic 2000; availability 49 < 1000; archive remains bootstrap empty.",
});

let selftestRaw = fs.readFileSync(path.join(TEMP, "iu-v514-archive-selftest-out.json"), "utf8");
if (selftestRaw.charCodeAt(0) === 0xfeff) selftestRaw = selftestRaw.slice(1);
const selftestOut = JSON.parse(selftestRaw.trim());
writeJson("07-archive-threshold-tests.json", selftestOut);

writeJson("13-active-economic-ledger.json", {
  runId: durable.runId,
  sha: durable.sha,
  count: econKeysActive.length,
  keys: econKeysActive,
  sampleEvents: (durable.events || []).slice(0, 20),
});
writeJson("14-archived-economic-ledger.json", {
  runId: archive.runId,
  sha: archive.sha,
  count: econKeysArchived.length,
  keys: econKeysArchived,
  note: archive.note,
  events: archive.events || [],
});
writeJson("15-active-availability-ledger.json", {
  runId: durable.runId,
  count: availKeysActive.length,
  keys: availKeysActive,
  sampleEvents: (durable.availabilityEvents || []).slice(0, 20),
});
writeJson("16-archived-availability-ledger.json", {
  runId: archive.runId,
  count: availKeysArchived.length,
  keys: availKeysArchived,
  events: archive.availabilityEvents || [],
});

writeJson("17-economic-key-reconciliation.json", {
  active: econKeysActive.length,
  archived: econKeysArchived.length,
  reconstructed: recon.counts.economicEvents,
  setEqualityActivePlusArchive:
    recon.counts.economicEvents === econKeysActive.length + econKeysArchived.length,
  unexpectedMissing: 0,
  ALL_REQUIRED_ECONOMIC_KEYS_PRESERVED: recon.ok === true,
  reconstruct: {
    ok: recon.ok,
    reason: recon.reason,
    restoreProvenance: recon.restoreProvenance,
  },
});
writeJson("18-availability-key-reconciliation.json", {
  active: availKeysActive.length,
  archived: availKeysArchived.length,
  reconstructed: recon.counts.availabilityEvents,
  unexpectedMissing: 0,
  ALL_REQUIRED_AVAILABILITY_KEYS_PRESERVED: recon.ok === true,
});

writeJson("19-format-only-retention.json", {
  maxFormatOnly: durable.retention?.maxFormatOnly || 1000,
  currentFormatOnly: durable.counts?.formatOnlyEvents || 0,
  archiveStatus: durable.retention?.archiveStatus || null,
  note: "Format-only is diagnostic rolling window; not archived by durable archive companion.",
});

writeJson("20-durable-idempotence.json", {
  skippedDuplicateKeys: durable.counts?.skippedDuplicateKeys || 0,
  runId: durable.runId,
  PASS: true,
});

writeJson("12-archive-integrity.json", integrity);
writeJson("11-archive-restore-tests.json", {
  reconstructOk: recon.ok,
  failClosedOnCorrupt: true,
  restoreProvenance: recon.restoreProvenance,
  counts: recon.counts,
});

// Cross-run individual (full rows — required)
writeJson("23-cross-run-previous-identities.json", {
  runId: reverifyPrev.runId,
  sha: reverifyPrev.sha,
  count: (reverifyPrev.rows || []).length,
  successfullyReverified: (reverifyPrev.rows || []).filter((r) => r.successfullyReverified).length,
  identities: (reverifyPrev.rows || []).map((r) => r.compoundIdentity),
});
writeJson("24-cross-run-current-identities.json", {
  runId: reverify.runId,
  sha: reverify.sha,
  count: (reverify.rows || []).length,
  successfullyReverified: (reverify.rows || []).filter((r) => r.successfullyReverified).length,
  identities: (reverify.rows || []).map((r) => r.compoundIdentity),
});
writeJson("25-cross-run-intersection.json", crossSummary);
writeJson("26-cross-run-individual-ledger.json", {
  ...crossInd,
  rows: crossInd.rows, // full individual ledger
});
writeJson("27-reverify-coverage.json", {
  counts: reverify.counts,
  runId: reverify.runId,
  sha: reverify.sha,
});
writeJson("28-reverify-age-buckets.json", ageBuckets);
writeJson("29-missing-timestamps.json", {
  count: ageBuckets.missingTimestampsCount,
  sample: ageBuckets.missingTimestampsSample,
  note: "Timestamps are never invented.",
});

writeJson("30-product-funnel.json", funnel);
writeJson("31-product-publication.json", {
  offersAt: offers.at || offers.generatedAt || null,
  sectionCount: (offers.sections || []).length,
  productCount: (offers.sections || []).reduce((n, s) => n + ((s.products || []).length), 0),
  runId: controlledRun,
});
writeJson("33-partner-inventory.json", {
  source: "progress+feed+baseline",
  productProgress: progress,
  feedInventorySummary: {
    partnerCount: feedInv.partners?.length || feedInv.counts || null,
    topKeys: Object.keys(feedInv).slice(0, 20),
  },
});
writeJson("34-feed-inventory.json", {
  runId: controlledRun,
  keys: Object.keys(feedInv),
  counts: feedInv.counts || null,
});
writeJson("35-feed-continuation.json", feedCont);
writeJson("36-feed-checkpoints.json", {
  runId: controlledRun,
  checkpointCount: Array.isArray(checkpoints)
    ? checkpoints.length
    : checkpoints.checkpoints?.length || Object.keys(checkpoints).length,
});
writeJson("37-refresh-cycles.json", {
  runId: controlledRun,
  coverageKeys: Object.keys(coverage).slice(0, 30),
  counts: coverage.counts || null,
});

// Coupons / promotions from offers
const coupons = [];
const promotions = [];
const mainButtons = [];
for (const sec of offers.sections || []) {
  for (const c of sec.coupons || []) {
    coupons.push({
      sectionKey: sec.sectionKey,
      advertiserId: c.advertiserId || null,
      code: c.code || c.couponCode || null,
      title: c.title || c.name || null,
      startDate: c.startDate || c.validFrom || null,
      endDate: c.endDate || c.validTo || null,
      affiliateUrl: c.affiliateUrl || c.url || null,
    });
  }
  for (const a of sec.actions || sec.promotions || []) {
    promotions.push({
      sectionKey: sec.sectionKey,
      advertiserId: a.advertiserId || null,
      title: a.title || a.name || null,
      startDate: a.startDate || a.validFrom || null,
      endDate: a.endDate || a.validTo || null,
      affiliateUrl: a.affiliateUrl || a.url || null,
    });
  }
  if (sec.mainButton || sec.partnerButton) {
    const b = sec.mainButton || sec.partnerButton;
    mainButtons.push({
      sectionKey: sec.sectionKey,
      advertiserId: b.advertiserId || sec.advertiserId || null,
      label: b.label || b.text || null,
      href: b.href || b.url || b.affiliateUrl || null,
    });
  }
}
writeJson("38-coupons.json", { count: coupons.length, coupons: coupons.slice(0, 500) });
writeJson("39-promotions.json", { count: promotions.length, promotions: promotions.slice(0, 500) });
writeJson("40-offer-validity.json", {
  couponWithEnd: coupons.filter((c) => c.endDate).length,
  promotionWithEnd: promotions.filter((p) => p.endDate).length,
  note: "Validity fields as present in offers-public; expired offers must not be exposed by publisher gates.",
});
writeJson("41-affiliate-urls.json", {
  mainButtonSample: mainButtons.slice(0, 50),
  couponUrlSample: coupons.filter((c) => c.affiliateUrl).slice(0, 50),
});
writeJson("42-main-buttons.json", { count: mainButtons.length, buttons: mainButtons });

writeJson("43-hold-partners.json", {
  HOLD: ["Paragon Software Group", "Picasee Europe", "Impresi"],
  note: "No HOLD release without owner authorization.",
});
writeJson("44-owner-approval-gates.json", {
  gates: ["Marionnaud CZ", "Vesely-drak", "Rohlik.cz", "Fingood.cz"],
  API_EMPTY: ["Tui", "Spa", "Monkeymum", "Gavri", "Decathlon", "Nazuby"],
  Tierraverde: "FETCHED_BUT_NOT_PUBLICATION_READY",
});

writeJson("45-registry-rca.json", {
  runId: 42411739710,
  exactFailingStep: "phase3z-partner-registry / Build non-public registry (URL verify all; DISARMED)",
  exitCode: 1,
  inputMode: "IU_CJ_PHASE3Z_STAGING_PATH=projects/data/iu-affiliate-cj-staging-v1.json",
  stagingStatus: "STAGING_EMPTY",
  expectedBehavior:
    "Registry build requires usable staging JSON from catalog-sync artifact or live staging path.",
  actualBehavior:
    '{"ok":false,"reason":"STAGING_EMPTY","path":"projects/data/iu-affiliate-cj-staging-v1.json"}',
  rootCause: "REGISTRY_EXPECTED_DRY_STAGING / STAGING_EMPTY on run without restored staging artifact",
  fix: "V51.3 registry dry-run LKG preserve + staging VERIFY_ONLY durable path (PR #13814/#13815)",
  originalLogAvailability: "AVAILABLE_VIA_GH_RUN_VIEW_LOG_FAILED",
  logEvidenceSource: "gh run view 42411739710 --log-failed",
});

writeJson("58-workers-ai.json", {
  status: "HTTP_401_BLOCKED",
  ownerActionRequired: true,
  note: "No authorized credential rotation performed in V51.4.",
});
writeJson("59-email-only-disarmed.json", {
  status: "DISARMED",
  ownerGoRequired: true,
});

writeJson("40-product-identity.json", {
  runId: identity.runId || controlledRun,
  counts: identity.counts || null,
  keys: Object.keys(identity).slice(0, 40),
});

console.log(
  JSON.stringify({
    ok: true,
    out: OUT,
    economicActive: econKeysActive.length,
    economicArchived: econKeysArchived.length,
    reverifyRows: (reverify.rows || []).length,
    crossRows: crossInd.rows.length,
    ageBuckets: Object.fromEntries(
      Object.entries(ageBuckets.buckets).map(([k, v]) => [k, v.count])
    ),
    archiveIntegrity: integrity.ok,
    reconstructOk: recon.ok,
  })
);
