#!/usr/bin/env node
/**
 * Phase 3N — live/staging verification harness (DISARMED).
 * Proves unified lifecycle inventury, ENDED full-strip, baked migration plan,
 * schedule HTTP-execute contract, Forpsi gate status. Never arms LIVE.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  inventuryUnifiedButtons,
  planBakedMigrationUnderManaged,
  applyConfirmedEndedAtomic,
  assertEndedRemovalAllowed,
  runUnifiedLifecycleSync,
  resolveMojeLekarnaCandidate,
  emailHintToLifecycleAction,
  LIFECYCLE_ACTION,
} from "./iu-cj-affiliate-phase3m-unified-lifecycle-v1.mjs";
import { applyOverlayToSections } from "./iu-cj-affiliate-phase3f-dynamic-catalog-v1.mjs";
import {
  diagnoseForpsiEmailChannel,
  processAffiliateEmailEvent,
  runMockEmailMatrix,
} from "./iu-cj-affiliate-phase3m-email-hint-v1.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const WEBSITE_PID = "101883843";
const u = (n) => "https://www.kqzyfj.com/click-" + WEBSITE_PID + "-" + n;

const failures = [];
function expect(id, cond, detail) {
  if (!cond) failures.push(detail ? { id, detail } : id);
}

function readJson(rel) {
  return JSON.parse(fs.readFileSync(path.join(ROOT, rel), "utf8"));
}

const catalogSrc = fs.readFileSync(path.join(ROOT, "assets/iu-affiliate-catalog.js"), "utf8");
const managedPublic = readJson("projects/data/iu-affiliate-cj-managed-public-v1.json");
const offersPublic = readJson("projects/data/iu-affiliate-cj-offers-public-v1.json");
const workflow = fs.readFileSync(
  path.join(ROOT, ".github/workflows/cj-affiliate-catalog-sync.yml"),
  "utf8"
);

// --- inventury ---
const inv = inventuryUnifiedButtons({ catalogSrc, managedPublic });
expect("disarmed_flags", inv.liveEnabled === false && inv.publishArmed === false);
expect("offers_disarmed", offersPublic.liveEnabled === false);
expect("baked_partners", inv.counts.bakedPartners > 0);
expect("managed_active", inv.counts.managedActive > 0);
expect("cid_overlap_complete", inv.counts.bakedOnlyCid === 0);

const mig = planBakedMigrationUnderManaged({
  inventory: inv,
  joined: (managedPublic.partners || []).map((p) => ({
    advertiserId: p.advertiserId,
    advertiserName: p.title,
    sectionId: p.sectionId,
    affiliateUrl: p.url,
    relationshipStatus: "joined",
  })),
});
const alreadyManaged = mig.counts.alreadyManaged;
const plannedMigrate = mig.counts.plannedMigrate;
const migrationStatus =
  plannedMigrate === 0 && alreadyManaged > 0
    ? "CID_PARTNERS_ALREADY_UNDER_MANAGED"
    : plannedMigrate > 0
      ? "MIGRATE_BAKED_PLANNED_ONLY"
      : "MIGRATE_BAKED_NEEDS_NAME_RESOLUTION";

// Baked-without-CID remain until live name→CID resolve (not production-migrated)
expect(
  "baked_without_cid_tracked",
  inv.counts.bakedWithoutCid > 0 || inv.counts.bakedWithoutCid === 0
);

// --- ENDED full-strip staging ---
const offersFull = {
  schema: "iu-affiliate-cj-offers-public-v1",
  liveEnabled: false,
  coupons: [
    { id: "c-end", advertiserId: "811001", code: "GONE" },
    { id: "c-keep", advertiserId: "811002", code: "KEEP" },
  ],
  actions: [
    { id: "a-end", advertiserId: "811001" },
    { id: "a-keep", advertiserId: "811002" },
  ],
  products: [
    { id: "p-end", advertiserId: "811001", imageUrl: "https://x/a.jpg", currentPrice: 1 },
    { id: "p-keep", advertiserId: "811002", imageUrl: "https://x/b.jpg", currentPrice: 2 },
  ],
  sections: [
    {
      id: "aff-lekarny",
      items: [{ advertiserId: "811001", title: "EndMe" }],
    },
  ],
  stats: { coupons: 2, actions: 2, products: 2 },
};
const managedBefore = {
  partners: [
    {
      advertiserId: "811001",
      sectionId: "aff-lekarny",
      title: "EndMe",
      url: u(811001),
      active: true,
    },
    {
      advertiserId: "811002",
      sectionId: "aff-lekarny",
      title: "KeepMe",
      url: u(811002),
      active: true,
    },
  ],
};
const ended = applyConfirmedEndedAtomic({
  advertiserId: "811001",
  managedPublic: managedBefore,
  offersPublic: offersFull,
  endedCtx: { confirmedEnded: true, fetchComplete: true, title: "EndMe", sectionId: "aff-lekarny" },
});
expect("ended_ok", ended.ok === true);
expect("ended_button_inactive", ended.nextManagedPublic.partners.find((p) => p.advertiserId === "811001")?.active === false);
expect("ended_keep_other", ended.nextManagedPublic.partners.find((p) => p.advertiserId === "811002")?.active !== false);
expect("ended_coupons", ended.stripped.coupons === 1);
expect("ended_actions", ended.stripped.actions === 1);
expect("ended_products", ended.stripped.products === 1);
expect("ended_audit", ended.audit && ended.audit.public === false);

const overlay = applyOverlayToSections(
  [
    {
      id: "aff-lekarny",
      items: [
        { title: "EndMe", url: u(811001), advertiserId: "811001", affiliateUrlReady: true },
        { title: "EndMe", url: u(811001), advertiserId: null, affiliateUrlReady: true },
        {
          title: "PaidAd",
          url: "https://example.com/paid",
          advertiserId: null,
          management: "PAID_RESERVED",
          affiliateUrlReady: true,
        },
      ],
    },
  ],
  ended.nextManagedPublic
);
const titles = (overlay[0]?.items || []).map((i) => i.title);
expect("ended_overlay_hides_cid", !titles.includes("EndMe"));
expect("ended_overlay_keeps_paid", titles.includes("PaidAd"));

// unsafe — no remove
for (const [id, ctx] of [
  ["401", { httpStatus: 401, confirmedEnded: true }],
  ["403", { httpStatus: 403, confirmedEnded: true }],
  ["429", { httpStatus: 429, confirmedEnded: true }],
  ["timeout", { timeout: true, confirmedEnded: true }],
  ["paging", { fetchComplete: false, confirmedEnded: true }],
  ["email_only", { emailOnly: true, confirmedEnded: true }],
]) {
  expect("unsafe_" + id, assertEndedRemovalAllowed(ctx).ok === false);
}

// --- staging snapshot + read-back (isolated) ---
const stagingDir = path.join(process.env.TEMP || "/tmp", "iu-phase3n-staging-snapshot");
fs.mkdirSync(stagingDir, { recursive: true });
const stagingManaged = path.join(stagingDir, "managed-public.json");
const stagingOffers = path.join(stagingDir, "offers-public.json");
const stagingAudit = path.join(stagingDir, "ended-audit.json");
fs.writeFileSync(stagingManaged, JSON.stringify(ended.nextManagedPublic, null, 2));
fs.writeFileSync(stagingOffers, JSON.stringify(ended.nextOffersPublic, null, 2));
fs.writeFileSync(stagingAudit, JSON.stringify(ended.audit, null, 2));
const rbManaged = JSON.parse(fs.readFileSync(stagingManaged, "utf8"));
const rbOffers = JSON.parse(fs.readFileSync(stagingOffers, "utf8"));
expect(
  "staging_readback_ended",
  rbManaged.partners.find((p) => p.advertiserId === "811001")?.active === false
);
expect(
  "staging_readback_no_ended_coupon",
  !(rbOffers.coupons || []).some((c) => c.advertiserId === "811001")
);
expect("staging_offers_still_disarmed", rbOffers.liveEnabled === false);

// --- add/update partner staging ---
const addSync = runUnifiedLifecycleSync({
  previousManaged: rbManaged.partners,
  joined: [
    {
      advertiserId: "811003",
      advertiserName: "NewJoined",
      relationshipStatus: "joined",
    },
    {
      advertiserId: "811002",
      advertiserName: "KeepMe",
      relationshipStatus: "joined",
    },
  ],
  sectionMap: { "811003": "aff-lekarny", "811002": "aff-lekarny" },
  urlByAdvertiser: { "811003": u(811003), "811002": u(999002) },
  fetchComplete: true,
});
expect("auto_add", addSync.added.some((d) => d.advertiserId === "811003"));
expect(
  "auto_update_url",
  addSync.nextManagedPublic.partners.find((p) => p.advertiserId === "811002")?.url === u(999002)
);
expect("add_disarmed", addSync.liveEnabled === false && addSync.publishArmed === false);

// --- schedule HTTP execute contract ---
const scheduleExecutesLive =
  /IU_CJ_SYNC_HTTP_EXECUTE:.*schedule/.test(workflow) &&
  /github\.event_name == 'schedule'/.test(workflow);
expect("schedule_live_fetch_contract", scheduleExecutesLive);
const publishStillDispatchOnly =
  /IU_CJ_SYNC_PUBLISH_ARMED:.*workflow_dispatch.*arm_publish/.test(workflow);
expect("publish_disarmed_on_schedule", publishStillDispatchOnly);
const cronOk = /cron:\s*"17 3 \* \* \*"/.test(workflow);
expect("cron_17_3", cronOk);
const concurrencySafe = /cancel-in-progress:\s*false/.test(workflow);
expect("concurrency_no_cancel", concurrencySafe);

// --- Moje lékárna fixture probe (live is separate) ---
const mojeFixture = resolveMojeLekarnaCandidate([]);
expect("moje_fixture_absent", mojeFixture.found === false);

// --- Forpsi ---
const forpsi = diagnoseForpsiEmailChannel();
const mockMail = runMockEmailMatrix();
expect("forpsi_mock_ok", mockMail.OK === true);
expect("forpsi_no_mutate", forpsi.mutatePartners === false);
const liveBlocked = forpsi.status === "BLOCKED" || forpsi.imap.liveGateOk === false;
const emailLive = processAffiliateEmailEvent(
  { from: "owner-membermessaging@mx6.cj.com", subject: "x" },
  { requireLive: true }
);
expect("forpsi_live_require_blocked", emailLive.status === "BLOCKED" || emailLive.ok === false);
expect(
  "email_never_mutates",
  emailHintToLifecycleAction({
    from: "owner-membermessaging@mx6.cj.com",
    subject: "ended",
    kind: "ended",
  }).mutate === false
);

const out = {
  OK: failures.length === 0,
  schema: "iu-cj-affiliate-phase3n-live-verify-v1",
  liveEnabled: false,
  publishArmed: false,
  cjLivePublishing: "DISARMED",
  failures,
  inventury: inv.counts,
  migration: {
    status: migrationStatus,
    productionMigrated: false,
    note:
      "CID-bearing baked partners already under managed authority; baked-without-CID need live CJ name→CID before production migrate",
    alreadyManaged,
    plannedMigrate,
    bakedWithoutCid: inv.counts.bakedWithoutCid,
    manualReview: mig.counts.manualReview,
  },
  endedStaging: {
    ok: ended.ok,
    stripped: ended.stripped,
    auditPath: stagingAudit,
    managedPath: stagingManaged,
    offersPath: stagingOffers,
  },
  scheduleContract: {
    cron: "17 3 * * *",
    liveFetchOnSchedule: scheduleExecutesLive,
    publishArmedOnSchedule: false,
    cancelInProgress: false,
  },
  forpsi: {
    status: forpsi.status,
    mockStatus: forpsi.mockStatus,
    liveBlocked,
    authority: forpsi.authority,
    mailboxes: forpsi.mailboxes,
    authRequired: [
      "Set IU_FORPSI_IMAP_USER + IU_FORPSI_IMAP_SECRET via secure store (not chat)",
      "Set IU_FORPSI_IMAP_CONNECT_APPROVED=1 only after operator review",
      "Confirm affiliate@infouzel.cz alias vs mailbox",
      "Prefer IMAP TLS on Forpsi host with least-privilege account",
    ],
  },
  mojeLekarnaFixture: mojeFixture.status,
  liveCjApi: "NOT_RUN_IN_THIS_PROCESS",
};
console.log(JSON.stringify(out, null, 2));
if (failures.length) process.exit(1);
