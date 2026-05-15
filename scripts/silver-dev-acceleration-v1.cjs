#!/usr/bin/env node
/**
 * Silver development acceleration layer V1 — scripts-only diagnostic aggregator.
 * Loads available Silver JSON reports under scripts/, never throws on missing/malformed files.
 */
"use strict";

const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const SCRIPT_DIR = __dirname;
const REPO_ROOT = path.join(SCRIPT_DIR, "..");

const REPORT_FILENAMES = [
  "silver-real-human-chaos-v3-report.json",
  "silver-real-czech-public-ux-corpus-v2-report.json",
  "silver-deep-product-real-ux-v2-report.json",
  "silver-realistic-mobile-corpus-report.json",
  "silver-quality-v2-report.json",
  "silver-real-czech-corpus-v1-report.json",
  "silver-real-czech-corpus-v1-30k-report.json",
  "silver-real-ux-v1-report.json",
];

const RHC3_BASENAME = "silver-real-human-chaos-v3-report.json";
const RCZ2_BASENAME = "silver-real-czech-public-ux-corpus-v2-report.json";
const DEEP_BASENAME = "silver-deep-product-real-ux-v2-report.json";

function readJsonSafe(absPath) {
  try {
    const raw = fs.readFileSync(absPath, "utf8");
    return JSON.parse(raw);
  } catch {
    return null;
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
      const t = String(obj[k]).trim();
      if (/^\d+(\.\d+)?$/.test(t)) return t;
    }
  }
  return null;
}

function getNested(obj, dotted) {
  if (!obj) return null;
  const parts = dotted.split(".");
  let cur = obj;
  for (const p of parts) {
    if (cur == null) return null;
    cur = cur[p];
  }
  return cur;
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
  const qcw = Math.max(
    pick("query_created_write_count"),
    pick("query_created_write_count_realistic"),
  );
  return {
    dangerous_write_count: pick("dangerous_write_count"),
    false_write_count: pick("false_write_count"),
    query_created_write_count: qcw,
    write_when_negated_count: pick("write_when_negated_count"),
  };
}

function parseClusterString(entry) {
  if (typeof entry !== "string") return null;
  const s = entry.trim();
  if (!s) return null;
  const lastColon = s.lastIndexOf(":");
  if (lastColon <= 0) return { name: s, count: 0 };
  const left = s.slice(0, lastColon);
  let right = s.slice(lastColon + 1);
  const slash = right.indexOf("/");
  if (slash >= 0) right = right.slice(0, slash);
  const count = parseInt(right, 10);
  return { name: left.trim(), count: Number.isFinite(count) ? count : 0 };
}

function examplesCountFrom(obj) {
  if (!obj || typeof obj !== "object") return 0;
  const keys = [
    "example_inputs",
    "replay",
    "examples",
    "sample_fails",
    "top_fail_examples",
  ];
  let max = 0;
  for (const k of keys) {
    const v = obj[k];
    if (Array.isArray(v)) max = Math.max(max, v.length);
  }
  return max;
}

function classifyRootCause(textBlob, safetyAgg, clusterName) {
  const t = strLower(textBlob + " " + clusterName);
  if (/engine_bug/.test(t) || /\bengine bug\b/.test(t)) return "ENGINE_BUG";
  if (/\bgold\b/.test(t) || /gold_/.test(t)) return "GOLD_PROBLEM";
  if (/\bharness\b/.test(t) || /harness_/.test(t) || /partial_cal|harness mismatch/.test(t)) return "HARNESS_BUG";
  if (/\btemplate\b/.test(t) || /\bdna\b/.test(t)) return "TEMPLATE_DNA_PROBLEM";
  if (/response_contract|contract_fail|remaining_response|note_create|uloz_poznamku|do_poznamek/.test(t)) return "RESPONSE_CONTRACT_PROBLEM";
  if (/ambiguous|ambiguity|clarify|clarification|disambigu/.test(t)) return "AMBIGUOUS_OK";
  if (/retrieval|fuzzy_note|false_negative|relevance|false negative|_retrieval/.test(t)) return "RETRIEVAL_PROBLEM";
  if (/mobile_voice|no_diacritics|filler_speech|dirty_czech|ascii_task/.test(t)) return "TEMPLATE_DNA_PROBLEM";
  if (/safety|negation|no_write|no-write|readonly|negated/.test(t)) {
    const anyBad =
      safetyAgg.dangerous_write_count > 0 ||
      safetyAgg.false_write_count > 0 ||
      safetyAgg.query_created_write_count > 0 ||
      safetyAgg.write_when_negated_count > 0;
    return anyBad ? "SAFETY_RISK" : "SAFETY_OK";
  }
  return "UNKNOWN";
}

function recommendedActionFor(rc) {
  switch (rc) {
    case "ENGINE_BUG":
      return "Run narrow engine diagnostic for the subpattern; avoid broad refactors.";
    case "GOLD_PROBLEM":
    case "HARNESS_BUG":
    case "TEMPLATE_DNA_PROBLEM":
    case "AMBIGUOUS_OK":
    case "RESPONSE_CONTRACT_PROBLEM":
      return "Scripts-only diagnostic and gold/harness/template alignment.";
    case "RETRIEVAL_PROBLEM":
      return "Retrieval-focused diagnostic first; no broad engine rewrite.";
    case "SAFETY_RISK":
      return "P0 safety triage and counter verification across harnesses.";
    case "SAFETY_OK":
      return "Continue Silver slice work; safety counters clean.";
    default:
      return "Collect more labeled fails or run targeted diagnostic script.";
  }
}

function recommendedScopeFor(rc) {
  switch (rc) {
    case "ENGINE_BUG":
      return "Narrow assets/app.js change only after diagnostic confirms engine bug.";
    case "RETRIEVAL_PROBLEM":
      return "Retrieval ranking and query-read paths; scripts-first replay.";
    case "SAFETY_RISK":
      return "Negation and write gates; verify harness expectations.";
    default:
      return "scripts/* diagnostics and corpus JSON; keep UI/CSS/backend untouched.";
  }
}

function productSeverityFrom(count, severityField) {
  if (severityField && typeof severityField === "string") return severityField;
  if (count >= 1500) return "P0";
  if (count >= 500) return "P1";
  if (count >= 100) return "P2";
  if (count > 0) return "P3";
  return "P4";
}

function collectClustersFromReport(basename, data) {
  const out = [];
  if (!data) return out;

  const pushOne = (name, count, extra) => {
    const n = String(name || "").trim();
    const c = Number(count);
    if (!n || !Number.isFinite(c) || c <= 0) return;
    out.push({
      source_report: basename,
      cluster_name: n,
      count: c,
      module: extra && extra.module ? extra.module : "",
      operation: extra && extra.operation ? extra.operation : "",
      suspected_root_cause: "",
      root_text: extra && extra.root_text ? extra.root_text : "",
      recommended_action: "",
      recommended_scope: extra && extra.recommended_scope ? extra.recommended_scope : "",
      product_severity: extra && extra.product_severity ? extra.product_severity : "",
      safety_severity: extra && extra.safety_severity ? extra.safety_severity : "",
      examples_count: extra && Number.isFinite(extra.examples_count) ? extra.examples_count : 0,
    });
  };

  const stringArrays = [
    data.top_fail_clusters,
    data.top_clusters,
  ];
  for (const arr of stringArrays) {
    if (!Array.isArray(arr)) continue;
    for (const item of arr) {
      if (typeof item === "string") {
        const p = parseClusterString(item);
        if (p) pushOne(p.name, p.count, { root_text: p.name });
      } else if (item && typeof item === "object") {
        const k = item.key || item.cluster_name || item.cluster || "";
        const c = item.count != null ? item.count : item.fail_count;
        const mod = item.affected_module || item.slice || item.module || "";
        const op = item.cat || item.operation || "";
        const rt = [item.root_cause, item.root_cause_guess, k, op].filter(Boolean).join(" ");
        const ex = examplesCountFrom(item);
        pushOne(k || op, c, {
          module: mod,
          operation: op,
          root_text: rt,
          recommended_scope: item.recommended_next_scope || "",
          product_severity: item.severity || "",
          examples_count: ex,
        });
      }
    }
  }

  const namedArrays = [
    data.top_25_fail_clusters,
    data.top_20_fail_clusters,
    data.top_10_fail_clusters,
  ];
  for (const arr of namedArrays) {
    if (!Array.isArray(arr)) continue;
    for (const item of arr) {
      if (!item || typeof item !== "object") continue;
      const name = item.cluster_name || item.cluster || item.key || "";
      const c = item.fail_count != null ? item.fail_count : item.count;
      const mod = item.affected_module || item.slice || "";
      const op = item.cat || "";
      const rt = [item.root_cause_guess, item.root_cause, name, op].filter(Boolean).join(" ");
      pushOne(name, c, {
        module: mod,
        operation: op,
        root_text: rt,
        recommended_scope: item.recommended_next_scope || "",
        product_severity: item.severity || "",
        examples_count: examplesCountFrom(item),
      });
    }
  }

  return out;
}

function mergeDuplicateClusters(rows) {
  const map = new Map();
  for (const r of rows) {
    const key = r.source_report + "\0" + r.cluster_name;
    const prev = map.get(key);
    if (!prev || r.count > prev.count) map.set(key, { ...r });
  }
  return Array.from(map.values());
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

function pickFirstInvariant(byBasename, keys, basenameOrder) {
  for (const bn of basenameOrder) {
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

function parsePct(s) {
  if (s == null || s === "UNKNOWN") return null;
  const t = String(s).replace("%", "").trim();
  if (!/^\d+(\.\d+)?$/.test(t)) return null;
  return parseFloat(t);
}

function rhc3TopDominantEngineSafety(rhc3Data, topRow) {
  if (!rhc3Data || !topRow) return false;
  const failTotal = Number(rhc3Data.fail_count);
  const c = topRow.count;
  const rc = topRow.suspected_root_cause;
  const frac = Number.isFinite(failTotal) && failTotal > 0 ? c / failTotal : 0;
  const dominant = c >= 200 || frac >= 0.08;
  if (!dominant) return false;
  return rc === "ENGINE_BUG" || rc === "SAFETY_RISK";
}

function decideNextTask(safetyFail, topThree, safetyAgg) {
  if (safetyFail) return "P0 SAFETY DIAGNOSTIC";
  const t1 = topThree[0];
  if (t1) {
    const rc = t1.suspected_root_cause;
    if (["GOLD_PROBLEM", "HARNESS_BUG", "TEMPLATE_DNA_PROBLEM", "AMBIGUOUS_OK", "RESPONSE_CONTRACT_PROBLEM"].includes(rc)) {
      return "Scripts-only diagnostic: align gold/harness/template/response contract for top cluster.";
    }
    if (rc === "ENGINE_BUG") {
      return "Narrow engine diagnostic/fix only for confirmed subpattern (no broad change).";
    }
    if (rc === "RETRIEVAL_PROBLEM") {
      return "Retrieval diagnostic first; defer broad engine or embedding changes.";
    }
  }
  const hasSignal = topThree.some((x) => x && x.count > 0 && x.suspected_root_cause !== "UNKNOWN");
  if (!hasSignal) return "Massive corpus readiness diagnostic: validate gates before scaling.";
  return "Massive corpus readiness diagnostic: validate residual clusters before scaling.";
}

function speedupPriorities(topThree) {
  const text = topThree.map((t) => strLower(t.cluster_name + " " + t.suspected_root_cause)).join(" ");
  const p = [];
  if (/retrieval|retriev/.test(text)) p.push("Retrieval Stress Factory");
  if (/chaos|partial|mobile|voice|rhc3/.test(text)) p.push("Chaos DNA Generator");
  if (/multi|intent/.test(text)) p.push("Multi-Intent Orchestration");
  if (/negat|safety|no_write/.test(text)) p.push("Negative / No-write Stress Scheduler");
  const defaults = [
    "Auto Cluster Reducer",
    "Delta Replay Selector",
    "Massive Corpus Scheduler",
    "Self-Correction Mutator",
  ];
  for (const d of defaults) {
    if (!p.includes(d)) p.push(d);
  }
  return [p[0] || "Auto Cluster Reducer", p[1] || "Delta Replay Selector", p[2] || "Massive Corpus Scheduler"];
}

function fileGlobsForTask(task) {
  const scriptsOnly = {
    allowed: "scripts/*",
    forbidden: "assets/app.js;engine;UI;CSS;backend",
  };
  const engineDiag = {
    allowed: "scripts/*",
    forbidden: "assets/app.js until diagnostic confirms ENGINE_BUG;broad refactor;UI;CSS;backend",
  };
  const narrowEngine = {
    allowed: "assets/app.js;scripts/*",
    forbidden: "UI;CSS;backend;broad refactor",
  };
  const safety = {
    allowed: "scripts/*",
    forbidden: "assets/app.js;UI;CSS;backend until safety root cause confirmed",
  };
  const retrieval = {
    allowed: "scripts/*",
    forbidden: "assets/app.js;broad embeddings/API/backend changes",
  };
  if (task.startsWith("P0 SAFETY")) return safety;
  if (/Retrieval diagnostic/.test(task)) return retrieval;
  if (/Narrow engine diagnostic/.test(task) || /engine diagnostic\/fix/.test(task)) return engineDiag;
  if (/engine fix/i.test(task)) return narrowEngine;
  return scriptsOnly;
}

function firstMassiveCorpus(topThree, safetyFail) {
  if (safetyFail) return "BLOCKED";
  const blob = topThree.map((t) => strLower(t.cluster_name + " " + t.suspected_root_cause)).join(" ");
  if (/retrieval/.test(blob)) return "Retrieval Stress 300k";
  if (/chaos|partial|mobile|voice|rhc3/.test(blob)) return "Real Human Chaos V3 500k";
  if (/negat|safety|no_write/.test(blob)) return "Negative / No-write 200k";
  if (/multi|intent/.test(blob)) return "Multi-Intent Orchestration 200k";
  return "Real Human Chaos V3 500k";
}

function main() {
  const writeReport = process.argv.includes("--write-report");
  const reportsLoaded = [];
  const reportsMissing = [];
  const byBasename = {};

  for (const fn of REPORT_FILENAMES) {
    const abs = path.join(SCRIPT_DIR, fn);
    if (!fs.existsSync(abs)) {
      reportsMissing.push(fn);
      continue;
    }
    const data = readJsonSafe(abs);
    if (!data) {
      reportsMissing.push(fn + "(unreadable)");
      continue;
    }
    reportsLoaded.push(fn);
    byBasename[fn] = data;
  }

  const reportsMeta = reportsLoaded.map((fn) => {
    const data = byBasename[fn];
    return {
      basename: fn,
      data,
      safety: extractSafetyCounters(data),
    };
  });

  const safetyAgg = aggregateSafety(reportsMeta);
  const safetyFail =
    safetyAgg.dangerous_write_count > 0 ||
    safetyAgg.false_write_count > 0 ||
    safetyAgg.query_created_write_count > 0 ||
    safetyAgg.write_when_negated_count > 0;
  const safety_gate_status = safetyFail ? "FAIL" : "PASS";

  const orderBaseline = [RHC3_BASENAME, RCZ2_BASENAME, DEEP_BASENAME, "silver-real-czech-corpus-v1-report.json", "silver-realistic-mobile-corpus-report.json"];

  const calendar_write_20k = fmtInvariant(
    pickFirstInvariant(byBasename, ["calendar_write_20k", "baseline_metrics.calendar_write_20k"], orderBaseline),
  );
  const calendar_query_20k = fmtInvariant(
    pickFirstInvariant(byBasename, ["calendar_query_20k", "baseline_metrics.calendar_query_20k"], orderBaseline) ||
      getNested(byBasename["silver-real-czech-corpus-v1-report.json"], "embed_20k.calendar_query"),
  );
  let v20k = pickFirstInvariant(byBasename, ["20k_overall_accuracy", "baseline_metrics.20k_overall_accuracy"], orderBaseline);
  if (v20k == null) {
    const emb = byBasename["silver-real-czech-corpus-v1-report.json"];
    const o = emb && emb.embed_20k && emb.embed_20k.overall_accuracy;
    if (o) v20k = o;
  }
  const overall_20k = fmtInvariant(v20k);

  const quality_accuracy = fmtInvariant(
    parseAccuracyNumber(byBasename["silver-quality-v2-report.json"] || {}, ["quality_accuracy"]) ||
      getNested(byBasename[RHC3_BASENAME], "baseline_metrics.quality_accuracy") ||
      getNested(byBasename["silver-real-czech-corpus-v1-report.json"], "quality_report.quality_accuracy"),
  );

  const realistic_overall_accuracy = fmtInvariant(
    parseAccuracyNumber(byBasename["silver-realistic-mobile-corpus-report.json"] || {}, ["overall_accuracy_realistic"]) ||
      getNested(byBasename[RHC3_BASENAME], "baseline_metrics.realistic_overall_accuracy") ||
      getNested(byBasename["silver-real-czech-corpus-v1-report.json"], "realistic_report.overall_accuracy_realistic"),
  );

  const real_czech_corpus_accuracy = fmtInvariant(
    parseAccuracyNumber(byBasename["silver-real-czech-corpus-v1-report.json"] || {}, ["corpus_accuracy"]) ||
      getNested(byBasename[RHC3_BASENAME], "baseline_metrics.real_czech_corpus_accuracy"),
  );

  const public_ux_corpus_accuracy = fmtInvariant(
    parseAccuracyNumber(byBasename[RCZ2_BASENAME] || {}, ["accuracy"]) ||
      getNested(byBasename[RHC3_BASENAME], "baseline_metrics.public_ux_corpus_accuracy"),
  );

  const deep_product_real_ux_v2_accuracy = fmtInvariant(
    parseAccuracyNumber(byBasename[DEEP_BASENAME] || {}, ["deep_product_accuracy"]) ||
      getNested(byBasename[RHC3_BASENAME], "baseline_metrics.deep_product_real_ux_v2_accuracy"),
  );

  const rhc3_overall_accuracy = fmtInvariant(
    parseAccuracyNumber(byBasename[RHC3_BASENAME] || {}, ["overall_accuracy"]) || null,
  );

  let allClusters = [];
  for (const fn of reportsLoaded) {
    allClusters = allClusters.concat(collectClustersFromReport(fn, byBasename[fn]));
  }
  allClusters = mergeDuplicateClusters(allClusters);
  for (const row of allClusters) {
    const blob = [row.cluster_name, row.root_text, row.module, row.operation, row.recommended_scope].join(" ");
    row.suspected_root_cause = classifyRootCause(blob, safetyAgg, row.cluster_name);
    row.recommended_action = recommendedActionFor(row.suspected_root_cause);
    if (!row.recommended_scope) row.recommended_scope = recommendedScopeFor(row.suspected_root_cause);
    if (!row.product_severity) row.product_severity = productSeverityFrom(row.count, "");
    row.safety_severity = safetyFail ? "P0" : "OK";
  }
  allClusters.sort((a, b) => b.count - a.count);
  const topThree = allClusters.slice(0, 3);

  const rhc3Data = byBasename[RHC3_BASENAME];
  const rhc3Top = topThree.find((x) => x.source_report === RHC3_BASENAME) || allClusters.find((x) => x.source_report === RHC3_BASENAME);

  const blockers = [];
  if (safetyFail) blockers.push("safety_counters_nonzero");
  if (rhc3TopDominantEngineSafety(rhc3Data, rhc3Top)) blockers.push("rhc3_dominant_unresolved_engine_or_safety_cluster");

  const pubN = parsePct(public_ux_corpus_accuracy);
  const deepN = parsePct(deep_product_real_ux_v2_accuracy);
  if (pubN != null && pubN < 70) blockers.push("public_ux_corpus_critical_drop");
  if (deepN != null && deepN < 78) blockers.push("deep_product_real_ux_critical_drop");

  let massive_corpus_ready = "YES";
  if (safety_gate_status !== "PASS") massive_corpus_ready = "NO";
  if (safetyAgg.dangerous_write_count > 0) massive_corpus_ready = "NO";
  if (safetyAgg.false_write_count > 0) massive_corpus_ready = "NO";
  if (safetyAgg.query_created_write_count > 0) massive_corpus_ready = "NO";
  if (safetyAgg.write_when_negated_count > 0) massive_corpus_ready = "NO";
  if (blockers.length) massive_corpus_ready = "NO";

  const recommended_next_task = decideNextTask(safetyFail, topThree, safetyAgg);
  const [sp1, sp2, sp3] = speedupPriorities(topThree);
  const fg = fileGlobsForTask(recommended_next_task);
  const first_massive = firstMassiveCorpus(topThree, safetyFail);

  let main_commit = process.env.SILVER_ACCEL_MAIN_COMMIT || "";
  if (!main_commit) {
    try {
      main_commit = execSync("git rev-parse HEAD", { cwd: REPO_ROOT, encoding: "utf8" }).trim();
    } catch {
      main_commit = "";
    }
  }
  if (!main_commit) {
    main_commit = fmtInvariant(
      byBasename[RHC3_BASENAME] && byBasename[RHC3_BASENAME].main_commit
        ? byBasename[RHC3_BASENAME].main_commit
        : null,
    );
    if (main_commit === "UNKNOWN") main_commit = "";
  }

  function changeFlagsFromReports() {
    const head = String(main_commit || "").trim();
    const matchReports = reportsMeta.filter((m) => {
      const d = m.data;
      const mc = String(d.main_commit || d.user_reference_main_commit || "").trim();
      return mc && head && mc === head;
    });
    const pool = matchReports.length ? matchReports : [];
    const readFlag = (field) => {
      if (!pool.length) return "NO";
      let anyYes = false;
      for (const m of pool) {
        const v = m.data[field];
        if (v && String(v).toUpperCase() === "YES") anyYes = true;
      }
      return anyYes ? "YES" : "NO";
    };
    return {
      engine_changed: readFlag("engine_changed"),
      assets_app_changed: readFlag("assets_app_changed"),
      ui_changed: readFlag("ui_changed"),
      css_changed: readFlag("css_changed"),
      backend_changed: readFlag("backend_changed"),
    };
  }

  const chg = changeFlagsFromReports();
  const engine_changed = chg.engine_changed;
  const assets_app_changed = chg.assets_app_changed;
  const ui_changed = chg.ui_changed;
  const css_changed = chg.css_changed;
  const backend_changed = chg.backend_changed;

  let git_status_clean = "UNKNOWN";
  let ready_for_pr = "UNKNOWN";
  try {
    const st = execSync("git status --porcelain", { cwd: REPO_ROOT, encoding: "utf8" }).trim();
    git_status_clean = st.length === 0 ? "YES" : "NO";
    ready_for_pr = git_status_clean;
  } catch {
    git_status_clean = "UNKNOWN";
    ready_for_pr = "UNKNOWN";
  }

  const lines = [];
  const add = (k, v) => lines.push(`${k}=${v}`);

  lines.push("=== SILVER_DEV_ACCELERATION_V1_RESULT ===");
  add("main_commit", main_commit);
  add("engine_changed", engine_changed);
  add("assets_app_changed", assets_app_changed);
  add("ui_changed", ui_changed);
  add("css_changed", css_changed);
  add("backend_changed", backend_changed);
  add("reports_loaded", reportsLoaded.join(";"));
  add("reports_missing", reportsMissing.join(";"));
  add("safety_gate_status", safety_gate_status);
  add("dangerous_write_count", String(safetyAgg.dangerous_write_count));
  add("false_write_count", String(safetyAgg.false_write_count));
  add("query_created_write_count", String(safetyAgg.query_created_write_count));
  add("write_when_negated_count", String(safetyAgg.write_when_negated_count));
  add("calendar_write_20k", calendar_write_20k);
  add("calendar_query_20k", calendar_query_20k);
  add("20k_overall_accuracy", overall_20k);
  add("quality_accuracy", quality_accuracy);
  add("realistic_overall_accuracy", realistic_overall_accuracy);
  add("real_czech_corpus_accuracy", real_czech_corpus_accuracy);
  add("public_ux_corpus_accuracy", public_ux_corpus_accuracy);
  add("deep_product_real_ux_v2_accuracy", deep_product_real_ux_v2_accuracy);
  add("rhc3_overall_accuracy", rhc3_overall_accuracy);

  for (let i = 0; i < 3; i++) {
    const idx = i + 1;
    const t = topThree[i];
    add(`top_cluster_${idx}`, t ? t.cluster_name : "");
    add(`top_cluster_${idx}_count`, t ? String(t.count) : "0");
    add(`top_cluster_${idx}_root_cause`, t ? t.suspected_root_cause : "UNKNOWN");
    add(`top_cluster_${idx}_recommended_action`, t ? t.recommended_action : "");
    add(`top_cluster_${idx}_recommended_scope`, t ? t.recommended_scope : "");
  }

  add("recommended_next_task", recommended_next_task);
  add("massive_corpus_ready", massive_corpus_ready);
  add("massive_corpus_blockers", blockers.join(";"));
  add("first_massive_corpus_recommended", massive_corpus_ready === "YES" ? first_massive : "N/A");
  add("speedup_priority_1", sp1);
  add("speedup_priority_2", sp2);
  add("speedup_priority_3", sp3);
  add("allowed_next_files", fg.allowed);
  add("forbidden_next_files", fg.forbidden);
  add("git_status_clean", git_status_clean);
  add("ready_for_pr", ready_for_pr);
  lines.push("=== END_SILVER_DEV_ACCELERATION_V1_RESULT ===");

  const block = lines.join("\n");
  process.stdout.write(block + "\n");

  if (writeReport) {
    const reportObj = {
      generated_at: new Date().toISOString(),
      reports_loaded: reportsLoaded,
      reports_missing: reportsMissing,
      safety_agg: safetyAgg,
      safety_gate_status,
      invariants: {
        calendar_write_20k,
        calendar_query_20k,
        "20k_overall_accuracy": overall_20k,
        quality_accuracy,
        realistic_overall_accuracy,
        real_czech_corpus_accuracy,
        public_ux_corpus_accuracy,
        deep_product_real_ux_v2_accuracy,
        rhc3_overall_accuracy,
      },
      top_clusters: topThree,
      recommended_next_task,
      massive_corpus_ready,
      massive_corpus_blockers: blockers,
      first_massive_corpus_recommended: massive_corpus_ready === "YES" ? first_massive : "N/A",
      speedup_priorities: [sp1, sp2, sp3],
      allowed_next_files: fg.allowed,
      forbidden_next_files: fg.forbidden,
      git_status_clean,
      ready_for_pr,
    };
    const outPath = path.join(SCRIPT_DIR, "silver-dev-acceleration-v1-report.json");
    fs.writeFileSync(outPath, JSON.stringify(reportObj, null, 2), "utf8");
  }
}

main();
