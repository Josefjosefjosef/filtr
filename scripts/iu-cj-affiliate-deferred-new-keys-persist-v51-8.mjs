#!/usr/bin/env node
/**
 * Persist FULL deferredNew composite identity keys (keys-only) for set-diff reconcile.
 *
 * Why: offers.publicGrowthBudget keeps sample≤50/200 and MUST NOT embed ~300k keys
 * (Pages size). The historical fat ledger write (keys+entries) often fails silently /
 * exceeds GitHub blob limits and was never stashed onto the sync branch — so current
 * deferredNewKeys were unavailable for DEFERRED_LEDGER_*_DELTA reconciliation.
 *
 * Writes (default under projects/data, overridable via env):
 *   - iu-affiliate-cj-deferred-new-ledger-v51.json  (keys-only pretty JSON; streamable)
 *   - iu-affiliate-cj-deferred-new-keys-v51.jsonl.gz (one key per line, gzip)
 *   - iu-affiliate-cj-deferred-new-keys-v51.meta.json (path pointers + counts)
 *
 * Never arms uncapped growth. Never embeds secrets. Not intended for public Pages.
 */

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import readline from "node:readline";
import { createReadStream, createWriteStream } from "node:fs";
import { pipeline } from "node:stream/promises";
import { createGzip, createGunzip } from "node:zlib";

export const DEFERRED_NEW_KEYS_SCHEMA = "iu-affiliate-cj-deferred-new-keys-v51";
export const DEFERRED_NEW_LEDGER_SCHEMA = "iu-affiliate-cj-deferred-new-ledger-v51";
export const DEFERRED_NEW_LEDGER_FILENAME = "iu-affiliate-cj-deferred-new-ledger-v51.json";
export const DEFERRED_NEW_KEYS_JSONL_GZ = "iu-affiliate-cj-deferred-new-keys-v51.jsonl.gz";
export const DEFERRED_NEW_KEYS_META_FILENAME = "iu-affiliate-cj-deferred-new-keys-v51.meta.json";
export const DEFERRED_ACTIVE_FILENAME = "iu-affiliate-cj-deferred-new-active-v51.json";

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function sha256File(filePath) {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

function readJsonIf(filePath) {
  try {
    if (!fs.existsSync(filePath)) return null;
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return null;
  }
}

function generationDir(outDir, generation) {
  return path.join(outDir, "generations", String(generation));
}

function acquireWriteLock(outDir) {
  ensureDir(outDir);
  const lockPath = path.join(outDir, ".deferred-write.lock");
  let fd;
  try {
    fd = fs.openSync(lockPath, "wx");
  } catch (err) {
    if (err && err.code === "EEXIST") {
      const busy = new Error("CONCURRENT_DEFERRED_WRITE");
      busy.code = "CONCURRENT_DEFERRED_WRITE";
      throw busy;
    }
    throw err;
  }
  fs.writeSync(fd, String(process.pid));
  fs.closeSync(fd);
  return lockPath;
}

function releaseWriteLock(lockPath) {
  if (lockPath) fs.rmSync(lockPath, { force: true });
}

function publishJsonAtomic(filePath, value) {
  const partial = filePath + ".partial";
  fs.writeFileSync(partial, JSON.stringify(value, null, 2) + "\n", "utf8");
  fs.renameSync(partial, filePath);
}

export function readActiveDeferredGeneration(outDir) {
  return readJsonIf(path.join(outDir, DEFERRED_ACTIVE_FILENAME));
}

export function verifyDeferredGenerationDir(genDir) {
  const ledger = path.join(genDir, DEFERRED_NEW_LEDGER_FILENAME);
  const gz = path.join(genDir, DEFERRED_NEW_KEYS_JSONL_GZ);
  const manifest = readJsonIf(path.join(genDir, "manifest.json"));
  if (!manifest) return { ok: false, reason: "MISSING_MANIFEST" };
  if (!fs.existsSync(ledger)) return { ok: false, reason: "MISSING_LEDGER" };
  if (!fs.existsSync(gz)) return { ok: false, reason: "MISSING_GZIP" };
  let ledgerSha = null;
  let gzSha = null;
  try {
    ledgerSha = sha256File(ledger);
    gzSha = sha256File(gz);
  } catch {
    return { ok: false, reason: "HASH_READ_FAILED" };
  }
  if (ledgerSha !== manifest.ledgerSha256 || gzSha !== manifest.jsonlGzSha256) {
    return { ok: false, reason: "SHA256_MISMATCH", ledgerSha, gzSha };
  }
  if (Number(manifest.keyCount) < 0) return { ok: false, reason: "MISSING_COUNT" };
  return { ok: true, manifest, ledger, gz, ledgerSha, gzSha };
}

function resolveOutDir(opts = {}, env = process.env) {
  if (opts.outDir) return path.resolve(String(opts.outDir));
  if (env.IU_CJ_DEFERRED_NEW_KEYS_OUT) {
    const p = path.resolve(String(env.IU_CJ_DEFERRED_NEW_KEYS_OUT));
    // File path → use parent dir; directory path → use as-is.
    try {
      if (fs.existsSync(p) && fs.statSync(p).isDirectory()) return p;
    } catch {
      /* ignore */
    }
    if (/\.(json|jsonl|gz)$/i.test(p)) return path.dirname(p);
    return p;
  }
  if (env.IU_CJ_DEFERRED_NEW_KEYS_DIR) return path.resolve(String(env.IU_CJ_DEFERRED_NEW_KEYS_DIR));
  if (opts.dataDir) return path.resolve(String(opts.dataDir));
  return path.resolve("projects", "data");
}

function resolveAuditDir(opts = {}, env = process.env) {
  if (opts.auditDir) return path.resolve(String(opts.auditDir));
  if (env.IU_CJ_DEFERRED_NEW_KEYS_AUDIT_DIR) return path.resolve(String(env.IU_CJ_DEFERRED_NEW_KEYS_AUDIT_DIR));
  if (env.IU_CJ_AUDITS_ROOT) return path.resolve(String(env.IU_CJ_AUDITS_ROOT));
  return null;
}

/** Normalize to unique non-empty string keys (preserves first-seen order). */
export function normalizeDeferredNewKeys(keys) {
  const out = [];
  const seen = new Set();
  if (!Array.isArray(keys)) return out;
  for (const raw of keys) {
    const k = raw == null ? "" : String(raw).trim();
    if (!k || k === "|" || seen.has(k)) continue;
    seen.add(k);
    out.push(k);
  }
  return out;
}

/**
 * Keys-only ledger document (compatible with inventory streamLedger / IU_CJ_INV_LEDGER).
 * Deliberately omits per-key `entries` enrichment to keep ~300k identities under GitHub limits.
 */
export function buildDeferredNewKeysOnlyDocument(deferredNewKeys, opts = {}) {
  const keys = normalizeDeferredNewKeys(deferredNewKeys);
  const budget = opts.budget || null;
  return {
    schema: DEFERRED_NEW_LEDGER_SCHEMA,
    updatedAt: opts.nowIso || new Date().toISOString(),
    runId: opts.runId != null && String(opts.runId).trim() ? String(opts.runId) : "UNKNOWN",
    catalogGeneration:
      opts.catalogGeneration != null && Number.isFinite(Number(opts.catalogGeneration))
        ? Number(opts.catalogGeneration)
        : opts.catalogGeneration === null
          ? null
          : "UNKNOWN",
    deferredNewCount: keys.length,
    reason: String(opts.reason || "PER_RUN_GROWTH_BUDGET"),
    preferredCurrency: String(opts.preferredCurrency || "CZK").toUpperCase(),
    budget: budget
      ? {
          allowedNew: budget.allowedNew,
          cumulativeAddedSinceBaseline: budget.cumulativeAddedSinceBaseline,
          cumulativeRemaining: budget.cumulativeRemaining,
          uncappedMode: budget.uncappedMode === true,
          maxCumulativeAbs: budget.maxCumulativeAbs,
          maxGrowthAbs: budget.maxGrowthAbs,
          maxGrowthRatio: budget.maxGrowthRatio,
        }
      : null,
    keys,
    sampleOnlyInOffers: true,
    keysOnly: true,
    evidenceCompleteness: "FULL_KEYS",
    uncappedMode: budget?.uncappedMode === true,
    growthGateLocked: budget?.uncappedMode !== true,
    note:
      "Keys-only deferred-new identity ledger for set-diff reconcile. Full entries omitted intentionally (size). Offers publicGrowthBudget keeps sample only. Not for public Pages.",
  };
}

/** Stream keys as gzipped JSONL (one key string per line). */
export async function writeDeferredNewKeysJsonlGz(keys, filePath) {
  ensureDir(path.dirname(filePath));
  const partial = filePath + ".partial";
  const gzip = createGzip({ level: 6 });
  const out = createWriteStream(partial);
  const done = pipeline(gzip, out);
  for (const k of keys) {
    if (!gzip.write(JSON.stringify(k) + "\n")) {
      await new Promise((resolve) => gzip.once("drain", resolve));
    }
  }
  gzip.end();
  await done;
  fs.renameSync(partial, filePath);
  return { path: filePath, count: keys.length, bytes: fs.statSync(filePath).size };
}

/** Write pretty keys-only ledger JSON (streamed line-by-line to avoid giant stringify of entries). */
export function writeDeferredNewKeysOnlyLedger(keys, filePath, meta = {}) {
  ensureDir(path.dirname(filePath));
  const docMeta = buildDeferredNewKeysOnlyDocument([], meta);
  const partial = filePath + ".partial";
  const fd = fs.openSync(partial, "w");
  try {
    const w = (s) => fs.writeSync(fd, s);
    w("{\n");
    w(`  "schema": ${JSON.stringify(docMeta.schema)},\n`);
    w(`  "updatedAt": ${JSON.stringify(docMeta.updatedAt)},\n`);
    w(`  "runId": ${JSON.stringify(docMeta.runId)},\n`);
    w(`  "catalogGeneration": ${JSON.stringify(docMeta.catalogGeneration)},\n`);
    w(`  "deferredNewCount": ${keys.length},\n`);
    w(`  "reason": ${JSON.stringify(docMeta.reason)},\n`);
    w(`  "preferredCurrency": ${JSON.stringify(docMeta.preferredCurrency)},\n`);
    w(`  "budget": ${JSON.stringify(docMeta.budget)},\n`);
    w(`  "keysOnly": true,\n`);
    w(`  "sampleOnlyInOffers": true,\n`);
    w(`  "evidenceCompleteness": "FULL_KEYS",\n`);
    w(`  "uncappedMode": ${docMeta.uncappedMode === true},\n`);
    w(`  "growthGateLocked": ${docMeta.growthGateLocked !== false},\n`);
    w(`  "note": ${JSON.stringify(docMeta.note)},\n`);
    w(`  "keys": [\n`);
    for (let i = 0; i < keys.length; i++) {
      const comma = i + 1 < keys.length ? "," : "";
      w(`    ${JSON.stringify(keys[i])}${comma}\n`);
    }
    w(`  ]\n`);
    w(`}\n`);
  } finally {
    fs.closeSync(fd);
  }
  fs.renameSync(partial, filePath);
  return { path: filePath, count: keys.length, bytes: fs.statSync(filePath).size };
}

/**
 * Persist current deferredNew keyset. Safe for DISARMED sync (no growth unlock).
 * @returns {{ ok: boolean, keyCount: number, ledgerPath: string, jsonlGzPath: string, metaPath: string, auditCopy: string|null, publicGrowthBudgetPatch: object }}
 */
export function restorePreviousValidDeferredGeneration(outDir) {
  const root = path.join(outDir, "generations");
  const active = readActiveDeferredGeneration(outDir);
  const current = active ? Number(active.generation) || 0 : 0;
  if (current > 0) {
    const currentCheck = verifyDeferredGenerationDir(generationDir(outDir, current));
    if (currentCheck.ok) return { restored: false, reason: "ACTIVE_VALID", generation: current };
  }
  if (!fs.existsSync(root)) return { restored: false, reason: "NO_GENERATIONS" };
  const older = fs
    .readdirSync(root)
    .map((name) => Number(name))
    .filter((n) => Number.isFinite(n) && n > 0 && n < current)
    .sort((a, b) => b - a);
  for (const generation of older) {
    const check = verifyDeferredGenerationDir(generationDir(outDir, generation));
    if (!check.ok) continue;
    publishJsonAtomic(path.join(outDir, DEFERRED_ACTIVE_FILENAME), {
      ...check.manifest,
      relativeDir: path.join("generations", String(generation)),
    });
    return { restored: true, generation, manifest: check.manifest };
  }
  return { restored: false, reason: "NO_VALID_PREVIOUS" };
}

export async function persistDeferredNewKeys(deferredNewKeys, opts = {}, env = process.env) {
  const keys = normalizeDeferredNewKeys(deferredNewKeys);
  const outDir = resolveOutDir(opts, env);
  ensureDir(outDir);
  const lockPath = acquireWriteLock(outDir);
  try {
  const metaPath = path.join(outDir, DEFERRED_NEW_KEYS_META_FILENAME);
  const active = readActiveDeferredGeneration(outDir);
  let previousGeneration = active ? Number(active.generation) || 0 : 0;
  if (!previousGeneration && fs.existsSync(metaPath)) {
    try {
      previousGeneration = Number(JSON.parse(fs.readFileSync(metaPath, "utf8")).generation) || 0;
    } catch {
      previousGeneration = 0;
    }
  }
  if (opts.expectedGeneration != null && Number(opts.expectedGeneration) !== previousGeneration) {
    const err = new Error("STALE_DEFERRED_SIDECAR");
    err.code = "STALE_DEFERRED_SIDECAR";
    throw err;
  }
  const generation = previousGeneration + 1;
  const genDir = generationDir(outDir, generation);
  fs.rmSync(genDir, { recursive: true, force: true });
  ensureDir(genDir);
  const ledgerPath = path.join(genDir, DEFERRED_NEW_LEDGER_FILENAME);
  const jsonlGzPath = path.join(genDir, DEFERRED_NEW_KEYS_JSONL_GZ);
  const ledgerWrite = writeDeferredNewKeysOnlyLedger(keys, ledgerPath, opts);
  if (typeof opts.afterLedger === "function") opts.afterLedger({ generation, genDir, ledgerPath });
  const gzWrite = await writeDeferredNewKeysJsonlGz(keys, jsonlGzPath);
  const ledgerSha256 = sha256File(ledgerPath);
  const jsonlGzSha256 = sha256File(jsonlGzPath);
  const manifest = {
    schema: DEFERRED_NEW_KEYS_SCHEMA,
    generation,
    keyCount: keys.length,
    ledgerSha256,
    jsonlGzSha256,
    ledgerBytes: ledgerWrite.bytes,
    jsonlGzBytes: gzWrite.bytes,
    forPublicPages: false,
    runId: opts.runId != null && String(opts.runId).trim() ? String(opts.runId) : "UNKNOWN",
    updatedAt: opts.nowIso || new Date().toISOString(),
  };
  publishJsonAtomic(path.join(genDir, "manifest.json"), manifest);
  const verified = verifyDeferredGenerationDir(genDir);
  if (!verified.ok) {
    const err = new Error(verified.reason || "GENERATION_NOT_CONSISTENT");
    err.code = verified.reason || "GENERATION_NOT_CONSISTENT";
    throw err;
  }
  publishJsonAtomic(path.join(outDir, DEFERRED_ACTIVE_FILENAME), {
    ...manifest,
    relativeDir: path.join("generations", String(generation)),
  });
  fs.copyFileSync(ledgerPath, path.join(outDir, DEFERRED_NEW_LEDGER_FILENAME));
  fs.copyFileSync(jsonlGzPath, path.join(outDir, DEFERRED_NEW_KEYS_JSONL_GZ));

  const meta = {
    schema: DEFERRED_NEW_KEYS_SCHEMA,
    updatedAt: manifest.updatedAt,
    runId: manifest.runId,
    deferredNewCount: keys.length,
    keysOnly: true,
    ledgerFile: DEFERRED_NEW_LEDGER_FILENAME,
    jsonlGzFile: DEFERRED_NEW_KEYS_JSONL_GZ,
    ledgerPath,
    jsonlGzPath,
    ledgerBytes: ledgerWrite.bytes,
    ledgerSha256,
    jsonlGzSha256,
    generation,
    jsonlGzBytes: gzWrite.bytes,
    reason: String(opts.reason || "PER_RUN_GROWTH_BUDGET"),
    preferredCurrency: String(opts.preferredCurrency || "CZK").toUpperCase(),
    forPublicPages: false,
    note: "One generation directory holds ledger and gzip. The active pointer switches only after both hashes match.",
  };
  publishJsonAtomic(metaPath, meta);

  let auditCopy = null;
  const auditDir = resolveAuditDir(opts, env);
  if (auditDir) {
    try {
      ensureDir(auditDir);
      const auditLedger = path.join(auditDir, DEFERRED_NEW_LEDGER_FILENAME);
      const auditGz = path.join(auditDir, DEFERRED_NEW_KEYS_JSONL_GZ);
      const auditMeta = path.join(auditDir, DEFERRED_NEW_KEYS_META_FILENAME);
      fs.copyFileSync(ledgerPath, auditLedger);
      fs.copyFileSync(jsonlGzPath, auditGz);
      fs.writeFileSync(
        auditMeta,
        JSON.stringify({ ...meta, ledgerPath: auditLedger, jsonlGzPath: auditGz, copiedFrom: outDir }, null, 2) + "\n",
        "utf8"
      );
      auditCopy = auditDir;
    } catch {
      auditCopy = null;
    }
  }

  const publicGrowthBudgetPatch = {
    deferredNewLedgerSchema: DEFERRED_NEW_LEDGER_SCHEMA,
    deferredNewLedgerFile: DEFERRED_NEW_LEDGER_FILENAME,
    deferredNewKeysFile: DEFERRED_NEW_KEYS_JSONL_GZ,
    deferredNewKeysMetaFile: DEFERRED_NEW_KEYS_META_FILENAME,
    deferredNewKeysPersistedInOffers: false,
    deferredNewKeysPersistedSidecar: true,
    deferredNewKeysPersistedCount: keys.length,
    deferredNewKeysForPublicPages: false,
  };

  return {
    ok: true,
    keyCount: keys.length,
    ledgerPath,
    jsonlGzPath,
    metaPath,
    auditCopy,
    publicGrowthBudgetPatch,
    meta,
    generation,
  };
  } finally {
    releaseWriteLock(lockPath);
  }
}

/** Stream keys from keys-only ledger JSON (pretty `keys: [` layout) or fallback JSON.parse. */
export async function streamDeferredNewKeysFromLedger(file, onKey) {
  const meta = {};
  let inKeys = false;
  let rows = 0;
  const rl = readline.createInterface({
    input: createReadStream(file, { encoding: "utf8" }),
    crlfDelay: Infinity,
  });
  for await (const line of rl) {
    const t = line.trim();
    if (!inKeys) {
      if (/^"keys"\s*:\s*\[\s*$/.test(t)) {
        inKeys = true;
        continue;
      }
      const m = t.match(
        /^"(schema|updatedAt|runId|catalogGeneration|deferredNewCount|reason|preferredCurrency|keysOnly)"\s*:\s*(.*?),?$/
      );
      if (m) {
        try {
          meta[m[1]] = JSON.parse(m[2]);
        } catch {
          /* ignore */
        }
      }
      continue;
    }
    if (t.startsWith("]")) break;
    const m = t.match(/^"(.*)",?$/);
    if (m) {
      rows += 1;
      onKey(m[1]);
    }
  }
  if (rows === 0) {
    const j = JSON.parse(fs.readFileSync(file, "utf8"));
    const arr = Array.isArray(j.keys) ? j.keys : Array.isArray(j) ? j : [];
    for (const k of arr) {
      const key = typeof k === "string" ? k : null;
      if (!key) continue;
      rows += 1;
      onKey(key);
    }
    for (const k of [
      "schema",
      "updatedAt",
      "runId",
      "catalogGeneration",
      "deferredNewCount",
      "reason",
      "preferredCurrency",
      "keysOnly",
    ]) {
      if (j[k] !== undefined) meta[k] = j[k];
    }
  }
  return { rows, meta };
}

/** Stream keys from gzipped JSONL. */
export async function streamDeferredNewKeysFromJsonlGz(file, onKey) {
  const rl = readline.createInterface({
    input: createReadStream(file).pipe(createGunzip()),
    crlfDelay: Infinity,
  });
  let rows = 0;
  for await (const line of rl) {
    const t = line.trim();
    if (!t) continue;
    let key;
    try {
      key = JSON.parse(t);
    } catch {
      key = t;
    }
    if (typeof key !== "string" || !key) continue;
    rows += 1;
    onKey(key);
  }
  return { rows };
}

/**
 * Load full key set into a Set (for set-diff). Prefers jsonl.gz when present beside ledger/meta.
 * Accepts: ledger JSON, jsonl.gz, or meta.json that points at either.
 */
export async function loadDeferredNewKeySet(fileOrDir, opts = {}) {
  let target = fileOrDir ? path.resolve(String(fileOrDir)) : null;
  if (!target) throw new Error("loadDeferredNewKeySet: path required");
  let ledgerPath = null;
  let gzPath = null;
  let meta = null;

  if (fs.existsSync(target) && fs.statSync(target).isDirectory()) {
    const active = readActiveDeferredGeneration(target);
    if (active && active.generation) {
      let check = verifyDeferredGenerationDir(generationDir(target, active.generation));
      if (!check.ok) {
        const restored = restorePreviousValidDeferredGeneration(target);
        if (restored.restored) {
          check = verifyDeferredGenerationDir(generationDir(target, restored.generation));
        }
      }
      if (check.ok) {
        ledgerPath = check.ledger;
        gzPath = check.gz;
        meta = check.manifest;
      }
    }
    if (!gzPath && !ledgerPath) {
      ledgerPath = path.join(target, DEFERRED_NEW_LEDGER_FILENAME);
      gzPath = path.join(target, DEFERRED_NEW_KEYS_JSONL_GZ);
      const metaPath = path.join(target, DEFERRED_NEW_KEYS_META_FILENAME);
      if (fs.existsSync(metaPath)) meta = JSON.parse(fs.readFileSync(metaPath, "utf8"));
    }
  } else if (/\.meta\.json$/i.test(target)) {
    meta = JSON.parse(fs.readFileSync(target, "utf8"));
    const dir = path.dirname(target);
    ledgerPath = meta.ledgerPath || path.join(dir, meta.ledgerFile || DEFERRED_NEW_LEDGER_FILENAME);
    gzPath = meta.jsonlGzPath || path.join(dir, meta.jsonlGzFile || DEFERRED_NEW_KEYS_JSONL_GZ);
  } else if (/\.jsonl\.gz$/i.test(target)) {
    gzPath = target;
  } else {
    ledgerPath = target;
    const dir = path.dirname(target);
    const siblingGz = path.join(dir, DEFERRED_NEW_KEYS_JSONL_GZ);
    if (fs.existsSync(siblingGz)) gzPath = siblingGz;
  }

  const keys = new Set();
  let source = null;
  let rows = 0;
  const preferGz = opts.preferGz !== false;
  if (preferGz && gzPath && fs.existsSync(gzPath)) {
    const r = await streamDeferredNewKeysFromJsonlGz(gzPath, (k) => keys.add(k));
    rows = r.rows;
    source = gzPath;
  } else if (ledgerPath && fs.existsSync(ledgerPath)) {
    const r = await streamDeferredNewKeysFromLedger(ledgerPath, (k) => keys.add(k));
    rows = r.rows;
    source = ledgerPath;
    meta = { ...(meta || {}), ...r.meta };
  } else {
    throw new Error(`loadDeferredNewKeySet: no readable keys at ${target}`);
  }
  return {
    keys,
    uniqueCount: keys.size,
    rows,
    source,
    meta,
  };
}

/** Env helpers for inventory / balance scripts. */
export function deferredKeysPathsFromEnv(env = process.env) {
  return {
    currentKeys:
      env.IU_CJ_INV_CURRENT_DEFERRED_KEYS ||
      env.IU_CJ_DEFERRED_NEW_KEYS_OUT ||
      env.IU_CJ_DEFERRED_NEW_KEYS_DIR ||
      null,
    historicalLedger: env.IU_CJ_INV_LEDGER || null,
  };
}
