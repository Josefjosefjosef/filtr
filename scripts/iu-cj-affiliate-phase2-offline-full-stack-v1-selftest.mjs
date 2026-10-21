#!/usr/bin/env node
/** CI-friendly orchestrator: FORPSI mock ingest + unattended + publication gates (no secrets). */
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptsDir = path.dirname(fileURLToPath(import.meta.url));
const node = process.execPath;

const suites = [
  "iu-cj-affiliate-phase2-forpsi-mime-selftest.mjs",
  "iu-cj-affiliate-phase2-forpsi-imap-selftest.mjs",
  "iu-cj-affiliate-phase2-github-actions-ingest-integration-v6-selftest.mjs",
  "iu-cj-affiliate-phase2-github-actions-ingest-adversarial-v5-selftest.mjs",
  "iu-cj-affiliate-phase2-github-actions-ingest-e2e-selftest.mjs",
  "iu-cj-affiliate-phase2-unattended-import-cycle-v1-selftest.mjs",
  "iu-cj-affiliate-phase2-offline-pipeline-e2e-v1-selftest.mjs",
  "iu-cj-affiliate-phase2-offers-dataflow-offline-selftest.mjs",
  "iu-cj-affiliate-phase2-banner-permission-selftest.mjs",
  "iu-cj-affiliate-phase2-banner-creative-registry-v1-selftest.mjs",
  "iu-cj-affiliate-phase2-banner-negative-v1-selftest.mjs",
  "iu-cj-affiliate-phase2-preview-security-selftest.mjs",
  "iu-cj-affiliate-phase2-catalog-graphql-response-selftest.mjs",
  "iu-cj-affiliate-phase2-offer-landing-selftest.mjs",
  "iu-cj-affiliate-phase2-approved-product-feed-selftest.mjs",
  "iu-cj-affiliate-phase2-approved-product-feed-http-import-selftest.mjs",
  "iu-cj-affiliate-phase2-staging-isolation-v1-selftest.mjs",
  "iu-cj-affiliate-phase2-staging-ops-monitor-selftest.mjs",
  "iu-cj-affiliate-phase2-staging-worker-routes-selftest.mjs",
  "iu-cj-affiliate-phase2-server-negative-v1-selftest.mjs",
];

const results = [];
for (const script of suites) {
  const r = spawnSync(node, [path.join(scriptsDir, script)], {
    encoding: "utf8",
    env: { ...process.env, PRODUCTION_SIGNING_ENABLED: "false" },
  });
  results.push({
    script,
    exitCode: r.status ?? 1,
    ok: r.status === 0,
    tail: String(r.stdout || r.stderr || "").slice(-400),
  });
}

const fail = results.filter((r) => !r.ok);
console.log(
  JSON.stringify({
    IU_CJ_OFFLINE_FULL_STACK_V1_SELFTEST: fail.length ? "FAIL" : "OK",
    pass: results.length - fail.length,
    fail: fail.length,
    failures: fail.map((f) => ({ script: f.script, exitCode: f.exitCode })),
  })
);
process.exit(fail.length ? 1 : 0);
