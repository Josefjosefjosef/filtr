#!/usr/bin/env node
/**
 * Phase 2E PR B — end-to-end fixture selftest (no live CJ HTTP, no prod).
 * Proves: registry → materializeManagedPublic → overlay apply → catalog chips
 * for new / ended / restored / API outage / mass-hide / protected.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  buildPublishPlan,
  materializeManagedPublic,
  PARTNER_STATE,
  WEBSITE_PID,
} from "./iu-cj-affiliate-catalog-sync-publish-gate-v1.mjs";
import { runCatalogSyncPublish } from "./iu-cj-affiliate-catalog-sync-publish-v1.mjs";

const PID = WEBSITE_PID;
const goodUrl = (linkId) => `https://www.jdoqocy.com/click-${PID}-${linkId}`;

function expect(name, cond) {
  assert.equal(cond, true, name);
}

/** Minimal in-process overlay applicator mirroring catalog.js semantics. */
function applyOverlay(catalog, overlay) {
  const byAdv = {};
  for (const p of overlay.partners || []) {
    if (p?.advertiserId != null) byAdv[String(p.advertiserId)] = p;
  }
  const out = catalog.map((cat) => {
    const kept = [];
    const seenAdv = {};
    for (const it of cat.items) {
      const adv = it.advertiserId != null ? String(it.advertiserId) : null;
      if (adv && byAdv[adv]) {
        const ov = byAdv[adv];
        if (ov.active === false) {
          if (it.management === "MANUAL_PROTECTED" || it.management === "PAID_RESERVED") {
            kept.push(it);
            seenAdv[adv] = true;
          }
          continue;
        }
        kept.push({
          title: ov.title || it.title,
          url: ov.url || it.url,
          advertiserId: adv,
          management: "CJ_MANAGED",
        });
        seenAdv[adv] = true;
      } else {
        kept.push(it);
        if (adv) seenAdv[adv] = true;
      }
    }
    for (const np of overlay.partners || []) {
      if (!np || np.active === false) continue;
      if (String(np.sectionId || "") !== String(cat.id)) continue;
      const nid = String(np.advertiserId);
      if (seenAdv[nid]) continue;
      if (!np.url || !/^https:\/\//i.test(String(np.url))) continue;
      kept.push({
        title: np.title,
        url: np.url,
        advertiserId: nid,
        management: "CJ_MANAGED",
      });
      seenAdv[nid] = true;
    }
    return { id: cat.id, items: kept };
  });
  return out;
}

function titles(cat, sectionId) {
  const s = cat.find((c) => c.id === sectionId);
  return (s?.items || []).map((i) => i.title);
}

const metaOk = (id) => ({
  websitePid: PID,
  advertiserId: String(id),
  linkBelongsToAdvertiser: true,
  programAvailable: true,
});

const metaEnded = (id) => ({
  websitePid: PID,
  advertiserId: String(id),
  linkBelongsToAdvertiser: true,
  programAvailable: false,
  programStatus: "ENDED",
});

// --- 1) New partner appears via overlay ---
{
  const baked = [
    {
      id: "aff-moda",
      items: [
        {
          title: "ProtectedCo",
          url: goodUrl("111"),
          management: "MANUAL_PROTECTED",
        },
      ],
    },
  ];
  const plan = buildPublishPlan({
    candidates: [
      {
        advertiserId: "9001",
        title: "NewManaged",
        url: goodUrl("9001"),
        sectionId: "aff-moda",
      },
    ],
    policyPartners: [{ advertiserId: "9001", management: "CJ_MANAGED" }],
    linkMetaByAdvertiser: { 9001: metaOk("9001") },
    lastKnownGood: [],
  });
  expect("e2e_new_plan_ok", plan.ok === true);
  const pub = materializeManagedPublic(plan.publishSlice);
  const after = applyOverlay(baked, pub);
  expect("e2e_new_visible", titles(after, "aff-moda").includes("NewManaged"));
  expect("e2e_protected_kept_on_add", titles(after, "aff-moda").includes("ProtectedCo"));
}

// --- 2) Ended partner hidden (explicit active:false) ---
{
  const baked = [
    {
      id: "aff-moda",
      items: [
        {
          title: "GoingAway",
          url: goodUrl("9002"),
          advertiserId: "9002",
          management: "CJ_MANAGED",
        },
        {
          title: "ProtectedCo",
          url: goodUrl("111"),
          management: "MANUAL_PROTECTED",
        },
      ],
    },
  ];
  const plan = buildPublishPlan({
    candidates: [
      {
        advertiserId: "9002",
        title: "GoingAway",
        url: goodUrl("9002"),
        sectionId: "aff-moda",
      },
    ],
    policyPartners: [{ advertiserId: "9002", management: "CJ_MANAGED" }],
    linkMetaByAdvertiser: { 9002: metaEnded("9002") },
    lastKnownGood: [
      {
        advertiserId: "9002",
        title: "GoingAway",
        url: goodUrl("9002"),
        sectionId: "aff-moda",
        management: "CJ_MANAGED",
        active: true,
      },
    ],
  });
  expect("e2e_ended_plan_ok", plan.ok === true);
  const endedEntry = plan.publishSlice.find((p) => p.advertiserId === "9002");
  expect("e2e_ended_explicit_false", endedEntry && endedEntry.active === false);
  const pub = materializeManagedPublic(plan.publishSlice);
  const after = applyOverlay(baked, pub);
  expect("e2e_ended_hidden", !titles(after, "aff-moda").includes("GoingAway"));
  expect("e2e_protected_kept_on_hide", titles(after, "aff-moda").includes("ProtectedCo"));
}

// --- 3) Restored partner returns ---
{
  const baked = [
    {
      id: "aff-moda",
      items: [
        {
          title: "ComingBack",
          url: goodUrl("9003"),
          advertiserId: "9003",
          management: "CJ_MANAGED",
        },
      ],
    },
  ];
  const hiddenOverlay = materializeManagedPublic([
    {
      advertiserId: "9003",
      title: "ComingBack",
      url: goodUrl("9003"),
      sectionId: "aff-moda",
      active: false,
    },
  ]);
  expect("e2e_pre_restore_hidden", !titles(applyOverlay(baked, hiddenOverlay), "aff-moda").includes("ComingBack"));

  const plan = buildPublishPlan({
    candidates: [
      {
        advertiserId: "9003",
        title: "ComingBack",
        url: goodUrl("9003"),
        sectionId: "aff-moda",
      },
    ],
    policyPartners: [{ advertiserId: "9003", management: "CJ_MANAGED" }],
    linkMetaByAdvertiser: { 9003: metaOk("9003") },
    lastKnownGood: [
      {
        advertiserId: "9003",
        title: "ComingBack",
        url: goodUrl("9003"),
        sectionId: "aff-moda",
        active: false,
      },
    ],
  });
  const pub = materializeManagedPublic(plan.publishSlice);
  const after = applyOverlay(baked, pub);
  expect("e2e_restored_visible", titles(after, "aff-moda").includes("ComingBack"));
}

// --- 4) API outage → no public write; baked LKG unchanged ---
{
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "iu-cj-e2e-outage-"));
  const dataDir = path.join(tmp, "projects", "data");
  fs.mkdirSync(dataDir, { recursive: true });
  const lkgPublic = {
    schema: "iu-affiliate-cj-managed-public-v1",
    version: 1,
    partners: [
      {
        advertiserId: "9004",
        title: "Stable",
        url: goodUrl("9004"),
        sectionId: "aff-moda",
        active: true,
      },
    ],
  };
  const lkgReg = {
    version: 1,
    partners: lkgPublic.partners.map((p) => ({ ...p, management: "CJ_MANAGED" })),
  };
  fs.writeFileSync(path.join(dataDir, "iu-affiliate-cj-managed-public-v1.json"), JSON.stringify(lkgPublic));
  fs.writeFileSync(path.join(dataDir, "iu-affiliate-cj-managed-registry-v1.json"), JSON.stringify(lkgReg));
  fs.writeFileSync(
    path.join(dataDir, "iu-affiliate-cj-staging-v1.json"),
    JSON.stringify({ apiOutage: true, advertisers: [], links: [] })
  );
  fs.writeFileSync(
    path.join(dataDir, "iu-affiliate-slot-policy-v1.json"),
    JSON.stringify({ partners: [{ advertiserId: "9004", management: "CJ_MANAGED" }] })
  );
  const before = fs.readFileSync(path.join(dataDir, "iu-affiliate-cj-managed-public-v1.json"), "utf8");
  const r = runCatalogSyncPublish({
    dataDir,
    env: { IU_CJ_SYNC_PUBLISH_ARMED: "1" },
    candidates: [
      {
        advertiserId: "9004",
        title: "Stable",
        url: goodUrl("9004"),
        sectionId: "aff-moda",
      },
    ],
    linkMetaByAdvertiser: { 9004: { apiError: "503" } },
  });
  expect("e2e_outage_blocked", r.ok === false && r.wrotePublic === false);
  const after = fs.readFileSync(path.join(dataDir, "iu-affiliate-cj-managed-public-v1.json"), "utf8");
  expect("e2e_outage_public_unchanged", before === after);
}

// --- 5) Mass ended → publish refused, public unchanged ---
{
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "iu-cj-e2e-mass-"));
  const dataDir = path.join(tmp, "projects", "data");
  fs.mkdirSync(dataDir, { recursive: true });
  const partners = [];
  const candidates = [];
  const meta = {};
  const policy = [];
  for (let i = 0; i < 10; i++) {
    const id = String(9100 + i);
    partners.push({
      advertiserId: id,
      title: "P" + i,
      url: goodUrl("1000" + i),
      sectionId: "aff-moda",
      active: true,
      management: "CJ_MANAGED",
    });
    candidates.push({
      advertiserId: id,
      title: "P" + i,
      url: goodUrl("1000" + i),
      sectionId: "aff-moda",
    });
    meta[id] = metaEnded(id);
    policy.push({ advertiserId: id, management: "CJ_MANAGED" });
  }
  const lkgPublic = { schema: "iu-affiliate-cj-managed-public-v1", version: 1, partners };
  fs.writeFileSync(path.join(dataDir, "iu-affiliate-cj-managed-public-v1.json"), JSON.stringify(lkgPublic));
  fs.writeFileSync(
    path.join(dataDir, "iu-affiliate-cj-managed-registry-v1.json"),
    JSON.stringify({ version: 1, partners })
  );
  fs.writeFileSync(
    path.join(dataDir, "iu-affiliate-cj-staging-v1.json"),
    JSON.stringify({ apiOutage: false, links: [] })
  );
  fs.writeFileSync(path.join(dataDir, "iu-affiliate-slot-policy-v1.json"), JSON.stringify({ partners: policy }));
  const before = fs.readFileSync(path.join(dataDir, "iu-affiliate-cj-managed-public-v1.json"), "utf8");
  const r = runCatalogSyncPublish({
    dataDir,
    env: { IU_CJ_SYNC_PUBLISH_ARMED: "1" },
    candidates,
    linkMetaByAdvertiser: meta,
  });
  expect("e2e_mass_blocked", r.ok === false && r.wrotePublic === false);
  expect(
    "e2e_mass_public_unchanged",
    fs.readFileSync(path.join(dataDir, "iu-affiliate-cj-managed-public-v1.json"), "utf8") === before
  );
}

// --- 6) Protected never in publish slice / never hidden by false active ---
{
  const baked = [
    {
      id: "aff-pojisteni",
      items: [
        {
          title: "Klik.cz",
          url: goodUrl("15024030"),
          management: "MANUAL_PROTECTED",
          advertiserId: "5871720",
        },
      ],
    },
  ];
  const plan = buildPublishPlan({
    candidates: [
      {
        advertiserId: "5871720",
        title: "Klik.cz",
        url: goodUrl("15024030"),
        sectionId: "aff-pojisteni",
      },
    ],
    policyPartners: [{ advertiserId: "5871720", management: "MANUAL_PROTECTED" }],
    linkMetaByAdvertiser: { 5871720: metaEnded("5871720") },
    lastKnownGood: [],
  });
  expect(
    "e2e_protected_not_published",
    !plan.publishSlice.some((p) => String(p.advertiserId) === "5871720")
  );
  const malicious = materializeManagedPublic([
    {
      advertiserId: "5871720",
      title: "Klik.cz",
      url: goodUrl("15024030"),
      sectionId: "aff-pojisteni",
      active: false,
    },
  ]);
  const after = applyOverlay(baked, malicious);
  expect("e2e_protected_immune", titles(after, "aff-pojisteni").includes("Klik.cz"));
}

// --- 7) Armed publish writes managed-public file ---
{
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "iu-cj-e2e-write-"));
  const dataDir = path.join(tmp, "projects", "data");
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(
    path.join(dataDir, "iu-affiliate-cj-staging-v1.json"),
    JSON.stringify({ apiOutage: false, links: [] })
  );
  fs.writeFileSync(
    path.join(dataDir, "iu-affiliate-slot-policy-v1.json"),
    JSON.stringify({ partners: [{ advertiserId: "9200", management: "CJ_MANAGED" }] })
  );
  fs.writeFileSync(
    path.join(dataDir, "iu-affiliate-cj-managed-registry-v1.json"),
    JSON.stringify({ version: 1, partners: [] })
  );
  const r = runCatalogSyncPublish({
    dataDir,
    env: { IU_CJ_SYNC_PUBLISH_ARMED: "1" },
    candidates: [
      {
        advertiserId: "9200",
        title: "WriteMe",
        url: goodUrl("9200"),
        sectionId: "aff-moda",
      },
    ],
    linkMetaByAdvertiser: { 9200: metaOk("9200") },
  });
  expect("e2e_write_ok", r.ok === true && r.wrotePublic === true);
  const pub = JSON.parse(fs.readFileSync(path.join(dataDir, "iu-affiliate-cj-managed-public-v1.json"), "utf8"));
  expect("e2e_write_schema", pub.schema === "iu-affiliate-cj-managed-public-v1");
  expect("e2e_write_partner", pub.partners.some((p) => p.advertiserId === "9200" && p.active === true));
}

console.log(
  JSON.stringify(
    {
      IU_CJ_AFFILIATE_CATALOG_SYNC_E2E_OVERLAY_SELFTEST: "PASS",
      websitePid: PID,
      scenarios: [
        "new_partner",
        "ended_hide",
        "restored",
        "api_outage_lkg",
        "mass_ended_reject",
        "protected_immune",
        "armed_writes_managed_public",
      ],
      noMergeNoProd: true,
      noLiveFetch: true,
    },
    null,
    2
  )
);

// silence unused import warning in some linters
void pathToFileURL;
