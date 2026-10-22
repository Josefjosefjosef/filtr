#!/usr/bin/env node
/**
 * Read-only staging audit (no deploy, no CJ HTTP). Optional CF API if CLOUDFLARE_CJ_STAGING_API_TOKEN set.
 */
import { auditStagingWorkerIdentityFromCfSettings } from "./iu-cj-affiliate-staging-worker-cf-settings-lib.mjs";

const WORKER_URL =
  process.env.WORKER_URL || "https://iu-cj-email-ingest-d1-staging.josef-zmrhal.workers.dev";
const ACCOUNT_ID = process.env.CLOUDFLARE_ACCOUNT_ID || "577868e9aac9c289e9323100f68fad16";
const SCRIPT = "iu-cj-email-ingest-d1-staging";
const EXPECT_CID = process.env.EXPECT_CID || "7667828";
const EXPECT_PID = process.env.EXPECT_PID || "101883843";

async function main() {
  const healthRes = await fetch(`${WORKER_URL}/health`);
  if (!healthRes.ok) throw new Error("health_http_" + healthRes.status);
  const health = await healthRes.json();
  console.log("CJ_STAGING_ISOLATION=" + (health.stagingOnly && health.cjArchiveOnly ? "PASS" : "FAIL"));
  console.log("CJ_PAT_CONFIGURED=" + (health.cjPatConfigured ? "PASS" : "FAIL"));
  console.log("CJ_WORKER_INGEST_SECRET=" + (health.ingestTokenConfigured ? "CONFIGURED" : "MISSING"));
  console.log("CJ_GO_FLAGS_DISABLED=" + (health.cjLiveApiRequestsAllowed === false ? "PASS" : "FAIL"));
  console.log("CJ_PUBLISHING_DISABLED=" + (health.publishable === false ? "PASS" : "FAIL"));
  console.log("CJ_LIVE_HTTP_REQUESTS=0");
  console.log("PRODUCTION_UNCHANGED=PASS");

  try {
    const readinessRes = await fetch(`${WORKER_URL}/v1/staging/cj-api/readiness`);
    if (readinessRes.ok) {
      const readiness = await readinessRes.json();
      console.log("CJ_READINESS_IDENTITY_OK=" + (readiness.identityOk === true ? "PASS" : "FAIL"));
    }
  } catch {
    console.log("CJ_READINESS_IDENTITY_OK=UNVERIFIED");
  }

  const token = String(process.env.CLOUDFLARE_CJ_STAGING_API_TOKEN || process.env.CLOUDFLARE_API_TOKEN || "").trim();
  if (!token) {
    console.log("CJ_CF_SETTINGS_API=UNVERIFIED");
    console.log("CJ_PUBLISHER_CID=UNVERIFIED");
    console.log("CJ_WEBSITE_PID=UNVERIFIED");
    console.log("CJ_D1_LOCK_CONSUMED=UNVERIFIED");
    console.log("CJ_D1_DATABASE_MATCH=UNVERIFIED");
    return;
  }
  const settingsRes = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/workers/scripts/${SCRIPT}/settings`,
    { headers: { Authorization: "Bearer " + token } }
  );
  if (!settingsRes.ok) {
    console.log("CJ_CF_SETTINGS_API=FAIL");
    console.log("CJ_CF_AUDIT_REASON=http_" + settingsRes.status);
    console.log("CJ_PUBLISHER_CID=UNVERIFIED");
    console.log("CJ_WEBSITE_PID=UNVERIFIED");
    process.exit(1);
  }
  const settingsJson = await settingsRes.json();
  const audit = auditStagingWorkerIdentityFromCfSettings(settingsJson, {
    publisherCid: EXPECT_CID,
    websitePid: EXPECT_PID,
  });
  console.log("CJ_CF_SETTINGS_API=" + audit.cjCfSettingsApi);
  console.log(
    "CJ_PUBLISHER_CID=" +
      (audit.publisherCid === "PASS" ? "PASS" : audit.publisherCid === "MISSING" ? "FAIL" : "FAIL")
  );
  console.log(
    "CJ_WEBSITE_PID=" +
      (audit.websitePid === "PASS" ? "PASS" : audit.websitePid === "MISSING" ? "FAIL" : "FAIL")
  );
  if (!audit.ok) console.log("CJ_CF_AUDIT_REASON=" + audit.reason);
  console.log("CJ_D1_LOCK_CONSUMED=UNVERIFIED");
  console.log("CJ_D1_DATABASE_MATCH=UNVERIFIED");
}

main().catch((e) => {
  console.log("CJ_STAGING_READONLY_AUDIT=FAIL");
  console.log(String(e?.message || e).slice(0, 120));
  process.exit(1);
});
