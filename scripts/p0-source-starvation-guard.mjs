/**
 * p0_source_starvation_guard — P0 feeds must be fetched within SLA (scheduler_state / feed_health).
 *
 * Run: node scripts/p0-source-starvation-guard.mjs
 *
 * Env:
 *   SCHEDULER_STATE_PATH — default projects/data/scheduler_state.json
 *   FEED_HEALTH_PATH — default projects/data/feed_health.json
 *   P0_STARVATION_WARN_MINUTES — default 60
 *   P0_STARVATION_FAIL_MINUTES — default 120
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { P0_CONTENT_SOURCES } from "./content-freshness-guard-lib.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");

const schedPath =
  process.env.SCHEDULER_STATE_PATH || path.join(root, "projects", "data", "scheduler_state.json");
const healthPath = process.env.FEED_HEALTH_PATH || path.join(root, "projects", "data", "feed_health.json");
const warnMin = Number(process.env.P0_STARVATION_WARN_MINUTES || "60");
const failMin = Number(process.env.P0_STARVATION_FAIL_MINUTES || "120");
const allowMissingState = String(process.env.P0_STARVATION_ALLOW_MISSING_STATE || "0") === "1";

function log(msg) {
  console.log(`[p0-source-starvation-guard] ${msg}`);
}

function fail(msg) {
  console.error(`[p0-source-starvation-guard] FAIL: ${msg}`);
}

function parseTs(v) {
  if (!v) return null;
  const t = Date.parse(v);
  return Number.isFinite(t) ? t : null;
}

function loadJsonSafe(p) {
  if (!fs.existsSync(p)) return null;
  try {
    return JSON.parse(fs.readFileSync(p, "utf8"));
  } catch {
    return null;
  }
}

function lastFetchForSlotKey(slotKey, sched, health, registryUrls) {
  let best = null;
  if (sched && typeof sched === "object") {
    const domainLast = sched.domain_last_fetch || {};
    const ts = parseTs(domainLast[slotKey]);
    if (ts) best = ts;
    const entryState = sched.entry_state || {};
    for (const st of Object.values(entryState)) {
      if (!st || typeof st !== "object") continue;
      const t = parseTs(st.last_fetch_at || st.last_success_at);
      if (t && (!best || t > best)) best = t;
    }
  }
  if (health && typeof health === "object") {
    const feeds = health.feeds || health;
    for (const url of registryUrls) {
      const rep = feeds[url];
      if (!rep || typeof rep !== "object") continue;
      const t = parseTs(rep.last_fetch_at || rep.lastFetchAt || rep.fetchedAt || rep.last_success_at);
      if (t && (!best || t > best)) best = t;
    }
  }
  return best;
}

function resolveUrlsForSlot(slotKey) {
  const urls = [];
  for (const def of P0_CONTENT_SOURCES) {
    if (def.slotKey === slotKey) urls.push(def.fallbackUrl);
  }
  return urls;
}

function main() {
  let failed = false;
  let warned = false;
  const sched = loadJsonSafe(schedPath);
  const health = loadJsonSafe(healthPath);
  const now = Date.now();

  if (!sched && !health) {
    if (allowMissingState) {
      log("SKIP no scheduler_state or feed_health (allow missing)");
      log("RESULT=PASS");
      return;
    }
    fail("missing scheduler_state and feed_health — cannot verify P0 fetch recency");
    console.error("[p0-source-starvation-guard] RESULT=FAIL");
    process.exit(1);
  }

  for (const def of P0_CONTENT_SOURCES) {
    const last = lastFetchForSlotKey(def.slotKey, sched, health, resolveUrlsForSlot(def.slotKey));
    const ageMin = last ? (now - last) / 60_000 : null;
    log(
      `source=${def.label} slot_key=${def.slotKey} last_fetch=${last ? new Date(last).toISOString() : "unknown"} age_min=${ageMin !== null ? ageMin.toFixed(1) : "n/a"}`,
    );
    if (last === null) {
      log(`WARN: ${def.label} last fetch unknown`);
      warned = true;
      continue;
    }
    if (ageMin > failMin) {
      fail(`${def.label} not fetched for ${ageMin.toFixed(1)}m > ${failMin}m`);
      failed = true;
    } else if (ageMin > warnMin) {
      log(`WARN: ${def.label} not fetched for ${ageMin.toFixed(1)}m > ${warnMin}m`);
      warned = true;
    }
  }

  if (failed) {
    console.error("[p0-source-starvation-guard] RESULT=FAIL");
    process.exit(1);
  }
  log(warned ? "RESULT=PASS_WITH_WARN" : "RESULT=PASS");
}

main();
