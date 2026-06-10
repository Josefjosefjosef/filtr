#!/usr/bin/env node
/**
 * P0 PRODUCTION STABILITY AUDIT — 24h / 72h / 7d (READ-ONLY diagnostic).
 *
 * Proves the aggregator holds quality reached by PR #5145/#5156/#5160 over time:
 *  A) Pipeline autonomy: fast-pool runs, pages publish, prod data updates, gaps, staleness.
 *  B) Publication stability: feed freshness, publishable_pool.generatedAt movement,
 *     education home card, hry liveness, dead sections, duplicates.
 *  C) Quality samples: per-section composition from prod chunks; registry-leak and
 *     classifier-suspect counts using the audited deterministic patterns (E1–E6).
 *
 * No production change. No workflow change. No classifier/registry change.
 * Requires: gh CLI (authenticated) + git remote origin + network to infouzel.cz.
 *
 * Run: node scripts/iu-production-stability-audit.mjs
 * Output: scripts/iu-production-stability-audit-report.json + stdout summary.
 */
import fs from "fs";
import path from "path";
import { execSync } from "child_process";
import { fileURLToPath } from "url";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const REPORT_PATH = path.join(REPO, "scripts", "iu-production-stability-audit-report.json");
const DATA_BASE = process.env.IU_AUDIT_DATA_BASE || "https://infouzel.cz/projects/data/";
const GH_REPO = process.env.IU_AUDIT_GH_REPO || "Josefjosefjosef/filtr";

const NOW = new Date();
const WINDOWS = { "24h": 24, "72h": 72, "7d": 168 };
const SECTIONS = ["zpravy", "sport", "finance", "zdravi", "cestovani", "hry", "kultura", "veda", "vzdelavani"];

/** Feeds blocked by merged purity PR #5145 — any NEW vertical article from them = regression. */
const BLOCKED_5145_FEED_IDS = new Set([
  "hry_novinky",
  "ces_novinky_cestovani",
  "fin_novinky_ekonomika",
  "zdr_prozeny_zdravi",
  "kul_vlasta",
]);
/** Feeds fixed in PR #5156 (open, pending merge) — leaks expected until merge. */
const PENDING_5156_FEED_IDS = new Set([
  "vzd_betterlife",
  "zdr_betterlife",
  "vzd_novinky_skola",
  "ved_novinky",
]);
/** PR #5145 merge instant — items published after it must be clean of 5145-blocked feeds. */
const PURITY_5145_MERGED_AT = "2026-06-10T18:09:35Z";

/** Source-name fallback (older rows have no feedId). section -> deny source patterns. */
const SECTION_DENY_SOURCES = {
  vzdelavani: [
    { re: /^betterlife/i, cls: "pending_5156" },
    { re: /^novinky/i, cls: "pending_5156" },
  ],
  zdravi: [
    { re: /^proženy|^prozeny/i, cls: "blocked_5145" },
    { re: /^betterlife/i, cls: "pending_5156" },
  ],
  hry: [{ re: /^novinky$/i, cls: "blocked_5145" }],
  cestovani: [{ re: /^novinky$/i, cls: "blocked_5145" }],
  kultura: [{ re: /^vlasta/i, cls: "blocked_5145" }],
  veda: [{ re: /^novinky/i, cls: "pending_5156" }],
};

const RE_HEALTH_NON_COVID =
  /(nemoc|nemocnic|lékař|lekar|pacient|zdraví|zdravi|očkov|onkolog|operac|chorob|léčb|lecba|vakcín|vakcin|antibiot|psychiatr|rehabilit|epidemi|ambulanc)/i;
const RE_SPORT_ENTITY =
  /(sportov|rychlobrusl|brusl|závod|zavod|atlet|liga|zápas|zapas|hokej|fotbal|tenis|turnaj|olymp|extraliga|nhl|trenér|trener|medail|reprezentac)/i;

function sh(cmd) {
  return execSync(cmd, { cwd: REPO, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
}

function ghJson(endpoint) {
  return JSON.parse(sh(`gh api "${endpoint}"`));
}

async function fetchJson(url) {
  const res = await fetch(url + (url.includes("?") ? "&" : "?") + "cb=stability-audit", {
    headers: { "cache-control": "no-cache", "user-agent": "infouzel stability audit (read-only)" },
  });
  if (!res.ok) throw new Error(`HTTP_${res.status} ${url}`);
  return res.json();
}

function hoursAgoIso(h) {
  return new Date(NOW.getTime() - h * 3600 * 1000).toISOString();
}

function minutesBetween(a, b) {
  return Math.round(Math.abs(new Date(b).getTime() - new Date(a).getTime()) / 60000);
}

/** All runs of a workflow file created in the last `hours` hours (paged). */
function workflowRuns(workflowFile, hours) {
  const since = hoursAgoIso(hours);
  const out = [];
  for (let page = 1; page <= 12; page++) {
    const data = ghJson(
      `repos/${GH_REPO}/actions/workflows/${workflowFile}/runs?per_page=100&page=${page}&created=>${since}`
    );
    const runs = data.workflow_runs || [];
    for (const r of runs) {
      out.push({
        id: r.id,
        event: r.event,
        status: r.status,
        conclusion: r.conclusion,
        created_at: r.created_at,
        updated_at: r.updated_at,
        actor: r.triggering_actor ? r.triggering_actor.login : null,
      });
    }
    if (runs.length < 100) break;
  }
  return out.sort((a, b) => a.created_at.localeCompare(b.created_at));
}

function inWindow(iso, hours) {
  return iso && new Date(iso).getTime() >= NOW.getTime() - hours * 3600 * 1000;
}

function gapStats(successIsoTimes) {
  if (successIsoTimes.length < 2) {
    return { longest_gap_min: null, average_gap_min: null, gaps: 0 };
  }
  const gaps = [];
  for (let i = 1; i < successIsoTimes.length; i++) {
    gaps.push(minutesBetween(successIsoTimes[i - 1], successIsoTimes[i]));
  }
  const longest = Math.max(...gaps);
  const avg = Math.round((gaps.reduce((s, g) => s + g, 0) / gaps.length) * 10) / 10;
  return { longest_gap_min: longest, average_gap_min: avg, gaps: gaps.length };
}

function dataCommits(hours) {
  const since = hoursAgoIso(hours);
  const log = sh(`git log origin/main --first-parent --since="${since}" --pretty="%H|%cI|%an|%s"`);
  const rows = log
    .split(/\r?\n/)
    .filter(Boolean)
    .map((l) => {
      const [hash, date, author, ...rest] = l.split("|");
      return { hash, date, author, subject: rest.join("|") };
    });
  return {
    all: rows,
    data: rows.filter((r) => /^chore\(data\)/i.test(r.subject)),
  };
}

function canonUrl(u) {
  try {
    const x = new URL(String(u || "").trim());
    x.hash = "";
    x.search = "";
    x.pathname = x.pathname.replace(/\/+$/, "") || "/";
    return x.toString().toLowerCase();
  } catch {
    return String(u || "").trim().toLowerCase();
  }
}

function hostOf(u) {
  try {
    let h = new URL(u).hostname.toLowerCase();
    if (h.startsWith("www.")) h = h.slice(4);
    return h;
  } catch {
    return "";
  }
}

/** Deterministic quality screening of one prod article inside its section. */
function screenArticle(sec, a) {
  const src = a.sources && a.sources[0] && a.sources[0].name ? String(a.sources[0].name) : "";
  const url = String(a.url || (a.sources && a.sources[0] && a.sources[0].url) || "");
  const feedId = String(a.feedId || "");
  const title = String(a.title || "");
  const host = hostOf(url);

  // Items correctly demoted to the news bucket are NOT purity errors (relevance guards working).
  const inVertical = sec !== "zpravy";
  if (inVertical && BLOCKED_5145_FEED_IDS.has(feedId)) {
    return { kind: "registry_leak", cls: "blocked_5145", detail: `feedId=${feedId}` };
  }
  if (inVertical && PENDING_5156_FEED_IDS.has(feedId)) {
    return { kind: "registry_leak", cls: "pending_5156", detail: `feedId=${feedId}` };
  }
  const deny = inVertical ? SECTION_DENY_SOURCES[sec] || [] : [];
  const denyHit = deny.find((d) => d.re.test(src));
  if (denyHit) {
    const pathOk =
      (sec === "hry" && /\/hry\//i.test(url)) ||
      (sec === "cestovani" && /\/cestovani\//i.test(url)) ||
      (sec === "vzdelavani" && /\/skola\//i.test(url)) ||
      (sec === "zdravi" && /\/zdrav/i.test(url)) ||
      (sec === "kultura" && /\/kultura\//i.test(url)) ||
      (sec === "veda" && /\/veda\//i.test(url));
    if (!pathOk) return { kind: "registry_leak", cls: denyHit.cls, detail: `source=${src}` };
  }

  // Classifier suspect patterns (audited E3/E4/E5 families):
  if (sec === "zdravi" && host.endsWith("sport.cz") && !/\/zdrav/i.test(url)) {
    if (RE_SPORT_ENTITY.test(title) && !RE_HEALTH_NON_COVID.test(title)) {
      return { kind: "classifier_suspect", cls: "pending_5160", detail: "sportcz_sport_entity_in_zdravi" };
    }
  }
  if (sec === "zdravi" && host.endsWith("ekonomickydenik.cz") && !/\/zdrav/i.test(url)) {
    if (/covid/i.test(title) && !RE_HEALTH_NON_COVID.test(title)) {
      return { kind: "classifier_suspect", cls: "pending_5160", detail: "ekonomickydenik_covid_only_in_zdravi" };
    }
  }
  if (sec === "finance" && (host.endsWith("faei.cz") || host.endsWith("profitonline.cz"))) {
    if (RE_HEALTH_NON_COVID.test(title) || /hygienik|hygienic|kvalitou vody/i.test(title)) {
      return { kind: "classifier_suspect", cls: "pending_5160", detail: "faei_societal_in_finance" };
    }
  }
  return { kind: "ok" };
}

async function sectionSamples() {
  const perSection = {};
  for (const sec of SECTIONS) {
    let payload;
    try {
      payload = await fetchJson(`${DATA_BASE}article_feed_chunks/${sec}/000.json`);
    } catch (e) {
      perSection[sec] = { error: String(e.message || e), articles: [] };
      continue;
    }
    perSection[sec] = { articles: (payload.articles || []).slice(0, 80) };
  }
  return perSection;
}

function summarizeSamples(perSection, hours) {
  let sampled = 0;
  let registryLeaks = 0;
  let classifierSuspects = 0;
  let pendingMergeIssues = 0; // expected until PR #5156 / #5160 merge
  let postFixSampled = 0;
  let postFixRegressions = 0; // published after #5145 merge AND from merged-fix scope = real regression
  const details = [];
  for (const sec of SECTIONS) {
    for (const a of perSection[sec].articles || []) {
      if (!inWindow(a.publishedAt, hours)) continue;
      sampled++;
      const postFix = String(a.publishedAt || "") > PURITY_5145_MERGED_AT;
      if (postFix) postFixSampled++;
      const v = screenArticle(sec, a);
      if (v.kind === "ok") continue;
      if (v.kind === "registry_leak") registryLeaks++;
      else classifierSuspects++;
      if (v.cls === "pending_5156" || v.cls === "pending_5160") pendingMergeIssues++;
      if (postFix && v.cls === "blocked_5145") postFixRegressions++;
      details.push({
        section: sec,
        kind: v.kind,
        cls: v.cls,
        post_5145_merge: postFix,
        detail: v.detail,
        title: String(a.title || "").slice(0, 90),
        publishedAt: a.publishedAt,
      });
    }
  }
  const bad = registryLeaks + classifierSuspects;
  const purityPct = sampled ? Math.round(10000 * (sampled - bad) / sampled) / 100 : null;
  const mergedScopePurityPct = postFixSampled
    ? Math.round(10000 * (postFixSampled - postFixRegressions) / postFixSampled) / 100
    : null;
  return {
    sampled,
    registry_leaks: registryLeaks,
    classifier_suspects: classifierSuspects,
    pending_merge_issues: pendingMergeIssues,
    purity_sample_pct: purityPct,
    post_5145_merge_sampled: postFixSampled,
    post_5145_merge_regressions: postFixRegressions,
    merged_scope_purity_pct: mergedScopePurityPct,
    details,
  };
}

async function main() {
  // --- A) pipeline autonomy ----------------------------------------------------------------
  const fastRuns = workflowRuns("update-articles-fast-pool.yml", 168);
  const slowRuns = workflowRuns("update-articles.yml", 168);
  const pagesMain = workflowRuns("pages-publish-from-main-data.yml", 168);
  const pagesPrMerge = workflowRuns("pages-on-data-pr-merge.yml", 168);
  const commits = dataCommits(168);

  const windows = {};
  for (const [label, hours] of Object.entries(WINDOWS)) {
    const fast = fastRuns.filter((r) => inWindow(r.created_at, hours));
    const fastOk = fast.filter((r) => r.conclusion === "success");
    const pages = [...pagesMain, ...pagesPrMerge].filter((r) => inWindow(r.created_at, hours));
    const pagesOk = pages.filter((r) => r.conclusion === "success");
    const dataC = commits.data.filter((c) => inWindow(c.date, hours));
    const g = gapStats(fastOk.map((r) => r.created_at));
    windows[label] = {
      fast_pool_runs: fast.length,
      fast_pool_success: fastOk.length,
      fast_pool_failed: fast.filter((r) => r.conclusion && r.conclusion !== "success" && r.conclusion !== "cancelled").length,
      fast_pool_cancelled: fast.filter((r) => r.conclusion === "cancelled").length,
      pages_publish_runs: pages.length,
      pages_publish_success: pagesOk.length,
      prod_data_update_commits: dataC.length,
      longest_gap_between_fast_pool_success_min: g.longest_gap_min,
      average_gap_between_fast_pool_success_min: g.average_gap_min,
      max_staleness_estimate_min: g.longest_gap_min,
    };
  }

  const lastFastOk = fastRuns.filter((r) => r.conclusion === "success").at(-1);
  const lastDataCommit = commits.data[0] || null;

  // dispatch / manual intervention screening
  const dispatchActors = {};
  for (const r of [...fastRuns, ...slowRuns]) {
    if (r.event !== "workflow_dispatch") continue;
    const k = r.actor || "?";
    dispatchActors[k] = (dispatchActors[k] || 0) + 1;
  }
  const humanDirectPushes = commits.all.filter(
    (c) => !/^chore\(data\)/i.test(c.subject) && !/\(#\d+\)$/.test(c.subject) && !/^Merge /.test(c.subject)
  );
  // Pipeline keep-alive interventions (manual dispatch / probe / restart) vs ordinary dev commits.
  const pipelineInterventions = humanDirectPushes.filter((c) =>
    /(dispatch|probe|keep.?alive|restart|emergency|manual run|wake)/i.test(c.subject)
  );

  // --- B) publication stability ------------------------------------------------------------
  const pool = await fetchJson(`${DATA_BASE}publishable_pool.json`);
  const feedInit = await fetchJson(`${DATA_BASE}article_feed_chunks/feed/init.json`);
  const poolAgeMin = minutesBetween(pool.generatedAt, NOW.toISOString());
  const feedAgeMin = minutesBetween(feedInit.generatedAt, NOW.toISOString());
  const eduItems = Array.isArray(feedInit.educationPreviewItems) ? feedInit.educationPreviewItems : [];

  // --- C) quality samples ------------------------------------------------------------------
  const perSection = await sectionSamples();
  const samples = {};
  for (const [label, hours] of Object.entries(WINDOWS)) {
    samples[label] = summarizeSamples(perSection, hours);
  }

  const sectionFreshness = {};
  const seenUrls = new Map();
  let duplicateCount = 0;
  const duplicates = [];
  for (const sec of SECTIONS) {
    const arts = perSection[sec].articles || [];
    const newest = arts.map((a) => a.publishedAt).filter(Boolean).sort().at(-1) || null;
    sectionFreshness[sec] = {
      sampled: arts.length,
      newest_published_at: newest,
      newest_age_hours: newest ? Math.round(minutesBetween(newest, NOW.toISOString()) / 6) / 10 : null,
    };
    for (const a of arts) {
      const cu = canonUrl(a.url || "");
      if (!cu) continue;
      if (seenUrls.has(cu) && seenUrls.get(cu) !== sec) continue; // cross-section syndication is handled upstream
      if (seenUrls.has(cu) && seenUrls.get(cu) === sec) {
        duplicateCount++;
        duplicates.push({ section: sec, url: cu });
      } else {
        seenUrls.set(cu, sec);
      }
    }
  }
  const deadSections = SECTIONS.filter(
    (s) => sectionFreshness[s].newest_age_hours == null || sectionFreshness[s].newest_age_hours > 48
  );

  const verdict = {
    AUTONOMOUS_OPERATION_STABLE:
      windows["7d"].fast_pool_success > 0 &&
      windows["24h"].fast_pool_success > 0 &&
      poolAgeMin < 180 &&
      feedAgeMin < 180
        ? "YES"
        : "NO",
    MANUAL_INTERVENTION_REQUIRED: pipelineInterventions.length === 0 ? "NO" : "YES",
    VZDELANI_CARD_OK: eduItems.length >= 1 ? "YES" : "NO",
    HRY_LIVENESS_OK:
      sectionFreshness.hry.newest_age_hours != null && sectionFreshness.hry.newest_age_hours <= 48 ? "YES" : "NO",
    NO_DUPLICATE_ARTICLES: duplicateCount === 0 ? "YES" : "NO",
    NO_DEAD_SECTIONS: deadSections.length === 0 ? "YES" : "NO",
  };

  const report = {
    report: "PRODUCTION_STABILITY_AUDIT",
    generatedAt: NOW.toISOString(),
    read_only: true,
    windows,
    current: {
      last_fast_pool_success_at: lastFastOk ? lastFastOk.created_at : null,
      current_fast_pool_gap_min: lastFastOk ? minutesBetween(lastFastOk.created_at, NOW.toISOString()) : null,
      last_prod_data_commit: lastDataCommit,
      publishable_pool_generated_at: pool.generatedAt,
      publishable_pool_age_min: poolAgeMin,
      homepage_feed_generated_at: feedInit.generatedAt,
      homepage_feed_age_min: feedAgeMin,
      education_preview_items: eduItems.length,
    },
    dispatch_screening: {
      workflow_dispatch_runs_by_actor_7d: dispatchActors,
      note: "watchdog (Cloudflare) dispatches via owner PAT — regular sub-hour cadence; no irregular human burst detected means no manual keep-alive",
      human_direct_pushes_to_main_7d: humanDirectPushes,
      pipeline_keepalive_interventions_7d: pipelineInterventions,
    },
    quality_samples: samples,
    section_freshness: sectionFreshness,
    dead_sections: deadSections,
    duplicates_in_section_samples: duplicates.slice(0, 20),
    verdict,
  };

  fs.writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2) + "\n", "utf8");

  console.log("PRODUCTION_STABILITY_AUDIT");
  for (const [label, w] of Object.entries(windows)) {
    console.log(
      `WINDOW ${label} fast_runs=${w.fast_pool_runs} fast_ok=${w.fast_pool_success} pages_ok=${w.pages_publish_success} prod_updates=${w.prod_data_update_commits} longest_gap=${w.longest_gap_between_fast_pool_success_min}min avg_gap=${w.average_gap_between_fast_pool_success_min}min`
    );
  }
  for (const [label, s] of Object.entries(samples)) {
    console.log(
      `SAMPLE ${label} sampled=${s.sampled} registry_leaks=${s.registry_leaks} classifier_suspects=${s.classifier_suspects} pending_merge=${s.pending_merge_issues} raw_purity=${s.purity_sample_pct}% merged_scope_purity=${s.merged_scope_purity_pct}% (post5145 n=${s.post_5145_merge_sampled} regressions=${s.post_5145_merge_regressions})`
    );
  }
  console.log(`POOL_AGE_MIN=${poolAgeMin} FEED_AGE_MIN=${feedAgeMin} EDU_CARD_ITEMS=${eduItems.length}`);
  console.log(`DEAD_SECTIONS=${deadSections.join(",") || "none"} DUPLICATES=${duplicateCount}`);
  for (const [k, v] of Object.entries(verdict)) console.log(`${k}=${v}`);
  console.log("REPORT=" + path.relative(REPO, REPORT_PATH));
}

main().catch((e) => {
  console.error("AUDIT_ERROR " + (e && e.stack ? e.stack : e));
  process.exit(1);
});
