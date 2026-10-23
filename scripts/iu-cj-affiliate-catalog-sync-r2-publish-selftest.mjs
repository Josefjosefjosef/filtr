/**
 * Phase 2H — R2 auto-publish selftest (fixtures, no prod, no secrets printed).
 * Proves data change → public JSON without git merge / code commit.
 */
import assert from "node:assert/strict";
import {
  buildPublishEnvelope,
  createMemoryCjManagedPublicEndpoint,
  publishManagedPublicToR2,
  sha256Hex,
} from "./iu-cj-affiliate-catalog-sync-r2-publish-v1.mjs";

const WEBSITE_PID = "101883843";

function doc(partners) {
  return {
    schema: "iu-affiliate-cj-managed-public-v1",
    websitePid: WEBSITE_PID,
    generatedAt: new Date().toISOString(),
    partners,
  };
}

function partner(id, title, active = true) {
  return {
    advertiserId: String(id),
    title,
    sectionId: "aff-zdravi-doplnky",
    url: "https://www.dpbolvw.net/click-101883843-" + id,
    active,
  };
}

function expect(name, cond) {
  assert.ok(cond, name);
  console.log("PASS " + name);
}

async function postPublish(base, token, document, metaExtra = {}) {
  const envelope = buildPublishEnvelope(document, metaExtra);
  const res = await fetch(base + "/projects/data/iu-affiliate-cj-managed-public/__iu_live_publish", {
    method: "POST",
    headers: {
      authorization: "Bearer " + token,
      "content-type": "application/json",
    },
    body: JSON.stringify(envelope),
  });
  const body = await res.json();
  return { status: res.status, body };
}

async function getPublic(base) {
  const res = await fetch(base + "/projects/data/iu-affiliate-cj-managed-public-v1.json", {
    cache: "no-store",
  });
  if (!res.ok) return { status: res.status, body: null };
  return { status: res.status, body: await res.json() };
}

const ep = createMemoryCjManagedPublicEndpoint({ token: "fixture-token", websitePid: WEBSITE_PID });
const { base } = await ep.listen(0);

try {
  // Disarmed dry-run (no network publish)
  const dry = await publishManagedPublicToR2({
    env: { IU_CJ_MANAGED_PUBLIC_R2_PUBLISH_ARMED: "0", IU_CJ_WEBSITE_PID: WEBSITE_PID },
    document: doc([partner(1, "New")]),
  });
  expect("dry_run_disarmed", dry.ok && dry.reason === "DRY_RUN_DISARMED");
  expect("dry_run_no_git_merge_flag", dry.NO_GIT_MERGE_REQUIRED === "YES");

  // New verified partner
  let r = await postPublish(base, "fixture-token", doc([partner(5706839, "Amix")]));
  expect("publish_new_partner", r.status === 200 && r.body.ok === true);
  expect("publish_no_git_merge", r.body.NO_GIT_MERGE_REQUIRED === "YES");
  let g = await getPublic(base);
  expect("public_has_new", g.body && g.body.partners.length === 1 && g.body.partners[0].active !== false);

  // Confirmed end (active:false)
  r = await postPublish(base, "fixture-token", doc([partner(5706839, "Amix", false)]), {
    contentSha256: sha256Hex("end-1"),
  });
  expect("publish_ended", r.status === 200 && r.body.ok);
  g = await getPublic(base);
  expect("public_shows_inactive", g.body.partners[0].active === false);

  // Re-activate
  r = await postPublish(base, "fixture-token", doc([partner(5706839, "Amix", true)]), {
    contentSha256: sha256Hex("reactivate-1"),
  });
  expect("publish_reactivate", r.status === 200 && r.body.ok);
  g = await getPublic(base);
  expect("public_active_again", g.body.partners[0].active === true);

  // Unauthorized
  r = await postPublish(base, "wrong", doc([partner(2, "X")]));
  expect("reject_401", r.status === 401);

  // Unverified URL
  r = await postPublish(
    base,
    "fixture-token",
    doc([
      {
        advertiserId: "9",
        title: "Bad",
        sectionId: "aff-zdravi-doplnky",
        url: "https://evil.example/x",
        active: true,
      },
    ]),
    { contentSha256: sha256Hex("bad-url") }
  );
  expect("reject_unverified_url", r.status === 400 && r.body.reason === "VALIDATION_FAILED");

  // Missing section
  r = await postPublish(
    base,
    "fixture-token",
    doc([
      {
        advertiserId: "10",
        title: "NoSec",
        url: "https://www.dpbolvw.net/click-101883843-10",
        active: true,
      },
    ]),
    { contentSha256: sha256Hex("no-sec") }
  );
  expect("reject_missing_section", r.status === 400);

  // Duplicate id
  r = await postPublish(
    base,
    "fixture-token",
    doc([partner(11, "A"), partner(11, "B")]),
    { contentSha256: sha256Hex("dup") }
  );
  expect("reject_duplicate", r.status === 400);

  // Unchanged skip
  const stable = doc([partner(5706839, "Amix", true)]);
  const sha = sha256Hex(JSON.stringify(stable));
  r = await postPublish(base, "fixture-token", stable, { contentSha256: sha });
  expect("publish_stable", r.status === 200);
  r = await postPublish(base, "fixture-token", stable, { contentSha256: sha });
  expect("skip_unchanged", r.body.reason === "UNCHANGED_CONTENT_PUBLICATION_SKIPPED");

  // LKG rollback after second publish
  await postPublish(base, "fixture-token", doc([partner(100, "First")]), {
    contentSha256: sha256Hex("first"),
  });
  await postPublish(base, "fixture-token", doc([partner(200, "Second")]), {
    contentSha256: sha256Hex("second"),
  });
  const rb = await fetch(base + "/__rollback", { method: "POST" });
  const rbJson = await rb.json();
  expect("rollback_ok", rbJson.ok === true);
  g = await getPublic(base);
  expect("rollback_restored_first", g.body.partners[0].advertiserId === "100");

  // Endpoint down → publish armed fails without mutating (local armed against closed port)
  const down = await publishManagedPublicToR2({
    env: {
      IU_CJ_MANAGED_PUBLIC_R2_PUBLISH_ARMED: "1",
      IU_CJ_MANAGED_PUBLIC_PUBLISH_URL: "http://127.0.0.1:9/projects/data/iu-affiliate-cj-managed-public/__iu_live_publish",
      IU_CJ_MANAGED_PUBLIC_PUBLISH_TOKEN: "x",
      IU_CJ_WEBSITE_PID: WEBSITE_PID,
    },
    document: doc([partner(3, "Down")]),
  }).catch((e) => ({ ok: false, reason: "NETWORK", error: String(e && e.message ? e.message : e) }));
  expect("publish_failure_no_false_ok", down.ok !== true);

  // Concurrent: second identical sha skipped; different sha wins last-write
  await postPublish(base, "fixture-token", doc([partner(300, "C1")]), {
    contentSha256: sha256Hex("c1"),
  });
  const [a, b] = await Promise.all([
    postPublish(base, "fixture-token", doc([partner(301, "C2")]), { contentSha256: sha256Hex("c2a") }),
    postPublish(base, "fixture-token", doc([partner(302, "C3")]), { contentSha256: sha256Hex("c2b") }),
  ]);
  expect("concurrent_both_handled", a.status === 200 && b.status === 200);
  g = await getPublic(base);
  expect("concurrent_has_single_partner", g.body.partners.length === 1);

  console.log(
    JSON.stringify({
      IU_CJ_R2_PUBLISH_SELFTEST: "PASS",
      NO_GIT_MERGE_REQUIRED: true,
      publishes: ep.state.publishes,
      INFRA_PENDING: "live Cloudflare R2 binding + token + CJ_MANAGED_PUBLIC_LIVE_ENABLED",
    })
  );
} finally {
  await ep.close();
}
