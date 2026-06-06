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
import { fileURLToPath } from "url";
import { effectivePublishedMs, loadArticlesDoc } from "./content-freshness-guard-lib.mjs";

export const DEFAULT_WINDOWS_HOURS = [1, 2, 4];
export const DEFAULT_MIN_2H = 1;
export const FLEX_4H_BLOCKING_WINDOW_HOURS = 4;
/** When 4h window is empty but newest section article is within this age, warn only (do not block release). */
export const FLEX_4H_SOFT_NEWEST_HOURS = 8;
/** @deprecated use FLEX_4H_BLOCKING_WINDOW_HOURS */
export const ZDRAVI_BLOCKING_WINDOW_HOURS = FLEX_4H_BLOCKING_WINDOW_HOURS;

/** Priority sections with 2h warn / 4h blocking (native verticals with slower publish cadence). */
export const FLEX_4H_LIVENESS_SECTION_KEYS = new Set([
  "finance",
  "zdravi",
  "cestovani",
  "hry",
  "kultura",
  "veda",
  "vzdelavani",
]);

/** Sections that must never soft-fail alone — keep hard 2h contract. */
export const HARD_FAIL_SECTION_KEYS = new Set(["aktualne", "sport"]);

export const SECTIONS = [
  { key: "hub", label: "Přehled dne", match: () => true },
  { key: "aktualne", label: "Zprávy", match: (a) => (a.section || a.topic) === "aktualne" },
  { key: "sport", label: "Sport", match: (a) => (a.section || a.topic) === "sport" },
  { key: "finance", label: "Finance", match: (a) => (a.section || a.topic) === "finance" },
  { key: "zdravi", label: "Zdraví", match: (a) => (a.section || a.topic) === "zdravi" },
  { key: "cestovani", label: "Cestování", match: (a) => (a.section || a.topic) === "cestovani" },
];

export const PRIORITY_SECTION_KEYS = new Set(["aktualne", "sport", "finance", "zdravi", "cestovani"]);

function log(msg) {
  console.log(`[production-liveness-guard] ${msg}`);
}

function fail(msg) {
  console.error(`[production-liveness-guard] FAIL: ${msg}`);
}

export function countInWindow(articles, matchFn, hours, nowMs = Date.now()) {
  const cutoff = nowMs - hours * 3_600_000;
  let n = 0;
  for (const a of articles) {
    if (!matchFn(a)) continue;
    const t = effectivePublishedMs(a);
    if (t !== null && t >= cutoff) n++;
  }
  return n;
}

export function newestInSection(articles, matchFn) {
  let best = null;
  for (const a of articles) {
    if (!matchFn(a)) continue;
    const t = effectivePublishedMs(a);
    if (t === null) continue;
    if (!best || t > best) best = t;
  }
  return best;
}

function flex4hSectionVerdict(sectionKey, c2, c4, min2h, newestAgeMin = null) {
  const label = SECTIONS.find((s) => s.key === sectionKey)?.label || sectionKey;
  if (c2 >= min2h) {
    return { ok: true, warn: false, result: "PASS" };
  }
  if (c4 >= min2h) {
    return {
      ok: true,
      warn: true,
      result: "PASS_WITH_WARN",
      message: `${label}: 2h=${c2} but 4h=${c4} (PASS_WITH_WARN)`,
    };
  }
  if (
    newestAgeMin !== null &&
    newestAgeMin <= FLEX_4H_SOFT_NEWEST_HOURS * 60
  ) {
    return {
      ok: true,
      warn: true,
      result: "PASS_WITH_WARN",
      message: `${label}: 4h=${c4} but newest within ${FLEX_4H_SOFT_NEWEST_HOURS}h (PASS_WITH_WARN)`,
    };
  }
  return {
    ok: false,
    warn: false,
    result: "FAIL",
    message: `${label}: only ${c4} articles in last ${FLEX_4H_BLOCKING_WINDOW_HOURS}h (min ${min2h})`,
  };
}

/**
 * Evaluate blocking/warn contract for one priority section.
 * Finance / Zdraví: 2h miss is warning when 4h has content; 4h empty is blocking fail.
 * Other priority sections: 2h blocking only.
 */
export function evaluatePrioritySectionLiveness(sectionKey, counts, min2h = DEFAULT_MIN_2H, newestAgeMin = null) {
  const c2 = Number(counts?.last_2h ?? 0);
  const c4 = Number(counts?.last_4h ?? 0);

  if (FLEX_4H_LIVENESS_SECTION_KEYS.has(sectionKey)) {
    return flex4hSectionVerdict(sectionKey, c2, c4, min2h, newestAgeMin);
  }

  if (c2 < min2h) {
    const label =
      SECTIONS.find((s) => s.key === sectionKey)?.label ||
      sectionKey;
    return {
      ok: false,
      warn: false,
      result: "FAIL",
      message: `${label}: only ${c2} articles in last 2h (min ${min2h})`,
    };
  }
  return { ok: true, warn: false, result: "PASS" };
}

export function evaluateProductionLiveness(articles, options = {}) {
  const nowMs = options.nowMs ?? Date.now();
  const windows = options.windowsHours ?? DEFAULT_WINDOWS_HOURS;
  const min2h = options.min2h ?? DEFAULT_MIN_2H;

  let failed = false;
  let warned = false;
  const failedSections = [];
  const report = { generatedAt: options.generatedAt ?? null, sections: {} };

  for (const sec of SECTIONS) {
    const counts = {};
    for (const h of windows) {
      counts[`last_${h}h`] = countInWindow(articles, sec.match, h, nowMs);
    }
    const newest = newestInSection(articles, sec.match);
    const newestAgeMin = newest ? (nowMs - newest) / 60_000 : null;
    report.sections[sec.key] = {
      label: sec.label,
      counts,
      newestIso: newest ? new Date(newest).toISOString() : null,
      newestAgeMin,
    };

    if (PRIORITY_SECTION_KEYS.has(sec.key)) {
      const verdict = evaluatePrioritySectionLiveness(sec.key, counts, min2h, newestAgeMin);
      report.sections[sec.key].livenessResult = verdict.result;
      if (!verdict.ok) {
        failedSections.push(sec.key);
        failed = true;
      } else if (verdict.warn) {
        warned = true;
      }
    }
  }

  if (
    failed &&
    failedSections.length === 1 &&
    FLEX_4H_LIVENESS_SECTION_KEYS.has(failedSections[0])
  ) {
    const sk = failedSections[0];
    const row = report.sections[sk];
    const c4 = Number(row?.counts?.last_4h ?? 0);
    const newestAgeMin = row?.newestAgeMin;
    const softOnly =
      c4 >= min2h ||
      (newestAgeMin !== null && newestAgeMin <= FLEX_4H_SOFT_NEWEST_HOURS * 60);
    if (softOnly) {
      failed = false;
      warned = true;
      report.single_section_soft_fail = sk;
    }
  }

  const result = failed ? "FAIL" : warned ? "PASS_WITH_WARN" : "PASS";
  return { failed, warned, result, report };
}

async function main() {
  const windows = (process.env.LIVENESS_WINDOWS_HOURS || "1,2,4")
    .split(",")
    .map((x) => Number(x.trim()))
    .filter((n) => Number.isFinite(n) && n > 0);
  const min2h = Number(process.env.LIVENESS_MIN_PER_SECTION_2H || String(DEFAULT_MIN_2H));

  const doc = await loadArticlesDoc();
  const articles = Array.isArray(doc.articles) ? doc.articles : [];
  const nowMs = Date.now();
  const { failed, warned, result, report } = evaluateProductionLiveness(articles, {
    nowMs,
    windowsHours: windows,
    min2h,
    generatedAt: doc.generatedAt,
  });

  for (const sec of SECTIONS) {
    const row = report.sections[sec.key];
    const counts = row.counts;
    const parts = windows.map((h) => `${h}h=${counts[`last_${h}h`]}`).join(" ");
    log(
      `section=${sec.label} ${parts} newest_age_min=${row.newestAgeMin !== null ? row.newestAgeMin.toFixed(1) : "n/a"}`,
    );
    if (PRIORITY_SECTION_KEYS.has(sec.key)) {
      const verdict = evaluatePrioritySectionLiveness(sec.key, counts, min2h, row.newestAgeMin);
      if (!verdict.ok) {
        fail(verdict.message);
      } else if (verdict.warn) {
        log(`WARN: ${verdict.message}`);
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
  log(`RESULT=${result}`);
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  main().catch((e) => {
    console.error("[production-liveness-guard] ERROR:", e.message || e);
    process.exit(1);
  });
}
