#!/usr/bin/env node
/**
 * Mutation guard for Variant B smoke heavy-data stubs (anti-false-green).
 * Run: node scripts/smoke-cutover-stub-mutation-guard.mjs
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import {
  loadSmokeFeedStub,
  loadSmokeTrafficStub,
  freshenSmokeFeedStubTimestamps,
  validateSmokeFeedStubSchema,
  validateSmokeTrafficStubSchema,
  SMOKE_FEED_STUB_PATH,
  SMOKE_TRAFFIC_STUB_PATH,
} from "./smoke-heavy-data-stubs.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fails = [];
function must(cond, id) {
  if (!cond) fails.push(id);
}

const baseFeed = loadSmokeFeedStub();
const baseSnap = loadSmokeTrafficStub();
must(validateSmokeFeedStubSchema(baseFeed).ok, "base_feed_schema");
must(validateSmokeTrafficStubSchema(baseSnap).ok, "base_traffic_schema");
must(fs.existsSync(SMOKE_FEED_STUB_PATH), "feed_fixture_file");
must(fs.existsSync(SMOKE_TRAFFIC_STUB_PATH), "traffic_fixture_file");

must(!validateSmokeFeedStubSchema({ nope: true }).ok, "mutation_malformed_feed_fails");
must(!validateSmokeTrafficStubSchema({ nope: true }).ok, "mutation_malformed_traffic_fails");

{
  const snap = JSON.parse(JSON.stringify(baseSnap));
  delete snap.cards[0].publicEventId;
  delete snap.cards[0].feed;
  must(!validateSmokeTrafficStubSchema(snap).ok, "mutation_required_field_fails");
}

{
  const snap = JSON.parse(JSON.stringify(baseSnap));
  snap.cards[0].mapTarget.safeMapTarget = "javascript:alert(1)";
  const v = validateSmokeTrafficStubSchema(snap);
  must(!v.ok && v.fails.includes("snap_unsafe_url"), "mutation_unsafe_url_fails");
  const feed = JSON.parse(JSON.stringify(baseFeed));
  feed.items[0].url = "javascript:alert(1)";
  const fv = validateSmokeFeedStubSchema(feed);
  must(!fv.ok && fv.fails.includes("feed_unsafe_url"), "mutation_feed_unsafe_url_fails");
}

{
  const smokeSrc = fs.readFileSync(path.join(__dirname, "smoke.mjs"), "utf8");
  must(/SMOKE_FEED_ROUTE_NOT_INTERCEPTED/.test(smokeSrc), "stub_not_intercepted_fail_closed_in_smoke");
  must(/SMOKE_TRAFFIC_SNAPSHOT_ROUTE_NOT_INTERCEPTED/.test(smokeSrc), "traffic_not_intercepted_fail_closed");
  must(/SMOKE_UI_DID_NOT_CONSUME_FEED_STUB/.test(smokeSrc), "ui_consume_fail_closed");
  must(/installSmokeHeavyDataRouteStubs/.test(smokeSrc), "smoke_installs_stubs");
  must(/smokePrehledDneCutover/.test(smokeSrc), "cutover_still_present");
  must(/iuInfoSystem=off/.test(smokeSrc), "off_nav_still_present");
}

{
  const stale = JSON.parse(JSON.stringify(baseFeed));
  stale.generatedAt = "2020-01-01T00:00:00.000Z";
  for (const it of stale.items || []) {
    it.publishedAt = "2020-01-01T00:00:00.000Z";
    it.publishedAtSource = "2020-01-01T00:00:00.000Z";
    it.sortAt = "2020-01-01T00:00:00.000Z";
    if (it.validTo) it.validTo = "2020-01-02T00:00:00.000Z";
  }
  const fresh = freshenSmokeFeedStubTimestamps(stale, new Date("2026-08-12T15:00:00.000Z"));
  const maxAgeMs = 96 * 3600000;
  const now = Date.parse("2026-08-12T15:00:00.000Z");
  must(Date.parse(fresh.generatedAt) === now, "freshen_generatedAt");
  must(
    (fresh.items || []).every((it) => now - Date.parse(it.publishedAt) < maxAgeMs),
    "freshen_published_within_96h"
  );
  must(
    (fresh.items || []).every((it) => !it.validTo || Date.parse(it.validTo) > now),
    "freshen_validTo_future_when_set"
  );
}

console.log(
  JSON.stringify(
    {
      ok: fails.length === 0,
      fails,
      SMOKE_STUB_MUTATION_MALFORMED_FAILS:
        !fails.includes("mutation_malformed_feed_fails") &&
        !fails.includes("mutation_malformed_traffic_fails")
          ? "YES"
          : "NO",
      SMOKE_STUB_MUTATION_REQUIRED_FIELD_FAILS: !fails.includes("mutation_required_field_fails")
        ? "YES"
        : "NO",
      SMOKE_STUB_MUTATION_UNSAFE_URL_FAILS:
        !fails.includes("mutation_unsafe_url_fails") && !fails.includes("mutation_feed_unsafe_url_fails")
          ? "YES"
          : "NO",
      SMOKE_STUB_NOT_INTERCEPTED_DETECTED:
        !fails.includes("stub_not_intercepted_fail_closed_in_smoke") &&
        !fails.includes("traffic_not_intercepted_fail_closed")
          ? "YES"
          : "NO",
    },
    null,
    2
  )
);
process.exit(fails.length ? 1 : 0);
