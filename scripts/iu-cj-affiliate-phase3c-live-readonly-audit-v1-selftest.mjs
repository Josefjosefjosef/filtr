#!/usr/bin/env node
/**
 * Offline selftest for Phase 3C live audit harness (no live HTTP).
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runPhase3cLiveReadonlyAudit } from "./iu-cj-affiliate-phase3c-live-readonly-audit-v1.mjs";
import { runCatalogSyncFetch } from "./iu-cj-affiliate-catalog-sync-fetch-v1.mjs";

const failures = [];
function expect(id, cond, detail) {
  if (!cond) failures.push(detail ? { id, detail } : id);
}

const src = fs.readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), "iu-cj-affiliate-catalog-sync-fetch-v1.mjs"),
  "utf8"
);
expect("fetch_uses_xml_accept_path", src.includes("cjGet") && src.includes("parseLinkBlocks"));
expect("fetch_paginates", src.includes("page-number=") && src.includes("pagination_incomplete"));
expect("fetch_empty_not_false_ok", src.includes("empty_result_verified"));

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "iu-p3c-audit-"));
const missing = await runPhase3cLiveReadonlyAudit({
  env: {},
  outDir: tmp,
});
expect("missing_creds_fail", missing.ok === false && missing.report.reason === "credentials_missing");
expect("no_live_flag_touch", missing.report.liveEnabledTouched === false);
expect("no_publish", missing.report.publishArmed === false);

const dryDir = path.join(tmp, "projects", "data");
fs.mkdirSync(dryDir, { recursive: true });
const dryFetch = await runCatalogSyncFetch({
  env: { IU_CJ_SYNC_HTTP_EXECUTE: "0" },
  outDir: dryDir,
});
expect("dry_fetch_mode", dryFetch.mode === "dry_staging_shape");
expect("dry_fetch_zero_http_counts", dryFetch.counts.advertisers === 0 && dryFetch.counts.links === 0);

const ok = failures.length === 0;
console.log(
  JSON.stringify({
    IU_CJ_PHASE3C_LIVE_READONLY_AUDIT_SELFTEST: ok ? "OK" : "FAIL",
    failures,
  })
);
process.exit(ok ? 0 : 1);
