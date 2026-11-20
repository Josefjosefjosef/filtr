/**
 * Pages/PWA scale helper — lean manifest + per-section shards (paged if large).
 * Full offers-public keeps audit sidecars; clients prefer shards.
 * Growth gate / paid button inventory are intentionally untouched.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export const PAGES_LEAN_SCHEMA = "iu-affiliate-cj-offers-pages-v1";
export const SECTION_SHARD_SCHEMA = "iu-affiliate-cj-offers-section-v1";
export const PAGES_LEAN_FILENAME = "iu-affiliate-cj-offers-pages-v1.json";
export const SECTIONS_DIRNAME = "iu-affiliate-cj-offers-sections-v1";
/** Keep each section shard under mobile-friendly raw budget (~gzip ≪ 1MB). */
export const SECTION_SHARD_SOFT_MAX_BYTES = 1_500_000;
export const LEAN_INTRO_PRODUCTS = 3;

/** Stable generation id for lean ↔ section consistency (client fail-closed on mismatch). */
export function resolveCatalogGenerationId(src = {}) {
  return String(src.snapshotId || src.updatedAt || src.generationId || "").trim() || null;
}

/** SHA-256 hex of canonical JSON with contentSha256 stripped (self-describing). */
export function computeDocContentSha256(doc) {
  const clone =
    doc && typeof doc === "object" ? JSON.parse(JSON.stringify(doc)) : {};
  delete clone.contentSha256;
  const body = JSON.stringify(clone);
  return crypto.createHash("sha256").update(body, "utf8").digest("hex");
}

export function sealDocIntegrity(doc, opts = {}) {
  const out = doc && typeof doc === "object" ? { ...doc } : {};
  const generationId =
    opts.generationId != null
      ? String(opts.generationId)
      : resolveCatalogGenerationId(out);
  if (generationId) out.generationId = generationId;
  out.contentSha256 = computeDocContentSha256(out);
  return out;
}

export function verifyDocContentSha256(doc) {
  if (!doc || typeof doc !== "object") {
    return { ok: false, reason: "DOC_MISSING" };
  }
  const expected = String(doc.contentSha256 || "").trim().toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(expected)) {
    return { ok: false, reason: "CONTENT_SHA_MISSING" };
  }
  const actual = computeDocContentSha256(doc);
  if (actual !== expected) {
    return { ok: false, reason: "CONTENT_SHA_MISMATCH", expected, actual };
  }
  return { ok: true, contentSha256: actual, generationId: doc.generationId || null };
}

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

function cloneSectionIntro(section, introN = LEAN_INTRO_PRODUCTS) {
  const products = Array.isArray(section?.products) ? section.products : [];
  return {
    ...section,
    products: products.slice(0, Math.max(0, introN)),
    productCountTotal: products.length,
    productsTruncated: products.length > introN,
  };
}

/** Lean first-paint doc: drop audit sidecars + truncate products to intro cards. */
export function buildPagesLeanDoc(offersDoc, opts = {}) {
  const src = offersDoc && typeof offersDoc === "object" ? offersDoc : {};
  const introN = opts.introProducts != null ? Number(opts.introProducts) : LEAN_INTRO_PRODUCTS;
  const sections = Array.isArray(src.sections)
    ? src.sections.map((sec) => cloneSectionIntro(sec, introN))
    : [];
  const generationId = resolveCatalogGenerationId(src);
  const lean = {
    schema: PAGES_LEAN_SCHEMA,
    version: src.version ?? 1,
    updatedAt: src.updatedAt || null,
    liveEnabled: src.liveEnabled === true,
    sourceKind: src.sourceKind || null,
    websitePid: src.websitePid || null,
    ok: src.ok !== false,
    snapshotId: src.snapshotId || null,
    generationId,
    freshnessAppliedAt: src.freshnessAppliedAt || null,
    freshnessPolicy: src.freshnessPolicy || null,
    sections,
    stats: src.stats || null,
    note: "Pages lean payload — intro products only; full rows live in section shards.",
    sourceSchema: src.schema || null,
    leanIntroProducts: introN,
  };
  return sealDocIntegrity(lean, { generationId });
}

export function buildSectionShardDoc(offersDoc, section, opts = {}) {
  const src = offersDoc && typeof offersDoc === "object" ? offersDoc : {};
  const pageIndex = opts.pageIndex != null ? Number(opts.pageIndex) : 0;
  const pageCount = opts.pageCount != null ? Number(opts.pageCount) : 1;
  const generationId = resolveCatalogGenerationId(src);
  const doc = {
    schema: SECTION_SHARD_SCHEMA,
    version: src.version ?? 1,
    updatedAt: src.updatedAt || null,
    liveEnabled: src.liveEnabled === true,
    ok: src.ok !== false,
    snapshotId: src.snapshotId || null,
    generationId,
    sectionKey: section?.sectionKey || null,
    pageIndex,
    pageCount,
    /* Compatible with iu-affiliate-phase2-offers-v1 renderPublicSection(doc, sectionKey). */
    sections: section ? [section] : [],
    note: "Per-section shard for lazy first-paint; paid partner buttons remain in managed/static catalog.",
  };
  return sealDocIntegrity(doc, { generationId });
}

/**
 * Pack one section into one or more page shard docs under soft max bytes.
 */
export function packSectionIntoPageShards(offersDoc, section, opts = {}) {
  const softMax = Math.max(
    50_000,
    Number(opts.softMaxBytes) || SECTION_SHARD_SOFT_MAX_BYTES
  );
  const key = String(section?.sectionKey || "").trim();
  const products = Array.isArray(section?.products) ? section.products.slice() : [];
  if (!products.length) {
    const doc = buildSectionShardDoc(offersDoc, section, { pageIndex: 0, pageCount: 1 });
    return [{ sectionKey: key, pageIndex: 0, fileName: key + ".json", doc }];
  }

  const pages = [];
  let cursor = 0;
  while (cursor < products.length) {
    let lo = 1;
    let hi = products.length - cursor;
    let best = 1;
    while (lo <= hi) {
      const mid = Math.floor((lo + hi) / 2);
      const slice = products.slice(cursor, cursor + mid);
      const probeSec = { ...section, products: slice };
      const probe = buildSectionShardDoc(offersDoc, probeSec, {
        pageIndex: pages.length,
        pageCount: 1,
      });
      const bytes = Buffer.byteLength(JSON.stringify(probe));
      if (bytes <= softMax) {
        best = mid;
        lo = mid + 1;
      } else {
        hi = mid - 1;
      }
    }
    const slice = products.slice(cursor, cursor + Math.max(1, best));
    pages.push(slice);
    cursor += slice.length;
    // Fail-closed single-product overflow: still emit (caller gates maxShard).
    if (best < 1) break;
  }

  const pageCount = pages.length;
  return pages.map((slice, pageIndex) => {
    const sec = { ...section, products: slice };
    const doc = buildSectionShardDoc(offersDoc, sec, { pageIndex, pageCount });
    const fileName =
      pageIndex === 0 ? key + ".json" : key + "__p" + String(pageIndex + 1) + ".json";
    return { sectionKey: key, pageIndex, pageCount, fileName, doc };
  });
}

export function listSectionShards(offersDoc, opts = {}) {
  const src = offersDoc && typeof offersDoc === "object" ? offersDoc : {};
  const out = [];
  for (const sec of src.sections || []) {
    const key = String(sec?.sectionKey || "").trim();
    if (!key) continue;
    out.push(...packSectionIntoPageShards(offersDoc, sec, opts));
  }
  return out;
}

/**
 * Write lean pages JSON + section/page shards under dataDir.
 */
export function writePagesShards(offersDoc, dataDir, opts = {}) {
  const dir = String(dataDir || "");
  if (!dir) throw new Error("dataDir_required");
  fs.mkdirSync(dir, { recursive: true });
  const lean = buildPagesLeanDoc(offersDoc, opts);
  const leanPath = path.join(dir, PAGES_LEAN_FILENAME);
  const leanBody =
    JSON.stringify(lean, null, opts.pretty === false ? undefined : 2) +
    (opts.pretty === false ? "" : "\n");
  const leanTmp = leanPath + ".tmp." + process.pid;
  fs.writeFileSync(leanTmp, leanBody, "utf8");
  fs.renameSync(leanTmp, leanPath);

  const sectionsDir = path.join(dir, SECTIONS_DIRNAME);
  fs.mkdirSync(sectionsDir, { recursive: true });
  // Clear stale page shards for rewritten sections (best-effort).
  try {
    for (const name of fs.readdirSync(sectionsDir)) {
      if (name.endsWith(".json")) fs.unlinkSync(path.join(sectionsDir, name));
    }
  } catch {
    /* ignore */
  }

  const shardBytes = {};
  let maxShardBytes = 0;
  let shardCount = 0;
  for (const row of listSectionShards(offersDoc, opts)) {
    const key = String(row.sectionKey || "").trim();
    if (!key || /[^\w.-]/.test(key)) continue;
    const body =
      JSON.stringify(row.doc, null, opts.pretty === false ? undefined : 2) +
      (opts.pretty === false ? "" : "\n");
    const out = path.join(sectionsDir, row.fileName);
    const tmp = out + ".tmp." + process.pid;
    fs.writeFileSync(tmp, body, "utf8");
    fs.renameSync(tmp, out);
    const n = Buffer.byteLength(body);
    shardBytes[row.fileName] = n;
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
    softMaxBytes: Number(opts.softMaxBytes) || SECTION_SHARD_SOFT_MAX_BYTES,
  };
}

/**
 * Verify lean + all referenced section shards share one generation and valid hashes.
 * Fail-closed: missing/corrupt/mismatched generation ⇒ ok:false.
 */
export function verifyPagedCatalogTree(dataDir, opts = {}) {
  const dir = String(dataDir || "");
  const leanPath = path.join(dir, PAGES_LEAN_FILENAME);
  if (!fs.existsSync(leanPath)) {
    return { ok: false, reason: "LEAN_MISSING", leanPath };
  }
  let lean;
  try {
    lean = JSON.parse(fs.readFileSync(leanPath, "utf8"));
  } catch (err) {
    return { ok: false, reason: "LEAN_PARSE_FAIL", error: String(err?.message || err) };
  }
  const leanSeal = verifyDocContentSha256(lean);
  if (!leanSeal.ok && opts.requireContentSha !== false) {
    // Prod may still lack hashes until next sync — allow soft mode via opts.
    if (opts.requireContentSha === true) {
      return { ok: false, reason: leanSeal.reason, leanSeal };
    }
  }
  const generationId = resolveCatalogGenerationId(lean);
  const sectionsDir = path.join(dir, SECTIONS_DIRNAME);
  const sectionRows = [];
  const fails = [];
  for (const sec of lean.sections || []) {
    const key = String(sec?.sectionKey || "").trim();
    if (!key) continue;
    const page0 = path.join(sectionsDir, key + ".json");
    if (!fs.existsSync(page0)) {
      fails.push({ sectionKey: key, reason: "SECTION_MISSING", file: key + ".json" });
      continue;
    }
    let first;
    try {
      first = JSON.parse(fs.readFileSync(page0, "utf8"));
    } catch (err) {
      fails.push({ sectionKey: key, reason: "SECTION_PARSE_FAIL", error: String(err?.message || err) });
      continue;
    }
    const gen = resolveCatalogGenerationId(first);
    if (generationId && gen && gen !== generationId) {
      fails.push({ sectionKey: key, reason: "GENERATION_MISMATCH", lean: generationId, section: gen });
    }
    if (opts.requireContentSha === true) {
      const seal = verifyDocContentSha256(first);
      if (!seal.ok) fails.push({ sectionKey: key, reason: seal.reason, file: key + ".json" });
    }
    const pageCount = Math.max(1, Number(first.pageCount) || 1);
    for (let p = 2; p <= pageCount; p++) {
      const name = key + "__p" + String(p) + ".json";
      const fp = path.join(sectionsDir, name);
      if (!fs.existsSync(fp)) {
        fails.push({ sectionKey: key, reason: "PAGE_MISSING", file: name });
        continue;
      }
      let pageDoc;
      try {
        pageDoc = JSON.parse(fs.readFileSync(fp, "utf8"));
      } catch (err) {
        fails.push({ sectionKey: key, reason: "PAGE_PARSE_FAIL", file: name, error: String(err?.message || err) });
        continue;
      }
      const pgen = resolveCatalogGenerationId(pageDoc);
      if (generationId && pgen && pgen !== generationId) {
        fails.push({ sectionKey: key, reason: "GENERATION_MISMATCH", file: name, lean: generationId, section: pgen });
      }
      if (opts.requireContentSha === true) {
        const seal = verifyDocContentSha256(pageDoc);
        if (!seal.ok) fails.push({ sectionKey: key, reason: seal.reason, file: name });
      }
    }
    sectionRows.push({ sectionKey: key, pageCount, ok: true });
  }
  return {
    ok: fails.length === 0,
    reason: fails.length ? "PAGED_CATALOG_INTEGRITY_FAIL" : null,
    generationId,
    leanSeal,
    sectionCount: sectionRows.length,
    sectionRows,
    fails,
  };
}

export function estimateLoadPath(offersDoc, opts = {}) {
  const rawFull = Buffer.byteLength(JSON.stringify(offersDoc || {}));
  const lean = buildPagesLeanDoc(offersDoc, opts);
  const leanBytes = Buffer.byteLength(JSON.stringify(lean));
  const shards = listSectionShards(offersDoc, opts);
  let maxShard = 0;
  let sumShard = 0;
  for (const row of shards) {
    const n = Buffer.byteLength(JSON.stringify(row.doc));
    sumShard += n;
    if (n > maxShard) maxShard = n;
  }
  const softMax = Number(opts.softMaxBytes) || SECTION_SHARD_SOFT_MAX_BYTES;
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
    softMaxBytes: softMax,
    abortMs,
    fullNeedsBytesPerMs: Math.round(rawFull / abortMs),
    leanNeedsBytesPerMs: Math.round(leanBytes / abortMs),
    maxShardNeedsBytesPerMs: Math.round(maxShard / abortMs),
    architectureSafeFor5k: maxShard <= softMax && leanBytes < 2_500_000,
    architectureSafeFor10k: maxShard <= softMax && leanBytes < 2_500_000,
    note:
      "Safety: lean intro-only + paged section shards ≤ softMax; monolith full/lean-all-products unsafe.",
  };
}
