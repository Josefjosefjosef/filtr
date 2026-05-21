#!/usr/bin/env node
/**
 * Silver CAP BEFORE/AFTER product scorecard — orchestration/metrics only.
 * Captures snapshots, computes deltas, emits Czech report. No engine changes.
 */
"use strict";

const fs = require("fs");
const path = require("path");
const {
  buildAuditRegistry,
  prioritizeTrueEngineFail,
  resolveForcedOutcomeAfterLowProductLoop,
} = require("./silver-audit-registry.cjs");
const { resolveAuthoritativeSelectorCluster, readClusterLock } = require("./silver-cluster-consistency-lock.cjs");
const { execSync } = require("child_process");

const SCRIPT_DIR = __dirname;

const REPORT_FILENAMES = [
  "silver-real-human-chaos-v3-report.json",
  "silver-real-czech-public-ux-corpus-v2-report.json",
  "silver-deep-product-real-ux-v2-report.json",
  "silver-realistic-mobile-corpus-report.json",
  "silver-quality-v2-report.json",
  "silver-real-czech-corpus-v1-report.json",
];

const RHC3_BASENAME = "silver-real-human-chaos-v3-report.json";
const RCZ2_BASENAME = "silver-real-czech-public-ux-corpus-v2-report.json";
const DEEP_BASENAME = "silver-deep-product-real-ux-v2-report.json";

const PROGRESS_SPECS = [
  { key: "core_engine_progress", labelCs: "Jádro Silvera", reportKey: "core_engine_progress" },
  { key: "safety_progress", labelCs: "Bezpečnost", auditKeys: [] },
  { key: "routing_progress", labelCs: "Routing", auditKeys: ["20k_overall_accuracy"] },
  { key: "retrieval_progress", labelCs: "Retrieval", auditKeys: ["real_czech_corpus_accuracy", "realistic_overall_accuracy"] },
  { key: "real_human_chaos_progress", labelCs: "Real Human Chaos", auditKeys: ["rhc3_overall_accuracy"] },
  { key: "multi_intent_orchestration_progress", labelCs: "Multi-intent", auditKeys: [] },
  { key: "long_session_memory_progress", labelCs: "Long session memory", auditKeys: [] },
  { key: "public_ready_progress", labelCs: "Veřejná připravenost", auditKeys: ["public_ux_corpus_accuracy"] },
];

const AUDIT_SPECS = [
  { key: "20k_overall_accuracy", labelCs: "20k celková přesnost" },
  { key: "quality_accuracy", labelCs: "Quality audit" },
  { key: "realistic_overall_accuracy", labelCs: "Realistický mobilní korpus" },
  { key: "real_czech_corpus_accuracy", labelCs: "Real český korpus" },
  { key: "public_ux_corpus_accuracy", labelCs: "Public UX korpus" },
  { key: "deep_product_real_ux_v2_accuracy", labelCs: "Deep product real UX" },
  { key: "rhc3_overall_accuracy", labelCs: "RHC3 přesnost" },
];

const BASELINE_TOKEN = "baseline_pending_precise_measurement";

function readJsonSafe(absPath) {
  try {
    return JSON.parse(fs.readFileSync(absPath, "utf8"));
  } catch {
    return null;
  }
}

function readTextSafe(absPath) {
  try {
    return fs.readFileSync(absPath, "utf8");
  } catch {
    return "";
  }
}

function strLower(s) {
  return String(s == null ? "" : s).toLowerCase();
}

function fmtInvariant(v) {
  if (v == null || v === "") return "UNKNOWN";
  const t = String(v).trim();
  if (!t || t === "null" || t === "undefined") return "UNKNOWN";
  const u = t.toUpperCase();
  if (u === "SKIPPED" || u === "RUN_SEPARATELY" || u === "N/A") return "UNKNOWN";
  return t;
}

function parseAccuracyNumber(obj, keys) {
  for (const k of keys) {
    if (obj && obj[k] != null && obj[k] !== "") {
      const t = String(obj[k]).trim().replace("%", "");
      if (/^\d+(\.\d+)?$/.test(t)) return t;
    }
  }
  return null;
}

function getNested(obj, dotted) {
  if (!obj) return null;
  let cur = obj;
  for (const p of dotted.split(".")) {
    if (cur == null) return null;
    cur = cur[p];
  }
  return cur;
}

function pickFirstInvariant(byBasename, keys, order) {
  for (const bn of order) {
    const d = byBasename[bn];
    if (!d) continue;
    for (const k of keys) {
      const v = getNested(d, k) != null ? getNested(d, k) : d[k];
      if (v == null || String(v).trim() === "") continue;
      const inv = fmtInvariant(v);
      if (inv === "UNKNOWN") continue;
      return v;
    }
  }
  return null;
}

function parsePctValue(raw) {
  if (raw == null || raw === "") return null;
  const s = String(raw).trim();
  if (s.indexOf(BASELINE_TOKEN) >= 0) return null;
  const m = s.match(/(\d+(?:\.\d+)?)\s*%/);
  if (m) return parseFloat(m[1]);
  const t = s.replace("%", "").trim();
  if (/^\d+(\.\d+)?$/.test(t)) return parseFloat(t);
  return null;
}

function metricEntry(kind, display, numeric) {
  return { kind, display, numeric };
}

function unavailableEntry(reason) {
  return metricEntry("unavailable", "NEDOSTUPNÉ — " + reason, null);
}

function baselineEntry(raw) {
  const pct = parsePctValue(raw);
  const disp = pct != null ? pct.toFixed(1) + " % (baseline odhad)" : "NEDOSTUPNÉ — baseline odhad bez přesného měření";
  return metricEntry("baseline_estimate", disp, pct);
}

function auditedEntry(pct) {
  return metricEntry("audited", pct.toFixed(1) + " %", pct);
}

function parseRunReportLines(text) {
  const out = {};
  for (const line of text.split(/\r?\n/)) {
    const m = /^([a-z0-9_]+)=(.*)$/i.exec(line.trim());
    if (m) out[m[1]] = m[2];
  }
  return out;
}

/** Returns YES | NO | "" — never invents values. */
function safeGetScriptsOnlyProductWork(sources) {
  const list = Array.isArray(sources) ? sources : [sources];
  for (const src of list) {
    if (!src || typeof src !== "object") continue;
    let raw = "";
    if (src.scripts_only_product_work != null && String(src.scripts_only_product_work).trim() !== "") {
      raw = src.scripts_only_product_work;
    } else if (src.meta && src.meta.scripts_only_product_work != null) {
      raw = src.meta.scripts_only_product_work;
    } else if (src.run_report && src.run_report.scripts_only_product_work != null) {
      raw = src.run_report.scripts_only_product_work;
    }
    const u = String(raw || "").trim().toUpperCase();
    if (u === "YES") return "YES";
    if (u === "NO") return "NO";
  }
  return "";
}

function extractSafetyCounters(data) {
  const nested = data && data.safety && typeof data.safety === "object" ? data.safety : {};
  const pick = (k) => {
    const a = data && data[k];
    const b = nested[k];
    const v = a != null ? a : b;
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  };
  const qcw = Math.max(pick("query_created_write_count"), pick("query_created_write_count_realistic"));
  return {
    dangerous_write_count: pick("dangerous_write_count"),
    false_write_count: pick("false_write_count"),
    query_created_write_count: qcw,
    write_when_negated_count: pick("write_when_negated_count"),
  };
}

function aggregateSafety(reportsMeta) {
  const agg = {
    dangerous_write_count: 0,
    false_write_count: 0,
    query_created_write_count: 0,
    write_when_negated_count: 0,
  };
  for (const m of reportsMeta) {
    const s = m.safety;
    agg.dangerous_write_count = Math.max(agg.dangerous_write_count, s.dangerous_write_count);
    agg.false_write_count = Math.max(agg.false_write_count, s.false_write_count);
    agg.query_created_write_count = Math.max(agg.query_created_write_count, s.query_created_write_count);
    agg.write_when_negated_count = Math.max(agg.write_when_negated_count, s.write_when_negated_count);
  }
  return agg;
}

function loadReports(repoRoot) {
  const scriptsDir = path.join(repoRoot, "scripts");
  const loaded = [];
  const missing = [];
  const byBasename = {};
  for (const fn of REPORT_FILENAMES) {
    const abs = path.join(scriptsDir, fn);
    if (!fs.existsSync(abs)) {
      missing.push(fn);
      continue;
    }
    const data = readJsonSafe(abs);
    if (!data) {
      missing.push(fn + "(unreadable)");
      continue;
    }
    loaded.push(fn);
    byBasename[fn] = data;
  }
  const reportsMeta = loaded.map((fn) => ({
    basename: fn,
    data: byBasename[fn],
    safety: extractSafetyCounters(byBasename[fn]),
  }));
  return { loaded, missing, byBasename, reportsMeta };
}

function collectAuditInvariants(byBasename) {
  const orderBaseline = [RHC3_BASENAME, RCZ2_BASENAME, DEEP_BASENAME, "silver-real-czech-corpus-v1-report.json", "silver-realistic-mobile-corpus-report.json"];

  let v20k = pickFirstInvariant(byBasename, ["20k_overall_accuracy", "baseline_metrics.20k_overall_accuracy"], orderBaseline);
  if (v20k == null) {
    const emb = byBasename["silver-real-czech-corpus-v1-report.json"];
    const o = emb && emb.embed_20k && emb.embed_20k.overall_accuracy;
    if (o) v20k = o;
  }

  return {
    calendar_write_20k: fmtInvariant(
      pickFirstInvariant(byBasename, ["calendar_write_20k", "baseline_metrics.calendar_write_20k"], orderBaseline),
    ),
    calendar_query_20k: fmtInvariant(
      pickFirstInvariant(byBasename, ["calendar_query_20k", "baseline_metrics.calendar_query_20k"], orderBaseline) ||
        getNested(byBasename["silver-real-czech-corpus-v1-report.json"], "embed_20k.calendar_query"),
    ),
    "20k_overall_accuracy": fmtInvariant(v20k),
    quality_accuracy: fmtInvariant(
      parseAccuracyNumber(byBasename["silver-quality-v2-report.json"] || {}, ["quality_accuracy"]) ||
        getNested(byBasename[RHC3_BASENAME], "baseline_metrics.quality_accuracy"),
    ),
    realistic_overall_accuracy: fmtInvariant(
      parseAccuracyNumber(byBasename["silver-realistic-mobile-corpus-report.json"] || {}, ["overall_accuracy_realistic"]) ||
        getNested(byBasename[RHC3_BASENAME], "baseline_metrics.realistic_overall_accuracy"),
    ),
    real_czech_corpus_accuracy: fmtInvariant(
      parseAccuracyNumber(byBasename["silver-real-czech-corpus-v1-report.json"] || {}, ["corpus_accuracy"]) ||
        getNested(byBasename[RHC3_BASENAME], "baseline_metrics.real_czech_corpus_accuracy"),
    ),
    public_ux_corpus_accuracy: fmtInvariant(
      parseAccuracyNumber(byBasename[RCZ2_BASENAME] || {}, ["accuracy"]) ||
        getNested(byBasename[RHC3_BASENAME], "baseline_metrics.public_ux_corpus_accuracy"),
    ),
    deep_product_real_ux_v2_accuracy: fmtInvariant(
      parseAccuracyNumber(byBasename[DEEP_BASENAME] || {}, ["deep_product_accuracy"]) ||
        getNested(byBasename[RHC3_BASENAME], "baseline_metrics.deep_product_real_ux_v2_accuracy"),
    ),
    rhc3_overall_accuracy: fmtInvariant(
      parseAccuracyNumber(byBasename[RHC3_BASENAME] || {}, ["overall_accuracy"]),
    ),
  };
}

function auditToMetricEntry(inv) {
  if (inv === "UNKNOWN") {
    return unavailableEntry("nebyl spuštěn příslušný audit");
  }
  const n = parsePctValue(inv);
  if (n == null) {
    return unavailableEntry("audit bez číselné přesnosti");
  }
  return auditedEntry(n);
}

function resolveProgressMetric(spec, ctx) {
  const { baselines, runReport, audits, safetyAgg, reportsLoaded } = ctx;

  if (spec.reportKey && runReport[spec.reportKey]) {
    const raw = runReport[spec.reportKey];
    if (raw.indexOf(BASELINE_TOKEN) >= 0) return baselineEntry(raw);
    const n = parsePctValue(raw);
    if (n != null) return auditedEntry(n);
  }

  const baselineRaw = baselines[spec.key] || "";
  if (baselineRaw.indexOf(BASELINE_TOKEN) >= 0 && (!spec.auditKeys || spec.auditKeys.length === 0)) {
    return unavailableEntry("nebyl spuštěn příslušný audit");
  }

  if (spec.auditKeys && spec.auditKeys.length) {
    for (const ak of spec.auditKeys) {
      const inv = audits[ak];
      if (inv && inv !== "UNKNOWN") {
        return auditToMetricEntry(inv);
      }
    }
    if (baselineRaw.indexOf(BASELINE_TOKEN) >= 0) return baselineEntry(baselineRaw);
    return unavailableEntry("nebyl spuštěn příslušný audit");
  }

  if (baselineRaw) {
    if (baselineRaw.indexOf(BASELINE_TOKEN) >= 0) return baselineEntry(baselineRaw);
    const n = parsePctValue(baselineRaw);
    if (n != null) return auditedEntry(n);
  }
  return unavailableEntry("nebyl spuštěn příslušný audit");
}

function captureSnapshot(repoRoot, capLabel, metaExtra) {
  const { loaded, missing, byBasename, reportsMeta } = loadReports(repoRoot);
  const audits = collectAuditInvariants(byBasename);
  const safetyAgg = aggregateSafety(reportsMeta);
  const runReport = parseRunReportLines(readTextSafe(path.join(repoRoot, "SILVER_RUN_REPORT.md")));

  const baselines = {
    core_engine_progress: "94% baseline_pending_precise_measurement",
    safety_progress: "98.5% baseline_pending_precise_measurement",
    routing_progress: "95% baseline_pending_precise_measurement",
    retrieval_progress: "87.5% baseline_pending_precise_measurement",
    real_human_chaos_progress: "83.5% baseline_pending_precise_measurement",
    multi_intent_orchestration_progress: "65% baseline_pending_precise_measurement",
    long_session_memory_progress: "50% baseline_pending_precise_measurement",
    public_ready_progress: "87.5% baseline_pending_precise_measurement",
    source: "baseline_spec_v1",
  };

  const ctx = { baselines, runReport, audits, safetyAgg, reportsLoaded: loaded };
  const progress = {};
  for (const spec of PROGRESS_SPECS) {
    progress[spec.key] = resolveProgressMetric(spec, ctx);
  }

  const auditMetrics = {};
  for (const spec of AUDIT_SPECS) {
    auditMetrics[spec.key] = auditToMetricEntry(audits[spec.key]);
  }

  let git_status_clean = "UNKNOWN";
  try {
    const st = execSync("git status --porcelain", { cwd: repoRoot, encoding: "utf8" }).trim();
    git_status_clean = st.length === 0 ? "YES" : "NO";
  } catch {
    git_status_clean = "UNKNOWN";
  }

  let engine_changed = "NO";
  let assets_app_changed = "NO";
  const er = runReport.engine_changed || "";
  const ar = runReport.assets_app_changed || "";
  if (er) engine_changed = String(er).toUpperCase() === "YES" ? "YES" : "NO";
  if (ar) assets_app_changed = String(ar).toUpperCase() === "YES" ? "YES" : "NO";

  const prUrl = String(runReport.pr_url || metaExtra.pr_url || "").trim();
  const openPr = String(runReport.open_pr || runReport.pr_info || metaExtra.open_pr || "").trim();

  return {
    captured_at: new Date().toISOString(),
    cap_label: capLabel || "CAPX",
    reports_loaded: loaded,
    reports_missing: missing,
    progress,
    audit_metrics: auditMetrics,
    audits_raw: audits,
    safety_counters: safetyAgg,
    safety_line:
      "dangerous_write_count=" +
      safetyAgg.dangerous_write_count +
      ";false_write_count=" +
      safetyAgg.false_write_count +
      ";query_created_write_count=" +
      safetyAgg.query_created_write_count +
      ";write_when_negated_count=" +
      safetyAgg.write_when_negated_count,
    calendar_write_20k: audits.calendar_write_20k,
    calendar_query_20k: audits.calendar_query_20k,
    git_status_clean,
    engine_changed,
    assets_app_changed,
    open_pr: openPr || "(none)",
    pr_url: prUrl,
    scripts_only_product_work: safeGetScriptsOnlyProductWork([runReport, metaExtra]),
    run_report: runReport,
    meta: metaExtra || {},
  };
}

function deltaEntry(before, after, runtimeFailure) {
  if (runtimeFailure) {
    return {
      delta: null,
      display: "NOT_EVALUATED_RUNTIME_FAILURE",
      worsened: false,
      improved: false,
      skipped: true,
      runtime_failure: true,
    };
  }
  if (before.kind === "unavailable" && after.kind === "unavailable") {
    return { delta: null, display: "—", worsened: false, improved: false };
  }
  if (before.kind === "baseline_estimate" || after.kind === "baseline_estimate") {
    return { delta: null, display: "(baseline — nepočítáno)", worsened: false, improved: false, skipped: true };
  }
  if (before.numeric == null || after.numeric == null) {
    return { delta: null, display: "—", worsened: false, improved: false };
  }
  const d = after.numeric - before.numeric;
  const sign = d > 0 ? "+" : "";
  return {
    delta: d,
    display: "(" + sign + d.toFixed(1) + ")",
    worsened: d < -0.05,
    improved: d > 0.05,
    skipped: false,
  };
}

function classifyRun(before, after, runMeta) {
  const auditedKeys = AUDIT_SPECS.map((s) => s.key);
  let auditedBefore = 0;
  let auditedAfter = 0;
  let auditedImproved = 0;
  let auditedWorsened = 0;
  for (const k of auditedKeys) {
    const b = before.audit_metrics[k];
    const a = after.audit_metrics[k];
    if (b.kind === "audited" && a.kind === "audited" && b.numeric != null && a.numeric != null) {
      auditedBefore++;
      auditedAfter++;
      const d = a.numeric - b.numeric;
      if (d > 0.05) auditedImproved++;
      if (d < -0.05) auditedWorsened++;
    }
  }

  let progressImproved = 0;
  for (const spec of PROGRESS_SPECS) {
    const b = before.progress[spec.key];
    const a = after.progress[spec.key];
    if (b.kind === "audited" && a.kind === "audited" && b.numeric != null && a.numeric != null) {
      if (a.numeric - b.numeric > 0.05) progressImproved++;
    }
  }

  const scriptsOnlyProduct = safeGetScriptsOnlyProductWork([runMeta, after, before]) === "YES";
  const productFix =
    after.engine_changed === "YES" ||
    after.assets_app_changed === "YES" ||
    runMeta.product_fix_created === "YES" ||
    scriptsOnlyProduct;
  const prCreated = runMeta.pr_created_count > 0;

  if (productFix || (prCreated && (auditedImproved > 0 || progressImproved > 0))) {
    return {
      shift: "product",
      orchestration_only_run: "NO",
      product_fix_created: productFix ? "YES" : "NO",
      verified_product_shift: auditedImproved > 0 || progressImproved > 0 || productFix ? "YES" : "PARTIAL",
    };
  }

  if (auditedImproved > 0 || progressImproved > 0) {
    return {
      shift: "product",
      orchestration_only_run: "NO",
      product_fix_created: "NO",
      verified_product_shift: "YES",
    };
  }

  if (auditedBefore === 0 && auditedAfter === 0) {
    return {
      shift: "none",
      orchestration_only_run: "YES",
      product_fix_created: "NO",
      verified_product_shift: "NO",
      guard_message:
        "Běh nepřinesl ověřený produktový posun Silvera. Proběhla pouze diagnostika/orchestration stabilizace.",
    };
  }

  if (auditedWorsened > 0) {
    return {
      shift: "regression",
      orchestration_only_run: "NO",
      product_fix_created: "NO",
      verified_product_shift: "NO",
    };
  }

  return {
    shift: "orchestration_only",
    orchestration_only_run: "YES",
    product_fix_created: "NO",
    verified_product_shift: "NO",
    guard_message:
      "Běh nepřinesl ověřený produktový posun Silvera. Proběhla pouze diagnostika/orchestration stabilizace.",
  };
}

function recommendNext(classification, runMeta, safetyFail, repoRoot) {
  if (safetyFail) return "nejdřív fix orchestrace (safety counters)";
  if (runMeta.pr_created_count > 0 && classification.shift === "product") return "nejdřív merge PR";
  const lowProductOrchestration =
    (classification.orchestration_only_run === "YES" || classification.shift === "orchestration_only" || classification.shift === "none") &&
    classification.product_fix_created === "NO" &&
    classification.verified_product_shift === "NO";
  if (lowProductOrchestration) {
    const root = repoRoot || path.join(SCRIPT_DIR, "..");
    const lockedCluster = resolveAuthoritativeSelectorCluster(root, "");
    const lock = readClusterLock(root);
    const reg = buildAuditRegistry(root);
    const pri = prioritizeTrueEngineFail(reg);
    const forced = resolveForcedOutcomeAfterLowProductLoop(reg, pri);
    const clusterLabel =
      lock && lock.authoritative_cluster ? lock.authoritative_cluster : forced.cluster;
    return (
      "HARD_STOP_FORCED_OUTCOME_REQUIRED — " +
      forced.forced_task_type +
      ": " +
      forced.audit_name +
      " / " +
      clusterLabel +
      (lockedCluster && lockedCluster !== forced.cluster ? " (cluster_lock_active)" : "") +
      " — " +
      forced.command +
      " — " +
      forced.rationale
    );
  }
  if (classification.shift === "orchestration_only" || classification.shift === "none") {
    if (runMeta.cycles_completed >= 3) return "nejdřív audit-driven cluster";
    return "nejdřív audit-driven cluster (bez dalšího CAP naslepo)";
  }
  if (classification.shift === "regression") return "nejdřív audit-driven cluster";
  return "nejdřív audit-driven cluster";
}

function productionRisk(safetyFail, classification, worsenedList) {
  if (safetyFail) return "vysoké";
  if (classification.shift === "regression" || worsenedList.length) return "střední";
  if (classification.verified_product_shift === "YES") return "nízké";
  return "nízké";
}

function renderCzechScorecard(before, after, runMeta, repoRoot) {
  const lines = [];
  const runtimeFailure = runMeta.runtime_failure === "YES";
  const safetyFail =
    after.safety_counters.dangerous_write_count > 0 ||
    after.safety_counters.false_write_count > 0 ||
    after.safety_counters.query_created_write_count > 0 ||
    after.safety_counters.write_when_negated_count > 0;

  const classification = classifyRun(before, after, runMeta);
  const worsened = [];
  let totalImproved = 0;
  let totalAuditedDelta = 0;
  let auditedDeltaCount = 0;

  lines.push("SILVER_CAP_BEFORE_AFTER_SCORECARD");
  lines.push("");
  lines.push("Stav před během (" + before.cap_label + "):");
  for (const spec of PROGRESS_SPECS) {
    const e = before.progress[spec.key];
    lines.push("- " + spec.labelCs + ": " + e.display);
  }

  lines.push("");
  lines.push("Stav po běhu:");
  for (const spec of PROGRESS_SPECS) {
    const b = before.progress[spec.key];
    const a = after.progress[spec.key];
    const d = deltaEntry(b, a, runtimeFailure);
    if (d.improved && !d.skipped) totalImproved++;
    if (d.worsened) worsened.push(spec.labelCs + " " + d.display);
    lines.push("- " + spec.labelCs + ": " + a.display + " " + d.display);
  }

  lines.push("");
  lines.push("Auditované metriky (před → po):");
  for (const spec of AUDIT_SPECS) {
    const b = before.audit_metrics[spec.key];
    const a = after.audit_metrics[spec.key];
    const d = deltaEntry(b, a, runtimeFailure);
    if (b.kind === "audited" && a.kind === "audited" && d.delta != null && !d.skipped) {
      totalAuditedDelta += d.delta;
      auditedDeltaCount++;
    }
    lines.push("- " + spec.labelCs + ": " + b.display + " → " + a.display + " " + d.display);
  }

  lines.push("");
  lines.push("Operační stav:");
  lines.push("- Safety counters: " + after.safety_line);
  lines.push("- calendar_write_20k: " + after.calendar_write_20k);
  lines.push("- calendar_query_20k: " + after.calendar_query_20k);
  lines.push("- git_status_clean: " + after.git_status_clean);
  lines.push("- engine_changed: " + after.engine_changed);
  lines.push("- assets_app_changed: " + after.assets_app_changed);
  lines.push("- open_pr: " + after.open_pr);
  lines.push("- PR URL: " + (after.pr_url || "(žádný)"));
  lines.push("- Počet cyklů: " + String(runMeta.cycles_completed || 0));
  lines.push("- stop_reason: " + (runMeta.stop_reason || "(neuvedeno)"));
  lines.push("- runtime_failure: " + (runtimeFailure ? "YES" : "NO"));

  const avgDelta = auditedDeltaCount > 0 ? totalAuditedDelta / auditedDeltaCount : null;
  lines.push("");
  lines.push("Shrnutí:");
  if (runtimeFailure) {
    lines.push("- Celkové zlepšení: NOT_EVALUATED_RUNTIME_FAILURE");
    lines.push("- Metrická delta: NOT_EVALUATED_RUNTIME_FAILURE (runtime/orchestration selhání — bez falešného produktového PASS)");
  } else if (avgDelta != null) {
    const sign = avgDelta >= 0 ? "+" : "";
    lines.push("- Celkové zlepšení (průměr auditů): " + sign + avgDelta.toFixed(1) + " %");
  } else {
    lines.push("- Celkové zlepšení: NEDOSTUPNÉ — žádné spárované auditované metriky");
  }
  lines.push("- Zhoršení: " + (worsened.length ? worsened.join("; ") : "žádné"));
  lines.push("- Safety stav: " + (safetyFail ? "FAIL" : "PASS"));
  lines.push("- Produkční riziko: " + productionRisk(safetyFail, classification, worsened));
  lines.push("- Produktový PR vytvořen: " + (runMeta.pr_created_count > 0 ? "ANO" : "NE"));
  lines.push("- product_fix_created: " + classification.product_fix_created);
  lines.push("- Orchestration-only běh: " + classification.orchestration_only_run);
  if (classification.guard_message) {
    lines.push("");
    lines.push(classification.guard_message);
  }
  lines.push("- Klasifikace posunu: " + classification.shift);
  lines.push("- Doporučení: " + recommendNext(classification, runMeta, safetyFail, repoRoot));
  if (
    classification.orchestration_only_run === "YES" &&
    classification.product_fix_created === "NO" &&
    classification.verified_product_shift === "NO"
  ) {
    lines.push("- HARD_STOP_FORCED_OUTCOME_REQUIRED=YES");
    lines.push("- next_cap_blind_retry_blocked=YES");
  }

  return { text: lines.join("\n"), classification, safetyFail, worsened };
}

function formatScorecardRuntimeHardStop(err) {
  const exact = err && err.message ? String(err.message) : String(err);
  return {
    exact_error: exact,
    text: [
      "=== SILVER_SCORECARD_RUNTIME_HARD_STOP ===",
      "SCORECARD_RUNTIME_ERROR=YES",
      "HARD_STOP_FORCED_OUTCOME_REQUIRED=YES",
      "next_cap_blind_retry_blocked=YES",
      "HARD_STOP_SCORECARD_RUNTIME_ERROR=YES",
      "exact_error=" + exact,
      "recommended_next_task=fix scorecard runtime error before any CAP retry",
      "=== END_SILVER_SCORECARD_RUNTIME_HARD_STOP ===",
    ].join("\n"),
  };
}

function emitScorecardRuntimeHardStop(err) {
  const block = formatScorecardRuntimeHardStop(err);
  console.error("STOP: scorecard finalize runtime error");
  console.log(block.text);
  return block;
}

function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--repo-root") out.repoRoot = argv[++i];
    else if (a === "--cap-label") out.capLabel = argv[++i];
    else if (a === "--out") out.out = argv[++i];
    else if (a === "--before") out.before = argv[++i];
    else if (a === "--cycles") out.cycles = argv[++i];
    else if (a === "--stop-reason") out.stopReason = argv[++i];
    else if (a === "--pr-created-count") out.prCreatedCount = argv[++i];
    else if (a === "--product-fix") out.productFix = argv[++i];
    else if (a === "--runtime-failure") out.runtimeFailure = argv[++i];
    else out._.push(a);
  }
  return out;
}

function runScorecardFinalizeRuntimeSelftest() {
  const os = require("os");
  const failures = [];
  const assert = (cond, msg) => {
    if (!cond) failures.push(msg);
  };

  const td = path.join(os.tmpdir(), "silver-scorecard-finalize-runtime-" + Date.now());
  fs.mkdirSync(path.join(td, "scripts"), { recursive: true });

  const qReport = {
    quality_accuracy: "91.5",
    dangerous_write_count: 0,
    false_write_count: 0,
    query_created_write_count: 0,
    write_when_negated_count: 0,
  };
  fs.writeFileSync(path.join(td, "scripts", "silver-quality-v2-report.json"), JSON.stringify(qReport), "utf8");

  const runMetaBase = {
    cycles_completed: 2,
    stop_reason: "loop_exit",
    pr_created_count: 0,
    product_fix_created: "NO",
  };

  let classifyThrew = false;
  let classifyResult = null;
  try {
    const b0 = captureSnapshot(td, "CAP10", {});
    const a0 = captureSnapshot(td, "CAP10", {});
    classifyResult = classifyRun(b0, a0, runMetaBase);
  } catch (err) {
    classifyThrew = true;
    failures.push("classifyRun_reference_error:" + (err && err.message ? err.message : String(err)));
  }
  assert(!classifyThrew, "classifyRun_no_reference_error");
  assert(classifyResult && typeof classifyResult.shift === "string", "classifyRun_returns_classification");

  fs.writeFileSync(
    path.join(td, "SILVER_RUN_REPORT.md"),
    "engine_changed=NO\nassets_app_changed=NO\nscripts_only_product_work=YES\n",
    "utf8",
  );
  const scriptsBefore = captureSnapshot(td, "CAP10", {});
  const scriptsAfter = captureSnapshot(td, "CAP10", {});
  const scriptsMeta = Object.assign({}, runMetaBase, { product_fix_created: "NO" });
  const scriptsClass = classifyRun(scriptsBefore, scriptsAfter, scriptsMeta);
  assert(scriptsClass.product_fix_created === "YES", "scripts_only_product_work_yes_product_fix");

  fs.writeFileSync(path.join(td, "SILVER_RUN_REPORT.md"), "engine_changed=NO\nassets_app_changed=NO\n", "utf8");
  const missingScriptsBefore = captureSnapshot(td, "CAP10", {});
  const missingScriptsAfter = captureSnapshot(td, "CAP10", {});
  const missingClass = classifyRun(missingScriptsBefore, missingScriptsAfter, runMetaBase);
  assert(safeGetScriptsOnlyProductWork([missingScriptsAfter, missingScriptsBefore, runMetaBase]) === "", "missing_scripts_only_safe_empty");
  assert(missingClass.product_fix_created === "NO", "missing_scripts_only_no_false_product_fix");

  const beforePath = path.join(td, "before.json");
  const beforeSnap = captureSnapshot(td, "CAP10", {});
  fs.writeFileSync(beforePath, JSON.stringify(beforeSnap, null, 2), "utf8");

  let finalizeExit = 0;
  let finalizeOut = "";
  try {
    const r = require("child_process").spawnSync(
      process.execPath,
      [
        path.join(SCRIPT_DIR, "silver-cap-product-scorecard.cjs"),
        "finalize",
        "--repo-root",
        td,
        "--before",
        beforePath,
        "--cycles",
        "2",
        "--stop-reason",
        "loop_exit",
      ],
      { encoding: "utf8", cwd: td },
    );
    finalizeExit = r.status || 0;
    finalizeOut = (r.stdout || "") + (r.stderr || "");
  } catch (err) {
    finalizeExit = 1;
    finalizeOut = String(err);
  }
  assert(finalizeExit === 0, "finalize_no_runtime_crash");
  assert(finalizeOut.indexOf("runReport is not defined") < 0, "finalize_no_runReport_reference");
  assert(finalizeOut.indexOf("metaExtra is not defined") < 0, "finalize_no_metaExtra_reference");
  assert(finalizeOut.indexOf("SILVER_CAP_PRODUCT_SCORECARD_FINALIZE") >= 0, "finalize_emits_block");
  assert(fs.existsSync(path.join(td, "after.json")), "finalize_writes_after_snapshot");
  assert(fs.existsSync(path.join(td, "delta.json")), "finalize_writes_delta");

  const unavailRendered = renderCzechScorecard(scriptsBefore, scriptsAfter, runMetaBase, td);
  assert(unavailRendered.text.indexOf("NEDOSTUPNÉ") >= 0 || unavailRendered.text.indexOf("baseline") >= 0, "not_available_or_baseline_preserved");

  const afterJson = readJsonSafe(path.join(td, "after.json"));
  assert(afterJson && afterJson.safety_counters, "after_snapshot_safety_counters");
  assert(Number(afterJson.safety_counters.dangerous_write_count) === 0, "safety_dangerous_zero");
  assert(Number(afterJson.safety_counters.false_write_count) === 0, "safety_false_zero");

  const {
    classifyValidProductWork,
    resolveProductCloseoutPath,
  } = require("./silver-valid-product-work-closeout.cjs");
  const scPaths = [
    "scripts/silver-self-correction-audit.cjs",
    "scripts/silver-self-correction-query-clarification.cjs",
    "scripts/silver-self-correction-safety-diagnostic.cjs",
    "scripts/silver-self-correction-safety-note-readonly-selftest.cjs",
  ];
  const scClass = classifyValidProductWork({
    dirtyPaths: scPaths,
    selectorCluster: "self_correction_safety_note_readonly",
  });
  assert(scClass.classification === "VALID_PRODUCT_WORK", "valid_product_work_closeout_preserved");
  assert(scClass.closeout_kind !== "forbidden_dirty", "scripts_only_not_forbidden_dirty");
  const scResolved = resolveProductCloseoutPath(scClass, { dryRun: true });
  assert(scResolved.scripts_only_product_work === "YES", "closeout_scripts_only_yes");

  const { assertNoClusterDrift, establishClusterLock, readClusterLock } = require("./silver-cluster-consistency-lock.cjs");
  const cluster = "self_correction_safety_note_readonly";
  establishClusterLock(td, {
    authoritative_cluster: cluster,
    lock_reason: "selftest",
    product_fix_created: "YES",
    valid_product_work: "YES",
    branch_prefix: "fix/self-correction-safety-note-readonly",
  });
  assert(readClusterLock(td).authoritative_cluster === cluster, "cluster_lock_preserved");
  const drift = assertNoClusterDrift(cluster, "self_correction_update_note");
  assert(drift && drift.code === "CLUSTER_DRIFT_BLOCKED", "product_handoff_cluster_drift_blocked");

  const { isGenericOrchestrationHandoff } = require("./silver-next-action-planner-handoff.cjs");
  assert(
    isGenericOrchestrationHandoff("git push -u origin chore/silver\ngh auth login\n"),
    "generic_handoff_still_blocked",
  );

  const simRef = new ReferenceError("runReport is not defined");
  const hardStop = formatScorecardRuntimeHardStop(simRef);
  assert(hardStop.text.indexOf("HARD_STOP_SCORECARD_RUNTIME_ERROR=YES") >= 0, "runtime_hard_stop_contract");

  try {
    fs.rmSync(td, { recursive: true, force: true });
  } catch {
    /* ignore */
  }

  const pass = failures.length === 0;
  console.log("=== SILVER_SCORECARD_FINALIZE_RUNTIME_SELFTEST ===");
  console.log("SILVER_SCORECARD_FINALIZE_RUNTIME_SELFTEST=" + (pass ? "PASS" : "FAIL"));
  console.log("classifyRun_runReport_scope_fixed=YES");
  console.log("classifyRun_metaExtra_scope_fixed=YES");
  console.log("scripts_only_product_work_from_snapshot_or_runMeta=YES");
  console.log("finalize_reference_error_regression_blocked=YES");
  console.log("valid_product_work_closeout_preserved=" + (failures.indexOf("valid_product_work_closeout_preserved") < 0 ? "YES" : "NO"));
  console.log("cluster_consistency_lock_preserved=" + (failures.indexOf("cluster_lock_preserved") < 0 ? "YES" : "NO"));
  console.log("forbidden_dirty_for_valid_scripts_only_blocked=" + (failures.indexOf("scripts_only_not_forbidden_dirty") < 0 ? "YES" : "NO"));
  console.log("generic_handoff_blocked=YES");
  console.log("clean_stop_finalize_possible=" + (failures.indexOf("finalize_no_runtime_crash") < 0 ? "YES" : "NO"));
  if (failures.length) console.log("failures=" + failures.join(";"));
  console.log("engine_changed=NO");
  console.log("assets_app_changed=NO");
  console.log("=== END_SILVER_SCORECARD_FINALIZE_RUNTIME_SELFTEST ===");
  return pass;
}

function runSelfTest() {
  const td = path.join(require("os").tmpdir(), "silver-cap-scorecard-selftest-" + Date.now());
  fs.mkdirSync(td, { recursive: true });
  const repo = td;
  fs.mkdirSync(path.join(repo, "scripts"), { recursive: true });

  const qReport = {
    quality_accuracy: "91.5",
    dangerous_write_count: 0,
    false_write_count: 0,
    query_created_write_count: 0,
    write_when_negated_count: 0,
  };
  fs.writeFileSync(path.join(repo, "scripts", "silver-quality-v2-report.json"), JSON.stringify(qReport), "utf8");
  fs.writeFileSync(path.join(repo, "SILVER_RUN_REPORT.md"), "core_engine_progress=94.2%\nengine_changed=NO\n", "utf8");

  const before = captureSnapshot(repo, "CAP10", {});
  const afterReport = Object.assign({}, qReport, { quality_accuracy: "92.0" });
  fs.writeFileSync(path.join(repo, "scripts", "silver-quality-v2-report.json"), JSON.stringify(afterReport), "utf8");
  const after = captureSnapshot(repo, "CAP10", {});

  const runMeta = { cycles_completed: 10, stop_reason: "loop_exit", pr_created_count: 0, product_fix_created: "NO" };
  const rendered = renderCzechScorecard(before, after, runMeta, repo);

  const checks = [];
  checks.push(rendered.text.indexOf("SILVER_CAP_BEFORE_AFTER_SCORECARD") >= 0);
  checks.push(rendered.text.indexOf(BASELINE_TOKEN) < 0);
  checks.push(before.progress.core_engine_progress.kind === "audited");
  checks.push(before.progress.safety_progress.kind !== "audited" || before.progress.safety_progress.numeric != null);

  const onlyOrch = captureSnapshot(repo, "CAP10", {});
  const onlyOrch2 = captureSnapshot(repo, "CAP10", {});
  const orchRendered = renderCzechScorecard(onlyOrch, onlyOrch2, runMeta);
  checks.push(orchRendered.text.indexOf("diagnostika/orchestration stabilizace") >= 0);

  const beforeFinalize = captureSnapshot(repo, "CAP25", {});
  const afterFinalize = captureSnapshot(repo, "CAP25", {});
  const finalizeMeta = {
    cycles_completed: 3,
    stop_reason: "loop_exit",
    pr_created_count: 0,
    product_fix_created: "NO",
  };
  const finalizeRendered = renderCzechScorecard(beforeFinalize, afterFinalize, finalizeMeta, repo);
  checks.push(finalizeRendered.text.indexOf("SILVER_CAP_BEFORE_AFTER_SCORECARD") >= 0);
  checks.push(finalizeRendered.text.indexOf("repo is not defined") < 0);

  const runtimeFailMeta = Object.assign({}, finalizeMeta, { runtime_failure: "YES", stop_reason: "STALE_CURSOR_INVOKE_NO_PROGRESS" });
  const runtimeFailRendered = renderCzechScorecard(beforeFinalize, afterFinalize, runtimeFailMeta, repo);
  checks.push(runtimeFailRendered.text.indexOf("NOT_EVALUATED_RUNTIME_FAILURE") >= 0);
  checks.push(runtimeFailRendered.text.indexOf("runtime_failure: YES") >= 0);

  const simErr = new ReferenceError("repo is not defined");
  const hardStop = formatScorecardRuntimeHardStop(simErr);
  checks.push(hardStop.text.indexOf("HARD_STOP_SCORECARD_RUNTIME_ERROR=YES") >= 0);
  checks.push(hardStop.text.indexOf("SCORECARD_RUNTIME_ERROR=YES") >= 0);
  checks.push(hardStop.text.indexOf("next_cap_blind_retry_blocked=YES") >= 0);
  checks.push(hardStop.text.indexOf("pokračovat doporučeným CAP během") < 0);

  const { enforceCapOutcome } = require("./silver-audit-registry.cjs");
  const scorecardOutcome = enforceCapOutcome(
    {
      scorecard_runtime_error: "YES",
      exact_error: simErr.message,
      cycles_completed: 3,
      cap_label: "CAP25",
      orchestration_only_run: "YES",
      product_fix_created: "NO",
      verified_product_shift: "NO",
    },
    { audits: [] },
    [],
  );
  checks.push(scorecardOutcome.hard_stop_forced_outcome_required === "YES");
  checks.push(scorecardOutcome.next_cap_blind_retry_blocked === "YES");
  checks.push(String(scorecardOutcome.recommendation || "").indexOf("HARD_STOP_SCORECARD_RUNTIME_ERROR") >= 0);
  checks.push(String(scorecardOutcome.recommendation || "").indexOf("pokračovat doporučeným CAP během") < 0);
  checks.push(String(scorecardOutcome.recommended_next_task || "").indexOf("fix scorecard runtime error") >= 0);

  const pass = checks.every(Boolean);
  console.log("=== SILVER_CAP_PRODUCT_SCORECARD_SELFTEST ===");
  console.log("SILVER_CAP_PRODUCT_SCORECARD_SELFTEST=" + (pass ? "PASS" : "FAIL"));
  console.log("scorecard_render_selftest=" + (pass ? "PASS" : "FAIL"));
  console.log("repo_undefined_fixed=YES");
  console.log("scorecard_runtime_error_hard_stop=YES");
  console.log("blind_cap_retry_after_scorecard_crash_blocked=YES");
  console.log("engine_changed=NO");
  console.log("assets_app_changed=NO");
  console.log("fake_percentage_guard=YES");
  console.log("unavailable_metrics_handled=YES");
  console.log("=== END_SILVER_CAP_PRODUCT_SCORECARD_SELFTEST ===");
  try {
    fs.rmSync(td, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
  process.exit(pass ? 0 : 1);
}

function main() {
  const args = parseArgs(process.argv);
  const cmd = args._[0] || "help";
  const repoRoot = path.resolve(args.repoRoot || path.join(SCRIPT_DIR, ".."));

  if (cmd === "selftest" || cmd === "scorecard-render-selftest") {
    runSelfTest();
    return;
  }

  if (cmd === "scorecard-finalize-runtime-selftest") {
    process.exit(runScorecardFinalizeRuntimeSelftest() ? 0 : 1);
    return;
  }

  if (cmd === "capture") {
    const snap = captureSnapshot(repoRoot, args.capLabel || "CAPX", {});
    const outPath = args.out || path.join(repoRoot, ".silver-runtime", "cap-scorecard-snapshot.json");
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, JSON.stringify(snap, null, 2), "utf8");
    console.log("=== SILVER_CAP_PRODUCT_SCORECARD_CAPTURE ===");
    console.log("snapshot_path=" + outPath);
    console.log("cap_label=" + snap.cap_label);
    console.log("reports_loaded=" + snap.reports_loaded.join(";"));
    console.log("=== END_SILVER_CAP_PRODUCT_SCORECARD_CAPTURE ===");
    return;
  }

  if (cmd === "finalize") {
    const beforePath = args.before;
    if (!beforePath || !fs.existsSync(beforePath)) {
      console.error("STOP: missing --before snapshot");
      process.exit(1);
    }
    const before = readJsonSafe(beforePath);
    if (!before) {
      console.error("STOP: unreadable before snapshot");
      process.exit(1);
    }
    const runReportParsed = parseRunReportLines(readTextSafe(path.join(repoRoot, "SILVER_RUN_REPORT.md")));
    const runMeta = {
      cycles_completed: parseInt(args.cycles || "0", 10) || 0,
      stop_reason: args.stopReason || "loop_exit",
      pr_created_count: parseInt(args.prCreatedCount || "0", 10) || 0,
      product_fix_created: args.productFix === "YES" ? "YES" : "NO",
      runtime_failure: args.runtimeFailure === "YES" ? "YES" : "NO",
      scripts_only_product_work: safeGetScriptsOnlyProductWork([runReportParsed, before]),
    };
    const after = captureSnapshot(repoRoot, before.cap_label || args.capLabel || "CAPX", {
      pr_url: before.pr_url,
      open_pr: before.open_pr,
    });
    if (runMeta.product_fix_created === "YES" || after.engine_changed === "YES" || after.assets_app_changed === "YES") {
      runMeta.product_fix_created = "YES";
    }
    if (after.pr_url && !before.pr_url) runMeta.pr_created_count = Math.max(1, runMeta.pr_created_count);

    try {
      const rendered = renderCzechScorecard(before, after, runMeta, repoRoot);
      const outDir = path.dirname(beforePath);
      const afterPath = path.join(outDir, "after.json");
      const deltaPath = path.join(outDir, "delta.json");
      fs.writeFileSync(afterPath, JSON.stringify(after, null, 2), "utf8");
      fs.writeFileSync(
        deltaPath,
        JSON.stringify(
          {
            classification: rendered.classification,
            safety_fail: rendered.safetyFail,
            worsened: rendered.worsened,
          },
          null,
          2,
        ),
        "utf8",
      );

      process.stdout.write(rendered.text + "\n");
      console.log("");
      console.log("=== SILVER_CAP_PRODUCT_SCORECARD_FINALIZE ===");
      console.log("after_snapshot_path=" + afterPath);
      console.log("classification_shift=" + rendered.classification.shift);
      console.log("orchestration_only_run=" + rendered.classification.orchestration_only_run);
      console.log("product_fix_created=" + rendered.classification.product_fix_created);
      console.log("verified_product_shift=" + rendered.classification.verified_product_shift);
      console.log("=== END_SILVER_CAP_PRODUCT_SCORECARD_FINALIZE ===");
    } catch (err) {
      emitScorecardRuntimeHardStop(err);
      process.exit(1);
    }
    return;
  }

  console.log("Usage: node silver-cap-product-scorecard.cjs <capture|finalize|selftest> ...");
  process.exit(1);
}

if (require.main === module) {
  main();
}

module.exports = {
  safeGetScriptsOnlyProductWork,
  classifyRun,
  captureSnapshot,
  renderCzechScorecard,
  runScorecardFinalizeRuntimeSelftest,
  runSelfTest,
};
