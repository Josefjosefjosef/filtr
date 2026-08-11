/**
 * Persistent last-known-good TMC store (filesystem).
 * Live DATEX path is read-only. Maintenance writes via staging + atomic cutover.
 *
 * Layout (IU_NDIC_TMC_LKG_ROOT or default .cache/ndic-datex-v1/tmc-lkg):
 *   manifest.json
 *   current/store.json   — { active, previous, ... } in-memory shape
 *   previous/store.json  — last cutover backup (optional mirror)
 *   staging/<id>/
 */
import fs from "fs";
import path from "path";
import crypto from "crypto";
import { fileURLToPath } from "url";
import {
  emptyTmcStore,
  validateTmcTable,
  tmcPublicMeta,
  activateTmcTable,
  rollbackTmcTable,
} from "./tmc-table.mjs";
import { TMC_CID, TMC_TABCD, TMC_COUNTRY_CODE, TMC_LOCATION_TABLE_NUMBER } from "./config.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, "../..");

export const TMC_LKG_SCHEMA = "iu-ndic-tmc-lkg-v1";

export function defaultTmcLkgRoot(env = process.env) {
  const fromEnv = String(env.IU_NDIC_TMC_LKG_ROOT || "").trim();
  if (fromEnv) return path.resolve(fromEnv);
  // Prefer explicit store path parent when set to a stable file (not runner.temp).
  const storePath = String(env.IU_NDIC_TMC_STORE_PATH || "").trim();
  if (storePath && !/[/\\]Temporary[/\\]|[/\\]temp[/\\]|_work|_temp/i.test(storePath)) {
    return path.dirname(path.resolve(storePath));
  }
  return path.join(REPO, ".cache", "ndic-datex-v1", "tmc-lkg");
}

export function emptyManifest() {
  return {
    schema: TMC_LKG_SCHEMA,
    currentPath: "current/store.json",
    previousPath: "previous/store.json",
    activeVersion: null,
    previousVersion: null,
    activeCid: TMC_CID,
    activeTabcd: TMC_TABCD,
    activePointCount: null,
    activeValidated: false,
    activeChecksum: null,
    importedAt: null,
    lastVersionCheckAt: null,
    newVersionAvailable: false,
    lastMaintenanceResult: null,
    lastSuccessfulCutoverAt: null,
    lastRollbackAt: null,
  };
}

function readJson(p, fallback) {
  try {
    return JSON.parse(fs.readFileSync(p, "utf8"));
  } catch {
    return fallback;
  }
}

function writeJsonAtomic(p, obj) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  const tmp = p + ".tmp." + crypto.randomBytes(4).toString("hex");
  fs.writeFileSync(tmp, JSON.stringify(obj, null, 2) + "\n", "utf8");
  fs.renameSync(tmp, p);
}

export function ensureLkgLayout(root) {
  fs.mkdirSync(path.join(root, "current"), { recursive: true });
  fs.mkdirSync(path.join(root, "previous"), { recursive: true });
  fs.mkdirSync(path.join(root, "staging"), { recursive: true });
  const manPath = path.join(root, "manifest.json");
  if (!fs.existsSync(manPath)) writeJsonAtomic(manPath, emptyManifest());
  return root;
}

export function loadManifest(root) {
  ensureLkgLayout(root);
  const m = readJson(path.join(root, "manifest.json"), emptyManifest());
  return { ...emptyManifest(), ...m, schema: TMC_LKG_SCHEMA };
}

export function saveManifest(root, manifest) {
  ensureLkgLayout(root);
  writeJsonAtomic(path.join(root, "manifest.json"), { ...emptyManifest(), ...manifest, schema: TMC_LKG_SCHEMA });
}

export function currentStorePath(root) {
  return path.join(root, "current", "store.json");
}

export function previousStorePath(root) {
  return path.join(root, "previous", "store.json");
}

/**
 * Load persistent store. Returns { ok, store, reason, meta, root, bytes }.
 */
export function loadPersistentTmcStore(opts = {}) {
  const root = opts.root || defaultTmcLkgRoot(opts.env || process.env);
  ensureLkgLayout(root);
  const storeFile = currentStorePath(root);
  const bytes = fs.existsSync(storeFile) ? fs.statSync(storeFile).size : 0;
  const store = readJson(storeFile, emptyTmcStore());
  const active = store && store.active;
  if (!active) {
    return {
      ok: false,
      reason: "REFUSING_DATEX_RESOLVER_WITHOUT_VALID_TMC",
      code: "TMC_LKG_MISSING",
      store: emptyTmcStore(),
      meta: tmcPublicMeta(emptyTmcStore()),
      manifest: loadManifest(root),
      root,
      bytes,
    };
  }
  const v = validateTmcTable(active, {
    countryCode: opts.countryCode != null ? opts.countryCode : TMC_COUNTRY_CODE,
    tableNumber: opts.tableNumber != null ? opts.tableNumber : TMC_LOCATION_TABLE_NUMBER,
  });
  if (!v.ok) {
    return {
      ok: false,
      reason: "REFUSING_DATEX_RESOLVER_WITHOUT_VALID_TMC",
      code: "TMC_LKG_INVALID",
      detail: v.reason,
      store,
      meta: tmcPublicMeta(store),
      manifest: loadManifest(root),
      root,
      bytes,
    };
  }
  const manifest = loadManifest(root);
  return {
    ok: true,
    store,
    meta: tmcPublicMeta(store),
    manifest,
    root,
    bytes,
    validated: true,
  };
}

/**
 * Read-only guard for live DATEX: never writes store.
 */
export function requireValidPersistentTmcForLive(opts = {}) {
  const loaded = loadPersistentTmcStore(opts);
  if (!loaded.ok) {
    return {
      ok: false,
      refuseCode: "REFUSING_DATEX_RESOLVER_WITHOUT_VALID_TMC",
      reason: loaded.code || loaded.reason,
      diagnostics: {
        tmc: {
          ok: false,
          reason: loaded.code || loaded.reason,
          liveDownload: false,
          liveImport: false,
          persistent: true,
          meta: loaded.meta,
        },
      },
      loaded,
    };
  }
  return {
    ok: true,
    store: loaded.store,
    meta: loaded.meta,
    manifest: loaded.manifest,
    root: loaded.root,
    bytes: loaded.bytes,
    refuseCode: null,
  };
}

/**
 * Persist store atomically to current/ (maintenance only).
 * Also mirrors previous/ when store.previous exists.
 */
export function persistTmcStoreAtomic(root, store, opts = {}) {
  ensureLkgLayout(root);
  const cur = currentStorePath(root);
  if (fs.existsSync(cur)) {
    // Keep filesystem previous mirror for rollback without re-download.
    try {
      fs.copyFileSync(cur, previousStorePath(root));
    } catch {
      /* ignore */
    }
  }
  writeJsonAtomic(cur, store);
  const meta = tmcPublicMeta(store);
  const man = loadManifest(root);
  man.activeVersion = meta.version || null;
  man.previousVersion =
    store.previous && store.previous.version ? String(store.previous.version) : man.previousVersion;
  man.activeCid = TMC_CID;
  man.activeTabcd = TMC_TABCD;
  man.activePointCount = meta.pointCount != null ? meta.pointCount : null;
  man.activeValidated = true;
  man.activeChecksum = meta.contentHash || null;
  man.importedAt = meta.activatedAt || new Date().toISOString();
  if (opts.cutover === true) {
    man.lastSuccessfulCutoverAt = new Date().toISOString();
    man.lastMaintenanceResult = "cutover_ok";
    man.newVersionAvailable = false;
  }
  if (opts.rollback === true) {
    man.lastRollbackAt = new Date().toISOString();
    man.lastMaintenanceResult = "rollback_ok";
  }
  if (opts.maintenanceResult) man.lastMaintenanceResult = String(opts.maintenanceResult);
  if (opts.versionCheckAt) man.lastVersionCheckAt = String(opts.versionCheckAt);
  saveManifest(root, man);
  return { ok: true, meta, manifest: man, bytes: fs.statSync(cur).size };
}

export function createStagingDir(root, label = "stg") {
  ensureLkgLayout(root);
  const id = String(label).replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 48) + "-" + crypto.randomBytes(4).toString("hex");
  const dir = path.join(root, "staging", id);
  fs.mkdirSync(dir, { recursive: true });
  return { id, dir };
}

export function cleanupStagingDir(dir) {
  if (!dir) return { ok: false, reason: "no_dir" };
  const resolved = path.resolve(dir);
  if (!resolved.includes(`${path.sep}staging${path.sep}`) && !resolved.endsWith(`${path.sep}staging`)) {
    return { ok: false, reason: "not_staging" };
  }
  fs.rmSync(resolved, { recursive: true, force: true });
  return { ok: true };
}

/**
 * Bounded retention: keep current + previous stores; wipe old staging (>maxAgeSec).
 */
export function cleanupTmcLkg(root, opts = {}) {
  ensureLkgLayout(root);
  const maxAgeSec = opts.maxAgeSec != null ? Number(opts.maxAgeSec) : 7 * 24 * 3600;
  const now = Date.now();
  let deleted = 0;
  const staging = path.join(root, "staging");
  for (const name of fs.readdirSync(staging)) {
    const p = path.join(staging, name);
    try {
      const st = fs.statSync(p);
      if ((now - st.mtimeMs) / 1000 > maxAgeSec) {
        fs.rmSync(p, { recursive: true, force: true });
        deleted += 1;
      }
    } catch {
      /* ignore */
    }
  }
  // Remove leftover tmp files in current/previous
  for (const sub of ["current", "previous"]) {
    const d = path.join(root, sub);
    for (const name of fs.readdirSync(d)) {
      if (name.includes(".tmp.")) {
        try {
          fs.unlinkSync(path.join(d, name));
          deleted += 1;
        } catch {
          /* ignore */
        }
      }
    }
  }
  return { ok: true, deleted };
}

/**
 * DATEX ↔ TMC version mismatch guard using Alert-C refs on situations/items.
 * @param {Array<{ countryCode?: number, tableNumber?: number, tableVersion?: string|number }>} refs
 */
export function datexTmcVersionMismatchGuard(refs, activeTable, opts = {}) {
  const wantCc = opts.countryCode != null ? opts.countryCode : TMC_COUNTRY_CODE;
  const wantLtn = opts.tableNumber != null ? opts.tableNumber : TMC_LOCATION_TABLE_NUMBER;
  const activeVersion = activeTable && activeTable.version != null ? String(activeTable.version) : null;
  const list = Array.isArray(refs) ? refs : [];
  let mismatchCc = 0;
  let mismatchLtn = 0;
  let mismatchVersion = 0;
  let newVersionHint = 0;
  const seenVersions = new Set();
  for (const r of list) {
    if (!r) continue;
    if (r.countryCode != null && Number(r.countryCode) !== wantCc) mismatchCc += 1;
    if (r.tableNumber != null && Number(r.tableNumber) !== wantLtn) mismatchLtn += 1;
    if (r.tableVersion != null && String(r.tableVersion).trim() !== "") {
      const tv = String(r.tableVersion);
      seenVersions.add(tv);
      if (activeVersion && tv !== activeVersion) {
        mismatchVersion += 1;
        // Higher numeric version → new table may be required
        if (Number(tv) > Number(activeVersion)) newVersionHint += 1;
      }
    }
  }
  const ok = mismatchCc === 0 && mismatchLtn === 0;
  return {
    ok,
    code: ok ? null : "DATEX_TMC_VERSION_MISMATCH_GUARD",
    mismatchCc,
    mismatchLtn,
    mismatchVersion,
    newVersionHint,
    seenVersions: [...seenVersions].slice(0, 8),
    NEW_TMC_REFERENCE_DETECTED: newVersionHint > 0 ? "YES" : "NO",
    activeVersion,
    wantCc,
    wantLtn,
  };
}

/**
 * Dual-version need: when DATEX simultaneously references >1 tableNumber or >1 tableVersion.
 */
export function assessDualVersionNeed(refs) {
  const ltns = new Set();
  const versions = new Set();
  for (const r of Array.isArray(refs) ? refs : []) {
    if (!r) continue;
    if (r.tableNumber != null) ltns.add(String(r.tableNumber));
    if (r.tableVersion != null && String(r.tableVersion).trim() !== "") versions.add(String(r.tableVersion));
  }
  const required = ltns.size > 1 || versions.size > 1;
  return {
    TMC_DUAL_VERSION_REQUIRED: required ? "YES" : "NO",
    distinctTableNumbers: [...ltns],
    distinctTableVersions: [...versions],
    evidence: required
      ? "DATEX_REFS_SPAN_MULTIPLE_TABLE_IDENTITIES"
      : "SINGLE_TABLE_IDENTITY_IN_SAMPLE",
  };
}

export {
  emptyTmcStore,
  activateTmcTable,
  rollbackTmcTable,
  tmcPublicMeta,
  validateTmcTable,
};
