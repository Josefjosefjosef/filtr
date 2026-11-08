#!/usr/bin/env node
/**
 * V51.8-c5 semantic gates — refuse population mix-ups and sim-as-prod claims.
 */
import fs from "node:fs";
import path from "node:path";
import { evaluateAuditSemanticConsistencyV518c3 } from "./iu-cj-affiliate-phase3z-audit-semantic-consistency-v51-8-c3.mjs";
import { assertPopulationNotEquated } from "./iu-cj-affiliate-phase3z-329-continuity-v51-8.mjs";

function readJson(dir, name) {
  try {
    return JSON.parse(fs.readFileSync(path.join(dir, name), "utf8"));
  } catch {
    return null;
  }
}

function rule(ruleId, sourceFiles, expected, actual, pass, explanation) {
  return {
    ruleId,
    sourceFiles,
    expectedRelationship: expected,
    actualRelationship: actual,
    result: pass ? "PASS" : "FAIL",
    explanation,
    severity: "error",
  };
}

export function evaluateAuditSemanticConsistencyV518c5(outDir) {
  const base = evaluateAuditSemanticConsistencyV518c3(outDir);
  const rules = [...(base.rules || [])];
  const cont = readJson(outDir, "91-329-continuity.json");
  const criteria = readJson(outDir, "ACCEPTANCE_CRITERIA.json");
  const lkg = readJson(outDir, "LKG_MERGE_SIMULATION.json");
  const capacity = readJson(outDir, "CATALOG_CAPACITY_MODEL.json");
  const schedule = readJson(outDir, "53-schedule-after-deploy.json");
  const timed = readJson(outDir, "CAPACITY_TIMED_RUN.json");

  {
    const pops = cont?.populations || cont?.detailed?.populations || null;
    const a = pops?.original329;
    const b = pops?.currentMiss;
    const check = assertPopulationNotEquated(a, b);
    const claimedSame =
      criteria?.["329_MINUS_305_AS_LOST_IDENTITIES"] === "PASS" ||
      cont?.numericDeltaInterpretedAsLostIdentities === true;
    const ok = !claimedSame && (check.ok === false || !a || !b || a.purpose !== b.purpose);
    rules.push(
      rule(
        "POPULATION_329_VS_MISS_NOT_EQUATED",
        ["91-329-continuity.json", "ACCEPTANCE_CRITERIA.json"],
        "original329 and currentMiss are distinct populations",
        { claimedSame, check },
        !claimedSame,
        claimedSame ? "Audit equated 329−305 as lost identities" : "Populations kept distinct"
      )
    );
  }

  {
    const simProd = lkg?.simulated === true && lkg?.productionApplied === true;
    const claimedProdLkg = criteria?.PRODUCTION_LKG_VERIFIED === "PASS" && lkg?.productionApplied !== true;
    rules.push(
      rule(
        "LKG_SIM_NOT_PROD_CARRY",
        ["LKG_MERGE_SIMULATION.json", "ACCEPTANCE_CRITERIA.json"],
        "Simulated LKG must not claim PRODUCTION_LKG_VERIFIED PASS",
        { simProd, claimedProdLkg, productionApplied: lkg?.productionApplied },
        !simProd && !claimedProdLkg,
        simProd || claimedProdLkg ? "Sim presented as production LKG" : "LKG sim/prod separated"
      )
    );
  }

  {
    const sha = String(timed?.sha || capacity?.runEvidence?.sha || "");
    const after = String(schedule?.afterMergeSha || "");
    const claimedNewThroughput = criteria?.CJ_TIMED_THROUGHPUT === "PASS";
    const ok =
      !claimedNewThroughput ||
      !after ||
      (sha && after && sha.startsWith(after.slice(0, 8)));
    rules.push(
      rule(
        "CAPACITY_SHA_MATCHES_POST_MERGE",
        ["CAPACITY_TIMED_RUN.json", "53-schedule-after-deploy.json", "ACCEPTANCE_CRITERIA.json"],
        "Timed throughput PASS requires measurement on post-merge SHA",
        { sha, after, claimedNewThroughput },
        ok,
        ok ? "Throughput claim consistent" : "Historical timed run presented as new-version throughput"
      )
    );
  }

  {
    const event = String(schedule?.latestSchedule?.event || "");
    const claimed = criteria?.POST_MERGE_SCHEDULE_VERIFIED === "PASS";
    const post = Array.isArray(schedule?.postMergeSchedule) ? schedule.postMergeSchedule : [];
    const ok = !claimed || (event === "schedule" && post.length > 0);
    rules.push(
      rule(
        "SCHEDULE_NOT_DISPATCH_AS_AUTONOMY",
        ["53-schedule-after-deploy.json", "ACCEPTANCE_CRITERIA.json"],
        "POST_MERGE_SCHEDULE_VERIFIED requires schedule event on merge SHA",
        { event, postCount: post.length, claimed },
        ok,
        ok ? "Schedule claim consistent" : "Dispatch/historical schedule presented as post-merge autonomy"
      )
    );
  }

  const failCount = rules.filter((r) => r.result === "FAIL").length;
  return {
    schema: "iu-cj-affiliate-phase3z-audit-semantic-consistency-v51.8-c5",
    AUDIT_SEMANTIC_CONSISTENCY_PASS: failCount === 0,
    failCount,
    rules,
    baseFailCount: base.failCount || 0,
  };
}

export function runSemanticNegativeProbesC5(tmpRoot) {
  const probes = [
    {
      id: "EQ_329_305",
      pack: {
        "91-329-continuity.json": {
          populations: {
            original329: { purpose: "historical_problem_set", uniqueIdentities: 329 },
            currentMiss: { purpose: "current_miss_window", uniqueIdentities: 305 },
          },
          numericDeltaInterpretedAsLostIdentities: true,
        },
        "ACCEPTANCE_CRITERIA.json": { "329_MINUS_305_AS_LOST_IDENTITIES": "PASS" },
      },
      expectFailRule: "POPULATION_329_VS_MISS_NOT_EQUATED",
    },
    {
      id: "SIM_AS_PROD_LKG",
      pack: {
        "LKG_MERGE_SIMULATION.json": { simulated: true, productionApplied: false, carried: 10 },
        "ACCEPTANCE_CRITERIA.json": { PRODUCTION_LKG_VERIFIED: "PASS" },
      },
      expectFailRule: "LKG_SIM_NOT_PROD_CARRY",
    },
    {
      id: "OLD_CAPACITY_AS_NEW",
      pack: {
        "CAPACITY_TIMED_RUN.json": { sha: "0def330e50b78a" },
        "53-schedule-after-deploy.json": { afterMergeSha: "bb22976eec2975" },
        "ACCEPTANCE_CRITERIA.json": { CJ_TIMED_THROUGHPUT: "PASS" },
      },
      expectFailRule: "CAPACITY_SHA_MATCHES_POST_MERGE",
    },
  ];
  const results = [];
  for (const probe of probes) {
    const dir = path.join(tmpRoot, probe.id);
    fs.mkdirSync(dir, { recursive: true });
    // Minimal honest baseline for c3 parents
    fs.writeFileSync(path.join(dir, "03-current-main-sha.json"), JSON.stringify({ sha: "bb22976e" }));
    fs.writeFileSync(
      path.join(dir, "04-current-production-sha.json"),
      JSON.stringify({
        sha: "bb22976e",
        productionSha: "bb22976e",
        productionCodeSha: "bb22976e",
        productionDataVersion: "bb22976e",
        verifiedSha: "bb22976e",
        iuDataVer: "bb22976e",
        codeEqualsDataVersion: false,
        explicitlyStale: false,
      })
    );
    fs.writeFileSync(
      path.join(dir, "72-pages-run.json"),
      JSON.stringify({ runId: "1", authoritativeRunId: "1" })
    );
    fs.writeFileSync(
      path.join(dir, "01-executive-summary.json"),
      JSON.stringify({ pagesRunId: "1", productionSha: "bb22976e" })
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
        PRODUCTION_LKG_VERIFIED: "FAIL",
        CJ_TIMED_THROUGHPUT: "PARTIAL",
        POST_MERGE_SCHEDULE_VERIFIED: "PENDING_OBSERVATION",
      })
    );
    fs.writeFileSync(
      path.join(dir, "53-schedule-after-deploy.json"),
      JSON.stringify({ afterMergeSha: "bb22976e", postMergeSchedule: [], latestSchedule: { event: "schedule" } })
    );
    fs.writeFileSync(
      path.join(dir, "91-329-continuity.json"),
      JSON.stringify({
        populations: {
          original329: { purpose: "historical_problem_set", uniqueIdentities: 329 },
          currentMiss: { purpose: "current_miss_window", uniqueIdentities: 305 },
        },
        numericDeltaInterpretedAsLostIdentities: false,
      })
    );
    fs.writeFileSync(path.join(dir, "CAPACITY_TIMED_RUN.json"), JSON.stringify({ sha: "bb22976eabcdef" }));
    for (const [name, obj] of Object.entries(probe.pack)) {
      fs.writeFileSync(path.join(dir, name), JSON.stringify(obj, null, 2));
    }
    const evalResult = evaluateAuditSemanticConsistencyV518c5(dir);
    const hit = (evalResult.rules || []).find(
      (r) => r.ruleId === probe.expectFailRule && r.result === "FAIL"
    );
    results.push({ id: probe.id, expectFailRule: probe.expectFailRule, detected: !!hit });
  }
  return { ok: results.every((r) => r.detected), results };
}
