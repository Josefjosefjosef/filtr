/**
 * Versioned internal TMC location table importer (CC=2 / LTN=25).
 * Atomic activate; keep last-good on failure; never expose full table publicly.
 */
import crypto from "crypto";
import { TMC_COUNTRY_CODE, TMC_LOCATION_TABLE_NUMBER, DEFAULT_LIMITS } from "./config.mjs";

/**
 * @typedef {{
 *   version: string,
 *   countryCode: number,
 *   tableNumber: number,
 *   points: Record<string, { lcd: number, name?: string, roadNumber?: string, lat?: number, lon?: number, xpos?: number, ypos?: number, jumpref?: number, negOff?: number, posOff?: number }>,
 *   names?: Record<string, string>,
 *   activatedAt?: string|null,
 *   contentHash?: string,
 * }} TmcTable
 */

export function emptyTmcStore() {
  return {
    active: null,
    previous: null,
    lock: { locked: false, runId: null, expiresAt: null },
    lastError: null,
  };
}

/**
 * Validate table envelope against approved CC/LTN.
 * @param {object} table
 * @param {{ countryCode?: number, tableNumber?: number, limits?: object }} [opts]
 */
export function validateTmcTable(table, opts = {}) {
  const cc = opts.countryCode != null ? opts.countryCode : TMC_COUNTRY_CODE;
  const ltn = opts.tableNumber != null ? opts.tableNumber : TMC_LOCATION_TABLE_NUMBER;
  const limits = { ...DEFAULT_LIMITS, ...(opts.limits || {}) };
  if (!table || typeof table !== "object") {
    return { ok: false, reason: "not_object" };
  }
  const countryCode = Number(table.countryCode);
  const tableNumber = Number(table.tableNumber);
  if (countryCode !== cc) return { ok: false, reason: "country_code_mismatch", got: countryCode, want: cc };
  if (tableNumber !== ltn) return { ok: false, reason: "table_number_mismatch", got: tableNumber, want: ltn };
  if (!table.version) return { ok: false, reason: "missing_version" };
  if (!table.points || typeof table.points !== "object") return { ok: false, reason: "missing_points" };
  const keys = Object.keys(table.points);
  if (!keys.length) return { ok: false, reason: "empty_points" };
  if (keys.length > limits.maxTmcPoints) return { ok: false, reason: "too_many_points", count: keys.length };
  let checked = 0;
  for (const k of keys) {
    const p = table.points[k];
    if (!p || p.lcd == null) return { ok: false, reason: "point_missing_lcd", key: k };
    checked += 1;
    if (checked > 50) break; // spot-check
  }
  return { ok: true, pointCount: keys.length, version: String(table.version), countryCode, tableNumber };
}

/**
 * Parse minimal TISA-style POINTS lines or JSON payload into internal table.
 * Supported:
 *  - JSON { countryCode, tableNumber, version, points: { lcd: {...} } }
 *  - Delimited: LCD;ROADNUMBER;ROADNAME;... (fixture-friendly subset)
 *
 * @param {string|object} input
 * @param {{ version?: string }} [opts]
 */
export function parseTmcTablePayload(input, opts = {}) {
  if (input && typeof input === "object") {
    const table = {
      version: String(input.version || opts.version || "unknown"),
      countryCode: Number(input.countryCode),
      tableNumber: Number(input.tableNumber),
      points: input.points || {},
      names: input.names || {},
    };
    table.contentHash = hashTable(table);
    return table;
  }
  const text = String(input || "").replace(/^\uFEFF/, "");
  if (!text.trim()) throw Object.assign(new Error("tmc_empty"), { code: "TMC_EMPTY" });
  // JSON document
  if (/^\s*\{/.test(text)) {
    const obj = JSON.parse(text);
    return parseTmcTablePayload(obj, opts);
  }
  // Simple delimited POINTS: lcd;name;roadNumber;lat;lon;negOff;posOff
  const points = {};
  const lines = text.split(/\r?\n/);
  for (const line of lines) {
    const s = line.trim();
    if (!s || s.startsWith("#") || /^lcd/i.test(s)) continue;
    const parts = s.split(";");
    const lcd = Number(parts[0]);
    if (!Number.isFinite(lcd)) continue;
    points[String(lcd)] = {
      lcd,
      name: parts[1] || "",
      roadNumber: parts[2] || "",
      lat: parts[3] ? Number(parts[3]) : undefined,
      lon: parts[4] ? Number(parts[4]) : undefined,
      negOff: parts[5] ? Number(parts[5]) : undefined,
      posOff: parts[6] ? Number(parts[6]) : undefined,
    };
  }
  const table = {
    version: String(opts.version || "delimited-import"),
    countryCode: TMC_COUNTRY_CODE,
    tableNumber: TMC_LOCATION_TABLE_NUMBER,
    points,
    names: {},
  };
  table.contentHash = hashTable(table);
  return table;
}

function hashTable(table) {
  const keys = Object.keys(table.points || {}).sort();
  const h = crypto.createHash("sha256");
  h.update(String(table.countryCode) + "|" + String(table.tableNumber) + "|" + String(table.version));
  for (const k of keys.slice(0, 10000)) {
    const p = table.points[k];
    h.update("|" + k + ":" + (p && p.name) + ":" + (p && p.roadNumber));
  }
  h.update("|count:" + keys.length);
  return h.digest("hex");
}

/**
 * Atomic activate with single-flight lock.
 * @param {ReturnType<typeof emptyTmcStore>} store
 * @param {object} candidate
 * @param {{ nowMs?: number, ttlMs?: number, runId?: string, countryCode?: number, tableNumber?: number }} [opts]
 */
export function activateTmcTable(store, candidate, opts = {}) {
  const now = opts.nowMs || Date.now();
  const ttl = opts.ttlMs || 10 * 60 * 1000;
  if (store.lock && store.lock.locked && store.lock.expiresAt && now < store.lock.expiresAt) {
    return { ok: false, reason: "locked", store };
  }
  store.lock = { locked: true, runId: opts.runId || crypto.randomBytes(6).toString("hex"), expiresAt: now + ttl };
  try {
    const v = validateTmcTable(candidate, opts);
    if (!v.ok) {
      store.lastError = v.reason;
      store.lock = { locked: false, runId: null, expiresAt: null };
      return { ok: false, reason: v.reason, detail: v, store };
    }
    // Same version + hash → idempotent keep
    if (
      store.active &&
      store.active.version === candidate.version &&
      store.active.contentHash &&
      candidate.contentHash &&
      store.active.contentHash === candidate.contentHash
    ) {
      store.lock = { locked: false, runId: null, expiresAt: null };
      return { ok: true, reason: "same_version", store, activated: false };
    }
    if (store.active) store.previous = store.active;
    store.active = {
      ...candidate,
      activatedAt: new Date(now).toISOString(),
      contentHash: candidate.contentHash || hashTable(candidate),
    };
    store.lastError = null;
    store.lock = { locked: false, runId: null, expiresAt: null };
    return { ok: true, reason: "activated", store, activated: true, version: store.active.version };
  } catch (e) {
    store.lastError = String(e && e.message);
    store.lock = { locked: false, runId: null, expiresAt: null };
    return { ok: false, reason: "exception", error: store.lastError, store };
  }
}

/**
 * Rollback to previous functional version.
 */
export function rollbackTmcTable(store) {
  if (!store || !store.previous) return { ok: false, reason: "no_previous" };
  const cur = store.active;
  store.active = store.previous;
  store.previous = cur;
  return { ok: true, version: store.active && store.active.version };
}

/**
 * Resolve LCD → point (internal only).
 */
export function lookupTmcPoint(table, lcd) {
  if (!table || !table.points) return null;
  const p = table.points[String(lcd)];
  return p || null;
}

/**
 * Public-safe summary of active table (no point dump).
 */
export function tmcPublicMeta(store) {
  const a = store && store.active;
  if (!a) return { active: false };
  return {
    active: true,
    version: a.version,
    countryCode: a.countryCode,
    tableNumber: a.tableNumber,
    pointCount: Object.keys(a.points || {}).length,
    activatedAt: a.activatedAt || null,
    contentHash: a.contentHash ? String(a.contentHash).slice(0, 12) : null,
  };
}
