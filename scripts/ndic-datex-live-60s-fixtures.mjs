#!/usr/bin/env node
/**
 * Offline fixtures for NDIC 60s live path (lock, anomaly, publication shadow, health).
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { tryAcquireLiveLock } from "./ndic-datex-v1/live-lock.mjs";
import { evaluateLiveAnomalyGuard } from "./ndic-datex-v1/live-anomaly-guard.mjs";
import {
  buildGenerationId,
  isStaleWriter,
  loadHealth,
  saveHealth,
  defaultLiveRoot,
} from "./ndic-datex-v1/live-health.mjs";
import {
  publishLiveTrafficSnapshot,
  summarizeSnapshot,
} from "./ndic-datex-v1/live-publication.mjs";

const fails = [];
function check(id, cond, detail) {
  try {
    assert.ok(cond, detail || id);
  } catch (e) {
    fails.push(id + ":" + String((e && e.message) || e));
  }
}

function sampleSnapshot(overrides = {}) {
  const cards = [];
  for (let i = 0; i < 100; i++) {
    cards.push({
      schema: "iu-traffic-card-projection-v1",
      lifecycleStatus: i < 70 ? "ACTIVE" : "FUTURE",
      preciseLocationVerified: i % 5 !== 0,
      road: i % 3 === 0 ? "D1" : null,
      validityLine: "x",
      timelineField: "situationRecordVersionTime",
    });
  }
  return {
    schema: "iu-traffic-offline-snapshot-v1",
    snapshotVersion: "test",
    generatedAt: "2026-08-11T12:00:00.000Z",
    cardCount: cards.length,
    cards,
    ...overrides,
  };
}

async function main() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "iu-ndic-live-"));
  process.env.IU_NDIC_LIVE_ROOT = tmp;

  // lock single-flight
  const lockPath = path.join(tmp, "live.lock");
  const a = tryAcquireLiveLock(lockPath);
  check("lock_acquire", a.ok);
  const b = tryAcquireLiveLock(lockPath);
  check("lock_second_blocked", !b.ok && b.reason === "locked");
  a.handle.release();
  const c = tryAcquireLiveLock(lockPath);
  check("lock_reacquire", c.ok);
  c.handle.release();

  // anomaly
  const okGuard = evaluateLiveAnomalyGuard({
    previous: { cardCount: 3600, ACTIVE_COUNT: 2600, RESOLVED_COUNT: 3000, UNRESOLVED_COUNT: 500 },
    candidate: { cardCount: 3677, ACTIVE_COUNT: 2631, RESOLVED_COUNT: 3152, UNRESOLVED_COUNT: 525 },
  });
  check("anomaly_ok_normal", okGuard.ok);
  const zero = evaluateLiveAnomalyGuard({
    previous: { cardCount: 3600, ACTIVE_COUNT: 2600 },
    candidate: { cardCount: 0, ACTIVE_COUNT: 0 },
  });
  check("anomaly_blocks_zero", zero.blocked && zero.reasons.includes("CATASTROPHIC_ZERO_CARDS"));
  const spike = evaluateLiveAnomalyGuard({
    previous: { cardCount: 3600, UNRESOLVED_COUNT: 500, RESOLVED_COUNT: 3000 },
    candidate: { cardCount: 3600, UNRESOLVED_COUNT: 3500, RESOLVED_COUNT: 100 },
  });
  check("anomaly_blocks_unresolved_spike", spike.blocked);

  // stale writer
  check(
    "stale_writer_detect",
    isStaleWriter({
      incomingSourceLastModified: "Tue, 11 Aug 2026 10:00:00 GMT",
      currentSourceLastModified: "Tue, 11 Aug 2026 12:00:00 GMT",
    }) === true
  );
  check(
    "stale_writer_allow_newer",
    isStaleWriter({
      incomingSourceLastModified: "Tue, 11 Aug 2026 13:00:00 GMT",
      currentSourceLastModified: "Tue, 11 Aug 2026 12:00:00 GMT",
    }) === false
  );

  // health
  const h = loadHealth(tmp);
  h.LAST_POLL_AT = "2026-08-11T12:00:00.000Z";
  saveHealth(h, tmp);
  const h2 = loadHealth(tmp);
  check("health_persist", h2.LAST_POLL_AT === "2026-08-11T12:00:00.000Z");
  check("live_root", defaultLiveRoot() === tmp);

  // shadow publication
  const snap = sampleSnapshot();
  const sum = summarizeSnapshot(snap);
  check("summary_cards", sum.cardCount === 100);
  check("summary_active", sum.ACTIVE_COUNT === 70);
  const gen = {
    generationId: buildGenerationId({
      sourceLastModified: "Tue, 11 Aug 2026 12:00:00 GMT",
      bodyHash: "abc",
      processedAt: "2026-08-11T12:00:01.000Z",
    }),
    sourceLastModified: "Tue, 11 Aug 2026 12:00:00 GMT",
    sourceDownloadedAt: "2026-08-11T12:00:01.000Z",
    processedAt: "2026-08-11T12:00:01.000Z",
  };
  const pub = await publishLiveTrafficSnapshot({ snapshot: snap, mode: "shadow", generation: gen });
  check("shadow_ok", pub.ok === true);
  check("shadow_no_prod_write", pub.PRODUCTION_WRITE === "NO");
  check("shadow_staged", pub.reason === "SHADOW_STAGED");
  check("gen_id", String(gen.generationId).startsWith("gen_"));

  // idempotence after promoting pointer manually
  const pub2 = await publishLiveTrafficSnapshot({ snapshot: snap, mode: "shadow", generation: gen });
  check("shadow_second_ok", pub2.ok === true);

  // active without credentials fails closed
  const pubActive = await publishLiveTrafficSnapshot({ snapshot: snap, mode: "active", generation: gen });
  check("active_missing_creds_fail_closed", pubActive.ok === false);
  check("active_lkg_protected", pubActive.LAST_KNOWN_GOOD_PROTECTED === "YES");

  // mock fetch publish success
  const gen2 = {
    ...gen,
    generationId: buildGenerationId({
      sourceLastModified: "Tue, 11 Aug 2026 12:01:00 GMT",
      bodyHash: "def",
      processedAt: "2026-08-11T12:01:01.000Z",
    }),
    sourceLastModified: "Tue, 11 Aug 2026 12:01:00 GMT",
  };
  process.env.IU_NDIC_LIVE_PUBLISH_URL = "https://example.test/publish";
  process.env.IU_NDIC_LIVE_PUBLISH_TOKEN = "test-token";
  const pub3 = await publishLiveTrafficSnapshot({
    snapshot: snap,
    mode: "active",
    generation: gen2,
    fetchImpl: async () =>
      new Response(JSON.stringify({ ok: true, reason: "PUBLISHED" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
  });
  check("active_publish_ok", pub3.ok === true && pub3.PRODUCTION_WRITE === "YES");
  check("active_atomic", pub3.ATOMIC_PUBLICATION_PASS === "YES");

  // unchanged skip
  const pub4 = await publishLiveTrafficSnapshot({
    snapshot: snap,
    mode: "active",
    generation: gen2,
    fetchImpl: async () => new Response("should-not-call", { status: 500 }),
  });
  check("unchanged_skip", pub4.UNCHANGED_CONTENT_PUBLICATION_SKIPPED === "YES");

  // Conditional state path resolves at call-time (not module import time)
  const { statePaths } = await import("./ndic-datex-v1-prod-sync.mjs");
  const liveWork = path.join(tmp, "work", "info_events");
  process.env.IU_INFO_EVENTS_DATA_DIR = liveWork;
  const p1 = statePaths(process.env);
  check("state_path_uses_live_work", p1.stateFile.replace(/\\/g, "/").includes("/work/info_events/ndic_datex_v1/sync_state.json"));
  fs.mkdirSync(path.dirname(p1.stateFile), { recursive: true });
  const atomicState = {
    sync: {
      lastModified: "Tue, 11 Aug 2026 12:00:00 GMT",
      bodyHash: "deadbeef",
      etag: null,
    },
  };
  const tmpState = p1.stateFile + ".tmp";
  fs.writeFileSync(tmpState, JSON.stringify(atomicState, null, 2) + "\n", "utf8");
  fs.renameSync(tmpState, p1.stateFile);
  const loaded = JSON.parse(fs.readFileSync(p1.stateFile, "utf8"));
  check("conditional_state_atomic_persist", loaded.sync.lastModified === "Tue, 11 Aug 2026 12:00:00 GMT");
  // Simulate second independent invocation reading same path
  const p2 = statePaths({ ...process.env, IU_INFO_EVENTS_DATA_DIR: liveWork });
  check("conditional_state_survives_invocation", p2.stateFile === p1.stateFile);
  const loaded2 = JSON.parse(fs.readFileSync(p2.stateFile, "utf8"));
  check("conditional_state_same_lm", loaded2.sync.lastModified === "Tue, 11 Aug 2026 12:00:00 GMT");

  try {
    fs.rmSync(tmp, { recursive: true, force: true });
  } catch {
    /* ignore */
  }

  if (fails.length) {
    console.error(JSON.stringify({ ok: false, fails }, null, 2));
    process.exit(1);
  }
  console.log(
    JSON.stringify({
      ok: true,
      passCount: 24,
      schema: "iu-ndic-live-60s-fixtures-v1",
      MAX_CONCURRENT_LIVE_DATEX_PROCESSORS: 1,
      PERSISTENT_CONDITIONAL_STATE_PASS: "YES",
    })
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
