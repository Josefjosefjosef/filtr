#!/usr/bin/env node
/**
 * Read-only audit of IU_CJ_PUBLISHER_CID / IU_CJ_WEBSITE_PID from CF Workers settings JSON (stdin).
 * Does not print binding values or secrets.
 */
import { auditStagingWorkerIdentityFromCfSettings } from "./iu-cj-affiliate-staging-worker-cf-settings-lib.mjs";

async function readAllStdin() {
  const chunks = [];
  for await (const c of process.stdin) chunks.push(c);
  return Buffer.concat(chunks).toString("utf8");
}

async function main() {
  const raw = (await readAllStdin()).trim();
  if (!raw) {
    console.log("CJ_CF_SETTINGS_API=FAIL");
    console.log("CJ_PUBLISHER_CID=UNVERIFIED");
    console.log("CJ_WEBSITE_PID=UNVERIFIED");
    console.log("CJ_CF_AUDIT_REASON=empty_stdin");
    process.exit(1);
  }
  let json;
  try {
    json = JSON.parse(raw);
  } catch {
    console.log("CJ_CF_SETTINGS_API=FAIL");
    console.log("CJ_PUBLISHER_CID=UNVERIFIED");
    console.log("CJ_WEBSITE_PID=UNVERIFIED");
    console.log("CJ_CF_AUDIT_REASON=invalid_json");
    process.exit(1);
  }
  const audit = auditStagingWorkerIdentityFromCfSettings(json, {
    publisherCid: process.env.EXPECT_CID || process.env.IU_CJ_PUBLISHER_CID_EXPECT,
    websitePid: process.env.EXPECT_PID || process.env.IU_CJ_WEBSITE_PID_EXPECT,
  });
  console.log("CJ_CF_SETTINGS_API=" + audit.cjCfSettingsApi);
  const cidOut =
    audit.publisherCid === "MISSING"
      ? "FAIL"
      : audit.publisherCid === "PASS"
        ? "PASS"
        : audit.publisherCid === "FAIL"
          ? "FAIL"
          : "UNVERIFIED";
  const pidOut =
    audit.websitePid === "MISSING"
      ? "FAIL"
      : audit.websitePid === "PASS"
        ? "PASS"
        : audit.websitePid === "FAIL"
          ? "FAIL"
          : "UNVERIFIED";
  console.log("CJ_PUBLISHER_CID=" + cidOut + (audit.publisherCid === "MISSING" ? " (MISSING_BINDING)" : ""));
  console.log("CJ_WEBSITE_PID=" + pidOut + (audit.websitePid === "MISSING" ? " (MISSING_BINDING)" : ""));
  if (audit.swapped) console.log("CJ_CID_PID_SWAPPED=YES");
  if (!audit.ok) console.log("CJ_CF_AUDIT_REASON=" + audit.reason);
  process.exit(audit.ok ? 0 : 1);
}

main().catch((e) => {
  console.log("CJ_CF_SETTINGS_API=FAIL");
  console.log("CJ_CF_AUDIT_REASON=" + String(e?.message || e).slice(0, 80));
  process.exit(1);
});
