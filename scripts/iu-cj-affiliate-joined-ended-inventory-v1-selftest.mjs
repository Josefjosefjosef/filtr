#!/usr/bin/env node
/**
 * Offline selftest: JOINED / ENDED inventory vs stats.partners distinction.
 * Fixture checks are mandatory; committed-artifact checks run when artifacts exist (read-only).
 */
import fs from "node:fs";
import {
  buildJoinedEndedInventory,
  loadInventoryFromArtifacts,
  DEFAULT_REGISTRY_PATH,
  DEFAULT_OFFERS_PUBLIC_PATH,
} from "./iu-cj-affiliate-joined-ended-inventory-v1.mjs";
import { runPartnerLifecycleAuditSelftest } from "./iu-cj-affiliate-phase3z-partner-lifecycle-audit-v51-8.mjs";
import { runPartnerInventoryExportSelftest } from "./iu-cj-affiliate-phase3z-partner-inventory-export-v51-8.mjs";

const checks = [];
function check(name, cond, detail) {
  checks.push({ name, ok: cond === true, detail: detail ?? null });
}

const mk = (id, rel) => ({ advertiserId: String(id), relationshipStatus: rel });
const registry = {
  stagingMeta: { sourceKind: "cj_api_xml" },
  partners: [mk(1, "joined"), mk(2, "joined"), mk(3, "joined"), mk(4, "joined"), mk(5, "ended")],
};
const offersPublic = {
  sections: [
    { advertiserId: "1", coupons: [{ advertiserId: "1" }] },
    { advertiserId: "2", actions: [{ advertiserId: "2" }] },
    { advertiserId: "99", products: [{ advertiserId: "99" }] },
  ],
  stats: {
    partners: 3,
    advertisersWithOffers: 3,
    joinedPartnersNotImplied: true,
    statsSemantics: "partners(=advertisersWithOffers) ... NOT CJ JOINED count",
  },
};

// 1) Core semantics: joined (4) != stats.partners (3); sets differ
const inv = buildJoinedEndedInventory({ registry, offersPublic });
const d = inv.denominators;
check("fixture_joined_4", d.joined === 4, d);
check("fixture_stats_partners_3", d.statsPartners === 3 && d.advertisersWithOffers === 3, d);
check("fixture_joined_ne_stats_partners", inv.guards.joinedCountNotEqualStatsPartners === true, inv.guards);
check("fixture_explicit_ended_1", d.ended === 1 && inv.lists.endedIds[0] === "5", inv.lists);
check("fixture_joined_with_offers_2", d.joinedWithOffers === 2, d);
check("fixture_joined_without_offers_2", d.joinedWithoutOffers === 2, d);
check("fixture_offers_not_joined_1", d.offersAdvertisersNotInJoined === 1 && inv.lists.offersAdvertisersNotInJoinedIds[0] === "99", d);
check("fixture_offer_set_matches_stats", inv.guards.offerAdvertiserSetSizeMatchesStats === true, inv.guards);
check("fixture_semantics_declared", inv.guards.statsSemanticsDeclaredNotJoined === true && /NOT CJ JOINED/i.test(inv.statsPartnersSemantics), inv.statsPartnersSemantics);
check("fixture_joined_ended_disjoint", inv.guards.joinedEndedDisjoint === true, inv.guards);

// 2) ENDED via previous-registry diff on a complete CJ fetch
const prev = { partners: [mk(1, "joined"), mk(2, "joined"), mk(3, "joined"), mk(4, "joined"), mk(6, "joined")] };
const diff = buildJoinedEndedInventory({ registry, offersPublic, previousRegistry: prev });
check("diff_ended_includes_6_and_5", diff.lists.endedIds.join(",") === "5,6", diff.lists.endedIds);
check("diff_joined_stays_4", diff.denominators.joined === 4, diff.denominators);

// 3) ENDED must NOT be inferred when CJ API down / fetch incomplete
const apiDown = buildJoinedEndedInventory({
  registry,
  offersPublic,
  previousRegistry: prev,
  endedSample: [{ advertiserId: "6", status: "ENDED", errorKind: "CJ_API_DOWN" }],
});
check("api_down_blocks_diff", apiDown.lists.endedIds.join(",") === "5" && apiDown.ended.diffSkippedReason === "cj_api_down_false_positive", apiDown.ended);
check("api_down_guard_false", apiDown.guards.endedNotInferredFromApiDown === false, apiDown.guards);
const incomplete = buildJoinedEndedInventory({
  registry,
  offersPublic,
  previousRegistry: prev,
  currentFetchComplete: false,
});
check("incomplete_fetch_blocks_diff", incomplete.ended.fromPreviousRegistryDiff === 0 && incomplete.ended.diffSkippedReason === "current_fetch_incomplete_or_not_cj_authoritative", incomplete.ended);

// 4) Non-authoritative (fixture/email-ish) registry is flagged
const nonAuth = buildJoinedEndedInventory({ registry: { partners: registry.partners }, offersPublic });
check("non_cj_not_authoritative", nonAuth.guards.cjAuthoritative === false, nonAuth.authority);

// 5) Equal-by-coincidence is detected (guard not hard-coded true)
const eq = buildJoinedEndedInventory({
  registry: { stagingMeta: { sourceKind: "cj_api_xml" }, partners: [mk(1, "joined"), mk(2, "joined")] },
  offersPublic: { sections: [{ coupons: [{ advertiserId: "1" }] }, { actions: [{ advertiserId: "2" }] }], stats: { partners: 2, advertisersWithOffers: 2 } },
});
check("coincidence_detected", eq.guards.joinedCountNotEqualStatsPartners === false, eq.guards);

// 6) Committed artifacts (read-only, offline)
let artifacts = "SKIPPED";
if (fs.existsSync(DEFAULT_REGISTRY_PATH) && fs.existsSync(DEFAULT_OFFERS_PUBLIC_PATH)) {
  const real = loadInventoryFromArtifacts({});
  const r = real.denominators;
  artifacts = { joined: r.joined, ended: r.ended, statsPartners: r.statsPartners };
  check("artifact_cj_authoritative", real.guards.cjAuthoritative === true, real.authority);
  check("artifact_joined_positive", r.joined > 0, r);
  check("artifact_joined_ne_stats_partners", real.guards.joinedCountNotEqualStatsPartners === true, { joined: r.joined, statsPartners: r.statsPartners });
  check("artifact_stats_eq_offer_advertisers", real.guards.offerAdvertiserSetSizeMatchesStats === true, { offerIds: r.offerAdvertiserIds, stats: r.advertisersWithOffers });
  check("artifact_semantics_flags", real.guards.statsSemanticsDeclaredNotJoined === true && real.guards.joinedPartnersNotImpliedFlag === true, real.guards);
  check("artifact_joined_ended_disjoint", real.guards.joinedEndedDisjoint === true, real.guards);
}

// 7) Related selftests stay green (G-PARTNER-LIFECYCLE)
const lifecycle = runPartnerLifecycleAuditSelftest();
check("lifecycle_audit_selftest", lifecycle.ok === true, lifecycle.failed);
const exportSt = runPartnerInventoryExportSelftest();
check("partner_inventory_export_selftest", exportSt.ok === true, exportSt.failed);

const failed = checks.filter((c) => !c.ok);
const ok = failed.length === 0;
console.log(
  JSON.stringify({
    IU_CJ_JOINED_ENDED_INVENTORY_SELFTEST: ok ? "PASS" : "FAIL",
    checks: checks.length,
    failed: failed.map((f) => ({ name: f.name, detail: f.detail })),
    artifacts,
  }),
);
if (!ok) process.exit(1);
