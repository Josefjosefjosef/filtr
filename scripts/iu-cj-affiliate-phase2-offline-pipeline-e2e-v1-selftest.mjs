#!/usr/bin/env node
/** Offline end-to-end: import guards → registry idempotency → view model → publication blockers. */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { classifyTimeWindow, assessOffer } from "./iu-cj-affiliate-phase2-lib.mjs";
import { assessActionValidity } from "./iu-cj-affiliate-phase2-media-inventory-lib.mjs";
import {
  evaluatePublicationGates,
  evaluateIntendedUsePermission,
  INTENDED_USE,
  buildPermissionContextForAdvertiser,
} from "./iu-cj-affiliate-phase2-banner-permission-lib.mjs";
import { buildSectionOfferViewModel } from "./iu-cj-affiliate-phase2-offer-cards-view-model.mjs";
import { PRODUCTION_SIGNING_ENABLED } from "./iu-cj-affiliate-phase2-email-ingest-lib.mjs";
import {
  classifyProductFeedHttpStatus,
  evaluateZeroProductResult,
  runUnattendedImportCycle,
} from "./iu-cj-affiliate-phase2-unattended-import-cycle-lib-v1.mjs";

const failures = [];
function fail(id, detail) {
  failures.push({ id, detail });
}

const ref = new Date("2026-10-17T12:00:00.000Z");
const tmpBase = path.join(os.tmpdir(), "iu-cj-e2e-v1-" + process.pid);
fs.mkdirSync(tmpBase, { recursive: true });

if (PRODUCTION_SIGNING_ENABLED !== false) fail("signing_disabled", { PRODUCTION_SIGNING_ENABLED });

const vm = await buildSectionOfferViewModel(null, {
  linkId: "17365257",
  sectionKey: "aff-auto-moto",
  partnerSlug: "autohotarek",
});
if (!vm.ok || vm.previewOnly !== true) fail("valid_fixture_view_model", { ok: vm.ok, previewOnly: vm.previewOnly });
if (!(vm.productCards || []).length) fail("valid_product_cards", {});
if (!vm.coupon) fail("valid_coupon_present", {});
if ((vm.productCards || []).some((c) => c.publicationReady === true)) {
  fail("products_not_publication_ready", { ready: vm.productCards.filter((c) => c.publicationReady).length });
}

const expiredLink = {
  promotionStartDate: "2020-01-01 00:00:00.0",
  promotionEndDate: "2020-12-31 23:59:59.0",
  couponCode: "OLD",
  description: "10% sleva na vše",
};
const expiredOffer = assessOffer(expiredLink, ref);
if (!expiredOffer.publishBlockers.includes("time_window")) fail("expired_product_blocked", expiredOffer.publishBlockers);

const partialStart = assessActionValidity(
  "B_specific_discount_action_banner",
  { promotionStartDate: "2026-01-01 00:00:00.0", promotionEndDate: "" },
  ref
);
if (partialStart.state !== "partially_documented_period") fail("partial_period_not_active", partialStart);

const ctxDenied = buildPermissionContextForAdvertiser(
  "5124968",
  { publisherCid: "7991692", bannerPermissionEvidence: { documents: [] } },
  null,
  ref
);
const permUnknown = evaluateIntendedUsePermission(ctxDenied, INTENDED_USE.publicDisplay);
if (permUnknown.state === "allowed") fail("missing_permission_not_allowed", permUnknown);

const discountRow = {
  bannerRole: "B_specific_discount_action_banner",
  linkName: "Sale",
  affiliateClickUrlPresent: true,
  relationshipStatus: "joined",
  storeHost: "shop.cz",
  partnerLinkVerified: true,
  technicalAvailability: { localImageFile: "x.png" },
  publicationReadiness: { competitorDestinationBlocked: false },
  scopeSummary: { scopeType: "full_sortiment" },
  actionValidity: partialStart,
};
const gatesPartial = evaluatePublicationGates(discountRow, ctxDenied, null);
if (!gatesPartial.blockers.some((b) => b.id === "display_permission_unknown" || b.id === "display_permission_denied")) {
  fail("no_permission_blocks_display", gatesPartial.blockers.map((b) => b.id));
}
if (!gatesPartial.blockers.some((b) => b.id === "action_validity_unverified")) {
  fail("partial_action_blocked", gatesPartial.blockers.map((b) => b.id));
}

const h401 = classifyProductFeedHttpStatus(401);
if (h401.ok !== false || h401.reason !== "cj_api_unauthorized") fail("http_401", h401);
const h403 = classifyProductFeedHttpStatus(403);
if (h403.ok !== false || h403.reason !== "cj_api_forbidden") fail("http_403", h403);
const zero = evaluateZeroProductResult(0);
if (zero.emptyFeed !== true) fail("empty_feed", zero);

const stateDir = path.join(tmpBase, "unattended");
const env = {
  IU_CJ_EMAIL_INGEST_OFFLINE: "1",
  IU_CJ_GITHUB_INGEST_DRY_RUN: "1",
  IU_CJ_D1_BACKEND: "mock",
  IU_CJ_D1_MOCK_PATH: path.join(tmpBase, "d1.json"),
  PRODUCTION_SIGNING_ENABLED: "false",
  IU_CJ_UNATTENDED_STATE_DIR: stateDir,
};
const run1 = await runUnattendedImportCycle({
  env: { ...env, IU_CJ_UNATTENDED_SKIP_EMAIL_INGEST: "1" },
  stateDir,
  mockProductFeedResponse: { status: 200, total: 2 },
  ownerId: "e2e-run-1",
});
const run2 = await runUnattendedImportCycle({
  env: { ...env, IU_CJ_UNATTENDED_SKIP_EMAIL_INGEST: "1" },
  stateDir,
  mockProductFeedResponse: { status: 200, total: 2 },
  ownerId: "e2e-run-2",
});
if (!run1.ok || !run2.ok) fail("repeat_import_runs", { run1: run1.ok, run2: run2.ok });
if (run1.publishable === true || run2.publishable === true) fail("repeat_import_not_publishable", {});
const auditPath = run2.auditPath || path.join(stateDir, "unattended-import-audit.jsonl");
const auditLines = fs.existsSync(auditPath) ? fs.readFileSync(auditPath, "utf8").trim().split("\n").filter(Boolean) : [];
const completes = auditLines.filter((line) => {
  try {
    return JSON.parse(line).event === "run_complete";
  } catch {
    return false;
  }
});
if (completes.length < 2) fail("duplicate_import_audit", { completes: completes.length });

const dupLink = {
  promotionStartDate: "2026-10-12 22:00:00.0",
  promotionEndDate: "2026-10-18 21:59:00.0",
  description: "15% sleva",
  couponCode: "DUP",
};
const dupA = assessOffer(dupLink, ref);
const dupB = assessOffer(dupLink, ref);
if (JSON.stringify(dupA.publishBlockers) !== JSON.stringify(dupB.publishBlockers)) {
  fail("duplicate_product_eval_consistent", {});
}

const provisionOrderLink = {
  promotionStartDate: "2026-10-12 22:00:00.0",
  promotionEndDate: "2026-10-18 21:59:00.0",
  description: "15% sleva",
};
if (classifyTimeWindow(provisionOrderLink.promotionStartDate, provisionOrderLink.promotionEndDate, ref) !== "time_active") {
  fail("closed_window_active", {});
}

console.log(
  JSON.stringify({
    IU_CJ_OFFLINE_PIPELINE_E2E_V1_SELFTEST: failures.length ? "FAIL" : "OK",
    fail: failures.length,
    failures,
    scenarios: 10,
  })
);
process.exit(failures.length ? 1 : 0);
