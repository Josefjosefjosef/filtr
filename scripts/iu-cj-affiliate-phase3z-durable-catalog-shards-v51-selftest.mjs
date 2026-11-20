#!/usr/bin/env node
/**
 * V51.8 — durable catalog shard spill / integrity / rollback / resume selftest.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  PUBLICATION_ELIGIBILITY,
} from "./iu-cj-affiliate-phase3z-publication-lkg-v51-8.mjs";
import {
  emptyDurableCatalog,
  mergeIntoDurableCatalog,
  serializeDurableCatalog,
} from "./iu-cj-affiliate-phase3z-durable-catalog-v51.mjs";
import {
  spillDurableCatalogToShards,
  publishDurableCatalogAtomic,
  loadDurableCatalogFromDir,
  restoreDurableCatalogFromTipAndShards,
  assertGenerationManifestIntegrity,
  verifyShardIntegrity,
  rollbackDurableCatalogToLkg,
  sealShard,
  shardFileName,
  DURABLE_CATALOG_SHARD_FILE_PREFIX,
} from "./iu-cj-affiliate-phase3z-durable-catalog-shards-v51.mjs";

function assert(cond, msg) {
  if (!cond) throw new Error("ASSERT: " + msg);
}

function makeEntry(adv, pid, kind, pad) {
  const eligible = kind === "eligible";
  const blocked = kind === "blocked";
  const hold = kind === "hold";
  return {
    advertiserId: String(adv),
    productId: String(pid),
    partnerName: "P" + adv,
    sectionKey: "sec",
    title: "T-" + pid + (pad ? ("-" + "x".repeat(pad)) : ""),
    imageUrl: pad ? "https://example.com/" + "i".repeat(Math.min(pad, 200)) : null,
    currentPrice: "10.00",
    originalPrice: null,
    currency: "CZK",
    availability: blocked ? "out_of_stock" : "in_stock",
    availabilityClass: blocked ? "OUT_OF_STOCK" : "IN_STOCK",
    affiliateUrl: "https://www.kqzyfj.com/click-" + adv + "-" + pid,
    feedId: "f1",
    catalogStatus: "CATALOG_RETAINED",
    publicationEligibility: eligible
      ? PUBLICATION_ELIGIBILITY.PUBLICATION_ELIGIBLE
      : hold
        ? PUBLICATION_ELIGIBILITY.PUBLICATION_HOLD
        : PUBLICATION_ELIGIBILITY.PUBLICATION_BLOCKED,
    publicOffer: eligible,
    lkgPublicHold: !eligible,
    hideAsCurrent: !eligible,
    lastSourceMatchAt: "2026-01-01T00:00:00.000Z",
    lastSuccessfulRefreshAt: "2026-01-01T00:00:00.000Z",
    sourceFreshLabelForbidden: !eligible,
    freshnessStatus: eligible ? "SOURCE_VERIFIED" : "UNKNOWN",
    freshnessReason: eligible ? "OK" : "HOLD",
    updatedAt: "2026-01-01T00:00:00.000Z",
    publicationReady: true,
  };
}

function buildDoc({ eligible = 2, hold = 4, blocked = 20, pad = 80 } = {}) {
  const doc = emptyDurableCatalog("2026-01-01T00:00:00.000Z");
  let i = 0;
  for (let n = 0; n < eligible; n++) {
    i += 1;
    const k = "1|e" + n;
    doc.products[k] = makeEntry(1, "e" + n, "eligible", 8);
  }
  for (let n = 0; n < hold; n++) {
    i += 1;
    const k = "1|h" + n;
    doc.products[k] = makeEntry(1, "h" + n, "hold", pad);
  }
  for (let n = 0; n < blocked; n++) {
    i += 1;
    const k = "2|b" + n;
    doc.products[k] = makeEntry(2, "b" + n, "blocked", pad);
  }
  doc.stats = { catalogUnique: i, publicEligible: eligible, hold, blocked, confirmedRemoved: 0 };
  return doc;
}

function tmpDir(name) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "iu-cj-durable-shards-" + name + "-"));
  return d;
}

const results = [];

function record(name, ok, extra = {}) {
  results.push({ name, ok, ...extra });
  assert(ok, name + " failed " + JSON.stringify(extra));
}

// --- under limit: no spill ---
{
  const doc = buildDoc({ eligible: 2, hold: 1, blocked: 2, pad: 4 });
  const spill = spillDurableCatalogToShards(doc, { softMaxBytes: 500_000, hardMaxBytes: 900_000 });
  record("under_limit_no_spill", spill.ok === true && spill.spilled === false, {
    tipBytes: spill.tipBytes,
    shardCount: spill.shards.length,
    reason: spill.reason,
  });
}

// --- over limit: spill cold ---
{
  const doc = buildDoc({ eligible: 3, hold: 8, blocked: 40, pad: 400 });
  const hard = 25_000;
  const soft = 12_000;
  const spill = spillDurableCatalogToShards(doc, {
    softMaxBytes: soft,
    hardMaxBytes: hard,
    generation: 1,
    generationHeadroomBytes: 2000,
  });
  record("over_limit_spill", spill.ok === true && spill.spilled === true && spill.tipBytes <= hard, {
    tipBytes: spill.tipBytes,
    shardCount: spill.shards.length,
    tipIds: spill.tipIdentityCount,
    shardIds: spill.shardIdentityCount,
    reason: spill.reason,
  });
  assert(spill.identityCount === spill.tipIdentityCount + spill.shardIdentityCount, "identity partition");
}

// --- publish + restore roundtrip ---
const dir = tmpDir("pub");
{
  const doc = buildDoc({ eligible: 3, hold: 10, blocked: 50, pad: 350 });
  const hard = 28_000;
  const soft = 12_000;
  const pub = publishDurableCatalogAtomic(dir, doc, {
    softMaxBytes: soft,
    hardMaxBytes: hard,
    generation: 1,
    generationHeadroomBytes: 2000,
  });
  record("publish_spill_ok", pub.ok === true && pub.tipBytes <= hard && pub.shardCount >= 1, {
    tipBytes: pub.tipBytes,
    shardCount: pub.shardCount,
    generation: pub.generation,
  });
  const loaded = loadDurableCatalogFromDir(dir);
  record("load_full_identities", loaded.ok === true && loaded.identityCount === pub.identityCount, {
    identityCount: loaded.identityCount,
    shardCount: loaded.shardCount,
  });
  // merge still sees full set
  const merged = mergeIntoDurableCatalog(loaded.doc, [
    {
      advertiserId: "1",
      productId: "e0",
      title: "upd",
      currentPrice: 11,
      currency: "CZK",
      availability: "in_stock",
      affiliateUrl: "https://www.kqzyfj.com/click-1-e0",
    },
  ], { nowIso: "2026-01-02T00:00:00.000Z", livePublicKeys: new Set(["1|e0"]) });
  record(
    "merge_sees_full_set",
    Object.keys(merged.doc.products).length >= pub.identityCount,
    { after: Object.keys(merged.doc.products).length }
  );
}

// --- missing shard ---
{
  const tip = JSON.parse(fs.readFileSync(path.join(dir, "iu-affiliate-cj-durable-catalog-v51.json"), "utf8"));
  const shardMeta = tip.generation.shards[0];
  const shardPath = path.join(dir, shardMeta.file || shardFileName(shardMeta.id));
  const backup = fs.readFileSync(shardPath);
  fs.unlinkSync(shardPath);
  const loaded = loadDurableCatalogFromDir(dir);
  record("missing_shard_fail_closed", loaded.ok === false && loaded.reason === "MISSING_SHARD", {
    reason: loaded.reason,
  });
  fs.writeFileSync(shardPath, backup);
}

// --- corrupt shard ---
{
  const tip = JSON.parse(fs.readFileSync(path.join(dir, "iu-affiliate-cj-durable-catalog-v51.json"), "utf8"));
  const shardMeta = tip.generation.shards[0];
  const shardPath = path.join(dir, shardMeta.file || shardFileName(shardMeta.id));
  const shard = JSON.parse(fs.readFileSync(shardPath, "utf8"));
  const backup = serializeDurableCatalog(shard);
  shard.products["corrupt|x"] = makeEntry("corrupt", "x", "blocked", 10);
  fs.writeFileSync(shardPath, JSON.stringify(shard) + "\n");
  const loaded = loadDurableCatalogFromDir(dir);
  record(
    "corrupt_shard_fail_closed",
    loaded.ok === false &&
      (loaded.reason === "SHARD_CORRUPT_CONTENT_HASH" ||
        loaded.detail?.reason === "SHARD_CORRUPT_CONTENT_HASH" ||
        loaded.reason === "SHARD_CORRUPT_CONTENT_HASH" ||
        String(loaded.reason || "").includes("CORRUPT") ||
        String(loaded.detail?.reason || "").includes("CORRUPT")),
    { reason: loaded.reason, detail: loaded.detail?.reason || null }
  );
  // restoreDurable path
  const badMap = { [shardMeta.id]: shard };
  const restored = restoreDurableCatalogFromTipAndShards(tip, badMap);
  record(
    "corrupt_shard_restore_fail",
    restored.ok === false,
    { reason: restored.reason }
  );
  fs.writeFileSync(shardPath, backup);
}

// --- manifest mismatch (wrong sha in tip) ---
{
  const tipPath = path.join(dir, "iu-affiliate-cj-durable-catalog-v51.json");
  const tip = JSON.parse(fs.readFileSync(tipPath, "utf8"));
  const backup = fs.readFileSync(tipPath);
  tip.generation.shards[0].sha256 = "0".repeat(64);
  fs.writeFileSync(tipPath, serializeDurableCatalog(tip));
  const loaded = loadDurableCatalogFromDir(dir);
  record(
    "manifest_mismatch_fail_closed",
    loaded.ok === false &&
      (loaded.reason === "SHARD_MANIFEST_SHA_MISMATCH" ||
        loaded.detail?.reason === "SHARD_MANIFEST_SHA_MISMATCH" ||
        String(loaded.reason || "").includes("MISMATCH") ||
        String(loaded.detail?.reason || "").includes("MISMATCH")),
    { reason: loaded.reason, detail: loaded.detail?.reason || null }
  );
  fs.writeFileSync(tipPath, backup);
}

// --- older generation after newer refused ---
{
  const doc2 = buildDoc({ eligible: 3, hold: 10, blocked: 50, pad: 350 });
  const pub2 = publishDurableCatalogAtomic(dir, doc2, {
    softMaxBytes: 12_000,
    hardMaxBytes: 28_000,
    generation: 2,
    generationHeadroomBytes: 2000,
  });
  record("publish_gen2", pub2.ok === true && pub2.generation === 2, {
    generation: pub2.generation,
    tipBytes: pub2.tipBytes,
  });
  const refuse = publishDurableCatalogAtomic(dir, doc2, {
    softMaxBytes: 12_000,
    hardMaxBytes: 28_000,
    generation: 1,
    generationHeadroomBytes: 2000,
  });
  record(
    "older_generation_refused",
    refuse.ok === false && refuse.reason === "REFUSE_OVERWRITE_NEWER_GENERATION",
    { reason: refuse.reason }
  );
}

// --- rollback to LKG ---
{
  const rb = rollbackDurableCatalogToLkg(dir);
  record("rollback_to_lkg", rb.ok === true && rb.generation === 1, {
    generation: rb.generation,
    identityCount: rb.identityCount,
    shardCount: rb.shardCount,
  });
  const loaded = loadDurableCatalogFromDir(dir);
  record("rollback_load_ok", loaded.ok === true && loaded.generation === 1, {
    generation: loaded.generation,
  });
}

// --- resume / idempotent same generation+hash ---
{
  const full = loadDurableCatalogFromDir(dir);
  assert(full.ok, "full load before resume");
  const pub3 = publishDurableCatalogAtomic(dir, full.doc, {
    softMaxBytes: 12_000,
    hardMaxBytes: 28_000,
    generation: 3,
    generationHeadroomBytes: 2000,
  });
  record("publish_gen3_for_resume", pub3.ok === true && pub3.generation === 3, {
    generation: pub3.generation,
    tipSha256: pub3.tipSha256,
  });
  const resume = publishDurableCatalogAtomic(dir, full.doc, {
    softMaxBytes: 12_000,
    hardMaxBytes: 28_000,
    generation: 3,
    generationHeadroomBytes: 2000,
  });
  record(
    "resume_same_generation",
    resume.ok === true && resume.resumed === true,
    { resumed: resume.resumed === true, reason: resume.reason, generation: resume.generation }
  );
}

// --- verifyShardIntegrity unit ---
{
  const sealed = sealShard({
    generation: 9,
    id: "s0000",
    products: { "9|z": makeEntry(9, "z", "blocked", 4) },
  });
  const ok = verifyShardIntegrity(sealed.doc);
  record("shard_integrity_ok", ok.ok === true, { sha256: ok.sha256 });
  const bad = { ...sealed.doc, sha256: "deadbeef" };
  const badV = verifyShardIntegrity(bad);
  record("shard_integrity_detects_bad", badV.ok === false, { reason: badV.reason });
}

// cleanup
try {
  for (const name of fs.readdirSync(dir)) fs.unlinkSync(path.join(dir, name));
  fs.rmdirSync(dir);
} catch {
  /* leave tmp on failure */
}

const failed = results.filter((r) => !r.ok);
console.log(
  JSON.stringify({
    IU_CJ_DURABLE_CATALOG_SHARDS_V51_SELFTEST: failed.length ? "FAIL" : "PASS",
    passed: results.filter((r) => r.ok).length,
    failed: failed.length,
    results,
  })
);
if (failed.length) process.exitCode = 1;
