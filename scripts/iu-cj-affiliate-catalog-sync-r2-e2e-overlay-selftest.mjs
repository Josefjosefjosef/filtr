/**
 * Phase 2H E2E (fixtures): CJ fixture doc → validate → memory R2 publish →
 * public GET → overlay apply → chip present. No code commit / no git merge.
 */
import assert from "node:assert/strict";
import {
  createMemoryCjManagedPublicEndpoint,
  buildPublishEnvelope,
} from "./iu-cj-affiliate-catalog-sync-r2-publish-v1.mjs";

const WEBSITE_PID = "101883843";

function expect(name, cond) {
  assert.ok(cond, name);
  console.log("PASS " + name);
}

function applyOverlay(catalog, overlay) {
  const byAdv = {};
  for (const p of overlay.partners || []) {
    if (p?.advertiserId != null) byAdv[String(p.advertiserId)] = p;
  }
  return catalog.map((cat) => {
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
}

const catalog = [
  {
    id: "aff-zdravi-doplnky",
    items: [
      {
        title: "Booking Protected",
        url: "https://example.test/protected",
        advertiserId: "999",
        management: "MANUAL_PROTECTED",
      },
    ],
  },
];

const ep = createMemoryCjManagedPublicEndpoint({ token: "e2e-token", websitePid: WEBSITE_PID });
const { base } = await ep.listen(0);

try {
  const document = {
    schema: "iu-affiliate-cj-managed-public-v1",
    websitePid: WEBSITE_PID,
    partners: [
      {
        advertiserId: "5706839",
        title: "Amix E2E",
        sectionId: "aff-zdravi-doplnky",
        url: "https://www.dpbolvw.net/click-101883843-5706839",
        active: true,
      },
    ],
  };
  const envelope = buildPublishEnvelope(document, { contentSha256: "e2e-1" });
  const pub = await fetch(base + ep.publishPath, {
    method: "POST",
    headers: {
      authorization: "Bearer e2e-token",
      "content-type": "application/json",
    },
    body: JSON.stringify(envelope),
  });
  const pubJson = await pub.json();
  expect("r2_publish_ok", pub.ok && pubJson.ok === true);
  expect("no_git_merge", pubJson.NO_GIT_MERGE_REQUIRED === "YES");

  const get = await fetch(base + ep.publicPath, { cache: "no-store" });
  expect("public_get_ok", get.ok);
  const overlay = await get.json();
  const rendered = applyOverlay(catalog, overlay);
  const titles = rendered[0].items.map((i) => i.title);
  expect("protected_retained", titles.includes("Booking Protected"));
  expect("new_managed_chip", titles.includes("Amix E2E"));

  // End partnership → hide managed only
  const ended = {
    ...document,
    partners: [{ ...document.partners[0], active: false }],
  };
  await fetch(base + ep.publishPath, {
    method: "POST",
    headers: {
      authorization: "Bearer e2e-token",
      "content-type": "application/json",
    },
    body: JSON.stringify(buildPublishEnvelope(ended, { contentSha256: "e2e-2" })),
  });
  const overlay2 = await (await fetch(base + ep.publicPath)).json();
  const rendered2 = applyOverlay(catalog, overlay2);
  const titles2 = rendered2[0].items.map((i) => i.title);
  expect("ended_hides_managed", !titles2.includes("Amix E2E"));
  expect("ended_keeps_protected", titles2.includes("Booking Protected"));

  // Unavailable endpoint → keep baked catalog (simulate failed fetch)
  const offlineCatalog = applyOverlay(catalog, { partners: [] });
  expect("empty_overlay_keeps_baked", offlineCatalog[0].items.length === 1);

  console.log(
    JSON.stringify({
      IU_CJ_R2_E2E_OVERLAY_SELFTEST: "PASS",
      NO_CODE_COMMIT_REQUIRED: true,
      NO_GIT_MERGE_REQUIRED: true,
      LIVE_CLOUDFLARE: "INFRA_PENDING",
    })
  );
} finally {
  await ep.close();
}
