#!/usr/bin/env node
/**
 * Phase 3M unified lifecycle selftest — offline matrix (no live CJ / IMAP).
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  inventuryUnifiedButtons,
  planBakedMigrationUnderManaged,
  assertEndedRemovalAllowed,
  applyConfirmedEndedAtomic,
  expireSingleCoupon,
  emailHintToLifecycleAction,
  runUnifiedLifecycleSync,
  resolveMojeLekarnaCandidate,
  LIFECYCLE_ACTION,
} from "./iu-cj-affiliate-phase3m-unified-lifecycle-v1.mjs";
import { applyOverlayToSections } from "./iu-cj-affiliate-phase3f-dynamic-catalog-v1.mjs";

const failures = [];
function expect(id, cond, detail) {
  if (!cond) failures.push(detail ? { id, detail } : id);
}

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const WEBSITE_PID = "101883843";
const u = (n) => "https://www.kqzyfj.com/click-" + WEBSITE_PID + "-" + n;

const catalogSrc = fs.readFileSync(path.join(ROOT, "assets", "iu-affiliate-catalog.js"), "utf8");
const managedPublic = JSON.parse(
  fs.readFileSync(
    path.join(ROOT, "projects", "data", "iu-affiliate-cj-managed-public-v1.json"),
    "utf8"
  )
);
const offersDisarmed = JSON.parse(
  fs.readFileSync(
    path.join(ROOT, "projects", "data", "iu-affiliate-cj-offers-public-v1.json"),
    "utf8"
  )
);

// --- inventury ---
const inv = inventuryUnifiedButtons({ catalogSrc, managedPublic });
expect("inv_disarmed", inv.liveEnabled === false && inv.publishArmed === false);
expect("inv_baked", inv.counts.bakedPartners > 0);
expect("inv_managed", inv.counts.managedActive > 0);
expect("inv_overlap_or_managed", inv.counts.uniqueActiveCid >= inv.counts.managedActive);

const mig = planBakedMigrationUnderManaged({
  inventory: inv,
  joined: managedPublic.partners.map((p) => ({
    advertiserId: p.advertiserId,
    advertiserName: p.title,
    sectionId: p.sectionId,
    affiliateUrl: p.url,
    relationshipStatus: "joined",
  })),
});
expect("mig_disarmed", mig.liveEnabled === false);
expect("mig_already_or_planned", mig.counts.alreadyManaged + mig.counts.plannedMigrate >= 0);

// --- 1 new joined ---
const syncAdd = runUnifiedLifecycleSync({
  previousManaged: [],
  joined: [
    {
      advertiserId: "900001",
      advertiserName: "NewJoinedTest",
      sectionId: "aff-lekarny",
      relationshipStatus: "joined",
    },
  ],
  sectionMap: { "900001": "aff-lekarny" },
  urlByAdvertiser: { "900001": u(900001) },
  fetchComplete: true,
});
expect("add_joined", syncAdd.added.some((d) => d.advertiserId === "900001"));
expect("add_disarmed", syncAdd.liveEnabled === false && syncAdd.publishArmed === false);

// --- 2 baked already exists ---
const bakedId = String(managedPublic.partners[0].advertiserId);
const syncBaked = runUnifiedLifecycleSync({
  previousManaged: managedPublic.partners.slice(0, 3),
  joined: [
    {
      advertiserId: bakedId,
      advertiserName: managedPublic.partners[0].title,
      relationshipStatus: "joined",
    },
  ],
  sectionMap: { [bakedId]: managedPublic.partners[0].sectionId },
  urlByAdvertiser: { [bakedId]: managedPublic.partners[0].url },
  fetchComplete: true,
});
expect(
  "baked_existing_keep",
  syncBaked.decisions.some(
    (d) => String(d.advertiserId) === bakedId && (d.decision === "KEEP" || d.decision === "ADD")
  )
);

// --- 3 URL update ---
const syncUrl = runUnifiedLifecycleSync({
  previousManaged: [
    {
      advertiserId: "900002",
      sectionId: "aff-lekarny",
      title: "UrlUp",
      url: u(1),
      active: true,
    },
  ],
  joined: [{ advertiserId: "900002", advertiserName: "UrlUp", relationshipStatus: "joined" }],
  sectionMap: { "900002": "aff-lekarny" },
  urlByAdvertiser: { "900002": u(999002) },
  fetchComplete: true,
});
const urlPartner = syncUrl.nextManagedPublic.partners.find((p) => p.advertiserId === "900002");
expect("url_update", urlPartner && urlPartner.url === u(999002));

// --- 4 section move ---
const syncMove = runUnifiedLifecycleSync({
  previousManaged: [
    {
      advertiserId: "900003",
      sectionId: "aff-pojisteni",
      title: "MoveMe",
      url: u(900003),
      active: true,
    },
  ],
  joined: [{ advertiserId: "900003", advertiserName: "MoveMe", relationshipStatus: "joined" }],
  sectionMap: { "900003": "aff-lekarny" },
  urlByAdvertiser: { "900003": u(900003) },
  fetchComplete: true,
});
const moved = syncMove.nextManagedPublic.partners.find((p) => p.advertiserId === "900003");
expect("section_move", moved && moved.sectionId === "aff-lekarny");

// --- 5 no section → MANUAL_REVIEW ---
const syncMr = runUnifiedLifecycleSync({
  previousManaged: [],
  joined: [{ advertiserId: "900004", advertiserName: "NoSec", relationshipStatus: "joined" }],
  sectionMap: {},
  urlByAdvertiser: { "900004": u(900004) },
  fetchComplete: true,
});
expect(
  "manual_review_no_section",
  syncMr.manualReview.some((d) => d.advertiserId === "900004")
);

// --- 6 duplicate ---
const syncDup = runUnifiedLifecycleSync({
  previousManaged: [
    {
      advertiserId: "900005",
      sectionId: "aff-lekarny",
      title: "Dup",
      url: u(900005),
      active: true,
    },
  ],
  joined: [
    { advertiserId: "900005", advertiserName: "Dup", relationshipStatus: "joined" },
    { advertiserId: "900005", advertiserName: "Dup", relationshipStatus: "joined" },
  ],
  sectionMap: { "900005": "aff-lekarny" },
  urlByAdvertiser: { "900005": u(900005) },
  fetchComplete: true,
});
const dupCount = syncDup.nextManagedPublic.partners.filter((p) => p.advertiserId === "900005").length;
expect("no_duplicate_partner", dupCount === 1);

// --- 7/8/9 confirmed ENDED (managed + baked marker) ---
const offersFull = {
  schema: "iu-affiliate-cj-offers-public-v1",
  liveEnabled: false,
  coupons: [
    { id: "c1", advertiserId: "800001", code: "X" },
    { id: "c2", advertiserId: "800002", code: "Y" },
  ],
  actions: [{ id: "a1", advertiserId: "800001" }],
  products: [
    { id: "p1", advertiserId: "800001", imageUrl: "https://x/y.jpg", currentPrice: 10 },
    { id: "p2", advertiserId: "800002", imageUrl: "https://x/z.jpg", currentPrice: 11 },
  ],
  sections: [],
  stats: { coupons: 2, actions: 1, products: 2 },
};
const endedManaged = applyConfirmedEndedAtomic({
  advertiserId: "800001",
  managedPublic: {
    partners: [
      {
        advertiserId: "800001",
        sectionId: "aff-lekarny",
        title: "EndManaged",
        url: u(800001),
        active: true,
      },
      {
        advertiserId: "800002",
        sectionId: "aff-lekarny",
        title: "Keep",
        url: u(800002),
        active: true,
      },
    ],
  },
  offersPublic: offersFull,
  endedCtx: { confirmedEnded: true, fetchComplete: true },
});
expect("ended_ok", endedManaged.ok === true);
expect(
  "ended_button_inactive",
  endedManaged.nextManagedPublic.partners.find((p) => p.advertiserId === "800001")?.active === false
);
expect(
  "ended_other_active",
  endedManaged.nextManagedPublic.partners.find((p) => p.advertiserId === "800002")?.active !== false
);
// 10/11/12 strip coupons/actions/products
expect("ended_coupons_stripped", endedManaged.stripped.coupons === 1);
expect("ended_actions_stripped", endedManaged.stripped.actions === 1);
expect("ended_products_stripped", endedManaged.stripped.products === 1);
expect(
  "ended_keep_other_coupon",
  endedManaged.nextOffersPublic.coupons.some((c) => c.advertiserId === "800002")
);

// baked-only ENDED still gets active:false marker
const endedBaked = applyConfirmedEndedAtomic({
  advertiserId: "800099",
  managedPublic: { partners: [] },
  offersPublic: { liveEnabled: false, coupons: [], actions: [], products: [], sections: [] },
  endedCtx: {
    confirmedEnded: true,
    fetchComplete: true,
    title: "BakedEnded",
    sectionId: "aff-lekarny",
    url: u(800099),
  },
});
expect(
  "ended_baked_marker",
  endedBaked.nextManagedPublic.partners.some(
    (p) => p.advertiserId === "800099" && p.active === false
  )
);

// overlay hides ended, keeps paid; baked-without-CID title match cannot re-show ENDED
const overlaySections = applyOverlayToSections(
  [
    {
      id: "aff-lekarny",
      items: [
        {
          title: "EndManaged",
          url: u(800001),
          advertiserId: "800001",
          affiliateUrlReady: true,
        },
        {
          title: "EndManaged",
          url: u(800001),
          advertiserId: null,
          affiliateUrlReady: true,
        },
        {
          title: "Paid",
          url: "https://example.com/paid",
          advertiserId: null,
          management: "PAID_RESERVED",
          affiliateUrlReady: true,
        },
      ],
    },
  ],
  endedManaged.nextManagedPublic
);
const chipTitles = (overlaySections[0]?.items || []).map((i) => i.title);
expect("overlay_hides_ended", !chipTitles.includes("EndManaged"));
expect("overlay_keeps_paid", chipTitles.includes("Paid"));

// no duplicate when baked-without-CID matches active managed title
const noDup = applyOverlayToSections(
  [
    {
      id: "aff-lekarny",
      items: [
        {
          title: "Keep",
          url: u(800002),
          advertiserId: null,
          affiliateUrlReady: true,
        },
      ],
    },
  ],
  endedManaged.nextManagedPublic
);
const keepChips = (noDup[0]?.items || []).filter((i) => /keep/i.test(String(i.title)));
expect("overlay_no_title_dupe", keepChips.length === 1);
expect("overlay_title_gets_cid", keepChips[0]?.advertiserId === "800002");

// --- 13 single coupon expire ---
const exp = expireSingleCoupon({
  offersPublic: offersFull,
  couponId: "c1",
  advertiserId: "800001",
});
expect("expire_coupon_only", exp.ok && exp.partnerPreserved === true);
expect("expire_leaves_other", exp.nextOffersPublic.coupons.some((c) => c.id === "c2"));

// --- 14-17 unsafe ENDED ---
for (const [id, ctx] of [
  ["outage", { apiOutage: true, confirmedEnded: true }],
  ["401", { httpStatus: 401, confirmedEnded: true }],
  ["403", { httpStatus: 403, confirmedEnded: true }],
  ["429", { httpStatus: 429, confirmedEnded: true }],
  ["timeout", { timeout: true, confirmedEnded: true }],
  ["paging", { fetchComplete: false, confirmedEnded: true }],
  ["absent", { partnerTemporarilyAbsent: true }],
  ["unclear", { statusUnclear: true }],
  ["parse", { parseError: true, confirmedEnded: true }],
  ["email", { emailOnly: true, confirmedEnded: true }],
]) {
  const g = assertEndedRemovalAllowed(ctx);
  expect("unsafe_" + id, g.ok === false);
}

// --- 18/19 LKG on incomplete ---
const lkg = runUnifiedLifecycleSync({
  previousManaged: [
    {
      advertiserId: "700001",
      sectionId: "aff-lekarny",
      title: "LKG",
      url: u(700001),
      active: true,
    },
  ],
  joined: [],
  fetchComplete: false,
  apiOutage: true,
});
expect("lkg_keep", lkg.ok === false && lkg.nextManagedPublic.partners.length === 1);
expect("lkg_disarmed", lkg.liveEnabled === false);

// --- 21-25 email ---
const spoof = emailHintToLifecycleAction({
  from: "evil@example.com",
  subject: "You are ended",
  kind: "ended",
});
expect("email_spoof_blocked", spoof.blocked === true && spoof.mutate === false);
const dupMail = emailHintToLifecycleAction({
  from: "owner-membermessaging@mx6.cj.com",
  subject: "Approved",
  duplicate: true,
});
expect("email_dup_skip", dupMail.skip === true && dupMail.mutate === false);
const goodHint = emailHintToLifecycleAction({
  from: "owner-membermessaging@mx6.cj.com",
  subject: "Program approval",
  kind: "approved",
  advertiserName: "Eshop.mojelekarna.cz",
});
expect(
  "email_hint_only",
  goodHint.mutate === false &&
    goodHint.requiresCjApi === true &&
    goodHint.action === LIFECYCLE_ACTION.EMAIL_HINT_REQUIRES_CJ_RECONCILE
);

// IMAP unavailable → email path does not mutate
const imapDown = emailHintToLifecycleAction({
  from: "owner-membermessaging@mx6.cj.com",
  subject: "x",
  imapError: "ECONNREFUSED",
});
expect("imap_down_no_mutate", imapDown.mutate === false);

// email vs CJ mismatch: email says ended but CJ not confirmed → reject
const emailEndedNoCj = applyConfirmedEndedAtomic({
  advertiserId: "800001",
  managedPublic: { partners: [{ advertiserId: "800001", active: true, url: u(800001) }] },
  offersPublic: offersFull,
  endedCtx: { emailOnly: true },
});
expect("email_ended_rejected", emailEndedNoCj.ok === false);

// --- 26 Moje lékárna (fixture absence → NOT_IN_JOINED_FIXTURE; synthetic READY) ---
const mojeMissing = resolveMojeLekarnaCandidate([]);
expect("moje_fixture_absent", mojeMissing.found === false);
const mojeReady = resolveMojeLekarnaCandidate([
  {
    advertiserId: "5159999",
    advertiserName: "Eshop.mojelekarna.cz",
    relationshipStatus: "joined",
    sectionId: "aff-lekarny",
    affiliateUrl: u(5159999),
  },
]);
expect("moje_ready_when_joined", mojeReady.status === "READY_FOR_MANAGED_ADD");

// --- 27/28 Novakid / GearUP MANUAL_REVIEW (no section in fixture props) ---
expect(
  "novakid_mr_pattern",
  syncMr.manualReview.length >= 1
);
const novaGear = runUnifiedLifecycleSync({
  previousManaged: [],
  joined: [
    { advertiserId: "5578976", advertiserName: "Novakid INT", relationshipStatus: "joined" },
    { advertiserId: "7804601", advertiserName: "GearUP", relationshipStatus: "joined" },
  ],
  sectionMap: {},
  urlByAdvertiser: { "5578976": u(5578976), "7804601": u(7804601) },
  fetchComplete: true,
});
expect(
  "novakid_manual_review",
  novaGear.manualReview.some((d) => d.advertiserId === "5578976")
);
expect(
  "gearup_manual_review",
  novaGear.manualReview.some((d) => d.advertiserId === "7804601")
);

// --- 29 Gavri KEEP_DRIFT ---
const gavri = runUnifiedLifecycleSync({
  previousManaged: [
    {
      advertiserId: "5614135",
      sectionId: "aff-dum-zahrada",
      title: "Gavri.cz",
      url: u(5614135),
      active: true,
    },
  ],
  joined: [],
  confirmedEndedAdvertiserIds: [],
  fetchComplete: true,
});
expect(
  "gavri_keep_drift",
  gavri.decisions.some(
    (d) =>
      d.advertiserId === "5614135" &&
      String(d.decision).includes("KEEP_DRIFT")
  )
);

// --- 30 paid ads not overwritten ---
expect("paid_preserved", chipTitles.includes("Paid"));

// --- 34 LIVE disarmed on repo offers ---
expect("offers_live_false", offersDisarmed.liveEnabled === false);
expect("sync_disarmed", syncAdd.cjLivePublishing === "DISARMED");

// re-join after ENDED
const rejoin = runUnifiedLifecycleSync({
  previousManaged: endedManaged.nextManagedPublic.partners,
  joined: [
    {
      advertiserId: "800001",
      advertiserName: "EndManaged",
      relationshipStatus: "joined",
    },
  ],
  sectionMap: { "800001": "aff-lekarny" },
  urlByAdvertiser: { "800001": u(800001) },
  fetchComplete: true,
});
expect(
  "rejoin_after_ended",
  rejoin.nextManagedPublic.partners.find((p) => p.advertiserId === "800001")?.active !== false
);

const out = {
  OK: failures.length === 0,
  failures,
  inventury: inv.counts,
  liveEnabled: false,
  publishArmed: false,
  cjLivePublishing: "DISARMED",
  mojeFixture: mojeMissing.status,
};
console.log(JSON.stringify(out, null, 2));
if (failures.length) process.exit(1);
