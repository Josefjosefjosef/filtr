#!/usr/bin/env node
/**
 * Offline selftest for the full product inventory export (fixtures only, tmpdir, no repo writes).
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";
import {
  runFullExport,
  classifyIdentity,
  PRIMARY_STATE_PRIORITY,
  OUTPUT_FILES,
  DEFAULT_PARTITION_ROWS,
} from "./iu-cj-affiliate-product-inventory-full-export-v1.mjs";

const checks = [];
const check = (name, cond, detail) => checks.push({ name, ok: cond === true, detail: detail ?? null });

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "iu-cj-inv-selftest-"));
const w = (rel, obj) => {
  const f = path.join(tmp, rel);
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, typeof obj === "string" ? obj : JSON.stringify(obj, null, 2));
  return f;
};
const readRows = (dir) => {
  const man = JSON.parse(fs.readFileSync(path.join(dir, OUTPUT_FILES.manifest), "utf8"));
  const rows = [];
  for (const p of man.parts) {
    for (const l of zlib.gunzipSync(fs.readFileSync(path.join(dir, p.file))).toString("utf8").split("\n")) if (l) rows.push(JSON.parse(l));
  }
  return { man, rows };
};
const prod = (adv, id, extra = {}) => ({
  advertiserId: adv,
  productId: id,
  title: `T ${id}`,
  currentPrice: 10,
  currency: "CZK",
  affiliateUrl: "https://x/y",
  availabilityClass: "IN_STOCK",
  sectionKey: "aff-test",
  partnerName: "P",
  ...extra,
});

try {
  // ---- classifier unit checks ----
  const base = { hasTitle: true, hasPrice: true, hasUrl: true };
  const c1 = classifyIdentity({ ...base, inLedger: true });
  check("ledger-only complete => blocked_growth_only", c1.primaryState === "blocked_growth_only");
  check("ledger-only without any record => still blocked_growth_only (missing data only demoted when a record exists)", classifyIdentity({ inLedger: true, hasTitle: false, hasPrice: false, hasUrl: false }).primaryState === "blocked_growth_only");
  check("shard-only => pending_verification", classifyIdentity({ ...base, inShard: true }).primaryState === "pending_verification");
  check("hold wins over ledger", classifyIdentity({ ...base, inLedger: true, offers: { hold: true, ready: false, occurrences: 1 } }).primaryState === "hold");
  check("visible published wins over ledger+retry", classifyIdentity({ ...base, inLedger: true, retry: { status: "RETRY_SCHEDULED" }, offers: { hold: false, ready: true, occurrences: 1 } }).primaryState === "published");
  check("retry beats lkg/blocked", classifyIdentity({ ...base, inLedger: true, retry: { status: "RETRY_SCHEDULED" } }).primaryState === "retry");
  check("collision from retry queue", classifyIdentity({ ...base, retry: { status: "INVALID_DATA", closedReason: "IDENTITY_COLLISION_OR_INVALID_DATA" } }).primaryState === "identity_collision");
  check("no evidence => unknown_with_reason + reason", (() => { const r = classifyIdentity({}); return r.primaryState === "unknown_with_reason" && !!r.stateReason; })());
  check("secondary flags multi-ok", classifyIdentity({ ...base, inLedger: true, inShard: true, inPrevOffers: true }).secondaryFlags.length >= 3);

  // ---- fixture export (multi-part) ----
  const ledger = w(
    "ledger.json",
    JSON.stringify({ schema: "iu-affiliate-cj-deferred-new-ledger-v51", updatedAt: "2026-01-01T00:00:00Z", runId: "R1", deferredNewCount: 6, preferredCurrency: "CZK", keys: ["1|a", "1|b", "1|c", "2|d", "2|e", "9|ledgeronly"] }, null, 2),
  );
  w("cat/shard-0.json", { products: { "1|a": prod("1", "a"), "1|b": prod("1", "b", { currency: "RON" }), "1|c": prod("1", "c") } });
  w("cat/shard-1.json", { products: { "2|d": prod("2", "d"), "2|e": prod("2", "e"), "3|f": prod("3", "f"), "3|g": prod("3", "g") } });
  const manifest = w("cat/manifest.json", {
    updatedAt: "2026-01-01T00:00:00Z",
    stats: { catalogUnique: 6 },
    generation: { generation: 1, identityCount: 7, shards: [{ id: "s0", file: "shard-0.json", productCount: 3 }, { id: "s1", file: "shard-1.json", productCount: 4 }] },
  });
  const sec = (products) => ({ sections: [{ sectionKey: "aff-test", products }] });
  const offers = w("offers.json", {
    updatedAt: "2026-01-02T00:00:00Z",
    stats: { uniqueProducts: 3 },
    publicGrowthBudget: { deferredNew: 5, keptNew: 0, deferredDecisionLedgerSample: [{ ADVERTISER_ID: "7", PRODUCT_ID: "newsample" }] },
    ...sec([
      prod("1", "a", { productKey: "1|a", publicationReady: true, publishable: true, lkgPublicHold: false, lkgCarried: false }),
      prod("2", "d", { productKey: "2|d", publicationReady: false, lkgPublicHold: true, publicationEligibility: "PUBLICATION_HOLD" }),
      prod("4", "off", { productKey: "4|off", publicationReady: true, publishable: true, lkgPublicHold: false }),
    ]),
  });
  const prevOffers = w("prev.json", { updatedAt: "2026-01-01T12:00:00Z", ...sec([prod("2", "d", { productKey: "2|d", lkgPublicHold: false, lkgCarried: false, publicationReady: true }), prod("1", "a", { productKey: "1|a", lkgPublicHold: false, publicationReady: true })]) });
  const retryQ = w("rq.json", { items: { "1|b": { key: "1|b", status: "RETRY_SCHEDULED" }, "3|f": { key: "3|f", status: "INVALID_DATA", closed: true, closedReason: "IDENTITY_COLLISION_OR_INVALID_DATA" } } });
  const prevRq = w("rq-prev.json", { items: { "1|b": { key: "1|b", status: "REFRESHED" } } });
  const out = path.join(tmp, "out");
  const r = await runFullExport({ outDir: out, ledger, catalogManifest: manifest, offers, prevOffers, retryQueue: retryQ, prevRetryQueue: prevRq, partitionRows: 3 });
  const { man, rows } = readRows(out);
  const byKey = Object.fromEntries(rows.map((x) => [x.key, x]));
  check("multi-part sharded output", man.parts.length >= 3 && r.classification === "SHARDED_FULL", `${man.parts.length} parts`);
  check("every identity exactly once", new Set(rows.map((x) => x.key)).size === rows.length && rows.length === r.universeSize);
  check("universe = ledger+catalog+offers+sample (10)", rows.length === 10, `${rows.length}`);
  check("balance ok + sum equals rows", r.balance.balanceOk === true && r.balance.sumOfPrimaryStates === rows.length);
  check("published", byKey["1|a"].primaryState === "published");
  check("hold", byKey["2|d"].primaryState === "hold" && byKey["2|d"].secondaryFlags.includes("inDeferredLedger"));
  check("retry", byKey["1|b"].primaryState === "retry" && byKey["1|b"].secondaryFlags.includes("currencyNotPreferred"));
  check("collision", byKey["3|f"].primaryState === "identity_collision");
  check("blocked_growth_only", byKey["1|c"].primaryState === "blocked_growth_only");
  check("shard-only pending_verification", byKey["3|g"].primaryState === "pending_verification");
  check("offers-only published", byKey["4|off"].primaryState === "published" && byKey["4|off"].shard === null);
  check("ledger-only: null fields + missingReason, not 0", byKey["9|ledgeronly"].title === null && byKey["9|ledgeronly"].currentPrice === null && byKey["9|ledgeronly"].missingReason === "NO_PRODUCT_RECORD_IN_ANY_SOURCE_ONLY_IDENTITY_KEY_KNOWN");
  check("current deferred sample identity added", byKey["7|newsample"]?.primaryState === "blocked_growth_only");
  check("unevaluable states report null", r.countsByPrimaryState.technical_failure === null && r.countsByPrimaryState.unsuitable_cz_market === null);
  check("delta file written + residual math", fs.existsSync(path.join(out, r.deltaName)) && r.delta.declaredDelta === 1 && r.delta.identityLevel.ledgerKeysNowInCurrentOffers.total === 2, r.deltaName);
  check("diff: hold entered from known prev", r.diff.hold.enteredFromKnownPrev.includes("2|d"));
  check("diff: retry transition", r.diff.retryQueue.transitions.some((t) => t.key === "1|b" && t.prevStatus === "REFRESHED" && t.curStatus === "RETRY_SCHEDULED"));
  check("outputs present", [OUTPUT_FILES.summary, OUTPUT_FILES.balance, OUTPUT_FILES.completeness, OUTPUT_FILES.diff, OUTPUT_FILES.manifest].every((f) => fs.existsSync(path.join(out, f))));

  // ---- IU_CJ_INV_MAX_ROWS (tests only) forces SAMPLE_NOT_FULL ----
  const out2 = path.join(tmp, "out-capped");
  const r2 = await runFullExport({ outDir: out2, ledger, catalogManifest: manifest, offers, maxRows: 4, partitionRows: 100 });
  check("maxRows => SAMPLE_NOT_FULL + 4 rows", r2.classification === "SAMPLE_NOT_FULL" && r2.rowsWritten === 4 && r2.balance.universeComplete === false);

  // ---- NO 50k hard cap ----
  const N = DEFAULT_PARTITION_ROWS * 2 + 7;
  const keys = [];
  for (let i = 0; i < N; i += 1) keys.push(`5|k${i}`);
  const bigLedger = w("big-ledger.json", JSON.stringify({ updatedAt: "x", deferredNewCount: N, keys }, null, 2));
  const out3 = path.join(tmp, "out-big");
  const r3 = await runFullExport({ outDir: out3, ledger: bigLedger });
  const big = readRows(out3);
  check("no 50k cap: all rows exported in >=3 parts", big.rows.length === N && big.man.parts.length === 3 && r3.classification === "SHARDED_FULL", `${big.rows.length}/${N}`);
  check("no 50k cap: balance ok", r3.balance.balanceOk === true);
  check("priority list has all required states", ["published", "eligible_new", "blocked_growth_only", "hold", "retry", "lkg", "invalid", "technical_failure", "duplicate", "identity_collision", "unsuitable_cz_market", "missing_business_data", "ended_partnership", "external_cj_restriction", "pending_verification", "unavailable", "unknown_with_reason"].every((s) => PRIMARY_STATE_PRIORITY.includes(s)));
} catch (e) {
  check("selftest exception", false, String(e?.stack || e));
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}

const failed = checks.filter((c) => !c.ok);
for (const c of checks) console.log(`${c.ok ? "PASS" : "FAIL"} ${c.name}${c.ok || !c.detail ? "" : ` :: ${c.detail}`}`);
console.log(`iu-cj-product-inventory-full-export-v1 selftest: ${checks.length - failed.length}/${checks.length} PASS`);
process.exit(failed.length ? 1 : 0);
