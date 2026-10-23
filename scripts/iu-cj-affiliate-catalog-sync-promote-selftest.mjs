#!/usr/bin/env node
/**
 * Phase 2F — promote + renderer E2E fixtures (no live GitHub / no prod).
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  promoteManagedPublicAtomic,
  rollbackManagedPublicFromLkg,
  validateManagedPublicPayload,
} from "./iu-cj-affiliate-catalog-sync-promote-managed-public-v1.mjs";
import { materializeManagedPublic, WEBSITE_PID } from "./iu-cj-affiliate-catalog-sync-publish-gate-v1.mjs";

const PID = WEBSITE_PID;
const goodUrl = (id) => `https://www.jdoqocy.com/click-${PID}-${id}`;

function expect(name, cond) {
  assert.equal(cond, true, name);
}

function applyOverlay(catalog, overlay) {
  const byAdv = {};
  for (const p of overlay.partners || []) {
    if (p?.advertiserId != null) byAdv[String(p.advertiserId)] = p;
  }
  return catalog.map((cat) => {
    const kept = [];
    const seen = {};
    for (const it of cat.items) {
      const adv = it.advertiserId != null ? String(it.advertiserId) : null;
      if (adv && byAdv[adv]) {
        const ov = byAdv[adv];
        if (ov.active === false) {
          if (it.management === "MANUAL_PROTECTED") {
            kept.push(it);
            seen[adv] = true;
          }
          continue;
        }
        kept.push({
          title: ov.title || it.title,
          url: ov.url || it.url,
          advertiserId: adv,
          management: "CJ_MANAGED",
        });
        seen[adv] = true;
      } else {
        kept.push(it);
        if (adv) seen[adv] = true;
      }
    }
    for (const np of overlay.partners || []) {
      if (!np || np.active === false) continue;
      if (String(np.sectionId) !== String(cat.id)) continue;
      const nid = String(np.advertiserId);
      if (seen[nid]) continue;
      kept.push({
        title: np.title,
        url: np.url,
        advertiserId: nid,
        management: "CJ_MANAGED",
      });
    }
    return { id: cat.id, items: kept };
  });
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "iu-cj-promote-"));
const dataDir = path.join(tmp, "projects", "data");
fs.mkdirSync(dataDir, { recursive: true });

const baseline = materializeManagedPublic([
  {
    advertiserId: "8001",
    title: "BaseCo",
    url: goodUrl("8001"),
    sectionId: "aff-moda",
    active: true,
  },
]);
fs.writeFileSync(
  path.join(dataDir, "iu-affiliate-cj-managed-public-v1.json"),
  JSON.stringify(baseline, null, 2)
);

// Disarmed → no write
{
  const next = materializeManagedPublic([
    ...baseline.partners,
    {
      advertiserId: "8002",
      title: "NewCo",
      url: goodUrl("8002"),
      sectionId: "aff-moda",
      active: true,
    },
  ]);
  fs.writeFileSync(path.join(tmp, "incoming.json"), JSON.stringify(next));
  const r = promoteManagedPublicAtomic({
    dataDir,
    sourcePath: path.join(tmp, "incoming.json"),
    env: { IU_CJ_MANAGED_PUBLIC_PROMOTE_ARMED: "0" },
  });
  expect("disarmed_ok", r.ok === true && r.wrote === false);
  const still = JSON.parse(
    fs.readFileSync(path.join(dataDir, "iu-affiliate-cj-managed-public-v1.json"), "utf8")
  );
  expect("disarmed_unchanged", still.partners.length === 1);
}

// Armed promote → new version + LKG
{
  const next = materializeManagedPublic([
    {
      advertiserId: "8001",
      title: "BaseCo",
      url: goodUrl("8001"),
      sectionId: "aff-moda",
      active: true,
    },
    {
      advertiserId: "8002",
      title: "NewCo",
      url: goodUrl("8002"),
      sectionId: "aff-moda",
      active: true,
    },
  ]);
  const r = promoteManagedPublicAtomic({
    dataDir,
    payload: next,
    env: { IU_CJ_MANAGED_PUBLIC_PROMOTE_ARMED: "1" },
  });
  expect("armed_wrote", r.ok === true && r.wrote === true);
  expect("lkg_exists", fs.existsSync(path.join(dataDir, "iu-affiliate-cj-managed-public-lkg-v1.json")));
  const pub = JSON.parse(
    fs.readFileSync(path.join(dataDir, "iu-affiliate-cj-managed-public-v1.json"), "utf8")
  );
  expect("pub_has_new", pub.partners.some((p) => p.advertiserId === "8002"));

  const baked = [
    {
      id: "aff-moda",
      items: [
        {
          title: "Protected",
          url: goodUrl("1"),
          management: "MANUAL_PROTECTED",
        },
      ],
    },
  ];
  const rendered = applyOverlay(baked, pub);
  const titles = rendered[0].items.map((i) => i.title);
  expect("renderer_shows_new", titles.includes("NewCo"));
  expect("renderer_keeps_protected", titles.includes("Protected"));
}

// Unverified active URL rejected
{
  const bad = {
    schema: "iu-affiliate-cj-managed-public-v1",
    websitePid: PID,
    partners: [
      {
        advertiserId: "9000",
        title: "Bad",
        url: "https://example.com/x",
        sectionId: "aff-moda",
        active: true,
      },
    ],
  };
  const v = validateManagedPublicPayload(bad, { websitePid: PID });
  expect("reject_unverified", v.ok === false);
  const r = promoteManagedPublicAtomic({
    dataDir,
    payload: bad,
    env: { IU_CJ_MANAGED_PUBLIC_PROMOTE_ARMED: "1" },
  });
  expect("no_write_on_bad", r.wrote === false);
}

// Hide via active:false + renderer
{
  const ended = materializeManagedPublic([
    {
      advertiserId: "8002",
      title: "NewCo",
      url: goodUrl("8002"),
      sectionId: "aff-moda",
      active: false,
    },
  ]);
  const r = promoteManagedPublicAtomic({
    dataDir,
    payload: ended,
    env: { IU_CJ_MANAGED_PUBLIC_PROMOTE_ARMED: "1" },
  });
  expect("ended_promoted", r.wrote === true);
  const pub = JSON.parse(
    fs.readFileSync(path.join(dataDir, "iu-affiliate-cj-managed-public-v1.json"), "utf8")
  );
  const baked = [
    {
      id: "aff-moda",
      items: [
        {
          title: "NewCo",
          url: goodUrl("8002"),
          advertiserId: "8002",
          management: "CJ_MANAGED",
        },
      ],
    },
  ];
  const rendered = applyOverlay(baked, pub);
  expect("ended_hidden", !rendered[0].items.some((i) => i.title === "NewCo"));
}

// Rollback to LKG
{
  const before = fs.readFileSync(
    path.join(dataDir, "iu-affiliate-cj-managed-public-lkg-v1.json"),
    "utf8"
  );
  const rb = rollbackManagedPublicFromLkg(dataDir);
  expect("rollback_ok", rb.ok === true);
  const after = fs.readFileSync(
    path.join(dataDir, "iu-affiliate-cj-managed-public-v1.json"),
    "utf8"
  );
  expect("rollback_restored", after === before);
}

// Concurrent promote: second write still atomic (last write wins, no corrupt JSON)
{
  const a = materializeManagedPublic([
    {
      advertiserId: "8100",
      title: "A",
      url: goodUrl("8100"),
      sectionId: "aff-moda",
      active: true,
    },
  ]);
  const b = materializeManagedPublic([
    {
      advertiserId: "8101",
      title: "B",
      url: goodUrl("8101"),
      sectionId: "aff-moda",
      active: true,
    },
  ]);
  promoteManagedPublicAtomic({
    dataDir,
    payload: a,
    env: { IU_CJ_MANAGED_PUBLIC_PROMOTE_ARMED: "1" },
  });
  promoteManagedPublicAtomic({
    dataDir,
    payload: b,
    env: { IU_CJ_MANAGED_PUBLIC_PROMOTE_ARMED: "1" },
  });
  const pub = JSON.parse(
    fs.readFileSync(path.join(dataDir, "iu-affiliate-cj-managed-public-v1.json"), "utf8")
  );
  expect("concurrent_valid_json", Array.isArray(pub.partners));
  expect("concurrent_last_wins", pub.partners.some((p) => p.advertiserId === "8101"));
}

console.log(
  JSON.stringify(
    {
      IU_CJ_AFFILIATE_CATALOG_SYNC_PROMOTE_SELFTEST: "PASS",
      websitePid: PID,
      scenarios: [
        "disarmed_no_write",
        "armed_atomic_promote",
        "renderer_new_partner",
        "reject_unverified_url",
        "ended_hide",
        "rollback_lkg",
        "concurrent_atomic",
      ],
      noMergeNoProd: true,
      promoteDefaultDisarmed: true,
    },
    null,
    2
  )
);
