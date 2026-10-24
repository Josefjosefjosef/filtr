#!/usr/bin/env node
/**
 * Phase 2C PR B selftest — fetch≠publish gate scenarios (no live CJ HTTP).
 */
import assert from "node:assert/strict";
import {
  buildPublishPlan,
  decidePublishAction,
  verifyCjLinkOwnership,
  assertAllowedDataWrite,
  materializeManagedPublic,
  PARTNER_STATE,
  WEBSITE_PID,
} from "./iu-cj-affiliate-catalog-sync-publish-gate-v1.mjs";

const PID = WEBSITE_PID;
const goodUrl = `https://www.jdoqocy.com/click-${PID}-15735649`;

function expect(name, cond) {
  assert.equal(cond, true, name);
}

// Link ownership
{
  const bad = verifyCjLinkOwnership(null, "1");
  expect("null_meta_unverified", bad.state === PARTNER_STATE.LINK_UNVERIFIED);
  const outage = verifyCjLinkOwnership({ apiError: "401" }, "1");
  expect("api_outage", outage.state === PARTNER_STATE.API_OUTAGE);
  const ended = verifyCjLinkOwnership(
    {
      websitePid: PID,
      advertiserId: "99",
      linkBelongsToAdvertiser: true,
      programAvailable: false,
      programStatus: "ENDED",
    },
    "99"
  );
  expect("ended", ended.state === PARTNER_STATE.ENDED);
  const ok = verifyCjLinkOwnership(
    {
      websitePid: PID,
      advertiserId: "99",
      linkBelongsToAdvertiser: true,
      programAvailable: true,
    },
    "99"
  );
  expect("publishable", ok.ok === true);
}

// Protected never overwritten
{
  const d = decidePublishAction({
    candidate: { advertiserId: "1", url: goodUrl, title: "X", sectionId: "aff-moda" },
    policyEntry: { management: "MANUAL_PROTECTED", advertiserId: "1" },
    linkMeta: {
      websitePid: PID,
      advertiserId: "1",
      linkBelongsToAdvertiser: true,
      programAvailable: true,
    },
    sectionMap: {},
  });
  expect("protected_keep", d.action === "KEEP" && d.publish === false);
}

// Invalid link / missing section
{
  const d1 = decidePublishAction({
    candidate: { advertiserId: "2", url: "https://example.com/x", title: "Y", sectionId: "aff-moda" },
    policyEntry: { management: "CJ_MANAGED" },
    linkMeta: {
      websitePid: PID,
      advertiserId: "2",
      linkBelongsToAdvertiser: true,
      programAvailable: true,
    },
  });
  expect("bad_url", d1.state === PARTNER_STATE.LINK_UNVERIFIED);

  const d2 = decidePublishAction({
    candidate: { advertiserId: "3", url: goodUrl, title: "Z" },
    policyEntry: { management: "CJ_MANAGED" },
    linkMeta: {
      websitePid: PID,
      advertiserId: "3",
      linkBelongsToAdvertiser: true,
      programAvailable: true,
    },
    sectionMap: {},
  });
  expect("no_section", d2.reason === "missing_section");
}

// New partner publishable
{
  const plan = buildPublishPlan({
    candidates: [
      {
        advertiserId: "100",
        title: "NewCo",
        url: goodUrl,
        sectionId: "aff-moda",
      },
    ],
    policyPartners: [{ advertiserId: "100", management: "CJ_MANAGED" }],
    linkMetaByAdvertiser: {
      100: {
        websitePid: PID,
        advertiserId: "100",
        linkBelongsToAdvertiser: true,
        programAvailable: true,
      },
    },
    lastKnownGood: [],
  });
  expect("new_partner_ok", plan.ok && plan.counts.published === 1);
  expect("slice_has_new", plan.publishSlice.some((p) => p.advertiserId === "100"));
}

// API outage → keep LKG, no mass hide
{
  const lkg = [
    {
      advertiserId: "100",
      title: "NewCo",
      url: goodUrl,
      sectionId: "aff-moda",
      management: "CJ_MANAGED",
    },
  ];
  const plan = buildPublishPlan({
    candidates: [{ advertiserId: "100", title: "NewCo", url: goodUrl, sectionId: "aff-moda" }],
    policyPartners: [{ advertiserId: "100", management: "CJ_MANAGED" }],
    linkMetaByAdvertiser: { 100: { apiError: "503" } },
    lastKnownGood: lkg,
  });
  expect("outage_blocks", plan.apiOutage === true && plan.ok === false);
  expect("outage_keeps_lkg", plan.publishSlice.length === 1);
  expect("outage_reason", plan.publishBlockedReason === "API_OUTAGE_KEEP_LKG");
}

// Mass ENDED stop
{
  const managed = [];
  const candidates = [];
  const meta = {};
  for (let i = 0; i < 10; i++) {
    const id = String(200 + i);
    managed.push({ advertiserId: id, management: "CJ_MANAGED" });
    candidates.push({
      advertiserId: id,
      title: "P" + i,
      url: `https://www.jdoqocy.com/click-${PID}-1000${i}`,
      sectionId: "aff-moda",
    });
    meta[id] = {
      websitePid: PID,
      advertiserId: id,
      linkBelongsToAdvertiser: true,
      programAvailable: false,
      programStatus: "ENDED",
    };
  }
  const plan = buildPublishPlan({
    candidates,
    policyPartners: managed,
    linkMetaByAdvertiser: meta,
    lastKnownGood: candidates.map((c) => ({ ...c, management: "CJ_MANAGED" })),
    massEndedRatioStop: 0.25,
  });
  expect("mass_ended_stop", plan.massEndedStop === true && plan.ok === false);
}

// Forbidden write paths
{
  let threw = false;
  try {
    assertAllowedDataWrite("assets/iu-affiliate-catalog.js");
  } catch {
    threw = true;
  }
  expect("forbid_catalog", threw === true);
  expect(
    "allow_staging",
    assertAllowedDataWrite("projects/data/iu-affiliate-cj-staging-v1.json") === true
  );
  expect(
    "allow_managed_public",
    assertAllowedDataWrite("projects/data/iu-affiliate-cj-managed-public-v1.json") === true
  );
}

// Explicit ENDED → active:false in slice (overlay hide signal)
{
  const plan = buildPublishPlan({
    candidates: [
      {
        advertiserId: "400",
        title: "Bye",
        url: goodUrl,
        sectionId: "aff-moda",
      },
    ],
    policyPartners: [{ advertiserId: "400", management: "CJ_MANAGED" }],
    linkMetaByAdvertiser: {
      400: {
        websitePid: PID,
        advertiserId: "400",
        linkBelongsToAdvertiser: true,
        programAvailable: false,
        programStatus: "ENDED",
      },
    },
    lastKnownGood: [
      {
        advertiserId: "400",
        title: "Bye",
        url: goodUrl,
        sectionId: "aff-moda",
        management: "CJ_MANAGED",
        active: true,
      },
    ],
  });
  const row = plan.publishSlice.find((p) => p.advertiserId === "400");
  expect("ended_active_false", plan.ok === true && row && row.active === false);
  const pub = materializeManagedPublic(plan.publishSlice);
  expect(
    "ended_public_inactive",
    pub.partners.some((p) => p.advertiserId === "400" && p.active === false)
  );
}

// Duplicate advertiser → last publish wins in slice (single id)
{
  const plan = buildPublishPlan({
    candidates: [
      { advertiserId: "300", title: "A", url: goodUrl, sectionId: "aff-moda" },
      { advertiserId: "300", title: "A2", url: goodUrl, sectionId: "aff-moda" },
    ],
    policyPartners: [{ advertiserId: "300", management: "CJ_MANAGED" }],
    linkMetaByAdvertiser: {
      300: {
        websitePid: PID,
        advertiserId: "300",
        linkBelongsToAdvertiser: true,
        programAvailable: true,
      },
    },
    lastKnownGood: [],
  });
  expect("dedupe_slice", plan.publishSlice.filter((p) => p.advertiserId === "300").length === 1);
}

console.log(
  JSON.stringify(
    {
      IU_CJ_AFFILIATE_CATALOG_SYNC_V1_SELFTEST: "PASS",
      websitePid: PID,
      noMergeNoProd: true,
    },
    null,
    2
  )
);
