#!/usr/bin/env node
/**
 * Offline selftest for the JOINED partner reconciliation / product inventory / ENDED proof exporter.
 * Fixture-only (writes under os.tmpdir(), never the repo).
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";
import {
  buildJoinedPartnerReconciliation,
  buildEndedLongitudinalProof,
  buildAggregateBalance,
  classifyIdentity,
  diffJoinedSets,
  exportProductInventoryJsonl,
  indexOffersByAdvertiser,
  listShardFiles,
  runExport,
} from "./iu-cj-affiliate-joined-partner-recon-export-v1.mjs";

const checks = [];
function check(name, cond, detail) {
  checks.push({ name, ok: cond === true, detail: detail ?? null });
}

const CJ = "https://www.kqzyfj.com/click-101883843-1";
const mk = (id, extra = {}) => ({
  advertiserId: String(id),
  cjName: `P${id}`,
  displayNameCs: `Partner ${id}`,
  relationshipStatus: "joined",
  accountStatus: "Active",
  selectedClickUrl: `${CJ}${id}`,
  selectedDestination: `https://p${id}.cz/`,
  mainButtonReady: true,
  mainButtonStatus: "MAIN_BUTTON_READY",
  sectionId: "aff-x",
  czMarketEligibilityVerified: true,
  selectedLanguage: "CZ",
  ...extra,
});
const registry = {
  generatedAt: "FIXTURE",
  stagingMeta: { sourceKind: "cj_api_xml" },
  partners: [mk(1), mk(2), mk(3, { holdReason: "CZ_ELIGIBILITY_UNKNOWN", czMarketEligibilityVerified: null }), mk(4), mk(5, { relationshipStatus: "ended" })],
};
const offersPublic = {
  updatedAt: "FIXTURE",
  sections: [
    {
      sectionKey: "aff-x",
      coupons: [{ advertiserId: "1", offerId: "c1" }],
      actions: [{ advertiserId: "1", offerId: "a1" }, { advertiserId: "1", offerId: "a1" }],
      products: [
        { advertiserId: "2", productId: "p1" },
        { advertiserId: "2", productId: "p2" },
        { advertiserId: "4", productId: "h1", lkgPublicHold: true, publicationEligibility: "PUBLICATION_HOLD" },
      ],
    },
    { sectionKey: "aff-y", products: [{ advertiserId: "2", productId: "p1" }] },
  ],
  stats: { partners: 2, advertisersWithOffers: 2, uniqueProducts: 2, uniquePublicEligible: 2, lkgPublicHoldProducts: 7, lkgCarriedProducts: 3 },
  publicGrowthBudget: { deferredNew: 10, newCandidates: 10, cumulativeRemaining: 0, allowedNew: 0, uncappedMode: false },
  rejectReasons: { market_not_targeting_cz: 4, incomplete_fields: 2, missing_https_image: 1 },
};

// 1) per-partner recon
const idx = indexOffersByAdvertiser(offersPublic);
check("index_unique_products_dedup_placements", idx.byAdv.get("2").productKeys.size === 2 && idx.byAdv.get("2").productPlacements === 3, null);
check("index_unique_actions_dedup", idx.byAdv.get("1").actionIds.size === 1 && idx.byAdv.get("1").actionPlacements === 2, null);
const recon = buildJoinedPartnerReconciliation({
  registry,
  offersPublic,
  feedInventory: { at: "FIXTURE", partners: [{ advertiserId: "2", hasFeed: true, feedCount: 1, declaredProductCountSum: 9 }], feeds: [{ advertiserId: "2", language: "cs", currency: "CZK", advertiserCountry: "CZ" }] },
  missingFeed: { partners: [{ advertiserId: "3", excludeReason: "PRODUCT_API_EMPTY_OR_NO_ACCESS", rootCause: "x", nextAction: "y" }] },
  expectJoined: 4,
});
const s = recon.summary;
check("joined_4_excludes_ended", s.joined === 4 && recon.partners.length === 4 && s.expectJoinedMatches === true, s);
check("with_without_offers_2_2", s.joinedWithOffers === 2 && s.joinedWithoutOffers === 2, s);
const REQUIRED = ["advertiserId", "name", "affiliateButton", "productsCount", "couponsCount", "actionsCount", "hasProductFeed", "emailOffers", "categories", "localization", "czechMarketAvailability", "partnershipStatus", "unpublishedReason"];
check("every_row_has_required_fields", recon.partners.every((r) => REQUIRED.every((k) => k in r)), null);
const byId = Object.fromEntries(recon.partners.map((r) => [r.advertiserId, r]));
check("counts_p1", byId["1"].couponsCount === 1 && byId["1"].actionsCount === 1 && byId["1"].productsCount === 0, byId["1"]);
check("counts_p2", byId["2"].productsCount === 2 && byId["2"].hasProductFeed === true, byId["2"]);
check("unpublished_reason_only_without_offers", byId["1"].unpublishedReason === null && byId["2"].unpublishedReason === null && Boolean(byId["3"].unpublishedReason) && Boolean(byId["4"].unpublishedReason), null);
check("reason_registry_hold_and_missing_feed", byId["3"].unpublishedReason.all.includes("REGISTRY_CZ_ELIGIBILITY_UNKNOWN") && byId["3"].unpublishedReason.all.includes("FEED_PRODUCT_API_EMPTY_OR_NO_ACCESS"), byId["3"].unpublishedReason);
check("reason_no_feed_when_feed_inventory_lists_absent", byId["4"].hasProductFeed === false && byId["4"].unpublishedReason.all.includes("NO_PRODUCT_FEED_AND_NO_PUBLISHED_COUPON_OR_ACTION"), byId["4"].unpublishedReason);
check("held_products_not_published", byId["4"].productsCount === 0 && byId["4"].productsHeldCount === 1 && byId["4"].unpublishedReason.primary === "ALL_PRODUCTS_LKG_PUBLIC_HOLD" && idx.heldKeys.has("4|h1") && !idx.publishedKeys.has("4|h1"), byId["4"]);
check("affiliate_button_valid", byId["1"].affiliateButton.cjTrackingUrlValid === true, byId["1"].affiliateButton);
check("cz_unknown_row", byId["3"].czechMarketAvailability.status === "CZ_UNKNOWN", byId["3"].czechMarketAvailability);
check("joined_ne_stats_partners_guard", s.statsPartnersIsNotJoined === true, s);

// 2) classification + JSONL export
const ctx = {
  joinedIds: new Set(["1", "2"]),
  endedIds: new Set(["9"]),
  publishedKeys: new Set(["1|pub"]),
  heldKeys: new Set(["1|heldOffers"]),
  invalidKeys: new Set(["1|inv"]),
  retryKeys: new Set(["1|ret"]),
  deferredKeys: new Set(["1|def"]),
  growthBudgetExhausted: true,
};
const base = { advertiserId: "1", title: "t", imageUrl: "i", currentPrice: "1", affiliateUrl: "u", publicationEligibility: "PUBLICATION_ELIGIBLE", freshnessStatus: "SOURCE_VERIFIED" };
const cls = (o) => classifyIdentity({ ...base, ...o }, ctx);
check("cls_published_wins", cls({ productId: "pub", lkgPublicHold: true }) === "published", null);
check("cls_invalid", cls({ productId: "inv" }) === "invalid", null);
check("cls_hold", cls({ productId: "h", lkgPublicHold: true }) === "hold", null);
check("cls_hold_from_offers_held_keys", cls({ productId: "heldOffers" }) === "hold", null);
check("cls_retry", cls({ productId: "ret" }) === "retry", null);
check("cls_blocked_growth", cls({ productId: "def" }) === "blocked_growth_only", null);
check("cls_eligible_new_not_in_ledger", cls({ productId: "new" }) === "eligible_new", null);
check("cls_missing_business", cls({ productId: "m", title: "" }) === "missing_business_data", null);
check("cls_ended", cls({ productId: "e", advertiserId: "9" }) === "ended_partnership", null);
check("cls_pending_verification", cls({ productId: "pv", freshnessStatus: "PENDING" }) === "unavailable", null);

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "iu-cj-recon-selftest-"));
const shardDir = path.join(tmp, "shards");
fs.mkdirSync(shardDir);
const rec = (pid, extra = {}) => ({ ...base, productId: pid, sectionKey: "aff-x", currency: "CZK", availabilityClass: "IN_STOCK", ...extra });
const shardA = { products: Object.fromEntries(["pub", "def", "new", "ret"].map((p) => [`1|${p}`, rec(p)])) };
const shardB = { products: { "1|pub": rec("pub"), "2|z": rec("z", { advertiserId: "2" }), "1|bad": rec("other") } };
fs.writeFileSync(path.join(shardDir, "iu-affiliate-cj-durable-catalog-shard-v51-s0000.json"), JSON.stringify(shardA));
fs.writeFileSync(path.join(shardDir, "iu-affiliate-cj-durable-catalog-shard-v51-s0001.json"), JSON.stringify(shardB));
fs.writeFileSync(path.join(shardDir, "unrelated.json"), "{}");
const files = listShardFiles(shardDir);
check("list_shards_filters", files.length === 2, files);
check("list_shards_missing_dir_empty", listShardFiles(path.join(tmp, "nope")).length === 0, null);
const out = path.join(tmp, "inv.jsonl.gz");
const r = await exportProductInventoryJsonl({ shardFiles: files, outFile: out, ctx });
check("source_rows_7", r.sourceRows === 7, r.sourceRows);
check("duplicates_1_unique_6", r.duplicates === 1 && r.uniqueCompositeIds === 6, r);
check("identity_collisions_1_key_mismatch", r.identityCollisions === 1, r.identityCollisions);
const sum = Object.values(r.countsByPrimaryState).reduce((a, b) => a + b, 0);
check("exclusive_sum_equals_unique", sum === r.uniqueCompositeIds, r.countsByPrimaryState);
const lines = zlib.gunzipSync(fs.readFileSync(out)).toString("utf8").trim().split("\n").map((l) => JSON.parse(l));
check("jsonl_roundtrip_lines_eq_unique", lines.length === r.uniqueCompositeIds && lines.every((l) => l.key && l.primaryState), lines.length);
check("jsonl_published_1", lines.filter((l) => l.primaryState === "published").length === 1, null);

// 3) aggregate balance (offers.publicGrowthBudget + stats)
const bal = buildAggregateBalance({ offersPublic, runLevelRetry: 1, runLevelInvalid: 1 });
check("balance_blocked_growth_only", bal.countsByPrimaryState.blocked_growth_only === 10, bal.countsByPrimaryState);
check("balance_hold_from_stats", bal.countsByPrimaryState.hold === 7 && bal.countsByPrimaryState.lkg === 3, bal.countsByPrimaryState);
check("balance_pass_safe", bal.gates.PASS_SAFE === true, bal.gates);

// 4) end-to-end run: shards absent => EXTERNAL_BLOCKED; shards present => JSONL
const regPath = path.join(tmp, "registry.json");
const offPath = path.join(tmp, "offers.json");
fs.writeFileSync(regPath, JSON.stringify(registry));
fs.writeFileSync(offPath, JSON.stringify(offersPublic));
const blocked = await runExport({ outDir: path.join(tmp, "o1"), registry: regPath, offers: offPath, shardDir: path.join(tmp, "missing"), expectJoined: "4" });
check("blocked_when_shards_absent", blocked.aggregate.status === "EXTERNAL_BLOCKED_ARTIFACT_MISSING" && blocked.aggregate.EXTERNAL_BLOCKED.code === "ARTIFACT_MISSING" && blocked.jsonlFile === null, blocked.aggregate.status);
check("blocked_lists_expected_paths", Boolean(blocked.aggregate.EXTERNAL_BLOCKED.expectedPaths.shardDir), null);
check("blocked_still_emits_aggregate", blocked.aggregate.authoritativeCounts.blockedGrowthOnly === 10 && blocked.aggregate.authoritativeCounts.hold === 7, blocked.aggregate.authoritativeCounts);
const full = await runExport({ outDir: path.join(tmp, "o2"), registry: regPath, offers: offPath, shardDir, expectJoined: "4" });
check("full_has_jsonl_and_shard_evidence", fs.existsSync(full.jsonlFile) && full.aggregate.shardEvidence.uniqueCompositeIds === 6, full.aggregate.status);
check("full_per_partner_durable_catalog", full.recon.partners.find((p) => p.advertiserId === "1").durableCatalog.catalogIdentities > 0, null);
let refused = false;
try {
  await runExport({ outDir: path.join(path.resolve("."), "tmp-should-refuse"), registry: regPath, offers: offPath });
} catch {
  refused = true;
}
check("refuses_out_dir_inside_repo", refused === true, null);

// 5) ENDED longitudinal proof (fixture)
const proof = buildEndedLongitudinalProof({});
check("ended_proof_ok", proof.ok === true, proof.failed);
check("ended_proof_no_production_claim", proof.productionEndedEventClaimed === false && proof.evidenceClass === "FIXTURE_MECHANISM_PROOF", proof.claim);
check("ended_proof_scenarios_ge_7", proof.scenarios.length >= 7, proof.scenarios.length);
const dj = diffJoinedSets({ partners: [mk(1), mk(2)] }, { partners: [mk(1), mk(3)] }, "x");
check("diff_joined_sets_informational", dj.absentNowButJoinedBefore.join() === "3" && dj.newlyJoined.join() === "2" && dj.productionEndedEventClaimed === false, dj);

fs.rmSync(tmp, { recursive: true, force: true });

const failed = checks.filter((c) => !c.ok);
console.log(
  JSON.stringify({
    IU_CJ_JOINED_PARTNER_RECON_EXPORT_SELFTEST: failed.length === 0 ? "PASS" : "FAIL",
    checks: checks.length,
    failed: failed.map((f) => ({ name: f.name, detail: f.detail })),
  }),
);
if (failed.length) process.exit(1);
