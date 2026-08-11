#!/usr/bin/env node
/**
 * Authorized conditional DATEX probe on Czech self-hosted runner only.
 * Bounded: request A → wait ≥60s → request B with validators.
 * No aggressive polling. Never logs secrets/Authorization/raw URL query.
 */
import { assertNdicCzechEgressRunnerOrThrow } from "./ndic-datex-v1/runner-identity.mjs";
import { getNdicDatexV1Config, assertAllowedPullUrl } from "./ndic-datex-v1/config.mjs";
import { createAuthenticatedPullDiscovery } from "./ndic-datex-v1/discovery-adapter.mjs";
import { applyConditionalResult, createSyncState } from "./ndic-datex-v1/sync-core.mjs";
import { buildDatexConditionalMetrics, safeEtagHash } from "./ndic-datex-v1/phase-observability.mjs";

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function redactResult(label, resp, sync, obs) {
  const m = buildDatexConditionalMetrics({
    status: resp.status,
    headers: resp.headers || {},
    ifModifiedSinceSent: obs && obs.ifModifiedSinceSent,
    ifNoneMatchSent: obs && obs.ifNoneMatchSent,
    bytesRead: obs && obs.bytesRead,
  });
  return {
    label,
    status: resp.status,
    metrics: m,
    etagPersisted: sync.etag ? "YES" : "NO",
    etagHash: sync.etag ? safeEtagHash(sync.etag) : null,
    lastModifiedPersisted: sync.lastModified ? "YES" : "NO",
    lastModifiedPreview: sync.lastModified ? String(sync.lastModified).slice(0, 40) : null,
    durationMs: obs && obs.totalDurationMs != null ? obs.totalDurationMs : null,
    bytesRead: obs && obs.bytesRead != null ? obs.bytesRead : null,
  };
}

async function main() {
  assertNdicCzechEgressRunnerOrThrow(process.env);
  const config = getNdicDatexV1Config(process.env);
  if (!config.hasPullCredentials) {
    console.log(JSON.stringify({ ok: false, reason: "credentials_missing" }));
    process.exit(1);
  }
  assertAllowedPullUrl(config.pullUrl);

  const waitMs = Math.max(60000, Number(process.env.IU_NDIC_CONDITIONAL_PROBE_WAIT_MS || 60000));
  const maxAttempts = Math.min(3, Math.max(1, Number(process.env.IU_NDIC_CONDITIONAL_PROBE_MAX_ATTEMPTS || 2)));
  const discovery = createAuthenticatedPullDiscovery({
    url: config.pullUrl,
    user: config.pullUser,
    pass: config.pullPass,
    userAgent: config.userAgent,
  });

  const sync = createSyncState("ndic://datex-pull-conditional-probe");
  const attempts = [];
  let proof = "INCONCLUSIVE_SOURCE_CHANGED";
  let saw304 = false;

  // Request A — establish validators
  const latest = await discovery.listLatest();
  const url = latest[0].url;
  const a = await discovery.fetchBody(url, {});
  applyConditionalResult(a, sync, { nowIso: new Date().toISOString() });
  attempts.push(redactResult("A", a, sync, a.observability));

  for (let i = 0; i < maxAttempts; i += 1) {
    await sleep(waitMs);
    const b = await discovery.fetchBody(url, {
      etag: sync.etag,
      lastModified: sync.lastModified,
    });
    const beforeHash = sync.bodyHash;
    const cond = applyConditionalResult(b, sync, { nowIso: new Date().toISOString() });
    attempts.push(redactResult("B" + (i + 1), b, sync, b.observability));
    if (b.status === 304 || cond.action === "not_modified") {
      saw304 = true;
      proof = "YES";
      break;
    }
    if (cond.action === "hash_unchanged") {
      // Server returned 200 but body identical — client-side not-modified; not a 304 proof
      proof = "INCONCLUSIVE_SOURCE_CHANGED";
    } else if (beforeHash && sync.bodyHash && beforeHash !== sync.bodyHash) {
      proof = "INCONCLUSIVE_SOURCE_CHANGED";
    }
  }

  const out = {
    ok: true,
    DATEX_304_PRODUCTION_PROOF: proof,
    DATEX_ETAG_RETURNED_BY_SERVER: attempts.some((x) => x.metrics.DATEX_RESPONSE_ETAG_PRESENT === "YES")
      ? "YES"
      : "NO",
    DATEX_LAST_MODIFIED_RETURNED_BY_SERVER: attempts.some(
      (x) => x.metrics.DATEX_RESPONSE_LAST_MODIFIED_PRESENT === "YES"
    )
      ? "YES"
      : "NO",
    DATEX_ETAG_PERSISTED: sync.etag ? "YES" : "NO",
    DATEX_LAST_MODIFIED_PERSISTED: sync.lastModified ? "YES" : "NO",
    "304_FAST_PATH_PASS": saw304 ? "YES" : "NO",
    waitMs,
    maxAttempts,
    attempts,
  };
  console.log(JSON.stringify(out, null, 2));
}

main().catch((e) => {
  console.error(JSON.stringify({ ok: false, error: String((e && e.message) || e) }));
  process.exit(1);
});
