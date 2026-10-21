#!/usr/bin/env node
import { buildStagingOpsSnapshot, sanitizeAuditEvent } from "./iu-cj-affiliate-phase2-staging-ops-monitor-lib.mjs";

const failures = [];
function expect(name, cond) {
  if (!cond) failures.push(name);
}

const events = [
  { event: "run_start", ts: "2026-01-01T00:00:00Z" },
  { event: "product_feed_probe", emptyFeed: true, receivedCount: 0 },
  { event: "product_feed_http_fail", status: 429 },
  { event: "run_complete", publishable: false, ts: "2026-01-01T00:05:00Z" },
];

const snap = buildStagingOpsSnapshot(events);
expect("zero_import_counted", snap.zeroImport === 1);
expect("429_counted", snap.http429 === 1);
expect("publishable_false", snap.publishable === false);

const red = sanitizeAuditEvent({ event: "x", pat: "secret-value", receivedCount: 3 });
expect("redact_pat", red.pat === "[redacted]");
expect("keep_counts", red.receivedCount === 3);

console.log(
  JSON.stringify({
    IU_CJ_STAGING_OPS_MONITOR_SELFTEST: failures.length ? "FAIL" : "OK",
    failures,
  })
);
process.exit(failures.length ? 1 : 0);
