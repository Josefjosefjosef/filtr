#!/usr/bin/env node
/**
 * Shared Silver next-action planner quality + deterministic cluster handoff.
 * Scripts-only; no engine / assets changes.
 */
"use strict";

const fs = require("fs");
const path = require("path");

const REPO = path.resolve(__dirname, "..");
const ORCHESTRATOR_REPORT = path.join(__dirname, "silver-pr-orchestrator-v1-report.json");
const RHC3_REPORT = path.join(__dirname, "silver-real-human-chaos-v3-report.json");
const REALISTIC_MOBILE_REPORT = path.join(__dirname, "silver-realistic-mobile-corpus-report.json");

const { resolveCapRuntimeHandoff } = require("./silver-audit-registry.cjs");

/** UTF-8 mis-decoded Czech (Latin-1/Windows-1252 read as UTF-8). */
const SILVER_NEXT_ACTION_MOJIBAKE_RE =
  /Ă|â€|Ĺ|pĹ|Ä›|OtevĹ|ZprĂ|pĹ™ejdÄ|ĂşKOL|ÄŤ|Ĺ™|Ă­|Ăˇ|Ă©/;

const SILVER_NEXT_ACTION_SILVER_WORKFLOW_RE =
  /PRODUCT_CLUSTER|NEXT PRODUCT CLUSTER|silver-rhc3|cluster diagnostic|cluster-classifier|SILVER_RHC3_CLUSTER_CLASSIFIER|harness|audit_silver|SILVER_PRODUCT_CLUSTER|top_cluster=/i;

/** Known stale verify-pr IDs from old backlog / selftest fixtures — never valid cluster tasks. */
const STALE_VERIFY_PR_IDS = new Set(["3794"]);

const GENERIC_INFRA_RE =
  /(?:sudo\s+apt\s+(?:update|install)|gh\s+auth\s+login|(?:--verify-pr=\d+|\bverify-pr\b)|git\s+push\s+-u\s+origin)/i;

const INFRA_BLOCKER_REASON_RE = /INFRA_BLOCKER_REASON:\s*\S+/i;

function readJsonFile(abs) {
  try {
    if (!fs.existsSync(abs)) return { ok: false, data: null, message: "missing" };
    const raw = fs.readFileSync(abs, "utf8");
    return { ok: true, data: JSON.parse(raw), message: "" };
  } catch (e) {
    return { ok: false, data: null, message: String(e.message || e || "json_read_failed") };
  }
}

function parseTopFailClustersFromReport(data) {
  if (!data || typeof data !== "object") return [];
  const arr = data.top_fail_clusters;
  if (!Array.isArray(arr)) return [];
  const out = [];
  for (const row of arr) {
    const s = String(row);
    const idx = s.lastIndexOf(":");
    if (idx <= 0) continue;
    const name = s.slice(0, idx).trim();
    const count = parseInt(s.slice(idx + 1), 10);
    if (!name || !Number.isFinite(count) || count <= 0) continue;
    out.push({ name, count });
  }
  return out;
}

function pickClusterFromAuditRegistry() {
  try {
    const handoff = resolveCapRuntimeHandoff(REPO, {});
    const diag = handoff.cluster_diag;
    if (!diag || !diag.cluster || diag.cluster === "(žádný)") return null;
    return {
      source: String(diag.source || "silver-audit-registry"),
      cluster: String(diag.cluster),
      count: Number(diag.count) || 0,
      audit_name: String(diag.audit_name || ""),
      harness_command: String(diag.harness_command || ""),
      recommended_cap: String(diag.recommended_cap || handoff.cap_label || ""),
      top_preview:
        handoff.prioritized && handoff.prioritized.length
          ? handoff.prioritized
              .slice(0, 8)
              .map((p) => p.cluster + ":" + p.fail_count)
              .join(" | ")
          : "",
    };
  } catch {
    return null;
  }
}

function pickTopClusterDiagnostic() {
  const fromRegistry = pickClusterFromAuditRegistry();
  if (fromRegistry) return fromRegistry;

  const rhc3 = readJsonFile(RHC3_REPORT);
  if (rhc3.ok && rhc3.data) {
    const tops = parseTopFailClustersFromReport(rhc3.data);
    if (tops.length) {
      const t = tops[0];
      return {
        source: "scripts/silver-real-human-chaos-v3-report.json",
        cluster: t.name,
        count: t.count,
        top_preview: tops.slice(0, 8).map((x) => `${x.name}:${x.count}`).join(" | "),
      };
    }
  }
  const mob = readJsonFile(REALISTIC_MOBILE_REPORT);
  if (mob.ok && mob.data) {
    const tops = parseTopFailClustersFromReport(mob.data);
    if (tops.length) {
      const t = tops[0];
      return {
        source: "scripts/silver-realistic-mobile-corpus-report.json",
        cluster: t.name,
        count: t.count,
        top_preview: tops.slice(0, 8).map((x) => `${x.name}:${x.count}`).join(" | "),
      };
    }
    const fc = mob.data.fail_count_by_cluster;
    if (fc && typeof fc === "object") {
      const pairs = Object.keys(fc)
        .map((k) => ({ name: k, count: Number(fc[k]) }))
        .filter((p) => p.name && Number.isFinite(p.count) && p.count > 0)
        .sort((a, b) => b.count - a.count);
      if (pairs.length) {
        const t = pairs[0];
        return {
          source: "scripts/silver-realistic-mobile-corpus-report.json:fail_count_by_cluster",
          cluster: t.name,
          count: t.count,
          top_preview: pairs.slice(0, 8).map((x) => `${x.name}:${x.count}`).join(" | "),
        };
      }
    }
  }
  return {
    source: "(no_cluster_report)",
    cluster: "(unknown)",
    count: 0,
    top_preview: "(no nonzero fail clusters found on disk — run harnesses if needed)",
  };
}

function buildQueueSummaryLines(rep) {
  if (!rep || typeof rep !== "object") return "(no orchestrator report)";
  return [
    `- mode: ${String(rep.mode || "")}`,
    `- queue_safe_to_continue: ${String(rep.queue_safe_to_continue || rep.safe_to_continue || "")}`,
    `- queue_stop_reason: ${String(rep.queue_stop_reason || "")}`,
    `- queue_cycles_completed: ${String(rep.queue_cycles_completed != null ? rep.queue_cycles_completed : "")}`,
    `- apply_stopped_reason: ${String(rep.apply_stopped_reason || "")}`,
    `- apply_merge_attempted/result: ${String(rep.apply_merge_attempted || "")}/${String(rep.apply_merge_result || "")}`,
    `- apply_sync_attempted/result: ${String(rep.apply_sync_attempted || "")}/${String(rep.apply_sync_result || "")}`,
    `- safe_open_candidates: ${String(rep.safe_open_candidates != null ? rep.safe_open_candidates : "")}`,
    `- total_open_prs: ${String(rep.total_open_prs != null ? rep.total_open_prs : "")}`,
    `- error: ${String(rep.error || "")}`,
  ].join("\n");
}

function readOrchestratorReport() {
  const r = readJsonFile(ORCHESTRATOR_REPORT);
  return r.ok ? r.data : null;
}

/**
 * @param {{ mainCommit?: string, queueReport?: object|null, clusterDiag?: object }} ctx
 * @returns {string}
 */
function buildHandoffMarkdown(ctx) {
  const diag = (ctx && ctx.clusterDiag) || pickTopClusterDiagnostic();
  const qrep = (ctx && ctx.queueReport) || readOrchestratorReport() || {};
  const main = String((ctx && ctx.mainCommit) || "").trim();
  return [
    "<!-- SILVER_NEXT_ACTION: silver-auto-dev V1 deterministic handoff; not auto-applied -->",
    "",
    "ÚKOL PRO CURSOR — infoUzel.cz / Silver — NEXT PRODUCT CLUSTER DIAGNOSTIC — NO ENGINE CHANGE + FINAL BEEP",
    "",
    "### Kontext (automaticky)",
    "",
    `- **Aktuální main commit:** \`${main || "(unknown)"}\``,
    "- **PR orchestrátor (poslední běh):** viz shrnutí níže + `scripts/silver-pr-orchestrator-v1-report.json`.",
    "",
    "### Shrnutí fronty safe PR",
    "",
    "```text",
    buildQueueSummaryLines(qrep),
    "```",
    "",
    "### Stav bezpečnosti / scope",
    "",
    "- **Zakázáno:** měnit `assets/app.js`, Silver engine (jádro), UI/CSS/backend jen kvůli diagnostice, GitHub workflows, nekonečné smyčky, surové `-MaxCycles 0` bez řízených pojistek z dokumentace.",
    "- **Povoleno:** skripty pod `scripts/`, audity/diagnostika existujících harnessů, čtení reportů JSON/MD, změny striktně mimo engine dle existující strategie.",
    "",
    "### Diagnostika top clusteru (disk)",
    "",
    `- **Zdroj:** ${diag.source}`,
    `- **Top cluster:** \`${diag.cluster}\` (count=${diag.count})`,
    diag.audit_name ? `- **Audit (registry):** ${diag.audit_name}` : "",
    diag.recommended_cap ? `- **Doporučený CAP (registry):** ${diag.recommended_cap}` : "",
    `- **Náhled top:** ${diag.top_preview}`,
    "",
    "### Kroky (max 7)",
    "",
    "1) `Set-Location C:\\\\projects\\\\filtr`",
    "2) `git status --short` — nesmí být neočekávané změny mimo výslovně povolené reporting soubory.",
    "3) `node scripts/silver-autopilot.cjs --status` — ověř safety/gate signály v konzoli a `SILVER_RUN_REPORT.md`.",
    diag.harness_command && String(diag.harness_command).indexOf("silver-rhc3-cluster-classifier") < 0
      ? `4) Zaměř se na cluster **${diag.cluster}**: nejprve \`${diag.harness_command}\`, pak cílené \`silver-*\` diagnostiky pro tento cluster (manifest v README; nevymýšlej nové cesty).`
      : `4) Zaměř se na cluster **${diag.cluster}**: nejprve \`node scripts/silver-rhc3-cluster-classifier-v1.cjs\`, pak existující \`silver-*\` diagnostické skripty pro tento typ selhání (manifest v README autopilota; nevymýšlej nové cesty).`,
    "5) Pokud reporty JSON ukazují **harness-only** signály vs **true engine fail**, drž se pravidla: nejdřív důkaz z harness JSON (`true_engine_fail_count`, `must_fix_engine_count`, …).",
    "6) `npm run smoke` po jakékoli smysluplné změně skriptů (ne u čistého read-only průzkumu).",
    "7) Výstup vlož do chatu dle bloku níže.",
    "",
    "### Povinný výstup (vlož do chatu)",
    "",
    "```text",
    "=== SILVER_PRODUCT_CLUSTER_DIAGNOSTIC_RESULT ===",
    `main_commit=${main || "(unknown)"}`,
    `top_cluster=${diag.cluster}`,
    `cluster_source=${diag.source}`,
    "engine_touched=NO",
    "assets_app_touched=NO",
    "harness_next_command=(vyplň přesný příkaz, který jsi spustil)",
    "PASS_FAIL=(PASS|FAIL)",
    "=== END_SILVER_PRODUCT_CLUSTER_DIAGNOSTIC_RESULT ===",
    "```",
    "",
    "### FINISH",
    "",
    "Na konci lokálního ověření v PowerShell:",
    "",
    "```powershell",
    "[console]::beep(880, 200)",
    "```",
    "",
  ].join("\n");
}

function silverNextActionHasClusterWorkflow(text) {
  return SILVER_NEXT_ACTION_SILVER_WORKFLOW_RE.test(String(text || ""));
}

function extractStaleVerifyPrIds(text) {
  const out = [];
  const t = String(text || "");
  const re = /--verify-pr=(\d+)/gi;
  let m;
  while ((m = re.exec(t)) !== null) {
    if (STALE_VERIFY_PR_IDS.has(m[1])) out.push(m[1]);
  }
  return out;
}

/**
 * @param {string} text
 * @returns {string[]}
 */
function silverNextActionQualityViolations(text) {
  const t = String(text || "");
  const v = [];
  const clusterWorkflow = silverNextActionHasClusterWorkflow(t);
  if (SILVER_NEXT_ACTION_MOJIBAKE_RE.test(t)) v.push("mojibake_utf8");
  if (!clusterWorkflow) {
    if (/git\s+push\s+-u\s+origin/i.test(t)) v.push("generic_git_push_upstream");
    if (/chore\/silver-audit-repo-state/i.test(t)) v.push("generic_chore_silver_audit_push");
    if (/(?:--verify-pr=\d+|\bverify-pr\b)/i.test(t)) {
      v.push("generic_verify_pr_not_cluster_workflow");
    }
    if (/(?:sudo\s+apt\s+(?:update|install)|gh\s+auth\s+login)/i.test(t)) {
      v.push("generic_gh_sudo_not_cluster_workflow");
    }
    if (/full-auto-loop-openai/i.test(t) && GENERIC_INFRA_RE.test(t)) {
      v.push("generic_full_auto_infra_not_cluster_workflow");
    }
    if (GENERIC_INFRA_RE.test(t) && !INFRA_BLOCKER_REASON_RE.test(t)) {
      v.push("generic_infra_without_blocker_reason");
    }
    const staleIds = extractStaleVerifyPrIds(t);
    if (staleIds.length) {
      v.push("generic_stale_verify_pr_id:" + staleIds.join(","));
    }
  }
  return v;
}

/**
 * Healthy CAP/planner context: no real infra blocker — generic infra tasks are invalid.
 * @param {{ guardBlocked?: boolean, safetyBlocked?: boolean, dirtyBlocked?: boolean }} ctx
 * @returns {boolean}
 */
function isHealthyPlannerContext(ctx) {
  if (!ctx || typeof ctx !== "object") return true;
  if (ctx.guardBlocked) return false;
  if (ctx.safetyBlocked) return false;
  if (ctx.dirtyBlocked) return false;
  return true;
}

/**
 * @param {{ mainCommit?: string, queueReport?: object|null, clusterDiag?: object, plannerContext?: object }} ctx
 * @returns {string}
 */
function buildClusterHandoffForHealthyPlanner(ctx) {
  return buildHandoffMarkdown({
    mainCommit: ctx && ctx.mainCommit,
    queueReport: (ctx && ctx.queueReport) || readOrchestratorReport(),
    clusterDiag: ctx && ctx.clusterDiag,
  });
}

function runPlannerClusterPreferenceSelftest() {
  let ok = true;
  const generic = silverNextActionQualityViolations(
    "<!-- SILVER_NEXT_ACTION: full-auto-loop-openai -->\nsudo apt update\ngh auth login\nnode scripts/silver-autopilot.cjs --verify-pr=3794",
  );
  if (!generic.length) {
    console.error("PLANNER_CLUSTER_SELFTEST_FAIL generic_infra_expected");
    ok = false;
  }
  if (!generic.includes("generic_stale_verify_pr_id:3794")) {
    console.error("PLANNER_CLUSTER_SELFTEST_FAIL stale_verify_pr_expected");
    ok = false;
  }
  const cluster = silverNextActionQualityViolations(
    "ÚKOL PRO CURSOR — NEXT PRODUCT CLUSTER\nnode scripts/silver-rhc3-cluster-classifier-v1.cjs\ntop_cluster=foo",
  );
  if (cluster.length) {
    console.error("PLANNER_CLUSTER_SELFTEST_FAIL cluster_rejected " + cluster.join(";"));
    ok = false;
  }
  const handoff = buildClusterHandoffForHealthyPlanner({ mainCommit: "abc123" });
  if (!silverNextActionHasClusterWorkflow(handoff)) {
    console.error("PLANNER_CLUSTER_SELFTEST_FAIL handoff_missing_markers");
    ok = false;
  }
  if (isHealthyPlannerContext({ guardBlocked: true, safetyBlocked: false, dirtyBlocked: false })) {
    console.error("PLANNER_CLUSTER_SELFTEST_FAIL guard_blocked_must_be_unhealthy");
    ok = false;
  }
  if (ok) console.log("PLANNER_CLUSTER_PREFERENCE_SELFTEST_PASS");
  return ok;
}

module.exports = {
  REPO,
  SILVER_NEXT_ACTION_MOJIBAKE_RE,
  SILVER_NEXT_ACTION_SILVER_WORKFLOW_RE,
  STALE_VERIFY_PR_IDS,
  pickClusterFromAuditRegistry,
  pickTopClusterDiagnostic,
  buildHandoffMarkdown,
  buildClusterHandoffForHealthyPlanner,
  silverNextActionHasClusterWorkflow,
  silverNextActionQualityViolations,
  isHealthyPlannerContext,
  readOrchestratorReport,
  runPlannerClusterPreferenceSelftest,
};
