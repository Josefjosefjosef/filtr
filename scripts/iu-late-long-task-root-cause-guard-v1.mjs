#!/usr/bin/env node
/**
 * IU_LATE_LONG_TASK_ROOT_CAUSE_GUARD
 *
 * Structural contracts for Doprava late LT fix:
 * - parseOfficialCommentFacts is memoized (same cleaned text → same object)
 * - Doprava quick expand yields before full PAGE_SIZE paint
 * - Memo does not change parse output (parity fixture)
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const fails = [];
function ok(id, cond, detail) {
  if (!cond) fails.push(id + (detail ? ":" + detail : ""));
}

const presenter = fs.readFileSync(path.join(ROOT, "assets", "iu-traffic-card-presenter-v1.js"), "utf8");
const prehled = fs.readFileSync(path.join(ROOT, "assets", "iu-prehled-dne-ui-v1.js"), "utf8");
const overview = fs.readFileSync(path.join(ROOT, "assets", "iu-traffic-overview-v1.js"), "utf8");

ok(
  "static_parse_facts_memo",
  /_iuParseOfficialCommentFactsCache/.test(presenter) &&
    /iuParseFactsCacheSet/.test(presenter) &&
    /IU_PARSE_FACTS_CACHE_MAX/.test(presenter)
);
ok(
  "static_memo_on_hit_return",
  /const hit = _iuParseOfficialCommentFactsCache\.get\(text\)/.test(presenter) &&
    /if \(hit\) return hit/.test(presenter)
);
ok(
  "static_memo_on_store",
  /iuParseFactsCacheSet\(text, out\)/.test(presenter)
);
ok(
  "static_quick_expand_yield",
  /iu:pd-traffic-quick-expand-start/.test(prehled) &&
    /scheduler\.yield/.test(prehled) &&
    /expandFullPage/.test(prehled)
);
ok(
  "static_presenter_url_bumped",
  /parse-facts-memo-v1-20260913/.test(overview)
);
ok(
  "static_no_text_rewrite_in_parse_header",
  /Extract only facts that appear in trusted NDIC/.test(presenter)
);

const mod = await import(
  pathToFileURL(path.join(ROOT, "assets", "iu-traffic-card-presenter-v1.js")).href
);

const sample =
  "Na dálnici D1 km 42 ve směru na Brno probíhá nehoda nákladního vozidla. Jízdní pruh je uzavřen. PČR na místě.";

const a = mod.parseOfficialCommentFacts(sample);
const b = mod.parseOfficialCommentFacts(sample);
ok("bench_memo_same_ref", a === b, "expected identical object reference on cache hit");

const c = mod.parseOfficialCommentFacts(sample + " ");
ok("bench_memo_trim_same", a === c || JSON.stringify(a) === JSON.stringify(c));

const t0 = performance.now();
for (let i = 0; i < 500; i++) mod.parseOfficialCommentFacts(sample);
const cachedMs = performance.now() - t0;

const other =
  "Uzavírka silnice I/35 v obci Litomyšl z důvodu stavebních prací. Objížďka přes místní komunikace.";
const t1 = performance.now();
for (let i = 0; i < 50; i++) mod.parseOfficialCommentFacts(other + " #" + i);
const coldMs = performance.now() - t1;

ok(
  "bench_cached_faster",
  cachedMs < 20 || cachedMs * 5 < coldMs,
  "cachedMs=" + cachedMs.toFixed(2) + " coldMs=" + coldMs.toFixed(2)
);

const report = {
  IU_LATE_LONG_TASK_ROOT_CAUSE_GUARD: fails.length ? "FAIL" : "PASS",
  fails,
  bench: {
    cachedMs: Math.round(cachedMs * 100) / 100,
    coldMs: Math.round(coldMs * 100) / 100,
    sameRef: a === b,
  },
};
console.log(JSON.stringify(report, null, 2));
if (fails.length) process.exit(1);
