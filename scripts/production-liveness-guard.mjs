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

/** Sections with hard 2h contract when not in batch publishing mode. */
export const HARD_FAIL_SECTION_KEYS = new Set(["aktualne", "sport"]);

/** Priority sections for small-batch cadence (Zprávy, Sport, Zdraví, Finance). */
export const BATCH_PRIORITY_SECTION_KEYS = new Set(["aktualne", "sport", "zdravi", "finance"]);

export const SECTIONS = [
  { key: "hub", label: "Přehled dne", match: () => true },
  { key: "aktualne", label: "Zprávy", match: (a) => (a.section || a.topic) === "aktualne" },
  { key: "sport", label: "Sport", match: (a) => (a.section || a.topic) === "sport" },
  { key: "finance", label: "Finance", match: (a) => (a.section || a.topic) === "finance" },
  { key: "zdravi", label: "Zdraví", match: (a) => (a.section || a.topic) === "zdravi" },
  { key: "cestovani", label: "Cestování", match: (a) => (a.section || a.topic) === "cestovani" },
];

export const PRIORITY_SECTION_KEYS = new Set(["aktualne", "sport", "finance", "zdravi", "cestovani"]);

/** Isolated Zdraví staleness may WARN when headline sections and pipeline content are alive. */
export const ZDRAVI_ISOLATED_SOFT_FAIL_SECTION = "zdravi";

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

export function countContentNewerThanGenerated(articles, generatedAtTs) {
  if (!generatedAtTs) return 0;
  return articles.filter((a) => {
    const t = effectivePublishedMs(a);
    return t !== null && t > generatedAtTs;
  }).length;
}

/**
 * Pipeline is alive when bundle is non-empty, headline sections have recent content,
 * and generatedAt is not moving without real articles.
 */
export function isPipelineLivenessAlive(report, options = {}) {
  const articles = options.articles ?? [];
  const generatedAtTs = options.generatedAtTs ?? null;
  const nowMs = options.nowMs ?? Date.now();
  const min2h = options.min2h ?? DEFAULT_MIN_2H;
  const batchMode = Boolean(options.batchMode);

  if (articles.length === 0) return false;

  const contentNewer = countContentNewerThanGenerated(articles, generatedAtTs);
  const hub4h = Number(report.sections?.hub?.counts?.last_4h ?? 0);

  if (generatedAtTs) {
    const genAgeMin = (nowMs - generatedAtTs) / 60_000;
    if (genAgeMin < 180 && contentNewer === 0) return false;
  }

  if (batchMode) {
    if (contentNewer > 0 || hub4h >= min2h) return true;
    const anyPriority4h = [...BATCH_PRIORITY_SECTION_KEYS].some((key) => {
      const row = report.sections[key];
      return Number(row?.counts?.last_4h ?? 0) >= min2h;
    });
    if (anyPriority4h) return true;
    const anyNewestSoft = [...PRIORITY_SECTION_KEYS].some((key) => {
      const age = report.sections[key]?.newestAgeMin;
      return age !== null && age !== undefined && age <= FLEX_4H_SOFT_NEWEST_HOURS * 60;
    });
    return anyNewestSoft;
  }

  for (const key of HARD_FAIL_SECTION_KEYS) {
    const row = report.sections[key];
    if (!row) return false;
    const c2 = Number(row.counts?.last_2h ?? 0);
    const c4 = Number(row.counts?.last_4h ?? 0);
    if (c2 < min2h && c4 < min2h) return false;
  }

  const supportingAlive = ["finance", "cestovani"].filter((key) => {
    const row = report.sections[key];
    const c4 = Number(row?.counts?.last_4h ?? 0);
    return c4 >= min2h;
  }).length;

  return supportingAlive >= 1;
}

/** Sections that may WARN instead of FAIL when pipeline content is alive. */
export function canSectionSoftFailWhenPipelineAlive(
  sectionKey,
  row,
  min2h = DEFAULT_MIN_2H,
  batchMode = false,
) {
  if (!row) return false;
  const c2 = Number(row.counts?.last_2h ?? 0);
  const c4 = Number(row.counts?.last_4h ?? 0);
  const newestAgeMin = row.newestAgeMin;
  const newestSoft =
    newestAgeMin !== null &&
    newestAgeMin !== undefined &&
    newestAgeMin <= FLEX_4H_SOFT_NEWEST_HOURS * 60;

  if (batchMode && BATCH_PRIORITY_SECTION_KEYS.has(sectionKey)) {
    return c2 < min2h && (c4 >= min2h || newestSoft);
  }
  if (sectionKey === "aktualne") return false;
  if (sectionKey === ZDRAVI_ISOLATED_SOFT_FAIL_SECTION) return c4 < min2h;
  if (sectionKey === "sport") return c2 < min2h && (c4 >= min2h || newestSoft);
  return false;
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
export function evaluatePrioritySectionLiveness(
  sectionKey,
  counts,
  min2h = DEFAULT_MIN_2H,
  newestAgeMin = null,
  batchMode = false,
) {
  const c2 = Number(counts?.last_2h ?? 0);
  const c4 = Number(counts?.last_4h ?? 0);

  if (FLEX_4H_LIVENESS_SECTION_KEYS.has(sectionKey)) {
    return flex4hSectionVerdict(sectionKey, c2, c4, min2h, newestAgeMin);
  }

  if (batchMode && BATCH_PRIORITY_SECTION_KEYS.has(sectionKey)) {
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
  const batchMode = Boolean(options.batchMode);
  const generatedAtTs =
    options.generatedAtTs ??
    (options.generatedAt ? Date.parse(String(options.generatedAt)) : null);

  let failed = false;
  let warned = false;
  const failedSections = [];
  const report = {
    generatedAt: options.generatedAt ?? null,
    generatedAtTs: Number.isFinite(generatedAtTs) ? generatedAtTs : null,
    batchMode,
    sections: {},
  };

  if (articles.length === 0) {
    return { failed: true, warned: false, result: "FAIL", report: { ...report, articles_empty: true } };
  }

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
      const verdict = evaluatePrioritySectionLiveness(sec.key, counts, min2h, newestAgeMin, batchMode);
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

  const contentNewerThanGenerated = countContentNewerThanGenerated(articles, report.generatedAtTs);
  report.content_newer_than_generated = contentNewerThanGenerated;

  const pipelineAlive = isPipelineLivenessAlive(report, {
    articles,
    generatedAtTs,
    nowMs,
    min2h,
    batchMode,
  });

  if (failed && pipelineAlive && failedSections.length > 0) {
    const allowAktualneSoft = batchMode || !failedSections.includes("aktualne");
    if (allowAktualneSoft) {
      const allSoft = failedSections.every((sk) =>
        canSectionSoftFailWhenPipelineAlive(sk, report.sections[sk], min2h, batchMode),
      );
      if (allSoft) {
        failed = false;
        warned = true;
        report.pipeline_alive = true;
        report.pipeline_alive_soft_fail_sections = [...failedSections];
        for (const sk of failedSections) {
          report.sections[sk].livenessResult = "PASS_WITH_WARN";
        }
      }
    }
  }

  if (batchMode && failed && contentNewerThanGenerated > 0) {
    failed = false;
    warned = true;
    report.batch_publish_soft_fail = true;
    report.batch_publish_soft_fail_sections = [...failedSections];
    for (const sk of failedSections) {
      report.sections[sk].livenessResult = "PASS_WITH_WARN";
    }
  }

  if (batchMode && failed) {
    const hub4h = Number(report.sections?.hub?.counts?.last_4h ?? 0);
    const siteDead = hub4h < min2h && contentNewerThanGenerated === 0;
    if (!siteDead && failedSections.length < PRIORITY_SECTION_KEYS.size) {
      failed = false;
      warned = true;
      report.partial_section_soft_fail = true;
      report.partial_section_soft_fail_sections = [...failedSections];
      for (const sk of failedSections) {
        report.sections[sk].livenessResult = "PASS_WITH_WARN";
      }
    }
  }

  const result = failed ? "FAIL" : warned ? "PASS_WITH_WARN" : "PASS";
  return {
    failed,
    warned,
    result,
    report,
    pipelineAlive: Boolean(report.pipeline_alive) || pipelineAlive,
  };
}

async function main() {
  const windows = (process.env.LIVENESS_WINDOWS_HOURS || "1,2,4")
    .split(",")
    .map((x) => Number(x.trim()))
    .filter((n) => Number.isFinite(n) && n > 0);
  const min2h = Number(process.env.LIVENESS_MIN_PER_SECTION_2H || String(DEFAULT_MIN_2H));
  const batchMode = String(process.env.LIVENESS_BATCH_MODE || "1").toLowerCase() !== "0";

  const doc = await loadArticlesDoc();
  const articles = Array.isArray(doc.articles) ? doc.articles : [];
  const nowMs = Date.now();
  const generatedAtTs = doc.generatedAt ? Date.parse(String(doc.generatedAt)) : null;
  const { failed, warned, result, report } = evaluateProductionLiveness(articles, {
    nowMs,
    windowsHours: windows,
    min2h,
    batchMode,
    generatedAt: doc.generatedAt,
    generatedAtTs: Number.isFinite(generatedAtTs) ? generatedAtTs : null,
  });

  log(`batch_mode=${batchMode ? "YES" : "NO"}`);
  log(`articles=${articles.length} content_newer_than_generatedAt=${countContentNewerThanGenerated(articles, report.generatedAtTs)}`);
  if (report.pipeline_alive) {
    log("pipeline_alive=YES");
  }
  if (report.batch_publish_soft_fail) {
    log(`batch_publish_soft_fail_sections=${(report.batch_publish_soft_fail_sections || []).join(",")}`);
  }

  for (const sec of SECTIONS) {
    const row = report.sections[sec.key];
    const counts = row.counts;
    const parts = windows.map((h) => `${h}h=${counts[`last_${h}h`]}`).join(" ");
    log(
      `section=${sec.label} ${parts} newest_age_min=${row.newestAgeMin !== null ? row.newestAgeMin.toFixed(1) : "n/a"}`,
    );
    if (PRIORITY_SECTION_KEYS.has(sec.key)) {
      const verdict = evaluatePrioritySectionLiveness(sec.key, counts, min2h, row.newestAgeMin, batchMode);
      const softened =
        report.pipeline_alive_soft_fail_sections?.includes(sec.key) ||
        report.batch_publish_soft_fail_sections?.includes(sec.key) ||
        report.partial_section_soft_fail_sections?.includes(sec.key);
      if (!verdict.ok && softened) {
        log(`WARN: ${verdict.message} (pipeline_alive)`);
      } else if (!verdict.ok) {
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
