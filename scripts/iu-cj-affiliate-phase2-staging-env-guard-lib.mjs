/** Staging vs production resource guards (offline config audit — no Cloudflare API). */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const WRANGLER = path.join(repoRoot, "cloudflare", "cj-email-ingest-d1-worker", "wrangler.toml");

const PLACEHOLDER_D1_ID = "00000000-0000-0000-0000-000000000000";
const PRODUCTION_NAME_MARKERS = ["-prod", "_prod", "production"];

export function parseWranglerStagingConfig(wranglerText = fs.readFileSync(WRANGLER, "utf8")) {
  const nameMatch = wranglerText.match(/^name\s*=\s*"([^"]+)"/m);
  const envMatch = wranglerText.match(/ENVIRONMENT\s*=\s*"([^"]+)"/);
  const d1NameMatch = wranglerText.match(/database_name\s*=\s*"([^"]+)"/);
  const d1IdMatch = wranglerText.match(/database_id\s*=\s*"([^"]+)"/);
  return {
    workerName: nameMatch?.[1] || null,
    environment: envMatch?.[1] || null,
    d1DatabaseName: d1NameMatch?.[1] || null,
    d1DatabaseId: d1IdMatch?.[1] || null,
  };
}

export function assertStagingWorkerNaming(config) {
  const name = String(config.workerName || "");
  if (!name) return { ok: false, reason: "missing_worker_name" };
  const lower = name.toLowerCase();
  if (PRODUCTION_NAME_MARKERS.some((m) => lower.includes(m))) {
    return { ok: false, reason: "production_name_marker", workerName: name };
  }
  if (!lower.includes("staging")) {
    return { ok: false, reason: "worker_name_must_include_staging", workerName: name };
  }
  return { ok: true, reason: "ok", workerName: name };
}

export function assertStagingD1Isolation(config) {
  const dbName = String(config.d1DatabaseName || "");
  if (!dbName.includes("staging")) {
    return { ok: false, reason: "d1_name_must_include_staging", d1DatabaseName: dbName };
  }
  if (config.d1DatabaseId === PLACEHOLDER_D1_ID) {
    return { ok: true, reason: "placeholder_id_awaiting_cf_go", placeholder: true };
  }
  if (!config.d1DatabaseId || config.d1DatabaseId.length < 8) {
    return { ok: false, reason: "invalid_d1_database_id" };
  }
  return { ok: true, reason: "ok", placeholder: false };
}

export function auditStagingWranglerConfig() {
  const config = parseWranglerStagingConfig();
  const naming = assertStagingWorkerNaming(config);
  const d1 = assertStagingD1Isolation(config);
  const envOk = config.environment === "staging";
  return {
    ok: naming.ok && d1.ok && envOk,
    config,
    naming,
    d1,
    environmentOk: envOk,
    publishable: false,
  };
}
