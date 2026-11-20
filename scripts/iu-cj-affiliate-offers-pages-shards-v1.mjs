/**
 * Pages/PWA scale helper — emit lean client payload + per-section shards.
 * Full offers-public keeps audit sidecars (refreshCoverage); clients should fetch shards.
 * Growth gate / paid button inventory are intentionally untouched.
 */
import fs from "node:fs";
import path from "node:path";

export const PAGES_LEAN_SCHEMA = "iu-affiliate-cj-offers-pages-v1";
export const SECTION_SHARD_SCHEMA = "iu-affiliate-cj-offers-section-v1";
export const PAGES_LEAN_FILENAME = "iu-affiliate-cj-offers-pages-v1.json";
export const SECTIONS_DIRNAME = "iu-affiliate-cj-offers-sections-v1";

const CLIENT_TOP_KEYS = [
  "schema",
  "version",
  "updatedAt",
  "liveEnabled",
  "sourceKind",
  "websitePid",
  "ok",
  "snapshotId",
  "freshnessAppliedAt",
  "freshnessPolicy",
  "sections",
  "stats",
  "note",
];

/** Drop audit-only blobs that bloat first-paint fetch (refreshCoverage ≈ half of live JSON). */
export function buildPagesLeanDoc(offersDoc) {
  const src = offersDoc && typeof offersDoc === "object" ? offersDoc : {};
  const lean = {
    schema: PAGES_LEAN_SCHEMA,
    version: src.version ?? 1,
    updatedAt: src.updatedAt || null,
    liveEnabled: src.liveEnabled === true,
    sourceKind: src.sourceKind || null,
    websitePid: src.websitePid || null,
    ok: src.ok !== false,
    snapshotId: src.snapshotId || null,
    freshnessAppliedAt: src.freshnessAppliedAt || null,
    freshnessPolicy: src.freshnessPolicy || null,
    sections: Array.isArray(src.sections) ? src.sections : [],
    stats: src.stats || null,
    note: "Pages lean payload — no refreshCoverage / growth ledger sidecars.",
    sourceSchema: src.schema || null,
  };
  return lean;
}

export function buildSectionShardDoc(offersDoc, section) {
  const src = offersDoc && typeof offersDoc === "object" ? offersDoc : {};
  return {
    schema: SECTION_SHARD_SCHEMA,
    version: src.version ?? 1,
    updatedAt: src.updatedAt || null,
    liveEnabled: src.liveEnabled === true,
    ok: src.ok !== false,
    snapshotId: src.snapshotId || null,
    sectionKey: section?.sectionKey || null,
    /* Compatible with iu-affiliate-phase2-offers-v1 renderPublicSection(doc, sectionKey). */
    sections: section ? [section] : [],
    note: "Per-section shard for lazy first-paint; paid partner buttons remain in managed/static catalog.",
  };
}

export function listSectionShards(offersDoc) {
  const lean = buildPagesLeanDoc(offersDoc);
  return (lean.sections || []).map((sec) => ({
    sectionKey: sec?.sectionKey || null,
    doc: buildSectionShardDoc(offersDoc, sec),
  }));
}

/**
 * Write lean pages JSON + one shard per section under dataDir.
 * @returns {{ ok: boolean, leanPath: string, sectionsDir: string, shardCount: number, leanBytes: number, maxShardBytes: number, shardBytes: Record<string, number> }}
 */
export function writePagesShards(offersDoc, dataDir, opts = {}) {
  const dir = String(dataDir || "");
  if (!dir) throw new Error("dataDir_required");
  fs.mkdirSync(dir, { recursive: true });
  const lean = buildPagesLeanDoc(offersDoc);
  const leanPath = path.join(dir, PAGES_LEAN_FILENAME);
  const leanBody = JSON.stringify(lean, null, opts.pretty === false ? undefined : 2) + (opts.pretty === false ? "" : "\n");
  const leanTmp = leanPath + ".tmp." + process.pid;
  fs.writeFileSync(leanTmp, leanBody, "utf8");
  fs.renameSync(leanTmp, leanPath);

  const sectionsDir = path.join(dir, SECTIONS_DIRNAME);
  fs.mkdirSync(sectionsDir, { recursive: true });
  const shardBytes = {};
  let maxShardBytes = 0;
  let shardCount = 0;
  for (const row of listSectionShards(offersDoc)) {
    const key = String(row.sectionKey || "").trim();
    if (!key || /[^\w.-]/.test(key)) continue;
    const body =
      JSON.stringify(row.doc, null, opts.pretty === false ? undefined : 2) +
      (opts.pretty === false ? "" : "\n");
    const out = path.join(sectionsDir, key + ".json");
    const tmp = out + ".tmp." + process.pid;
    fs.writeFileSync(tmp, body, "utf8");
    fs.renameSync(tmp, out);
    const n = Buffer.byteLength(body);
    shardBytes[key] = n;
    if (n > maxShardBytes) maxShardBytes = n;
    shardCount += 1;
  }

  return {
    ok: true,
    leanPath,
    sectionsDir,
    shardCount,
    leanBytes: Buffer.byteLength(leanBody),
    maxShardBytes,
    shardBytes,
    clientTopKeys: CLIENT_TOP_KEYS,
  };
}

export function estimateLoadPath(offersDoc, opts = {}) {
  const rawFull = Buffer.byteLength(JSON.stringify(offersDoc || {}));
  const lean = buildPagesLeanDoc(offersDoc);
  const leanBytes = Buffer.byteLength(JSON.stringify(lean));
  const shards = listSectionShards(offersDoc);
  let maxShard = 0;
  let sumShard = 0;
  for (const row of shards) {
    const n = Buffer.byteLength(JSON.stringify(row.doc));
    sumShard += n;
    if (n > maxShard) maxShard = n;
  }
  const abortMs = Number(opts.abortMs) || 2500;
  const unique =
    Number(offersDoc?.stats?.uniqueProducts) ||
    Number(offersDoc?.stats?.uniquePublicEligible) ||
    null;
  return {
    uniqueProducts: unique,
    fullBytes: rawFull,
    leanBytes,
    shardCount: shards.length,
    maxShardBytes: maxShard,
    sumShardBytes: sumShard,
    abortMs,
    fullNeedsBytesPerMs: Math.round(rawFull / abortMs),
    leanNeedsBytesPerMs: Math.round(leanBytes / abortMs),
    maxShardNeedsBytesPerMs: Math.round(maxShard / abortMs),
    architectureSafeFor5k: maxShard < 3_500_000,
    architectureSafeFor10k: maxShard < 3_500_000,
    note:
      "Safety heuristic: worst-case section shard <3.5MB raw (~gzip≪1MB) fits 2.5–4s mobile budgets; full/lean monoliths do not.",
  };
}
