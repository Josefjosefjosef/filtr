/**
 * Local health / generation state for NDIC 60s live writer.
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

export function defaultLiveRoot(env = process.env) {
  if (env.IU_NDIC_LIVE_ROOT) return path.resolve(String(env.IU_NDIC_LIVE_ROOT));
  return path.join(env.HOME || env.USERPROFILE || ".", ".cache", "infouzel-ndic-live");
}

export function healthPath(root = defaultLiveRoot()) {
  return path.join(root, "health.json");
}

export function generationPointerPath(root = defaultLiveRoot()) {
  return path.join(root, "current-generation.json");
}

export function readJsonSafe(p, fallback) {
  try {
    return JSON.parse(fs.readFileSync(p, "utf8"));
  } catch {
    return fallback;
  }
}

export function writeJsonAtomic(p, obj) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  const tmp = p + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(obj, null, 2) + "\n", "utf8");
  fs.renameSync(tmp, p);
}

export function emptyHealth() {
  return {
    schema: "iu-ndic-live-health-v1",
    LAST_POLL_AT: null,
    LAST_HTTP_STATUS: null,
    LAST_304_AT: null,
    LAST_200_AT: null,
    LAST_SUCCESSFUL_PROCESS_AT: null,
    LAST_SUCCESSFUL_PUBLICATION_AT: null,
    LAST_SUCCESSFUL_SOURCE_CHECK_AT: null,
    CURRENT_SOURCE_LAST_MODIFIED: null,
    CURRENT_PRODUCTION_GENERATION: null,
    ACTIVE_TMC_VERSION: null,
    CONSECUTIVE_FAILURES: 0,
    LAST_ERROR: null,
    LAST_CONDITIONAL_STATE_WRITE_AT: null,
    LAST_IF_MODIFIED_SINCE_SENT: null,
    STALE_THRESHOLD_MS: 15 * 60 * 1000,
  };
}

export function loadHealth(root = defaultLiveRoot()) {
  return { ...emptyHealth(), ...readJsonSafe(healthPath(root), {}) };
}

export function saveHealth(health, root = defaultLiveRoot()) {
  writeJsonAtomic(healthPath(root), health);
  return health;
}

export function buildGenerationId({ sourceLastModified, bodyHash, processedAt } = {}) {
  const raw = [sourceLastModified || "", bodyHash || "", processedAt || ""].join("|");
  const h = crypto.createHash("sha256").update(raw).digest("hex").slice(0, 16);
  return "gen_" + h;
}

export function isStaleWriter({ incomingSourceLastModified, currentSourceLastModified } = {}) {
  if (!incomingSourceLastModified || !currentSourceLastModified) return false;
  const a = Date.parse(String(incomingSourceLastModified));
  const b = Date.parse(String(currentSourceLastModified));
  if (!Number.isFinite(a) || !Number.isFinite(b)) {
    // RFC1123 string compare fallback: refuse if equal handled elsewhere; older if string <
    return String(incomingSourceLastModified) < String(currentSourceLastModified);
  }
  return a < b;
}
