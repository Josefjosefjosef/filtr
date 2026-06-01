/**
 * production_liveness_guard — count recent articles per main section (content liveness).
 *
 * Run: node scripts/production-liveness-guard.mjs
 *
 * Env:
 *   LIVENESS_WINDOWS_HOURS — comma list, default "1,2,4"
 *   LIVENESS_MIN_PER_SECTION_2H — min articles in last 2h for priority sections (default 1)
 *   ARTICLES_JSON_PATH / ARTICLES_JSON_URL
 */
import fs from "fs";
import path from "path";
import { effectivePublishedMs, loadArticlesDoc } from "./content-freshness-guard-lib.mjs";

const windows = (process.env.LIVENESS_WINDOWS_HOURS || "1,2,4")
  .split(",")
  .map((x) => Number(x.trim()))
  .filter((n) => Number.isFinite(n) && n > 0);
const min2h = Number(process.env.LIVENESS_MIN_PER_SECTION_2H || "1");

const SECTIONS = [
  { key: "hub", label: "Přehled dne", match: () => true },
  { key: "aktualne", label: "Zprávy", match: (a) => (a.section || a.topic) === "aktualne" },
  { key: "sport", label: "Sport", match: (a) => (a.section || a.topic) === "sport" },
  { key: "finance", label: "Finance", match: (a) => (a.section || a.topic) === "finance" },
  { key: "zdravi", label: "Zdraví", match: (a) => (a.section || a.topic) === "zdravi" },
  { key: "cestovani", label: "Cestování", match: (a) => (a.section || a.topic) === "cestovani" },
];

const PRIORITY_SECTION_KEYS = new Set(["aktualne", "sport", "finance", "zdravi", "cestovani"]);

function log(msg) {
  console.log(`[production-liveness-guard] ${msg}`);
}

function fail(msg) {
  console.error(`[production-liveness-guard] FAIL: ${msg}`);
}

function countInWindow(articles, matchFn, hours) {
  const cutoff = Date.now() - hours * 3_600_000;
  let n = 0;
  for (const a of articles) {
    if (!matchFn(a)) continue;
    const t = effectivePublishedMs(a);
    if (t !== null && t >= cutoff) n++;
  }
  return n;
}

function newestInSection(articles, matchFn) {
  let best = null;
  for (const a of articles) {
    if (!matchFn(a)) continue;
    const t = effectivePublishedMs(a);
    if (t === null) continue;
    if (!best || t > best) best = t;
  }
  return best;
}

async function main() {
  let failed = false;
  const doc = await loadArticlesDoc();
  const articles = Array.isArray(doc.articles) ? doc.articles : [];
  const now = Date.now();
  const report = { generatedAt: doc.generatedAt, sections: {} };

  for (const sec of SECTIONS) {
    const counts = {};
    for (const h of windows) {
      counts[`last_${h}h`] = countInWindow(articles, sec.match, h);
    }
    const newest = newestInSection(articles, sec.match);
    const newestAgeMin = newest ? (now - newest) / 60_000 : null;
    report.sections[sec.key] = {
      label: sec.label,
      counts,
      newestIso: newest ? new Date(newest).toISOString() : null,
      newestAgeMin,
    };
    const parts = windows.map((h) => `${h}h=${counts[`last_${h}h`]}`).join(" ");
    log(`section=${sec.label} ${parts} newest_age_min=${newestAgeMin !== null ? newestAgeMin.toFixed(1) : "n/a"}`);

    if (PRIORITY_SECTION_KEYS.has(sec.key)) {
      const c2 = counts.last_2h ?? countInWindow(articles, sec.match, 2);
      if (c2 < min2h) {
        fail(`${sec.label}: only ${c2} articles in last 2h (min ${min2h})`);
        failed = true;
      }
    }
  }

  const outPath = path.join(process.env.TEMP || process.env.TMP || ".", "iu_production_liveness_report.json");
  fs.writeFileSync(outPath, JSON.stringify(report, null, 2));
  log(`report=${outPath}`);

  if (failed) {
    console.error("[production-liveness-guard] RESULT=FAIL");
    process.exit(1);
  }
  log("RESULT=PASS");
}

main().catch((e) => {
  console.error("[production-liveness-guard] ERROR:", e.message || e);
  process.exit(1);
});
