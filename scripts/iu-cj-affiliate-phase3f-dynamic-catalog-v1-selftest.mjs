#!/usr/bin/env node
/**
 * Offline Phase 3F dynamic unlimited catalog selftest (no live CJ HTTP).
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  DYNAMIC_DECISION,
  syncUnlimitedDynamicCatalog,
  renderSectionChipsHtml,
  stressUnlimitedSectionRender,
  applyOverlayToSections,
} from "./iu-cj-affiliate-phase3f-dynamic-catalog-v1.mjs";
import { planUnlimitedDynamicFills, PLAN_DECISION } from "./iu-cj-affiliate-phase2-partner-slot-planner-v1.mjs";
import { auditAffiliateSectionCapacity } from "./iu-cj-affiliate-phase3e-capacity-audit-v1.mjs";

const failures = [];
function expect(id, cond, detail) {
  if (!cond) failures.push(detail ? { id, detail } : id);
}

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const WEBSITE_PID = "101883843";
const u = (n) => "https://www.kqzyfj.com/click-" + WEBSITE_PID + "-" + n;

const previous = [
  {
    advertiserId: "111",
    sectionId: "aff-pojisteni",
    title: "KeepMe",
    url: u(111),
    active: true,
  },
  {
    advertiserId: "222",
    sectionId: "aff-pojisteni",
    title: "EndMe",
    url: u(222),
    active: true,
  },
  {
    advertiserId: "333",
    sectionId: "aff-dum-zahrada",
    title: "GavriLike",
    url: u(333),
    active: true,
  },
];

const joined = [
  {
    advertiserId: "111",
    advertiserName: "KeepMe",
    relationshipStatus: "joined",
  },
  {
    advertiserId: "444",
    advertiserName: "NewPartner",
    relationshipStatus: "joined",
  },
  {
    advertiserId: "555",
    advertiserName: "NoSection",
    relationshipStatus: "joined",
  },
];

const sync = syncUnlimitedDynamicCatalog({
  joined,
  previousManaged: previous,
  sectionMap: { "111": "aff-pojisteni", "444": "aff-pojisteni" },
  urlByAdvertiser: { "111": u(111), "444": u(444) },
  titleByAdvertiser: { "444": "NewPartner" },
  confirmedEndedAdvertiserIds: ["222"],
  fetchComplete: true,
  slotPolicyPartners: [
    { advertiserId: "999", management: "MANUAL_PROTECTED", sectionId: "aff-pojisteni" },
  ],
});

expect("sync_ok", sync.ok === true);
expect("unlimited_flag", sync.unlimited === true && sync.freeEmptyGateRemoved === true);
expect(
  "added_new",
  sync.added.some((a) => a.advertiserId === "444")
);
expect(
  "removed_ended",
  sync.removed.some((r) => r.advertiserId === "222")
);
expect(
  "drift_kept",
  sync.decisions.some(
    (d) => d.advertiserId === "333" && d.decision === DYNAMIC_DECISION.KEEP_DRIFT
  )
);
expect(
  "manual_review_no_section",
  sync.manualReview.some((m) => m.advertiserId === "555")
);
expect("disarmed", sync.liveEnabled === false && sync.publishArmed === false);

const incomplete = syncUnlimitedDynamicCatalog({
  joined: [],
  previousManaged: previous,
  fetchComplete: false,
});
expect("incomplete_keeps_lkg", incomplete.ok === false && incomplete.removed.length === 0);
expect(
  "incomplete_active_count",
  incomplete.nextManagedPublic.partners.filter((p) => p.active !== false).length === 3
);

const outage = syncUnlimitedDynamicCatalog({
  joined: [],
  previousManaged: previous,
  fetchComplete: true,
  apiOutage: true,
});
expect("outage_no_mass_delete", outage.removed.length === 0 && outage.ok === false);

// Renderer: add many + protect manual
const sections = [
  {
    id: "aff-pojisteni",
    items: [
      {
        title: "PaidManual",
        url: u(1),
        affiliateUrlReady: true,
        advertiserId: "900",
        management: "MANUAL_PROTECTED",
      },
    ],
  },
];
const overlay = {
  partners: [
    {
      advertiserId: "900",
      sectionId: "aff-pojisteni",
      title: "PaidManual",
      url: u(1),
      active: false,
    },
    {
      advertiserId: "444",
      sectionId: "aff-pojisteni",
      title: "NewPartner",
      url: u(444),
      active: true,
    },
    {
      advertiserId: "222",
      sectionId: "aff-pojisteni",
      title: "EndMe",
      url: u(222),
      active: false,
    },
  ],
};
applyOverlayToSections(sections, overlay);
const chips = renderSectionChipsHtml(sections, "aff-pojisteni", overlay);
expect("protected_survives_active_false", chips.chips.some((c) => c.title === "PaidManual"));
expect("dynamic_added_visible", chips.chips.some((c) => c.advertiserId === "444"));
expect("ended_hidden", !chips.chips.some((c) => c.advertiserId === "222"));
expect("rel_sponsored", chips.chips.every((c) => c.rel === "sponsored noopener"));
expect("target_blank", chips.chips.every((c) => c.target === "_blank"));

const stress = stressUnlimitedSectionRender(120);
expect("stress_120", stress.ok === true && stress.rendered === 120, stress);

const plan = planUnlimitedDynamicFills({
  partners: [
    {
      partnerId: "p1",
      advertiserId: "444",
      displayName: "NewPartner",
      primarySectionId: "aff-pojisteni",
      affiliateUrl: u(444),
      approvalState: "approved_pending_button",
    },
  ],
});
expect(
  "planner_unlimited_no_free_slot_block",
  plan.decisions.some((d) => d.decision === PLAN_DECISION.unlimited_append)
);
expect("planner_not_no_free_slot", !plan.decisions.some((d) => d.decision === PLAN_DECISION.no_free_slot));

const cap = auditAffiliateSectionCapacity();
expect("capacity_unlimited_model", cap.dynamicModel === "unlimited_overlay" || cap.businessProposal?.overflowCatalogOutsidePaidSlots?.retired === true);

const map = JSON.parse(
  fs.readFileSync(path.join(ROOT, "projects", "data", "iu-affiliate-cj-section-map-v1.json"), "utf8")
);
expect("klik_pojisteni", map["5871720"] === "aff-pojisteni");

const review = JSON.parse(
  fs.readFileSync(path.join(ROOT, "projects", "data", "iu-affiliate-cj-manual-review-v1.json"), "utf8")
);
expect(
  "klik_not_in_manual",
  !(review.remainingManualReview || []).some((r) => String(r.advertiserId) === "5871720")
);

const ok = failures.length === 0;
console.log(
  JSON.stringify({
    IU_CJ_PHASE3F_DYNAMIC_CATALOG_SELFTEST: ok ? "OK" : "FAIL",
    failures,
    syncCounts: sync.counts,
    stressRendered: stress.rendered,
    chipsInPojisteni: chips.count,
  })
);
process.exit(ok ? 0 : 1);
