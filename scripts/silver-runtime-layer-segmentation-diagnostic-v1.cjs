#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const REPO = path.resolve(__dirname, "..");
const APP = path.join(REPO, "assets", "app.js");

const LAYERS = [
  {
    id: "Capability",
    anchors: ["iuSilverLineOCapabilityHelpEngineV1", "silverCapabilityTurn", "assistant.capability"],
    mustNotTouch: ["iuSilverSearchLocalData", "iuSilverApplyFinalFactsCalendarDraftV1"]
  },
  {
    id: "Routing",
    anchors: ["iuSilverBrainRoute", "iuSilverCommandResolutionOrderV1", "processUserTurn"],
    mustNotTouch: ["iuSilverLineOCapabilityHelpEngineV1"]
  },
  {
    id: "Save",
    anchors: [
      "iuSilverApplyFinalFactsCalendarDraftV1",
      "iuSilverApplySaveSearchModeGuardV1",
      "iuSilverCap55StrictNoteLockV1"
    ],
    mustNotTouch: ["iuSilverLineOCapabilityHelpEngineV1"]
  },
  {
    id: "Retrieval",
    anchors: ["iuSilverSearchLocalData", "iuSilverBuildAnswerFromSearch", "iuSilverIsNoteRetrievalIntentV1"],
    mustNotTouch: ["iuSilverLineOCapabilityHelpEngineV1"]
  },
  {
    id: "Continuation",
    anchors: ["iuSilverGovContinuationBumpV1", "iuSilverResolveFollowupReference", "silverConversationAction"],
    mustNotTouch: []
  },
  {
    id: "Orchestration",
    anchors: ["iuSilverMultiModule", "iuSilverLineL", "iuSilverDetermineActionModeV1"],
    mustNotTouch: []
  },
  {
    id: "Persistence",
    anchors: [
      "iuSilverLineNPersistenceSnapshotV1",
      "iuSilverLineNPersistenceRestoreV1",
      "iuSilverGovCompactPersistenceSnapshotV1"
    ],
    mustNotTouch: []
  },
  {
    id: "Governance",
    anchors: [
      "iuSilverSessionStateGovernanceTickV1",
      "iuSilverSessionStateGovernancePeekV1",
      "iuSilverRuntimeDebugSnapshotV1"
    ],
    mustNotTouch: []
  },
  {
    id: "Agenda",
    anchors: ["agendaContext", "iuSilverAgenda", "AgendaSummary"],
    mustNotTouch: []
  },
  {
    id: "DebugProof",
    anchors: ["iuSilverRuntimeDebugSnapshotV1", "calendarReadProbe", "proofWeekdayRuleSnippet"],
    mustNotTouch: []
  }
];

function mainCommit() {
  try {
    return execSync("git rev-parse HEAD", { cwd: REPO, encoding: "utf8" }).trim();
  } catch {
    return "unknown";
  }
}

function countPattern(src, pat) {
  const re = new RegExp(pat.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g");
  const m = src.match(re);
  return m ? m.length : 0;
}

function fnBodyOnly(src, name) {
  const sig = "function " + name;
  const idx = src.indexOf(sig);
  if (idx < 0) return "";
  const brace = src.indexOf("{", idx);
  if (brace < 0) return "";
  let depth = 0;
  for (let j = brace; j < src.length; j++) {
    const ch = src[j];
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) return src.slice(idx, j + 1);
    }
  }
  return src.slice(idx, Math.min(src.length, idx + 800));
}

function main() {
  const src = fs.readFileSync(APP, "utf8");
  const issues = [];
  const layerReport = [];

  for (let i = 0; i < LAYERS.length; i++) {
    const layer = LAYERS[i];
    const hits = [];
    for (let a = 0; a < layer.anchors.length; a++) {
      const c = countPattern(src, layer.anchors[a]);
      if (c > 0) hits.push({ anchor: layer.anchors[a], count: c });
    }
    if (!hits.length) {
      issues.push("missing_layer_anchor:" + layer.id);
    }
    let contamination = [];
    for (let h = 0; h < hits.length; h++) {
      const fnName = hits[h].anchor.indexOf("function") === 0 ? hits[h].anchor.slice(9) : hits[h].anchor;
      const block = fnBodyOnly(src, fnName);
      if (!block && hits[h].anchor.indexOf("function") < 0) {
        const idx = src.indexOf(hits[h].anchor);
        if (idx >= 0) {
          const slice = src.slice(Math.max(0, idx - 200), idx + 4000);
          for (let m = 0; m < layer.mustNotTouch.length; m++) {
            if (slice.indexOf(layer.mustNotTouch[m]) >= 0) {
              contamination.push(layer.id + "->" + layer.mustNotTouch[m] + " near " + hits[h].anchor);
            }
          }
        }
      } else if (block) {
        for (let m = 0; m < layer.mustNotTouch.length; m++) {
          if (block.indexOf(layer.mustNotTouch[m]) >= 0) {
            contamination.push(layer.id + "->" + layer.mustNotTouch[m] + " in " + hits[h].anchor);
          }
        }
      }
    }
    if (layer.id === "Capability") {
      const capFn = fnBodyOnly(src, "iuSilverLineOCapabilityHelpEngineV1");
      if (capFn.indexOf("draftRegistry") >= 0 || capFn.indexOf("processUserTurn(") >= 0) {
        contamination.push("Capability->draft_or_full_router");
      }
    }
    if (layer.id === "Save" && src.indexOf("iuSilverLineOCapabilityHelpEngineV1") >= 0) {
      const saveBlock = src.slice(src.indexOf("iuSilverApplyFinalFactsCalendarDraftV1"), src.indexOf("iuSilverApplyFinalFactsCalendarDraftV1") + 6000);
      if (saveBlock.indexOf("iuSilverSessionStateGovernanceTickV1") < 0 && saveBlock.indexOf("IU_SILVER_STATE_GOVERNANCE") < 0) {
        void 0;
      }
    }
    layerReport.push({
      layer: layer.id,
      anchors: hits,
      contamination: contamination
    });
    for (let c = 0; c < contamination.length; c++) issues.push(contamination[c]);
  }

  const engExport = src.indexOf("iuSilverRuntimeDebugSnapshotV1") >= 0;
  if (!engExport) issues.push("debug_snapshot_not_exported");

  const pass = issues.length === 0;
  const reportPath = path.join(__dirname, "silver-runtime-layer-segmentation-diagnostic-v1-report.json");
  const report = {
    harness_id: "silver_runtime_layer_segmentation_diagnostic_v1",
    main_commit: mainCommit(),
    layers: layerReport,
    cross_layer_contamination: issues,
    PASS_FAIL: pass ? "PASS" : "FAIL"
  };
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2), "utf8");

  console.log("=== SILVER_RUNTIME_LAYER_SEGMENTATION_DIAGNOSTIC_V1 ===");
  console.log("harness_id=silver_runtime_layer_segmentation_diagnostic_v1");
  console.log("main_commit=" + report.main_commit);
  console.log("layers_mapped=" + layerReport.filter(function (x) {
    return x.anchors.length > 0;
  }).length);
  console.log("contamination_count=" + issues.length);
  for (let i = 0; i < layerReport.length; i++) {
    const lr = layerReport[i];
    console.log(
      "layer_" +
        lr.layer +
        "_anchors=" +
        lr.anchors.map(function (a) {
          return a.anchor + ":" + a.count;
        }).join(",")
    );
  }
  if (issues.length) {
    console.log("first_contamination=" + issues[0]);
  } else {
    console.log("first_contamination=(none)");
  }
  console.log("PASS_FAIL=" + (pass ? "PASS" : "FAIL"));
  console.log("=== END_SILVER_RUNTIME_LAYER_SEGMENTATION_DIAGNOSTIC_V1 ===");
  process.exit(pass ? 0 : 1);
}

if (require.main === module) main();

module.exports = { LAYERS };
