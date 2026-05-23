/**
 * Silver Product Gap Audit V1 — shared harness (scripts-only).
 */
"use strict";

const fs = require("fs");
const path = require("path");
const core = require("./rhc-v3-deterministic-core.cjs");
const validator = require("./silver-clean-payload-validator-v1.cjs");
const antiDup = require("./silver-audit-anti-duplication-v1.cjs");
const harness = require("./audit_silver_realistic_mobile_corpus.cjs");
const { loadEngine, ctxForCase, foldCs } = harness;

const REPO = path.resolve(__dirname, "..");

function mainCommit() {
  try {
    return require("child_process").execSync("git rev-parse HEAD", { cwd: REPO, encoding: "utf8" }).trim();
  } catch {
    return "unknown";
  }
}

function evaluateCase(c, turn) {
  const payloadVal = validator.validateCleanPayload(turn, c.input, {
    conversationState: c.conversationState || null,
    searchSemantics: c.searchSemantics || null,
  });
  let pass = payloadVal.pass;
  if (typeof c.extraPass === "function") pass = pass && c.extraPass(turn, c);
  return { pass, payloadVal };
}

function runAudit(opts) {
  const options = opts || {};
  const harnessId = options.harnessId || "silver_product_gap_audit_v1";
  const casesPerFamily = parseInt(process.env.SPG_CASES_PER_FAMILY || options.casesPerFamily || "125", 10);
  const families = options.families || [];
  const templates = options.templates || {};
  const entities = options.entities || {};
  const probes = options.probes || [];
  const reportJson = path.join(__dirname, options.reportFile || harnessId + "-report.json");

  const eng = loadEngine();
  const rawCases = [];
  for (let f = 0; f < families.length; f++) {
    const family = families[f];
    const tpls = templates[family] || ["test {person}"];
    const baseSeed = ((family.length * 982451653) ^ (options.seedSalt || 0)) >>> 0;
    for (let i = 0; i < casesPerFamily; i++) {
      const rng = core.mulberry32((baseSeed ^ (i * 2654435761)) >>> 0);
      let input = String(tpls[i % tpls.length] || "")
        .replace(/\{([a-z_]+)\}/g, function (_, key) {
          const pool = entities[key] || [key];
          return core.pickFrom(rng, pool);
        });
      const mask = core.deriveMutationMask(family, i, baseSeed);
      input = core.applyMutationLayers(input, mask, rng);
      rawCases.push({
        id: family + "_" + String(i).padStart(4, "0"),
        family,
        input,
        group: options.groupForCase ? options.groupForCase(family, input) : "calendar_write",
        conversationState: options.conversationStateForCase ? options.conversationStateForCase(family, input, i) : null,
        searchSemantics: options.searchSemanticsForCase ? options.searchSemanticsForCase(family, input) : null,
        extraPass: options.extraPass,
      });
    }
  }

  const filtered = antiDup.filterUniqueCases(rawCases);
  const cases = filtered.accepted;
  const gov = antiDup.auditGovernanceReport(rawCases);
  let pass = 0;
  const clusterFails = {};
  for (let ci = 0; ci < cases.length; ci++) {
    const c = cases[ci];
    let prev = eng.createEmptyDraft();
    if (c.conversationState && c.conversationState.prevDraft) {
      prev = c.conversationState.prevDraft;
    }
    const turn = eng.processUserTurn(c.input, prev, ctxForCase(c.group));
    const ev = evaluateCase(c, turn);
    if (ev.pass) pass++;
    else {
      const v0 = (ev.payloadVal.violations || [])[0] || "unknown";
      clusterFails[v0] = (clusterFails[v0] || 0) + 1;
    }
  }

  const probeResults = [];
  let probePass = 0;
  for (let pi = 0; pi < probes.length; pi++) {
    const p = probes[pi];
    let prev = eng.createEmptyDraft();
    if (p.prevTurn) {
      const t0 = eng.processUserTurn(p.prevTurn.input, prev, ctxForCase(p.prevTurn.group || p.group));
      prev = t0.draft || prev;
    }
    const turn = eng.processUserTurn(p.input, prev, ctxForCase(p.group));
    let ok = true;
    if (p.intent && String(turn.normalizedIntent || "") !== p.intent) ok = false;
    if (p.checks) {
      const title = foldCs(validator.draftField(turn, "title"));
      const note = foldCs(validator.draftField(turn, "note"));
      const loc = foldCs(validator.draftField(turn, "location"));
      const body = foldCs(validator.draftField(turn, "body"));
      if (p.checks.titleHas && title.indexOf(foldCs(p.checks.titleHas)) < 0) ok = false;
      if (p.checks.noteHas && note.indexOf(foldCs(p.checks.noteHas)) < 0) ok = false;
      if (p.checks.locHas && loc.indexOf(foldCs(p.checks.locHas)) < 0) ok = false;
      if (p.checks.bodyHas && body.indexOf(foldCs(p.checks.bodyHas)) < 0) ok = false;
      if (p.checks.companionTask && !turn.silverCompanionTaskIntent) ok = false;
    }
    if (ok) probePass++;
    probeResults.push({ id: p.id, pass: ok, intent: turn.normalizedIntent });
  }

  const accuracy = cases.length ? pass / cases.length : 1;
  const top = Object.keys(clusterFails)
    .sort((a, b) => clusterFails[b] - clusterFails[a])
    .slice(0, 5)
    .map((k) => ({ cluster: k, count: clusterFails[k] }));

  const report = {
    harness_id: harnessId,
    main_commit: mainCommit(),
    cases_requested: rawCases.length,
    cases_after_anti_duplication: cases.length,
    cases_per_family: casesPerFamily,
    governance: gov.summary,
    accuracy,
    pass_count: pass,
    fail_count: cases.length - pass,
    product_probes: probeResults,
    product_probes_pass: probePass + "/" + probes.length,
    top_fail_clusters: top,
    pass_fail: accuracy >= (options.minAccuracy || 0.9) && probePass === probes.length ? "PASS" : "FAIL",
  };

  fs.writeFileSync(reportJson, JSON.stringify(report, null, 2), "utf8");
  console.log("=== " + harnessId.toUpperCase() + " ===");
  console.log("main_commit=" + report.main_commit);
  console.log("cases_total=" + cases.length);
  console.log("accuracy=" + Math.round(accuracy * 10000) / 100 + "%");
  console.log("product_probes_pass=" + report.product_probes_pass);
  console.log("top_remaining_cluster=" + (top[0] ? top[0].cluster : "NONE"));
  console.log("PASS_FAIL=" + report.pass_fail);
  console.log("=== END_" + harnessId.toUpperCase() + " ===");
  process.exit(report.pass_fail === "PASS" ? 0 : 1);
}

module.exports = { runAudit, mainCommit, evaluateCase };
