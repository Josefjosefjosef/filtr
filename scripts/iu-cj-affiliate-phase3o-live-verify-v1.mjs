#!/usr/bin/env node
/**
 * Phase 3O — staging + optional live-staging-file verification (DISARMED).
 * Completes baked-without-CID classification, Moje URL probe, ENDED full-strip,
 * Forpsi gate, schedule contract. Never arms LIVE. Never writes production catalog.
 *
 * Optional env:
 *   IU_CJ_PHASE3O_STAGING_JSON — path to live fetch staging JSON (advertisers+links)
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  inventuryUnifiedButtons,
  applyConfirmedEndedAtomic,
  assertEndedRemovalAllowed,
  runUnifiedLifecycleSync,
} from "./iu-cj-affiliate-phase3m-unified-lifecycle-v1.mjs";
import { applyOverlayToSections } from "./iu-cj-affiliate-phase3f-dynamic-catalog-v1.mjs";
import {
  planBakedMigrationFromLiveStaging,
  resolveAdvertiserTrustedUrl,
} from "./iu-cj-affiliate-phase3o-baked-cid-resolve-v1.mjs";
import {
  diagnoseForpsiEmailChannel,
  processAffiliateEmailEvent,
  runMockEmailMatrix,
} from "./iu-cj-affiliate-phase3m-email-hint-v1.mjs";
import { assertForpsiImapLiveConnectAllowed } from "./iu-forpsi-imap-credentials-interface.mjs";

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

// Repo offers may be LIVE after Phase 3V promote; require ready content when live.
if (offersPublic.liveEnabled === true) {
  expect(
    "offers_live_has_ready",
    (offersPublic.stats?.publicationReady || 0) > 0 ||
      (Array.isArray(offersPublic.sections) && offersPublic.sections.length > 0)
  );
} else {
  expect("offers_disarmed", offersPublic.liveEnabled === false);
}

const stagingPath =
  process.env.IU_CJ_PHASE3O_STAGING_JSON ||
  path.join(process.env.TEMP || "/tmp", "iu-phase3o-artifact", "iu-affiliate-cj-staging-v1.json");
let liveStaging = null;
let liveStagingSource = "ABSENT";
if (fs.existsSync(stagingPath)) {
  liveStaging = JSON.parse(fs.readFileSync(stagingPath, "utf8"));
  liveStagingSource = stagingPath;
}

const advertisers = liveStaging?.advertisers || [];
const links = liveStaging?.links || [];
const liveAvailable = advertisers.length > 0;

const planned = planBakedMigrationFromLiveStaging({
  catalogSrc,
  managedPublic,
  advertisers: liveAvailable ? advertisers : [],
  links: liveAvailable ? links : [],
});

expect("disarmed", planned.liveEnabled === false && planned.publishArmed === false);
expect("inv_baked", planned.inventoryCounts.bakedPartners > 0);

if (liveAvailable) {
  expect(
    "baked_resolve_progress",
    planned.classified.counts.resolvedActiveJoined >= 1 ||
      planned.classified.counts.manualReview === planned.classified.counts.bakedWithoutCid
  );
  expect(
    "no_false_prod_migrate_flag",
    planned.productionMigrated === false
  );
}

// --- staging apply migrate slice (isolated TEMP only) ---
const stagingDir = path.join(process.env.TEMP || "/tmp", "iu-phase3o-staging-snapshot");
fs.mkdirSync(stagingDir, { recursive: true });

const prevPartners = Array.isArray(managedPublic.partners) ? managedPublic.partners : [];
const prevIds = new Set(prevPartners.map((p) => String(p.advertiserId)));
const migrateSlice = liveAvailable ? planned.migrateSlice || [] : [];
const nextPartners = [
  ...prevPartners.map((p) => ({ ...p })),
  ...migrateSlice
    .filter((p) => !prevIds.has(String(p.advertiserId)))
    .map((p) => ({
      advertiserId: String(p.advertiserId),
      sectionId: p.sectionId,
      title: p.title,
      url: p.url,
      active: true,
      management: "CJ_MANAGED",
      migratedFrom: "baked",
    })),
];
const stagingManagedDoc = {
  schema: managedPublic.schema || "iu-affiliate-cj-managed-public-v1",
  liveEnabled: false,
  publishArmed: false,
  partners: nextPartners,
  note: "PHASE3O_STAGING_ONLY_NOT_PRODUCTION",
};
const stagingManagedPath = path.join(stagingDir, "managed-public-migrated.json");
fs.writeFileSync(stagingManagedPath, JSON.stringify(stagingManagedDoc, null, 2));
const rbMig = JSON.parse(fs.readFileSync(stagingManagedPath, "utf8"));
expect("staging_migrate_disarmed", rbMig.liveEnabled === false);
expect(
  "staging_migrate_readback_count",
  (rbMig.partners || []).length === nextPartners.length
);
if (liveAvailable && migrateSlice.length) {
  const sampleId = String(migrateSlice[0].advertiserId);
  expect(
    "staging_migrate_includes_sample",
    (rbMig.partners || []).some((p) => String(p.advertiserId) === sampleId)
  );
}

// --- ENDED full-strip on staging migrated doc ---
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
  stats: { coupons: 2, actions: 2, products: 2 },
};
const managedBefore = {
  liveEnabled: false,
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
  endedCtx: {
    confirmedEnded: true,
    fetchComplete: true,
    title: "EndMe",
    sectionId: "aff-lekarny",
  },
});
expect("ended_ok", ended.ok === true);
expect(
  "ended_button_inactive",
  ended.nextManagedPublic.partners.find((p) => p.advertiserId === "811001")?.active === false
);
expect("ended_coupons", ended.stripped.coupons === 1);
expect("ended_actions", ended.stripped.actions === 1);
expect("ended_products", ended.stripped.products === 1);
expect("ended_audit_private", ended.audit && ended.audit.public === false);

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
expect("ended_hides_baked_and_managed", !titles.includes("EndMe"));
expect("ended_keeps_paid", titles.includes("PaidAd"));

for (const [id, ctx] of [
  ["401", { httpStatus: 401, confirmedEnded: true }],
  ["403", { httpStatus: 403, confirmedEnded: true }],
  ["429", { httpStatus: 429, confirmedEnded: true }],
  ["timeout", { timeout: true, confirmedEnded: true }],
  ["paging", { fetchComplete: false, confirmedEnded: true }],
  ["unclear", { statusUnclear: true }],
  ["email_only", { emailOnly: true, confirmedEnded: true }],
]) {
  expect("unsafe_" + id, assertEndedRemovalAllowed(ctx).ok === false);
}

const endedManagedPath = path.join(stagingDir, "managed-after-ended.json");
const endedOffersPath = path.join(stagingDir, "offers-after-ended.json");
const endedAuditPath = path.join(stagingDir, "ended-audit.json");
fs.writeFileSync(endedManagedPath, JSON.stringify(ended.nextManagedPublic, null, 2));
fs.writeFileSync(endedOffersPath, JSON.stringify(ended.nextOffersPublic, null, 2));
fs.writeFileSync(endedAuditPath, JSON.stringify(ended.audit, null, 2));
const rbEnded = JSON.parse(fs.readFileSync(endedManagedPath, "utf8"));
expect(
  "ended_readback",
  rbEnded.partners.find((p) => p.advertiserId === "811001")?.active === false
);

// LKG / rollback: unsafe keep previous
const lkg = applyConfirmedEndedAtomic({
  advertiserId: "811002",
  managedPublic: managedBefore,
  offersPublic: offersFull,
  endedCtx: { httpStatus: 429, confirmedEnded: true },
});
expect("lkg_no_remove", lkg.ok === false);
expect(
  "lkg_partners_unchanged",
  lkg.nextManagedPublic.partners.find((p) => p.advertiserId === "811002")?.active !== false
);

// add/update lifecycle still works
const addSync = runUnifiedLifecycleSync({
  previousManaged: ended.nextManagedPublic.partners,
  joined: [
    { advertiserId: "811003", advertiserName: "NewJoined", relationshipStatus: "joined" },
    { advertiserId: "811002", advertiserName: "KeepMe", relationshipStatus: "joined" },
  ],
  sectionMap: { "811003": "aff-lekarny", "811002": "aff-lekarny" },
  urlByAdvertiser: { "811003": u(811003), "811002": u(999002) },
  fetchComplete: true,
});
expect("auto_add", addSync.added.some((d) => d.advertiserId === "811003"));
expect("add_disarmed", addSync.liveEnabled === false);

// --- Moje + related missing-URL partners ---
const moje = liveAvailable
  ? resolveAdvertiserTrustedUrl({
      advertiserId: "6466592",
      advertisers,
      links,
      suggestedSection: "aff-lekarny",
      titleHints: ["Mojelekarna", "Moje lékárna"],
    })
  : { status: "LIVE_STAGING_ABSENT", found: false, readyForManagedAdd: false };
const novakid = liveAvailable
  ? resolveAdvertiserTrustedUrl({
      advertiserId: "5578976",
      advertisers,
      links,
      suggestedSection: null,
    })
  : { status: "LIVE_STAGING_ABSENT" };
const gearup = liveAvailable
  ? resolveAdvertiserTrustedUrl({
      advertiserId: "7804601",
      advertisers,
      links,
      suggestedSection: null,
    })
  : { status: "LIVE_STAGING_ABSENT" };
const gavriManaged = (managedPublic.partners || []).find((p) => String(p.advertiserId) === "5614135");
const gavriJoined = liveAvailable
  ? advertisers.some((a) => String(a.advertiserId) === "5614135")
  : null;

if (liveAvailable) {
  expect("moje_found", moje.found === true);
  expect(
    "moje_missing_or_ready",
    moje.status === "MANUAL_REVIEW_MISSING_URL" || moje.status === "READY_FOR_MANAGED_ADD"
  );
  if (moje.status === "MANUAL_REVIEW_MISSING_URL") {
    expect("moje_no_fake_url", moje.hasTrustedCjUrl === false && moje.readyForManagedAdd === false);
  }
}

// --- schedule contract ---
expect(
  "schedule_live_fetch",
  /IU_CJ_SYNC_HTTP_EXECUTE:.*schedule/.test(workflow) &&
    /github\.event_name == 'schedule'/.test(workflow)
);
expect("cron_17_3", /cron:\s*"17 3 \* \* \*"/.test(workflow));
expect(
  "publish_dispatch_only",
  /IU_CJ_SYNC_PUBLISH_ARMED:.*workflow_dispatch/.test(workflow)
);
expect("concurrency_safe", /cancel-in-progress:\s*false/.test(workflow));

// --- Forpsi ---
const forpsi = diagnoseForpsiEmailChannel();
const forpsiGate = assertForpsiImapLiveConnectAllowed();
const mockMail = runMockEmailMatrix();
expect("forpsi_mock", mockMail.OK === true);
expect("forpsi_no_mutate", forpsi.mutatePartners === false);
const emailLive = processAffiliateEmailEvent(
  { from: "owner-membermessaging@mx6.cj.com", subject: "x" },
  { requireLive: true }
);
expect("forpsi_live_blocked_without_approval", emailLive.status === "BLOCKED" || emailLive.ok === false);

const classifyPath = path.join(stagingDir, "baked-classify.json");
fs.writeFileSync(
  classifyPath,
  JSON.stringify(
    {
      classified: planned.classified,
      planCounts: planned.plan?.counts || null,
      productionMigrated: false,
    },
    null,
    2
  )
);

const out = {
  OK: failures.length === 0,
  schema: "iu-cj-affiliate-phase3o-live-verify-v1",
  liveEnabled: false,
  publishArmed: false,
  cjLivePublishing: "DISARMED",
  failures,
  liveStagingSource: liveAvailable ? liveStagingSource : "ABSENT",
  liveJoinedCount: liveAvailable ? advertisers.length : null,
  liveLinkCount: liveAvailable ? links.length : null,
  inventury: planned.inventoryCounts,
  bakedMigration: {
    productionMigrated: false,
    status: liveAvailable
      ? planned.classified.counts.manualReview === 0 &&
        planned.classified.counts.resolvedActiveJoined ===
          planned.classified.counts.bakedWithoutCid
        ? "STAGING_MIGRATE_READY_ALL_RESOLVED"
        : "STAGING_MIGRATE_READY_PARTIAL_MANUAL_REVIEW"
      : "LIVE_STAGING_REQUIRED_FOR_RESOLVE",
    classifiedCounts: planned.classified.counts,
    planCounts: planned.plan?.counts || null,
    stagingManagedPath,
    classifyPath,
    manualReviewSample: (planned.classified.classifications || [])
      .filter((c) => c.status === "MANUAL_REVIEW")
      .slice(0, 10),
  },
  mojeLekarna: moje,
  novakid,
  gearup,
  gavri: {
    inManaged: Boolean(gavriManaged),
    inJoinedFetch: gavriJoined,
    status:
      gavriJoined === false
        ? "KEEP_DRIFT_NOT_IN_JOINED_FETCH"
        : gavriJoined === true
          ? "JOINED"
          : "LIVE_STAGING_ABSENT",
  },
  endedStaging: {
    ok: ended.ok,
    stripped: ended.stripped,
    endedManagedPath,
    endedOffersPath,
    endedAuditPath,
    lkgKeptOn429: lkg.ok === false,
  },
  scheduleContract: {
    cron: "17 3 * * *",
    liveFetchOnSchedule: true,
    publishArmedOnSchedule: false,
  },
  forpsi: {
    status: forpsiGate.ok ? "READY_FOR_OPERATOR_CONNECT" : "BLOCKED",
    reason: forpsiGate.reason || null,
    mockOk: mockMail.OK,
    authority: "CJ_API_ONLY",
    mailboxes: forpsi.mailboxes,
  },
  offersStats: offersPublic.stats || null,
};
console.log(JSON.stringify(out, null, 2));
if (failures.length) process.exit(1);
