#!/usr/bin/env node
/**
 * Silver audit registry + maturity + TRUE_ENGINE_FAIL prioritizer + NEXT CAP selector.
 * Orchestration/reporting only — no engine / assets changes.
 */
"use strict";

const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const SCRIPT_DIR = __dirname;

const MATURITY = {
  PLANNED_ONLY: "PLANNED_ONLY",
  FOUNDATION_ONLY: "FOUNDATION_ONLY",
  PARTIAL: "PARTIAL",
  ACTIVE: "ACTIVE",
  STABLE: "STABLE",
  STALE: "STALE",
};

const STALE_DAYS = 21;

/** Canonical audit catalog — never claim ACTIVE without on-disk evidence. */
const AUDIT_CATALOG = [
  {
    id: "rhc3",
    audit_name: "Real Human Chaos V3",
    audit_size: "500k",
    public_product_impact: "HIGH",
    harness_scripts: ["silver-real-human-chaos-v3.cjs"],
    report_json: "silver-real-human-chaos-v3-report.json",
    classifier_json: "silver-rhc3-cluster-classifier-v1-report.json",
    cluster_prefix: "rhc3_",
    safety_sensitive: true,
  },
  {
    id: "retrieval_stress",
    audit_name: "Retrieval Stress",
    audit_size: "300k",
    public_product_impact: "HIGH",
    harness_scripts: [
      "silver-retrieval-stress-300k-generator.cjs",
      "silver-retrieval-stress-300k-foundation-diagnostic.cjs",
    ],
    report_json: "silver-retrieval-stress-300k-foundation-diagnostic-report.json",
    foundation_scripts: ["silver-retrieval-stress-300k-prep.cjs"],
    cluster_prefix: "retrieval_",
    safety_sensitive: false,
  },
  {
    id: "self_correction",
    audit_name: "Self-Correction",
    audit_size: "240k",
    public_product_impact: "MEDIUM",
    harness_scripts: [
      "silver-self-correction-audit.cjs",
      "silver-self-correction-safety-diagnostic.cjs",
    ],
    foundation_scripts: [
      "silver-self-correction-negation-scope-selftest.cjs",
      "silver-self-correction-safety-cal-readonly-selftest.cjs",
    ],
    report_json: "silver-self-correction-audit-report.json",
    diagnostic_report_json: "silver-self-correction-safety-diagnostic-report.json",
    cluster_prefix: "self_correction",
    safety_sensitive: true,
  },
  {
    id: "negative_no_write",
    audit_name: "Negative / No-write",
    audit_size: "200k",
    public_product_impact: "HIGH",
    harness_scripts: ["silver-rhc3-negation-cal-readonly-diagnostic.cjs"],
    report_json: "silver-rhc3-negation-cal-readonly-diagnostic-report.json",
    cluster_prefix: "negation_",
    safety_sensitive: true,
  },
  {
    id: "multi_intent",
    audit_name: "Multi-Intent Orchestration",
    audit_size: "200k",
    public_product_impact: "MEDIUM",
    harness_scripts: [],
    report_json: "",
    cluster_prefix: "multi_intent",
    safety_sensitive: false,
  },
  {
    id: "title_cleanup",
    audit_name: "Title Cleanup / Action Extraction",
    audit_size: "160k",
    public_product_impact: "MEDIUM",
    harness_scripts: ["audit_silver_20000_routing_stable.cjs", "silver-normalizer-title-cleaning-v1-audit.cjs"],
    report_json: "silver-normalizer-title-cleaning-v1-report.json",
    cluster_prefix: "title_cleanup",
    safety_sensitive: false,
  },
  {
    id: "long_session",
    audit_name: "Long Session Memory",
    audit_size: "150k",
    public_product_impact: "MEDIUM",
    harness_scripts: ["silver-session-memory-v14-regression.mjs"],
    report_json: "",
    cluster_prefix: "long_session",
    safety_sensitive: false,
  },
  {
    id: "agenda_summary",
    audit_name: "Agenda Summary / Overview",
    audit_size: "120k",
    public_product_impact: "MEDIUM",
    harness_scripts: ["silver-calendar-read-regression.mjs"],
    report_json: "",
    cluster_prefix: "agenda_",
    safety_sensitive: false,
  },
  {
    id: "public_ux",
    audit_name: "Public UX Mixed Corpus",
    audit_size: "500k+",
    public_product_impact: "HIGH",
    harness_scripts: ["silver-real-czech-public-ux-corpus-v2.cjs"],
    report_json: "silver-real-czech-public-ux-corpus-v2-report.json",
    cluster_prefix: "rcz2_",
    safety_sensitive: true,
  },
  {
    id: "semantic_payload_v1",
    audit_name: "Semantic Payload Engine V1 Foundation",
    audit_size: "480+",
    public_product_impact: "HIGH",
    harness_scripts: ["silver-semantic-payload-foundation-diagnostic.cjs"],
    foundation_scripts: [
      "silver-semantic-payload-engine-v1-core.cjs",
      "silver-search-understanding-v1-core.cjs",
      "silver-conversation-state-v1-core.cjs",
      "silver-clean-payload-validator-v1.cjs",
      "silver-audit-anti-duplication-v1.cjs",
    ],
    report_json: "silver-semantic-payload-foundation-diagnostic-report.json",
    cluster_prefix: "spev1_",
    safety_sensitive: true,
  },
  {
    id: "semantic_slot_extraction_v1",
    audit_name: "Semantic Slot Extraction Engine V1",
    audit_size: "400+",
    public_product_impact: "HIGH",
    harness_scripts: ["silver-semantic-slot-extraction-diagnostic.cjs"],
    foundation_scripts: [
      "silver-semantic-payload-engine-v1-core.cjs",
      "silver-clean-payload-validator-v1.cjs",
      "silver-action-mode-v1-core.cjs",
      "silver-audit-anti-duplication-v1.cjs",
    ],
    report_json: "silver-semantic-slot-extraction-diagnostic-report.json",
    cluster_prefix: "ssesv1_",
    safety_sensitive: true,
  },
  {
    id: "clean_save_payload_production_v1",
    audit_name: "Clean Save Payload Production Line V1",
    audit_size: "480+",
    public_product_impact: "HIGH",
    harness_scripts: ["silver-clean-save-payload-production-line-v1.cjs"],
    foundation_scripts: [
      "silver-semantic-payload-engine-v1-core.cjs",
      "silver-clean-payload-validator-v1.cjs",
      "silver-action-mode-v1-core.cjs",
      "silver-audit-anti-duplication-v1.cjs",
    ],
    report_json: "silver-clean-save-payload-production-line-v1-report.json",
    cluster_prefix: "cspplv1_",
    safety_sensitive: true,
  },
  {
    id: "save_search_mode_v1",
    audit_name: "Save/Search Mode Architecture V1",
    audit_size: "400+",
    public_product_impact: "HIGH",
    harness_scripts: ["silver-save-search-mode-architecture-diagnostic.cjs"],
    foundation_scripts: [
      "silver-action-mode-v1-core.cjs",
      "silver-semantic-payload-engine-v1-core.cjs",
      "silver-search-understanding-v1-core.cjs",
      "silver-clean-payload-validator-v1.cjs",
      "silver-audit-anti-duplication-v1.cjs",
    ],
    report_json: "silver-save-search-mode-architecture-diagnostic-report.json",
    cluster_prefix: "ssmav1_",
    safety_sensitive: true,
  },
];

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

function fileStat(absPath) {
  try {
    const st = fs.statSync(absPath);
    return { exists: true, mtimeMs: st.mtimeMs, size: st.size };
  } catch {
    return { exists: false, mtimeMs: 0, size: 0 };
  }
}

function gitHead(repoRoot) {
  try {
    return execSync("git rev-parse HEAD", { cwd: repoRoot, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] })
      .trim();
  } catch {
    return "";
  }
}

function parseIsoAgeDays(iso) {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return null;
  return (Date.now() - t) / (86400 * 1000);
}

function parseClusterString(entry) {
  if (typeof entry !== "string") return null;
  const s = entry.trim();
  if (!s) return null;
  const pipe = s.indexOf("||");
  const colon = s.lastIndexOf(":");
  if (pipe >= 0) {
    const cluster = s.slice(0, pipe).trim();
    const rest = s.slice(pipe + 2);
    const c2 = rest.lastIndexOf(":");
    const cat = c2 >= 0 ? rest.slice(0, c2).trim() : rest;
    const count = parseInt(c2 >= 0 ? rest.slice(c2 + 1) : "0", 10);
    return { cluster, category: cat, count: Number.isFinite(count) ? count : 0 };
  }
  if (colon <= 0) return { cluster: s, category: "", count: 0 };
  const cluster = s.slice(0, colon).trim();
  let right = s.slice(colon + 1);
  const slash = right.indexOf("/");
  if (slash >= 0) right = right.slice(0, slash);
  const count = parseInt(right, 10);
  return { cluster, category: "", count: Number.isFinite(count) ? count : 0 };
}

function collectClustersFromReport(basename, data, auditId) {
  const out = [];
  if (!data || typeof data !== "object") return out;
  const push = (name, count, extra) => {
    const n = String(name || "").trim();
    const c = Number(count);
    if (!n || !Number.isFinite(c) || c <= 0) return;
    out.push(
      Object.assign(
        {
          audit_id: auditId,
          source_report: basename,
          cluster: n,
          fail_count: c,
        },
        extra || {},
      ),
    );
  };
  if (Array.isArray(data.top_fail_clusters)) {
    for (const e of data.top_fail_clusters) {
      const p = parseClusterString(e);
      if (p) push(p.cluster, p.count, { category: p.category });
    }
  }
  if (Array.isArray(data.top_clusters)) {
    for (const e of data.top_clusters) {
      const p = parseClusterString(e);
      if (p) push(p.cluster, p.count, { category: p.category });
    }
  }
  const fc = data.fail_count_by_cluster;
  if (fc && typeof fc === "object") {
    for (const k of Object.keys(fc)) {
      push(k, fc[k], {});
    }
  }
  if (data.target_cluster && data.intent_fail_count > 0) {
    push(data.target_cluster, data.intent_fail_count, { from_target: true });
  }
  return out;
}

/**
 * Fresh authoritative cluster passes from sibling harness reports (orchestration only).
 * When on-disk public_ux report is stale but retrieval foundation shows 12000/12000 PASS,
 * do not treat rcz2_retrieval intent_fail as authoritative engine work.
 */
function loadFreshAuthoritativeClusterPasses(repoRoot) {
  const passes = [];
  const retrievalPath = path.join(
    repoRoot,
    "scripts",
    "silver-retrieval-stress-300k-foundation-diagnostic-report.json",
  );
  const retrieval = readJsonSafe(retrievalPath);
  if (retrieval && retrieval.target_cluster) {
    const total = Number(retrieval.total_rcz2_retrieval_cases);
    const passN = Number(retrieval.retrieval_pass_count);
    const intentFail = Number(retrieval.intent_fail_count);
    if (total > 0 && passN >= total && (!Number.isFinite(intentFail) || intentFail === 0)) {
      passes.push({
        audit_id: "public_ux",
        cluster: String(retrieval.target_cluster).trim(),
        source_report: "silver-retrieval-stress-300k-foundation-diagnostic-report.json",
        authoritative_pass: "YES",
        pass_count: passN,
        total_cases: total,
      });
    }
  }
  const freshDir = process.env.SILVER_AUDIT_FRESH_OVERLAY_DIR
    ? path.resolve(process.env.SILVER_AUDIT_FRESH_OVERLAY_DIR)
    : path.join(require("os").tmpdir(), "silver-audit-fresh-overlay");
  try {
    if (fs.existsSync(freshDir)) {
      for (const fn of fs.readdirSync(freshDir)) {
        if (!fn.endsWith(".json")) continue;
        const data = readJsonSafe(path.join(freshDir, fn));
        if (!data || !data.target_cluster) continue;
        const total = Number(data.total_cases || data.total_rcz2_retrieval_cases);
        const passN = Number(data.pass_count || data.retrieval_pass_count || data.pass);
        const intentFail = Number(data.intent_fail_count);
        if (total > 0 && passN >= total && (!Number.isFinite(intentFail) || intentFail === 0)) {
          passes.push({
            audit_id: String(data.audit_id || "public_ux"),
            cluster: String(data.target_cluster).trim(),
            source_report: "fresh_overlay:" + fn,
            authoritative_pass: "YES",
            pass_count: passN,
            total_cases: total,
          });
        }
      }
    }
  } catch {
    /* ignore */
  }
  return passes;
}

function loadClassifierMap(repoRoot) {
  const abs = path.join(repoRoot, "scripts", "silver-rhc3-cluster-classifier-v1-report.json");
  const data = readJsonSafe(abs);
  const map = {};
  if (!data || !Array.isArray(data.classifications)) return map;
  for (const row of data.classifications) {
    if (!row || !row.cluster) continue;
    map[row.cluster] = row;
  }
  return map;
}

function inferTrueEngineFail(cluster, classifierRow, safetySensitive) {
  const name = String(cluster.cluster || "").toLowerCase();
  const cls = classifierRow || {};
  const diagTef = Number(cls.diagnostic_true_engine_fail_count);
  const harnessOnly = cls.harness_only === "YES" || cls.engine_fix_allowed === "NO";
  const engineAllowed = cls.engine_fix_allowed === "YES";
  const engineRec = cls.diagnostic_engine_fix_recommended === "YES";

  if (harnessOnly && !engineRec && !(diagTef > 0)) {
    return { confidence: "LOW", kind: "harness_or_gold", harness_only: "YES" };
  }
  if (engineAllowed && (diagTef > 0 || engineRec)) {
    return { confidence: "HIGH", kind: "TRUE_ENGINE_FAIL", harness_only: "NO" };
  }
  if (/negation|no_write|dangerous|false_write|safety/.test(name) && safetySensitive) {
    return { confidence: "HIGH", kind: "TRUE_ENGINE_FAIL", harness_only: "NO" };
  }
  if (/retrieval|false_empty|relevance|fuzzy/.test(name)) {
    return { confidence: cluster.fail_count >= 50 ? "HIGH" : "MEDIUM", kind: "TRUE_ENGINE_FAIL", harness_only: "NO" };
  }
  if (/intent_fail|calendar_vs_task|wrong_collection|clarif/.test(name)) {
    return { confidence: "MEDIUM", kind: "mixed_engine_harness", harness_only: "PARTIAL" };
  }
  if (/ambiguous|filler|ascii|voice|partial_cal/.test(name)) {
    return { confidence: "LOW", kind: "harness_or_ambiguity", harness_only: "YES" };
  }
  if (cluster.fail_count >= 100) {
    return { confidence: "MEDIUM", kind: "needs_diagnostic", harness_only: "UNKNOWN" };
  }
  return { confidence: "LOW", kind: "unclear", harness_only: "UNKNOWN" };
}

function safetyRiskFor(cluster, auditEntry, safetyAgg) {
  if (auditEntry.safety_sensitive) {
    if (/negation|no_write|dangerous|false_write|write_when/.test(String(cluster.cluster))) return "HIGH";
  }
  if (safetyAgg) {
    const bad =
      safetyAgg.dangerous_write_count > 0 ||
      safetyAgg.false_write_count > 0 ||
      safetyAgg.query_created_write_count > 0 ||
      safetyAgg.write_when_negated_count > 0;
    if (bad && auditEntry.safety_sensitive) return "HIGH";
  }
  if (/safety|negation|no_write/.test(String(cluster.cluster))) return "MEDIUM";
  return "LOW";
}

function extractSafetyCounters(data) {
  const nested = data && data.safety && typeof data.safety === "object" ? data.safety : {};
  const pick = (k) => {
    const v = data && data[k] != null ? data[k] : nested[k];
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  };
  return {
    dangerous_write_count: pick("dangerous_write_count"),
    false_write_count: pick("false_write_count"),
    query_created_write_count: Math.max(pick("query_created_write_count"), pick("query_created_write_count_realistic")),
    write_when_negated_count: pick("write_when_negated_count"),
  };
}

function aggregateSafetyFromReports(repoRoot) {
  const names = [
    "silver-quality-v2-report.json",
    "silver-real-human-chaos-v3-report.json",
    "silver-real-czech-public-ux-corpus-v2-report.json",
    "silver-self-correction-audit-report.json",
  ];
  const agg = {
    dangerous_write_count: 0,
    false_write_count: 0,
    query_created_write_count: 0,
    write_when_negated_count: 0,
  };
  for (const fn of names) {
    const d = readJsonSafe(path.join(repoRoot, "scripts", fn));
    const s = extractSafetyCounters(d);
    for (const k of Object.keys(agg)) {
      agg[k] = Math.max(agg[k], s[k]);
    }
  }
  return agg;
}

function classifyMaturity(entry, repoRoot, headCommit) {
  const scriptsDir = path.join(repoRoot, "scripts");
  let hasHarness = false;
  let hasFoundation = false;
  let hasReport = false;
  let reportData = null;
  let lastRun = "";
  let lastCommit = "";

  for (const s of entry.harness_scripts || []) {
    if (fileStat(path.join(scriptsDir, s)).exists) hasHarness = true;
  }
  for (const s of entry.foundation_scripts || []) {
    if (fileStat(path.join(scriptsDir, s)).exists) hasFoundation = true;
  }
  if (entry.report_json) {
    const rp = path.join(scriptsDir, entry.report_json);
    const st = fileStat(rp);
    if (st.exists) {
      hasReport = true;
      reportData = readJsonSafe(rp);
      lastRun = new Date(st.mtimeMs).toISOString();
      lastCommit =
        (reportData && (reportData.main_commit || reportData.actual_main_commit || reportData.expected_main_commit)) ||
        "";
    }
  }

  let maturity = MATURITY.PLANNED_ONLY;
  let foundation_only = "YES";
  let stale = "NO";

  if (!hasHarness && !hasFoundation && !hasReport) {
    maturity = MATURITY.PLANNED_ONLY;
  } else if (hasFoundation && !hasHarness && !hasReport) {
    maturity = MATURITY.FOUNDATION_ONLY;
  } else if (hasHarness && !hasReport) {
    maturity = MATURITY.PARTIAL;
    foundation_only = hasFoundation ? "YES" : "NO";
  } else if (hasReport) {
    const acc = reportData && (reportData.overall_accuracy || reportData.accuracy || reportData.retrieval_accuracy_percent);
    const failN = Number(reportData && (reportData.fail_count || reportData.intent_fail_count));
    const passN = Number(reportData && (reportData.pass_count || reportData.pass));
    const total = Number(reportData && (reportData.total_cases || reportData.total_rcz2_retrieval_cases));
    const ageDays = parseIsoAgeDays((reportData && reportData.generated_at) || lastRun);
    const commitMismatch = headCommit && lastCommit && headCommit !== lastCommit;
    if (commitMismatch || (ageDays != null && ageDays > STALE_DAYS)) {
      maturity = MATURITY.STALE;
      stale = "YES";
      if (hasHarness) foundation_only = "NO";
    } else if (acc && parseFloat(String(acc)) >= 99.5 && (!Number.isFinite(failN) || failN <= 20)) {
      maturity = MATURITY.STABLE;
      foundation_only = "NO";
    } else {
      maturity = MATURITY.ACTIVE;
      foundation_only = "NO";
    }
    if (hasFoundation && !hasHarness) {
      maturity = MATURITY.FOUNDATION_ONLY;
      foundation_only = "YES";
    }
    if (total > 0 && passN > 0 && passN / total < 0.5 && maturity !== MATURITY.STALE) {
      maturity = MATURITY.PARTIAL;
    }
  }

  return {
    maturity,
    foundation_only,
    stale,
    last_run: lastRun || "(nikdy)",
    last_commit: lastCommit || "(neznámý)",
    has_harness: hasHarness,
    has_report: hasReport,
    report_data: reportData,
  };
}

function buildAuditRegistry(repoRoot) {
  const scriptsDir = path.join(repoRoot, "scripts");
  const headCommit = gitHead(repoRoot);
  const classifierMap = loadClassifierMap(repoRoot);
  const safetyAgg = aggregateSafetyFromReports(repoRoot);
  const freshAuthoritativePasses = loadFreshAuthoritativeClusterPasses(repoRoot);
  const freshPassKey = new Set(
    freshAuthoritativePasses.map((fp) => fp.audit_id + "\0" + fp.cluster),
  );
  const audits = [];

  for (const spec of AUDIT_CATALOG) {
    const mat = classifyMaturity(spec, repoRoot, headCommit);
    const clusters = mat.report_data
      ? collectClustersFromReport(spec.report_json, mat.report_data, spec.id)
      : [];

    const clusterMap = {};
    for (const c of clusters) {
      const key = c.cluster;
      if (freshPassKey.has(spec.id + "\0" + key)) continue;
      if (!clusterMap[key]) clusterMap[key] = Object.assign({}, c);
      else clusterMap[key].fail_count = Math.max(clusterMap[key].fail_count, c.fail_count);
    }
    const enrichedClusters = Object.keys(clusterMap).map((key) => {
      const c = clusterMap[key];
      const cls = classifierMap[c.cluster];
      const tef = inferTrueEngineFail(c, cls, spec.safety_sensitive);
      return Object.assign({}, c, {
        true_engine_fail_confidence: tef.confidence,
        true_engine_fail_kind: tef.kind,
        harness_only: tef.harness_only,
        safety_risk: safetyRiskFor(c, spec, safetyAgg),
        classifier_engine_fix_allowed: cls ? cls.engine_fix_allowed : "UNKNOWN",
      });
    });

    const trueEngineClusters = enrichedClusters.filter(
      (c) => c.true_engine_fail_confidence === "HIGH" || c.true_engine_fail_confidence === "MEDIUM",
    );
    const harnessOnlyClusters = enrichedClusters.filter((c) => c.harness_only === "YES");

    const topCluster = enrichedClusters.sort((a, b) => b.fail_count - a.fail_count)[0] || null;

    const hasActionableClusters = enrichedClusters.some((c) => c.fail_count > 0);
    const usable =
      (mat.maturity === MATURITY.ACTIVE ||
        mat.maturity === MATURITY.STABLE ||
        mat.maturity === MATURITY.PARTIAL ||
        (mat.maturity === MATURITY.STALE && hasActionableClusters)) &&
      mat.foundation_only !== "YES" &&
      (mat.stale !== "YES" || hasActionableClusters) &&
      (trueEngineClusters.length > 0 || hasActionableClusters);

    let status = "planned";
    if (mat.maturity === MATURITY.PLANNED_ONLY) status = "not_created";
    else if (mat.maturity === MATURITY.FOUNDATION_ONLY) status = "foundation";
    else if (mat.maturity === MATURITY.STALE) status = "stale";
    else if (mat.maturity === MATURITY.STABLE) status = "stable_active";
    else if (mat.maturity === MATURITY.ACTIVE) status = "active";
    else status = "partial";

    audits.push({
      audit_id: spec.id,
      audit_name: spec.audit_name,
      status,
      maturity: mat.maturity,
      last_run: mat.last_run,
      last_commit: mat.last_commit,
      usable_for_cap_selection: usable ? "YES" : "NO",
      true_engine_fail_clusters: trueEngineClusters.map((c) => c.cluster).join("|") || "(žádný)",
      true_engine_fail_cluster_count: trueEngineClusters.length,
      harness_only_cluster_count: harnessOnlyClusters.length,
      top_cluster: topCluster ? topCluster.cluster + ":" + topCluster.fail_count : "(žádný)",
      safety_risk: topCluster ? topCluster.safety_risk : spec.safety_sensitive ? "MEDIUM" : "LOW",
      audit_size: spec.audit_size,
      stale: mat.stale,
      foundation_only: mat.foundation_only,
      public_product_impact: spec.public_product_impact,
      clusters: enrichedClusters,
    });
  }

  return {
    repoRoot,
    headCommit,
    safetyAgg,
    audits,
    fresh_authoritative_passes: freshAuthoritativePasses,
    generated_at: new Date().toISOString(),
  };
}

function scoreClusterForPriority(c, audit) {
  const impactMap = { HIGH: 3, MEDIUM: 2, LOW: 1 };
  const confMap = { HIGH: 3, MEDIUM: 2, LOW: 0 };
  const riskMap = { HIGH: 3, MEDIUM: 2, LOW: 1 };
  const fixMap = { YES: 2, PARTIAL: 1, NO: 0, UNKNOWN: 0 };
  const matMap = {
    ACTIVE: 2,
    STABLE: 1,
    PARTIAL: 1,
    STALE: 0,
    FOUNDATION_ONLY: 0,
    PLANNED_ONLY: 0,
  };
  const reproducibility = Math.min(3, Math.log10(Math.max(1, c.fail_count)) / 2);
  const auditQuality = matMap[audit.maturity] || 0;
  const deterministicFix = fixMap[c.classifier_engine_fix_allowed] || (c.true_engine_fail_confidence === "HIGH" ? 2 : 0);
  const harnessPenalty = c.harness_only === "YES" || c.true_engine_fail_confidence === "LOW" ? 0 : 1;

  return (
    (confMap[c.true_engine_fail_confidence] || 0) * 10000000 +
    riskMap[c.safety_risk || "LOW"] * 1000000 +
    (impactMap[audit.public_product_impact] || 1) * 100000 +
    harnessPenalty * 50000 +
    reproducibility * 1000 +
    auditQuality * 100 +
    deterministicFix * 10 +
    c.fail_count
  );
}

function prioritizeTrueEngineFail(registry) {
  const rows = [];
  const seen = new Set();
  for (const audit of registry.audits) {
    if (audit.usable_for_cap_selection !== "YES") continue;
    for (const c of audit.clusters) {
      if (c.fail_count <= 0) continue;
      const dedupeKey = audit.audit_id + "\0" + c.cluster;
      if (seen.has(dedupeKey)) continue;
      seen.add(dedupeKey);
      rows.push({
        audit_id: audit.audit_id,
        audit_name: audit.audit_name,
        cluster: c.cluster,
        fail_count: c.fail_count,
        safety_risk: c.safety_risk,
        public_product_impact: audit.public_product_impact,
        true_engine_fail_confidence: c.true_engine_fail_confidence,
        true_engine_fail_kind: c.true_engine_fail_kind,
        harness_only: c.harness_only,
        maturity: audit.maturity,
        score: scoreClusterForPriority(c, audit),
      });
    }
  }
  rows.sort((a, b) => b.score - a.score);
  return rows;
}

function recommendCapType(row, audit) {
  if (!row) return "CAP10";
  if (row.safety_risk === "HIGH" || row.fail_count >= 2000) return "CAP10";
  if (row.fail_count >= 500 || row.true_engine_fail_confidence === "HIGH") return "CAP15";
  if (audit.maturity === MATURITY.PARTIAL || audit.foundation_only === "YES") return "CAP25";
  if (row.fail_count >= 100) return "CAP25";
  return "CAP50";
}

function expectedOutcomeFor(row) {
  if (!row) return "audit expansion";
  if (row.harness_only === "YES") return "harness alignment";
  if (row.true_engine_fail_confidence === "HIGH" && row.true_engine_fail_kind === "TRUE_ENGINE_FAIL") return "engine PR";
  if (row.true_engine_fail_confidence === "MEDIUM") return "engine PR or harness split";
  if (row.true_engine_fail_kind === "harness_or_gold") return "harness alignment";
  return "diagnostic only";
}

function estimatedRiskFor(row, audit) {
  if (row && row.safety_risk === "HIGH") return "HIGH";
  if (audit && audit.maturity === MATURITY.STALE) return "HIGH";
  if (row && row.true_engine_fail_confidence === "LOW") return "MEDIUM";
  if (row && row.harness_only === "YES") return "LOW";
  return "LOW";
}

function selectNextCap(registry, prioritized) {
  const top = prioritized[0];
  if (!top) {
    const expand = registry.audits.find(
      (a) => a.foundation_only === "YES" || a.maturity === MATURITY.PLANNED_ONLY || a.maturity === MATURITY.FOUNDATION_ONLY,
    );
    return {
      recommended_cap: "CAP25",
      audit_name: expand ? expand.audit_name : "(žádný)",
      audit_id: expand ? expand.audit_id : "",
      cluster: "(žádný)",
      expected_outcome: "audit expansion",
      estimated_risk: "LOW",
      rationale: "Chybí aktivní TRUE_ENGINE_FAIL cluster — rozšířit audit nebo obnovit stale report.",
    };
  }
  const audit = registry.audits.find((a) => a.audit_id === top.audit_id);
  return {
    recommended_cap: recommendCapType(top, audit || {}),
    audit_name: top.audit_name,
    audit_id: top.audit_id,
    cluster: top.cluster,
    expected_outcome: expectedOutcomeFor(top),
    estimated_risk: estimatedRiskFor(top, audit),
    rationale:
      "Top cluster podle safety × dopad × TRUE_ENGINE_FAIL confidence × reprodukovatelnost; audit maturity=" +
      (audit ? audit.maturity : "?"),
  };
}

function harnessCommandsForCluster(auditId, cluster) {
  const name = String(cluster || "").trim();
  const id = String(auditId || "").trim();
  if (id === "self_correction" && name === "self_correction_negation_flip") {
    return [
      "node scripts/silver-self-correction-audit.cjs",
      "node scripts/silver-self-correction-safety-diagnostic.cjs",
      "node scripts/silver-self-correction-negation-scope-selftest.cjs",
    ];
  }
  if (id === "self_correction" && name === "self_correction_safety_note_readonly") {
    return [
      "node scripts/silver-self-correction-audit.cjs",
      "node scripts/silver-self-correction-safety-note-readonly-selftest.cjs",
    ];
  }
  const primary = harnessCommandForAuditId(id);
  return primary ? [primary] : ["node scripts/silver-rhc3-cluster-classifier-v1.cjs"];
}

function resolveForcedOutcomeAfterLowProductLoop(registry, prioritized) {
  const top = prioritized && prioritized[0];
  if (top && top.cluster && top.cluster !== "(žádný)" && top.fail_count > 0) {
    const cmds = harnessCommandsForCluster(top.audit_id, top.cluster);
    const exp = expectedOutcomeFor(top);
    if (top.harness_only === "YES" || exp === "harness alignment") {
      return {
        forced_task_type: "cluster_harness_alignment",
        audit_name: top.audit_name,
        audit_id: top.audit_id,
        cluster: top.cluster,
        command: cmds.join(" ; "),
        rationale:
          "CAP selector cluster — harness/gold alignment pro " + top.cluster + " (audit=" + top.audit_name + ").",
      };
    }
    if (
      top.true_engine_fail_confidence === "HIGH" ||
      top.true_engine_fail_confidence === "MEDIUM" ||
      exp.indexOf("engine PR") >= 0
    ) {
      return {
        forced_task_type: "narrow_engine_diagnostic_fix",
        audit_name: top.audit_name,
        audit_id: top.audit_id,
        cluster: top.cluster,
        command: cmds.join(" ; "),
        rationale:
          "CAP selector cluster — úzký engine diagnostic/fix pro " + top.audit_name + " / " + top.cluster + ".",
      };
    }
    return {
      forced_task_type: "cluster_product_diagnostic",
      audit_name: top.audit_name,
      audit_id: top.audit_id,
      cluster: top.cluster,
      command: cmds.join(" ; "),
      rationale:
        "CAP selector cluster — produktová diagnostika pro " + top.cluster + " před dalším orchestration CAP.",
    };
  }

  const staleAudits = registry.audits.filter(
    (a) => a.stale === "YES" && (a.usable_for_cap_selection === "YES" || a.maturity === MATURITY.STALE),
  );
  if (staleAudits.length) {
    const topStale = staleAudits.sort((a, b) => (b.fail_count || 0) - (a.fail_count || 0))[0];
    return {
      forced_task_type: "audit_refresh_proof",
      audit_name: topStale.audit_name,
      audit_id: topStale.audit_id,
      cluster: topStale.top_cluster || "(žádný)",
      command: harnessCommandForAuditId(topStale.audit_id),
      rationale:
        "Stale audit report — obnovit harness/report a doložit PASS před dalším CAP; audit=" + topStale.audit_name,
    };
  }
  const planned = registry.audits.find((a) => a.maturity === MATURITY.PLANNED_ONLY);
  if (planned) {
    return {
      forced_task_type: "audit_expansion",
      audit_name: planned.audit_name,
      audit_id: planned.audit_id,
      cluster: planned.top_cluster || "(žádný)",
      command: "node scripts/silver-audit-registry.cjs report",
      rationale:
        "Planned-only audit — rozšířit Self-Correction / foundation audit před dalším orchestration CAP.",
    };
  }
  const foundation = registry.audits.find(
    (a) => a.maturity === MATURITY.FOUNDATION_ONLY && a.foundation_only === "YES",
  );
  if (foundation) {
    return {
      forced_task_type: "audit_expansion",
      audit_name: foundation.audit_name,
      audit_id: foundation.audit_id,
      cluster: foundation.top_cluster || "(žádný)",
      command: "node scripts/silver-audit-registry.cjs report",
      rationale: "Foundation-only audit — dokončit audit expansion místo dalšího CAP běhu.",
    };
  }
  return {
    forced_task_type: "no_safe_fix_stale_audit_proof",
    audit_name: "(žádný)",
    audit_id: "",
    cluster: "(žádný)",
    command: "node scripts/silver-rhc3-negation-cal-readonly-hard-outcome.cjs",
    rationale:
      "Žádný bezpečný produktový cluster — vytvořit no-safe-fix/stale-audit proof; NEspouštět další CAP naslepo.",
  };
}

function enforceCapOutcome(meta, registry, prioritized) {
  if (meta && meta.scorecard_runtime_error === "YES") {
    const exact = String(meta.exact_error || meta.scorecard_exact_error || "scorecard runtime error");
    return {
      low_product_value_loop: "YES",
      cap_outcome_class: "SCORECARD_RUNTIME_ERROR",
      scorecard_runtime_error: "YES",
      recommendation:
        "HARD_STOP_SCORECARD_RUNTIME_ERROR — fix scorecard runtime error before any CAP retry — " + exact,
      recommended_next_task: "fix scorecard runtime error before any CAP retry",
      hard_stop_forced_outcome_required: "YES",
      next_cap_blind_retry_blocked: "YES",
      exact_error: exact,
      forced_outcome_task_type: "scorecard_runtime_fix",
      forced_outcome_audit_name: "(scorecard)",
      forced_outcome_cluster: "(runtime)",
      forced_outcome_command: "node scripts/silver-cap-product-scorecard.cjs selftest",
      forced_outcome_rationale: "Scorecard finalize spadl — opravit orchestration před dalším CAP.",
    };
  }

  const cycles = Number(meta.cycles_completed) || 0;
  const prCreated = Number(meta.pr_created_count) > 0 || meta.pr_created === "YES";
  const productFix = meta.product_fix_created === "YES" || meta.engine_changed === "YES";
  const trueEngineFound = meta.true_engine_fail_found === "YES";
  const clearExplanation = meta.clear_no_fix_explanation === "YES";
  const orchestrationOnly = meta.orchestration_only_run === "YES";
  const verifiedNo = String(meta.verified_product_shift || "NO").toUpperCase() === "NO";
  const productFixCreatedNo = meta.product_fix_created !== "YES" && !productFix;
  const capLabel = String(meta.cap_label || "").toUpperCase();

  let lowProductLoop = "NO";
  let recommendation = "pokračovat doporučeným CAP během dle priority matrix";
  let hardStopForced = "NO";
  let nextCapBlindBlocked = "NO";
  let forcedTaskType = "";
  let forcedAuditName = "";
  let forcedCluster = "";
  let forcedCommand = "";
  let forcedRationale = "";

  if (!prCreated && !productFix && !trueEngineFound && !clearExplanation) {
    if (orchestrationOnly || cycles >= 1) {
      lowProductLoop = "YES";
      recommendation =
        "Zastavit CAP bez produktového posunu; spustit cluster-specific diagnostiku dle selectoru (ne orchestration-only smyčka).";
    }
  }
  if (lowProductLoop === "YES" && capLabel === "CAP50") {
    recommendation = "STOP CAP50 — LOW_PRODUCT_VALUE_LOOP; použít CAP10–CAP25 na konkrétní TRUE_ENGINE_FAIL cluster.";
  }

  if (
    orchestrationOnly &&
    productFixCreatedNo &&
    verifiedNo &&
    lowProductLoop === "YES"
  ) {
    hardStopForced = "YES";
    nextCapBlindBlocked = "YES";
    const reg = registry || { audits: [] };
    const pri = prioritized || [];
    const forced = resolveForcedOutcomeAfterLowProductLoop(reg, pri);
    forcedTaskType = forced.forced_task_type;
    forcedAuditName = forced.audit_name;
    forcedCluster = forced.cluster;
    forcedCommand = forced.command;
    forcedRationale = forced.rationale;
    recommendation =
      "HARD_STOP_FORCED_OUTCOME_REQUIRED — " +
      forced.forced_task_type +
      ": " +
      forced.audit_name +
      " / " +
      forced.cluster +
      " — " +
      forced.rationale;
  }

  return {
    low_product_value_loop: lowProductLoop,
    cap_outcome_class: lowProductLoop === "YES" ? "LOW_PRODUCT_VALUE_LOOP" : prCreated || productFix ? "PRODUCT" : "DIAGNOSTIC",
    recommendation,
    hard_stop_forced_outcome_required: hardStopForced,
    next_cap_blind_retry_blocked: nextCapBlindBlocked,
    forced_outcome_task_type: forcedTaskType,
    forced_outcome_audit_name: forcedAuditName,
    forced_outcome_cluster: forcedCluster,
    forced_outcome_command: forcedCommand,
    forced_outcome_rationale: forcedRationale,
  };
}

function silverProductTrend(registry, prioritized) {
  const active = registry.audits.filter((a) => a.maturity === MATURITY.ACTIVE || a.maturity === MATURITY.STABLE);
  const top = prioritized[0];
  if (active.length >= 3 && top && top.true_engine_fail_confidence === "HIGH") {
    return "Silver se může zlepšovat produktově — priorita na " + top.audit_name + " / " + top.cluster;
  }
  if (registry.audits.every((a) => a.foundation_only === "YES" || a.maturity === MATURITY.PLANNED_ONLY)) {
    return "Stagnace — většina auditů je foundation/planned; nejdřív audit expansion.";
  }
  if (top && top.harness_only === "YES") {
    return "Cluster pravděpodobně není TRUE_ENGINE_FAIL — spíš harness/gold alignment.";
  }
  return "Zlepšuje se spíš orchestrace — ověřit CAP scorecard a audit maturity před dalším engine PR.";
}

function renderCzechRegistryTable(registry) {
  const lines = ["SILVER_AUDIT_REGISTRY", ""];
  for (const a of registry.audits) {
    lines.push(
      [
        "audit_name=" + a.audit_name,
        "status=" + a.status,
        "maturity=" + a.maturity,
        "last_run=" + a.last_run,
        "last_commit=" + a.last_commit,
        "usable_for_cap_selection=" + a.usable_for_cap_selection,
        "true_engine_fail_clusters=" + a.true_engine_fail_clusters,
        "top_cluster=" + a.top_cluster,
        "safety_risk=" + a.safety_risk,
        "audit_size=" + a.audit_size,
        "stale=" + a.stale,
        "foundation_only=" + a.foundation_only,
        "public_product_impact=" + a.public_product_impact,
      ].join(" | "),
    );
  }
  return lines.join("\n");
}

function renderCzechPriorityMatrix(prioritized, limit) {
  const lines = ["SILVER_AUDIT_PRIORITY_MATRIX", ""];
  const n = limit || 8;
  let i = 0;
  for (const row of prioritized.slice(0, n)) {
    i++;
    const cap = recommendCapType(row, { maturity: row.maturity, foundation_only: "NO" });
    lines.push(String(i) + ".");
    lines.push("Audit: " + row.audit_name);
    lines.push("Cluster: " + row.cluster + " (fails=" + row.fail_count + ")");
    lines.push("Impact: " + row.public_product_impact);
    lines.push("TRUE_ENGINE_FAIL confidence: " + row.true_engine_fail_confidence);
    lines.push("Recommended CAP: " + cap);
    lines.push("Expected outcome: " + expectedOutcomeFor(row));
    lines.push("Risk: " + estimatedRiskFor(row, { maturity: row.maturity }));
    lines.push("");
  }
  return lines.join("\n");
}

function renderFoundationActions(registry) {
  const lines = [];
  let idx = 0;
  for (const a of registry.audits) {
    if (a.maturity !== MATURITY.FOUNDATION_ONLY && a.maturity !== MATURITY.PLANNED_ONLY) continue;
    idx++;
    lines.push(String(idx) + ".");
    lines.push("Audit: " + a.audit_name);
    lines.push("Status: " + a.maturity);
    lines.push("Recommended action: audit expansion");
    lines.push("Risk: LOW");
    lines.push("");
  }
  return lines;
}

function renderNextCapBlock(nextCap) {
  return [
    "SILVER_NEXT_CAP_RECOMMENDATION",
    "",
    "Doporučený CAP: " + nextCap.recommended_cap,
    "Audit: " + nextCap.audit_name,
    "Cluster: " + nextCap.cluster,
    "Očekávaný výsledek: " + nextCap.expected_outcome,
    "Odhad rizika: " + nextCap.estimated_risk,
    "Zdůvodnění: " + nextCap.rationale,
  ].join("\n");
}

function renderCapOutcomeBlock(outcome) {
  const lines = [
    "SILVER_CAP_OUTCOME_ENFORCEMENT",
    "",
    "low_product_value_loop=" + outcome.low_product_value_loop,
    "cap_outcome_class=" + outcome.cap_outcome_class,
    "SCORECARD_RUNTIME_ERROR=" + (outcome.scorecard_runtime_error || "NO"),
    "HARD_STOP_FORCED_OUTCOME_REQUIRED=" + (outcome.hard_stop_forced_outcome_required || "NO"),
    "next_cap_blind_retry_blocked=" + (outcome.next_cap_blind_retry_blocked || "NO"),
    "doporučení=" + outcome.recommendation,
  ];
  if (outcome.scorecard_runtime_error === "YES") {
    lines.push("exact_error=" + (outcome.exact_error || ""));
    lines.push("recommended_next_task=" + (outcome.recommended_next_task || "fix scorecard runtime error before any CAP retry"));
  }
  if (outcome.hard_stop_forced_outcome_required === "YES") {
    lines.push("forced_outcome_task_type=" + (outcome.forced_outcome_task_type || ""));
    lines.push("forced_outcome_audit_name=" + (outcome.forced_outcome_audit_name || ""));
    lines.push("forced_outcome_cluster=" + (outcome.forced_outcome_cluster || ""));
    lines.push("forced_outcome_command=" + (outcome.forced_outcome_command || ""));
    lines.push("forced_outcome_rationale=" + (outcome.forced_outcome_rationale || ""));
  }
  return lines.join("\n");
}

function harnessCommandForAuditId(auditId) {
  const spec = AUDIT_CATALOG.find((a) => a.id === auditId);
  if (!spec || !spec.harness_scripts || !spec.harness_scripts.length) {
    return "node scripts/silver-rhc3-cluster-classifier-v1.cjs";
  }
  return "node scripts/" + spec.harness_scripts[0];
}

/**
 * Authoritative selector → execution runtime handoff (orchestration only).
 * @param {string} repoRoot
 * @param {{ max_autonomous_hard_cycles?: number }} [opts]
 */
function resolveCapRuntimeHandoff(repoRoot, opts) {
  const registry = buildAuditRegistry(repoRoot);
  const prioritized = prioritizeTrueEngineFail(registry);
  const nextCap = selectNextCap(registry, prioritized);
  let capLabel = String(nextCap.recommended_cap || "CAP50").toUpperCase();
  const hardMax = Number(opts && opts.max_autonomous_hard_cycles) || 0;
  if (hardMax > 0 && capLabel === "CAP50") {
    capLabel = "CAP" + String(hardMax);
  }
  const topRow =
    prioritized.find((p) => p.audit_id === nextCap.audit_id && p.cluster === nextCap.cluster) || prioritized[0];
  const clusterDiag =
    nextCap.cluster && nextCap.cluster !== "(žádný)"
      ? {
          source: "silver-audit-registry:" + String(nextCap.audit_id || ""),
          cluster: nextCap.cluster,
          count: topRow ? topRow.fail_count : 0,
          audit_name: nextCap.audit_name,
          audit_id: nextCap.audit_id,
          expected_outcome: nextCap.expected_outcome,
          harness_command: harnessCommandsForCluster(nextCap.audit_id, nextCap.cluster)[0],
          harness_commands: harnessCommandsForCluster(nextCap.audit_id, nextCap.cluster),
          recommended_cap: capLabel,
        }
      : null;
  const handoff = {
    cap_label: capLabel,
    next_cap: nextCap,
    prioritized,
    registry,
    cluster_diag: clusterDiag,
    stale_audit_count: registry.audits.filter((a) => a.stale === "YES").length,
  };
  if (opts && opts.skipClusterLock) return handoff;
  try {
    const { applyClusterLockToHandoff } = require("./silver-cluster-consistency-lock.cjs");
    return applyClusterLockToHandoff(handoff, repoRoot);
  } catch {
    return handoff;
  }
}

function runSelfTest() {
  const td = path.join(require("os").tmpdir(), "silver-audit-registry-selftest-" + Date.now());
  fs.mkdirSync(path.join(td, "scripts"), { recursive: true });
  try {
    execSync("git init", { cwd: td, encoding: "utf8", stdio: "ignore" });
    execSync('git config user.email "selftest@local"', { cwd: td, encoding: "utf8", stdio: "ignore" });
    execSync('git config user.name "selftest"', { cwd: td, encoding: "utf8", stdio: "ignore" });
    fs.writeFileSync(path.join(td, "README.md"), "selftest\n", "utf8");
    execSync("git add README.md", { cwd: td, encoding: "utf8", stdio: "ignore" });
    execSync('git commit -m "selftest"', { cwd: td, encoding: "utf8", stdio: "ignore" });
  } catch {
    /* ignore */
  }

  const headSelf = gitHead(td) || "abc";
  const rcz2 = {
    harness_id: "test",
    generated_at: new Date().toISOString(),
    main_commit: headSelf,
    total_cases: 1000,
    fail: 120,
    pass: 880,
    accuracy: "88.0",
    top_clusters: ["rcz2_retrieval||intent_fail:80", "rcz2_ultra_short_chaos||intent_fail:40"],
  };
  fs.writeFileSync(path.join(td, "scripts", "silver-real-czech-public-ux-corpus-v2-report.json"), JSON.stringify(rcz2));
  fs.writeFileSync(
    path.join(td, "scripts", "silver-real-human-chaos-v3.cjs"),
    "// harness stub\n",
    "utf8",
  );
  const rhc3 = {
    generated_at: new Date().toISOString(),
    main_commit: headSelf,
    total_cases: 5000,
    fail_count: 5,
    pass_count: 4995,
    overall_accuracy: "99.9",
    top_fail_clusters: ["rhc3_negation_cal_readonly:5"],
  };
  fs.writeFileSync(path.join(td, "scripts", "silver-real-human-chaos-v3-report.json"), JSON.stringify(rhc3));

  const reg = buildAuditRegistry(td);
  const pri = prioritizeTrueEngineFail(reg);
  const next = selectNextCap(reg, pri);
  const outcome = enforceCapOutcome(
    {
      cycles_completed: 3,
      pr_created_count: 0,
      orchestration_only_run: "YES",
      product_fix_created: "NO",
      verified_product_shift: "NO",
      cap_label: "CAP25",
    },
    reg,
    pri,
  );

  const headOk = gitHead(td).length >= 7;
  const checks = [];
  checks.push(reg.audits.length === AUDIT_CATALOG.length);
  checks.push(pri.length > 0);
  checks.push(next.recommended_cap && next.audit_name);
  checks.push(outcome.low_product_value_loop === "YES");
  checks.push(outcome.hard_stop_forced_outcome_required === "YES");
  checks.push(outcome.next_cap_blind_retry_blocked === "YES");
  checks.push(String(outcome.recommendation || "").indexOf("HARD_STOP_FORCED_OUTCOME_REQUIRED") >= 0);
  const forced = resolveForcedOutcomeAfterLowProductLoop(reg, pri);
  const topPri = pri[0];
  if (topPri && topPri.cluster) {
    checks.push(forced.cluster === topPri.cluster || String(forced.rationale || "").indexOf(topPri.cluster) >= 0);
  }
  const scorecardCrash = enforceCapOutcome(
    {
      scorecard_runtime_error: "YES",
      exact_error: "repo is not defined",
      cap_label: "CAP25",
    },
    reg,
    pri,
  );
  checks.push(scorecardCrash.scorecard_runtime_error === "YES");
  checks.push(scorecardCrash.hard_stop_forced_outcome_required === "YES");
  checks.push(String(scorecardCrash.recommendation || "").indexOf("HARD_STOP_SCORECARD_RUNTIME_ERROR") >= 0);
  checks.push(String(scorecardCrash.recommendation || "").indexOf("pokračovat doporučeným CAP během") < 0);
  checks.push(headOk);
  const pub = reg.audits.find((a) => a.audit_id === "public_ux");
  checks.push(pub && pub.maturity === MATURITY.ACTIVE);
  const planned = reg.audits.find((a) => a.audit_id === "self_correction");
  checks.push(
    planned &&
      (planned.maturity === MATURITY.PLANNED_ONLY ||
        planned.maturity === MATURITY.ACTIVE ||
        planned.maturity === MATURITY.STABLE ||
        planned.maturity === MATURITY.PARTIAL),
  );
  fs.writeFileSync(
    path.join(td, "scripts", "silver-retrieval-stress-300k-foundation-diagnostic-report.json"),
    JSON.stringify({
      target_cluster: "rcz2_retrieval",
      total_rcz2_retrieval_cases: 12000,
      retrieval_pass_count: 12000,
      intent_fail_count: 0,
    }),
    "utf8",
  );
  const reg2 = buildAuditRegistry(td);
  const pri2 = prioritizeTrueEngineFail(reg2);
  const rcz2Row = pri2.find((r) => r.cluster === "rcz2_retrieval");
  checks.push(!rcz2Row);
  const handoff = resolveCapRuntimeHandoff(td);
  checks.push(handoff.cap_label && handoff.cluster_diag && handoff.cluster_diag.cluster !== "rcz2_retrieval");

  const pass = checks.every(Boolean);
  console.log("=== SILVER_AUDIT_REGISTRY_SELFTEST ===");
  if (!pass) {
    const labels = [
      "catalog_count",
      "priority_rows",
      "next_cap",
      "low_product_loop",
      "hard_stop_forced",
      "next_cap_blind_blocked",
      "hard_stop_recommendation",
      "scorecard_runtime_hard_stop",
      "scorecard_runtime_hard_stop_forced",
      "scorecard_runtime_hard_stop_recommendation",
      "scorecard_no_blind_cap",
      "git_head",
      "pub_active",
      "planned_only",
      "fresh_rcz2_excluded",
      "handoff_not_rcz2",
    ];
    labels.forEach((lbl, i) => {
      if (!checks[i]) console.log("failed_check=" + lbl);
    });
  }
  console.log("SILVER_AUDIT_REGISTRY_SELFTEST=" + (pass ? "PASS" : "FAIL"));
  console.log("audits_catalog_count=" + reg.audits.length);
  console.log("priority_rows=" + pri.length);
  console.log("low_product_loop_detection=" + outcome.low_product_value_loop);
  console.log("=== END_SILVER_AUDIT_REGISTRY_SELFTEST ===");
  try {
    fs.rmSync(td, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
  process.exit(pass ? 0 : 1);
}

function parseArgs(argv) {
  const out = { cmd: "report", repoRoot: path.join(SCRIPT_DIR, ".."), capMeta: {} };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "selftest") out.cmd = "selftest";
    else if (a === "report") out.cmd = "report";
    else if (a === "cap-outcome") out.cmd = "cap-outcome";
    else if (a === "--repo-root" && argv[i + 1]) {
      out.repoRoot = path.resolve(argv[++i]);
    } else if (a.startsWith("--cycles=")) out.capMeta.cycles_completed = parseInt(a.slice(9), 10);
    else if (a.startsWith("--cap-label=")) out.capMeta.cap_label = a.slice(12);
    else if (a === "--orchestration-only") out.capMeta.orchestration_only_run = "YES";
    else if (a === "--pr-created") out.capMeta.pr_created_count = 1;
    else if (a === "--product-fix") out.capMeta.product_fix_created = "YES";
    else if (a === "--verified-product-shift-no") out.capMeta.verified_product_shift = "NO";
    else if (a === "--verified-product-shift-yes") out.capMeta.verified_product_shift = "YES";
    else if (a === "--true-engine-fail") out.capMeta.true_engine_fail_found = "YES";
    else if (a === "--clear-explanation") out.capMeta.clear_no_fix_explanation = "YES";
    else if (a === "--scorecard-runtime-error") out.capMeta.scorecard_runtime_error = "YES";
    else if (a.startsWith("--exact-error=")) out.capMeta.exact_error = a.slice(14);
  }
  return out;
}

function printImplementationResult(opts) {
  const lines = [
    "AUDIT_REGISTRY_IMPLEMENTATION_RESULT",
    "",
    "changed_files=scripts/silver-audit-registry.cjs;scripts/silver-audit-registry.ps1;scripts/silver-autopilot.cjs;scripts/silver-autopilot-loop.ps1;SILVER_AUTOPILOT_README.md",
    "engine_changed=NO",
    "assets_app_changed=NO",
    "audit_registry_added=" + (opts.audit_registry_added || "YES"),
    "maturity_classification_added=" + (opts.maturity_classification_added || "YES"),
    "next_cap_selector_added=" + (opts.next_cap_selector_added || "YES"),
    "true_engine_fail_prioritizer_added=" + (opts.true_engine_fail_prioritizer_added || "YES"),
    "cap_outcome_enforcement_added=" + (opts.cap_outcome_enforcement_added || "YES"),
    "low_product_value_loop_detection_added=" + (opts.low_product_value_loop_detection_added || "YES"),
    "smoke=" + (opts.smoke || "UNKNOWN"),
    "autopilot_status=" + (opts.autopilot_status || "UNKNOWN"),
    "safety_counters=" + (opts.safety_counters || "UNKNOWN"),
    "git_status_clean=" + (opts.git_status_clean || "UNKNOWN"),
    "pr_created=NO",
    "recommended_next_step=" + (opts.recommended_next_step || "node scripts/silver-audit-registry.cjs report"),
  ];
  console.log(lines.join("\n"));
}

function emitFullReport(repoRoot, capMeta) {
  const registry = buildAuditRegistry(repoRoot);
  const prioritized = prioritizeTrueEngineFail(registry);
  const nextCap = selectNextCap(registry, prioritized);
  const outcome = enforceCapOutcome(capMeta || {}, registry, prioritized);
  const trend = silverProductTrend(registry, prioritized);

  const matrixLines = renderCzechPriorityMatrix(prioritized, 6);
  const foundationExtra = renderFoundationActions(registry);
  const blocks = [
    renderCzechRegistryTable(registry),
    "",
    matrixLines,
    foundationExtra.length ? foundationExtra.join("\n") : "",
    renderNextCapBlock(nextCap),
    "",
    renderCapOutcomeBlock(outcome),
    "",
    "SILVER_PRODUCT_TREND",
    trend,
  ].filter((x) => x !== "");

  process.stdout.write(blocks.join("\n") + "\n");
  return { registry, prioritized, nextCap, outcome, trend };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.cmd === "selftest") {
    runSelfTest();
    return;
  }
  if (args.cmd === "cap-outcome") {
    const registry = buildAuditRegistry(args.repoRoot);
    const prioritized = prioritizeTrueEngineFail(registry);
    const o = enforceCapOutcome(args.capMeta, registry, prioritized);
    console.log(renderCapOutcomeBlock(o));
    return;
  }
  emitFullReport(args.repoRoot, args.capMeta);
}

module.exports = {
  AUDIT_CATALOG,
  MATURITY,
  buildAuditRegistry,
  prioritizeTrueEngineFail,
  selectNextCap,
  enforceCapOutcome,
  resolveForcedOutcomeAfterLowProductLoop,
  emitFullReport,
  renderCzechRegistryTable,
  renderCapOutcomeBlock,
  harnessCommandForAuditId,
  harnessCommandsForCluster,
  resolveCapRuntimeHandoff,
  loadFreshAuthoritativeClusterPasses,
  gitHead,
};

if (require.main === module) {
  main();
}
