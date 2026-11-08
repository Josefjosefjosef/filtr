#!/usr/bin/env node
/**
 * V51.8 continuation-3 semantic gates — LKG/churn/capacity honesty + negative probes.
 */
import fs from "node:fs";
import path from "node:path";
import { evaluateAuditSemanticConsistencyV518c2 } from "./iu-cj-affiliate-phase3z-audit-semantic-consistency-v51-8-c2.mjs";

function readJson(dir, name) {
  try {
    return JSON.parse(fs.readFileSync(path.join(dir, name), "utf8"));
  } catch {
    return null;
  }
}

function rule(ruleId, sourceFiles, expected, actual, pass, explanation, severity, remediation, rootCause) {
  return {
    ruleId,
    sourceFiles,
    expectedRelationship: expected,
    actualRelationship: actual,
    result: pass ? "PASS" : "FAIL",
    explanation,
    severity: severity || "error",
    rootCause: rootCause || "SEMANTIC",
    remediation: remediation || "Fix evidence",
  };
}

export function evaluateAuditSemanticConsistencyV518c3(outDir) {
  const base = evaluateAuditSemanticConsistencyV518c2(outDir);
  const rules = [...(base.rules || [])];
  const report = readJson(outDir, "01-executive-summary.json");
  const delta = readJson(outDir, "PRODUCT_PUBLICATION_DELTA_LEDGER.json");
  const lkg = readJson(outDir, "LKG_MERGE_SIMULATION.json");
  const capacity = readJson(outDir, "CATALOG_CAPACITY_MODEL.json");
  const criteria = readJson(outDir, "ACCEPTANCE_CRITERIA.json");
  const schedule = readJson(outDir, "53-schedule-after-deploy.json");

  {
    const simOnly = lkg?.productionApplied === true && lkg?.simulated === true;
    rules.push(
      rule(
        "LKG_SIMULATION_NOT_PRODUCTION",
        ["LKG_MERGE_SIMULATION.json"],
        "Simulated LKG must not claim productionApplied=true",
        { productionApplied: lkg?.productionApplied, simulated: lkg?.simulated },
        !simOnly,
        simOnly ? "Simulated LKG marked as production" : "LKG production claim consistent",
        "error",
        "Set productionApplied=false until promote after merge",
        "LKG_SIM_AS_PROD"
      )
    );
  }

  {
    const removed = Number(delta?.removedCount || 0);
    const added = Number(delta?.addedCount || 0);
    const net = Number(delta?.netUnique);
    const churnGate = criteria?.IDENTITY_CHURN_GATE_PASS;
    const dangerous =
      removed >= 500 &&
      added >= 500 &&
      Number.isFinite(net) &&
      Math.abs(net) < removed * 0.1 &&
      churnGate === "PASS" &&
      !(lkg?.carried > 0 || criteria?.LKG_IDENTITY_LEDGER_PASS === "PASS");
    rules.push(
      rule(
        "IDENTITY_CHURN_NOT_NET_ONLY",
        ["PRODUCT_PUBLICATION_DELTA_LEDGER.json", "ACCEPTANCE_CRITERIA.json"],
        "Massive identity rotation with net≈0 must not PASS churn without LKG",
        { removed, added, net, churnGate, carried: lkg?.carried },
        !dangerous,
        dangerous ? "Net-stable churn falsely PASSed" : "Churn gate consistent with LKG",
        "error",
        "Require LKG merge or FAIL IDENTITY_CHURN_GATE",
        "CHURN_NET_ONLY"
      )
    );
  }

  {
    const eta = capacity?.estimates?.etaDaysToDrainDeclaredRemaining;
    const reproducible = capacity?.reproducible === true;
    const claimedValidated = criteria?.CATALOG_ETA_VALIDATED === "PASS";
    const ok = !claimedValidated || (reproducible && eta != null);
    rules.push(
      rule(
        "CAPACITY_ETA_REPRODUCIBLE",
        ["CATALOG_CAPACITY_MODEL.json", "ACCEPTANCE_CRITERIA.json"],
        "CATALOG_ETA_VALIDATED PASS only when capacity.reproducible=true",
        { eta, reproducible, claimedValidated },
        ok,
        ok ? "ETA claim consistent" : "ETA PASSed without reproducible model",
        "error",
        "Mark ETA PENDING/FAIL until measured runs reproduce",
        "ETA_UNPROVEN"
      )
    );
  }

  {
    const afterMerge = schedule?.afterMergeSha || schedule?.headSha;
    const event = String(schedule?.latestSchedule?.event || schedule?.event || "");
    const sha = String(schedule?.latestSchedule?.headSha || schedule?.sha || "");
    const claimed = criteria?.SCHEDULE_AFTER_DEPLOY_PASS === "PASS";
    const ok =
      !claimed ||
      (event === "schedule" && afterMerge && sha && sha.startsWith(String(afterMerge).slice(0, 8)));
    rules.push(
      rule(
        "SCHEDULE_AFTER_DEPLOY_REAL",
        ["53-schedule-after-deploy.json", "ACCEPTANCE_CRITERIA.json"],
        "SCHEDULE_AFTER_DEPLOY_PASS requires real schedule event on merge SHA",
        { event, sha, afterMerge, claimed },
        ok,
        ok ? "Schedule claim consistent" : "Historical/dispatch schedule presented as post-deploy",
        "error",
        "Wait for schedule on new SHA or keep PENDING_OBSERVATION",
        "SCHEDULE_STALE"
      )
    );
  }

  {
    const prodData = readJson(outDir, "04-current-production-sha.json");
    const codeSha = String(prodData?.productionCodeSha || prodData?.verifiedSha || "").slice(0, 8);
    const dataVer = String(prodData?.productionDataVersion || prodData?.iuDataVer || "").slice(0, 8);
    const equated = prodData?.codeEqualsDataVersion === true && codeSha && dataVer && codeSha !== dataVer;
    rules.push(
      rule(
        "CODE_SHA_VS_DATA_VERSION",
        ["04-current-production-sha.json"],
        "Do not equate MAIN_CODE_SHA with PRODUCTION_DATA_VERSION",
        { codeSha, dataVer, equated },
        !equated,
        equated ? "Unrelated identifiers equated" : "Version identifiers separated",
        "error",
        "Split PRODUCTION_CODE_SHA vs PRODUCTION_DATA_VERSION fields",
        "SHA_KIND_MIX"
      )
    );
  }

  const failCount = rules.filter((r) => r.result === "FAIL").length;
  return {
    schema: "iu-cj-affiliate-phase3z-audit-semantic-consistency-v51.8-c3",
    AUDIT_SEMANTIC_CONSISTENCY_PASS: failCount === 0,
    failCount,
    rules,
    baseFailCount: base.failCount || 0,
  };
}

/**
 * Negative probes that MUST FAIL (for selftest / evidence).
 */
export function buildSemanticNegativeProbesV518c3() {
  return [
    {
      id: "STALE_PAGES_AS_CURRENT",
      pack: {
        "72-pages-run.json": { runId: "111", authoritativeRunId: "111" },
        "01-executive-summary.json": { pagesRunId: "999" },
      },
      expectFailRule: "PAGES_RUN_AUTHORITATIVE",
    },
    {
      id: "LKG_SIM_AS_PROD",
      pack: {
        "LKG_MERGE_SIMULATION.json": { simulated: true, productionApplied: true, carried: 10 },
      },
      expectFailRule: "LKG_SIMULATION_NOT_PRODUCTION",
    },
    {
      id: "CHURN_NET_ONLY_PASS",
      pack: {
        "PRODUCT_PUBLICATION_DELTA_LEDGER.json": {
          removedCount: 3050,
          addedCount: 2979,
          netUnique: -71,
        },
        "ACCEPTANCE_CRITERIA.json": { IDENTITY_CHURN_GATE_PASS: "PASS" },
        "LKG_MERGE_SIMULATION.json": { simulated: true, productionApplied: false, carried: 0 },
      },
      expectFailRule: "IDENTITY_CHURN_NOT_NET_ONLY",
    },
    {
      id: "ETA_UNPROVEN_PASS",
      pack: {
        "CATALOG_CAPACITY_MODEL.json": {
          reproducible: false,
          estimates: { etaDaysToDrainDeclaredRemaining: 82 },
        },
        "ACCEPTANCE_CRITERIA.json": { CATALOG_ETA_VALIDATED: "PASS" },
      },
      expectFailRule: "CAPACITY_ETA_REPRODUCIBLE",
    },
    {
      id: "SCHEDULE_HISTORICAL_AS_NEW",
      pack: {
        "53-schedule-after-deploy.json": {
          afterMergeSha: "aaaaaaaa",
          latestSchedule: { event: "schedule", headSha: "0def330e" },
        },
        "ACCEPTANCE_CRITERIA.json": { SCHEDULE_AFTER_DEPLOY_PASS: "PASS" },
      },
      expectFailRule: "SCHEDULE_AFTER_DEPLOY_REAL",
    },
    {
      id: "CODE_DATA_SHA_MIX",
      pack: {
        "04-current-production-sha.json": {
          productionCodeSha: "0def330e",
          productionDataVersion: "20260920",
          codeEqualsDataVersion: true,
        },
      },
      expectFailRule: "CODE_SHA_VS_DATA_VERSION",
    },
  ];
}

export function runSemanticNegativeProbesInTemp(tmpRoot) {
  const probes = buildSemanticNegativeProbesV518c3();
  const results = [];
  for (const probe of probes) {
    const dir = path.join(tmpRoot, probe.id);
    fs.mkdirSync(dir, { recursive: true });
    // Minimal honest baseline so only the injected contradiction fails when possible.
    fs.writeFileSync(
      path.join(dir, "03-current-main-sha.json"),
      JSON.stringify({ sha: "0def330e" })
    );
    fs.writeFileSync(
      path.join(dir, "04-current-production-sha.json"),
      JSON.stringify({
        productionCodeSha: "0def330e",
        productionDataVersion: "20260920",
        explicitlyStale: false,
        codeEqualsDataVersion: false,
      })
    );
    fs.writeFileSync(
      path.join(dir, "72-pages-run.json"),
      JSON.stringify({ runId: "1", authoritativeRunId: "1" })
    );
    fs.writeFileSync(
      path.join(dir, "01-executive-summary.json"),
      JSON.stringify({ pagesRunId: "1", productionSha: "0def330e" })
    );
    fs.writeFileSync(
      path.join(dir, "92-feed-inventory-traversal.json"),
      JSON.stringify({ partners: [], summary: { metricsSeparated: true } })
    );
    fs.writeFileSync(
      path.join(dir, "PRODUCT_PUBLICATION_DELTA_LEDGER.json"),
      JSON.stringify({ removedCount: 0, addedCount: 0, netUnique: 0 })
    );
    fs.writeFileSync(
      path.join(dir, "LKG_MERGE_SIMULATION.json"),
      JSON.stringify({ simulated: true, productionApplied: false, carried: 0 })
    );
    fs.writeFileSync(
      path.join(dir, "CATALOG_CAPACITY_MODEL.json"),
      JSON.stringify({ reproducible: false, estimates: {} })
    );
    fs.writeFileSync(
      path.join(dir, "ACCEPTANCE_CRITERIA.json"),
      JSON.stringify({
        IDENTITY_CHURN_GATE_PASS: "FAIL",
        CATALOG_ETA_VALIDATED: "FAIL",
        SCHEDULE_AFTER_DEPLOY_PASS: "PENDING_OBSERVATION",
        LKG_IDENTITY_LEDGER_PASS: "PARTIAL",
      })
    );
    fs.writeFileSync(
      path.join(dir, "53-schedule-after-deploy.json"),
      JSON.stringify({
        afterMergeSha: "0def330e",
        latestSchedule: { event: "schedule", headSha: "0def330eabcdef" },
      })
    );
    for (const [name, obj] of Object.entries(probe.pack)) {
      fs.writeFileSync(path.join(dir, name), JSON.stringify(obj, null, 2));
    }
    const evalResult = evaluateAuditSemanticConsistencyV518c3(dir);
    const hit = (evalResult.rules || []).find(
      (r) => r.ruleId === probe.expectFailRule && r.result === "FAIL"
    );
    results.push({
      id: probe.id,
      expectFailRule: probe.expectFailRule,
      detected: !!hit,
      failCount: evalResult.failCount,
    });
  }
  const allDetected = results.every((r) => r.detected);
  return { ok: allDetected, results };
}
