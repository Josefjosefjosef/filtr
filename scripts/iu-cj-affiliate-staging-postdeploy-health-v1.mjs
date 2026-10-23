#!/usr/bin/env node
/**
 * Read-only staging post-deploy health gate (HTTP + assertions retry).
 * Usage:
 *   node scripts/iu-cj-affiliate-staging-postdeploy-health-v1.mjs --url https://...workers.dev
 *   node scripts/iu-cj-affiliate-staging-postdeploy-health-v1.mjs --url ... --expected-version-id <uuid>
 * Never prints PAT/secrets.
 */
import {
  runStagingPostDeployHealthRetry,
  STAGING_POSTDEPLOY_HEALTH_DEFAULTS,
} from "./iu-cj-affiliate-staging-postdeploy-health-lib.mjs";

function argValue(flag) {
  const i = process.argv.indexOf(flag);
  if (i === -1) return null;
  return process.argv[i + 1] ?? null;
}

function redact(s) {
  return String(s || "").replace(/(token|Token|Bearer|pat|PAT)[^\s]*/g, "[REDACTED]");
}

async function main() {
  const urlRaw = argValue("--url") || process.env.WORKER_URL || "";
  const base = String(urlRaw).replace(/\/+$/, "");
  if (!base) {
    console.log("CJ_POSTDEPLOY_HEALTH=FAIL");
    console.log("CJ_POSTDEPLOY_HEALTH_REASON=url_missing");
    process.exit(1);
  }
  const healthUrl = base.endsWith("/health") ? base : `${base}/health`;
  const expectedVersionId =
    argValue("--expected-version-id") || process.env.EXPECTED_VERSION_ID || "";
  const maxAttempts = Number(
    argValue("--max-attempts") ||
      process.env.CJ_POSTDEPLOY_MAX_ATTEMPTS ||
      STAGING_POSTDEPLOY_HEALTH_DEFAULTS.maxAttempts
  );
  const sleepMs = Number(
    argValue("--sleep-ms") ||
      process.env.CJ_POSTDEPLOY_SLEEP_MS ||
      STAGING_POSTDEPLOY_HEALTH_DEFAULTS.sleepMs
  );

  const result = await runStagingPostDeployHealthRetry({
    expectedVersionId: expectedVersionId || null,
    maxAttempts,
    sleepMs,
    fetchHealth: async () => {
      const ac = new AbortController();
      const t = setTimeout(() => ac.abort(), 15000);
      try {
        const res = await fetch(healthUrl, {
          method: "GET",
          signal: ac.signal,
          headers: { Accept: "application/json" },
        });
        const body = await res.text();
        return { status: res.status, body };
      } catch (e) {
        return {
          status: 0,
          body: "",
          error: redact(e && e.message ? e.message : String(e)),
        };
      } finally {
        clearTimeout(t);
      }
    },
  });

  for (const a of result.attempts) {
    console.log(
      `CJ_POSTDEPLOY_ATTEMPT=${a.attempt} ok=${a.ok} phase=${a.phase || "n/a"} reasons=${(a.reasons || []).join(",") || "none"} versionCheck=${a.versionCheck || "n/a"}`
    );
  }

  if (result.ok) {
    console.log("CJ_POSTDEPLOY_HEALTH=PASS");
    console.log(`CJ_POSTDEPLOY_PASSED_ON_ATTEMPT=${result.passedOnAttempt}`);
    console.log("CJ_GO_FLAGS_DISABLED=PASS");
    console.log("CJ_PUBLISHING_DISABLED=PASS");
    console.log(`CJ_POSTDEPLOY_VERSION_CHECK=${result.last.versionCheck}`);
    console.log("CJ_LIVE_HTTP_REQUESTS=0");
    process.exit(0);
  }

  console.log("CJ_POSTDEPLOY_HEALTH=FAIL");
  console.log(`CJ_POSTDEPLOY_HEALTH_REASON=${result.reason || "assert_failed"}`);
  const lastReasons = (result.last && result.last.reasons) || [];
  console.log(`CJ_POSTDEPLOY_LAST_REASONS=${lastReasons.join(",") || "unknown"}`);
  if (result.last && result.last.payloadSafe) {
    console.log(`CJ_POSTDEPLOY_LAST_SAFE=${JSON.stringify(result.last.payloadSafe)}`);
  }
  process.exit(1);
}

main().catch((e) => {
  console.log("CJ_POSTDEPLOY_HEALTH=FAIL");
  console.log("CJ_POSTDEPLOY_HEALTH_REASON=unhandled");
  console.log("CJ_POSTDEPLOY_DETAIL=" + redact(e && e.message ? e.message : String(e)));
  process.exit(1);
});
