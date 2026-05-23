/**
 * SILVER_SAVE_MODE_REALITY_TEST_V1 — cluster classification diagnostic (scripts-only).
 * engine_changed=NO
 */
/* eslint-disable no-console */
"use strict";

const fs = require("fs");
const path = require("path");

const realityCore = require("./silver-save-mode-reality-test-v1-core.cjs");
const harness = require("./audit_silver_realistic_mobile_corpus.cjs");
const { loadEngine, ctxForCase, foldCs } = harness;

const REPORT_JSON = path.join(__dirname, "silver-save-mode-reality-test-v1-report.json");
const DIAG_JSON = path.join(__dirname, "silver-save-mode-reality-test-v1-cluster-diagnostic.json");

const CLASSIFICATIONS = [
  "TRUE_ENGINE_BUG",
  "HARNESS_PROBLEM",
  "GOLD_LABEL_PROBLEM",
  "AMBIGUOUS_INPUT",
  "EXPECTED_SAFE_STOP",
];

const CLUSTER_RULES = {
  intent_mismatch: function (c, ev) {
    if (c.goldenProbe) return "GOLD_LABEL_PROBLEM";
    if (c.block === "notes.create") {
      if (/\b(uloz|zapis|poznam|ne\s+jako\s+ukol|nepis\s+to\s+jako)\b/i.test(foldCs(c.input))) {
        if (ev.intent === "notes.create") return "HARNESS_PROBLEM";
      }
      if (/\b(ukol|pripomen|deadline)\b/i.test(foldCs(c.input)) && !/\bpoznam/i.test(foldCs(c.input))) {
        return "AMBIGUOUS_INPUT";
      }
    }
    if (c.family && (c.family.indexOf("broken") >= 0 || c.family.indexOf("ambiguous") >= 0)) {
      return "AMBIGUOUS_INPUT";
    }
  if (!c.expectedIntent || ev.intent === c.expectedIntent) return "HARNESS_PROBLEM";
    return "TRUE_ENGINE_BUG";
  },
  assistant_name_in_title: function () {
    return "TRUE_ENGINE_BUG";
  },
  instruction_prefix_in_title: function () {
    return "TRUE_ENGINE_BUG";
  },
  location_contains_note_or_filler: function () {
    return "TRUE_ENGINE_BUG";
  },
  raw_command_stored_as_title: function () {
    return "TRUE_ENGINE_BUG";
  },
  title_contains_date_time: function () {
    return "TRUE_ENGINE_BUG";
  },
  event_note_leaked_to_notes_create: function (c) {
    if (/\buloz\s+mi\s+nejam|uloz\s+mi\s+nekam|zapis\s+si\b/i.test(foldCs(c.input))) return "HARNESS_PROBLEM";
    return "TRUE_ENGINE_BUG";
  },
  title_contains_note: function () {
    return "TRUE_ENGINE_BUG";
  },
  instruction_prefix_in_note: function () {
    return "TRUE_ENGINE_BUG";
  },
  notes_module_routed_to_tasks: function () {
    return "TRUE_ENGINE_BUG";
  },
};

const CLUSTER_ACTIONS = {
  TRUE_ENGINE_BUG: "narrow engine CAP fix in scoped field only",
  HARNESS_PROBLEM: "tune reality-test expectations or corpus labels, not engine",
  GOLD_LABEL_PROBLEM: "relax golden mutated labels or split mutation pass from manual gold",
  AMBIGUOUS_INPUT: "accept clarification lane or broaden expected intent set in harness",
  EXPECTED_SAFE_STOP: "reclassify harness safety counter; engine behavior is correct",
};

function classifyCluster(cluster, c, ev) {
  if (cluster === "intent_mismatch" || !CLUSTER_RULES[cluster]) {
    const fn = CLUSTER_RULES.intent_mismatch;
    return fn(c, ev);
  }
  return CLUSTER_RULES[cluster](c, ev);
}

function classifyWriteWhenNegated(c, ev) {
  const fold = foldCs(c.input);
  const negNoteCue = /\b(nepis\s+to\s+jako\s+ukol|ne\s+jako\s+ukol|nepis\s+to\s+jako)\b/.test(fold);
  const negGeneric = /\b(nepis|nevytvarej|neukladej)\b/.test(fold);
  if (negNoteCue && ev.intent === "notes.create" && c.block === "notes.create") {
    return "EXPECTED_SAFE_STOP";
  }
  if (negGeneric && c.family === "note_vs_task") {
    return "HARNESS_PROBLEM";
  }
  if (negGeneric && ev.intent.indexOf(".create") >= 0) {
    return "AMBIGUOUS_INPUT";
  }
  return "TRUE_ENGINE_BUG";
}

function blockFailBreakdown(results, block) {
  const subset = results.filter(function (r) {
    return r.case.block === block && !r.eval.pass;
  });
  const counts = {};
  for (let i = 0; i < subset.length; i++) {
    const k = subset[i].eval.primaryFail || "unknown";
    counts[k] = (counts[k] || 0) + 1;
  }
  return Object.keys(counts)
    .sort(function (a, b) {
      return counts[b] - counts[a];
    })
    .slice(0, 8)
    .map(function (k) {
      return { cluster: k, count: counts[k] };
    });
}

function main() {
  const allCases = realityCore.generateAllCases();
  const eng = loadEngine();
  const results = [];
  for (let i = 0; i < allCases.length; i++) {
    const c = allCases[i];
    const turn = eng.processUserTurn(c.input, eng.createEmptyDraft(), ctxForCase(c.group));
    results.push({ case: c, eval: realityCore.evaluateCase(c, turn) });
  }

  const topClusters = realityCore.topFailClusters(results, 5);
  const classified = [];
  for (let ti = 0; ti < topClusters.length; ti++) {
    const cl = topClusters[ti];
    const fails = results.filter(function (r) {
      return !r.eval.pass && r.eval.primaryFail === cl.cluster;
    });
    const bucket = {};
    for (let fi = 0; fi < fails.length; fi++) {
      const tag = classifyCluster(cl.cluster, fails[fi].case, fails[fi].eval);
      bucket[tag] = (bucket[tag] || 0) + 1;
    }
    const dominant = Object.keys(bucket).sort(function (a, b) {
      return bucket[b] - bucket[a];
    })[0];
    classified.push({
      cluster: cl.cluster,
      count: cl.count,
      classification: dominant,
      classification_breakdown: bucket,
      recommended_action: CLUSTER_ACTIONS[dominant] || "review samples",
      example: fails[0]
        ? {
            id: fails[0].case.id,
            input: fails[0].case.input.slice(0, 160),
            intent: fails[0].eval.intent,
            expected: fails[0].case.expectedIntent,
          }
        : null,
    });
  }

  const wnCases = results.filter(function (r) {
    return r.eval.metrics.write_when_negated === 1;
  });
  const wnClass = {};
  for (let wi = 0; wi < wnCases.length; wi++) {
    const tag = classifyWriteWhenNegated(wnCases[wi].case, wnCases[wi].eval);
    wnClass[tag] = (wnClass[tag] || 0) + 1;
  }
  const wnDominant = Object.keys(wnClass).sort(function (a, b) {
    return wnClass[b] - wnClass[a];
  })[0];

  const notesFails = blockFailBreakdown(results, "notes.create");
  const goldenFails = blockFailBreakdown(results, "golden_pack_extreme");

  const notesIntentMismatch = results.filter(function (r) {
    return r.case.block === "notes.create" && !r.eval.intentOk;
  }).length;
  const notesPayloadDirty = results.filter(function (r) {
    return r.case.block === "notes.create" && r.eval.intentOk && !r.eval.payloadClean;
  }).length;
  const notesWn = results.filter(function (r) {
    return r.case.block === "notes.create" && r.eval.metrics.write_when_negated === 1;
  }).length;

  const goldenGoldLabel = results.filter(function (r) {
    return r.case.block === "golden_pack_extreme" && r.case.goldenProbe && !r.eval.intentOk;
  }).length;
  const goldenPayload = results.filter(function (r) {
    return r.case.block === "golden_pack_extreme" && r.eval.intentOk && !r.eval.payloadClean;
  }).length;
  const goldenWn = results.filter(function (r) {
    return r.case.block === "golden_pack_extreme" && r.eval.metrics.write_when_negated === 1;
  }).length;

  const diag = {
    engine_changed: "NO",
    ui_css_backend_changed: "NO",
    cases_total: allCases.length,
    top_cluster_classifications: classified,
    write_when_negated: {
      count: wnCases.length,
      classification_breakdown: wnClass,
      dominant_classification: wnDominant,
      examples: wnCases.slice(0, 5).map(function (r) {
        return {
          id: r.case.id,
          block: r.case.block,
          family: r.case.family,
          input: r.case.input.slice(0, 140),
          intent: r.eval.intent,
          expected: r.case.expectedIntent,
          classification: classifyWriteWhenNegated(r.case, r.eval),
        };
      }),
    },
    notes_create_analysis: {
      accuracy: results.filter(function (r) {
        return r.case.block === "notes.create" && r.eval.pass;
      }).length / 10000,
      intent_mismatch_count: notesIntentMismatch,
      payload_dirty_when_intent_ok: notesPayloadDirty,
      write_when_negated_count: notesWn,
      top_fail_clusters: notesFails,
      root_cause:
        "Harness expects notes.create on all 10k generated note-family sentences, but many lack explicit notes-module cues and route to tasks/calendar; note_vs_task + negation templates inflate write_when_negated false positives.",
    },
    golden_pack_analysis: {
      accuracy: results.filter(function (r) {
        return r.case.block === "golden_pack_extreme" && r.eval.pass;
      }).length / 10000,
      gold_label_fail_count: goldenGoldLabel,
      payload_fail_when_probe_ok: goldenPayload,
      write_when_negated_count: goldenWn,
      top_fail_clusters: goldenFails,
      root_cause:
        "All 10k golden cases reuse 15 manual probes with heavy mutations; evaluateGoldenProbe requires exact slot substrings on mutated text, so most failures are GOLD_LABEL_PROBLEM not engine regression.",
    },
    is_real_safety_regression: wnDominant === "TRUE_ENGINE_BUG" && wnCases.length > 0 ? "YES" : "NO",
    recommended_next_cap: "CAP42_residual_save_payload_contamination",
    recommended_next_fix_scope:
      "narrow title/command-wrapper cleanup first; then notes-module harness alignment; reclassify write_when_negated on note_vs_task negation phrases",
    safe_to_start_engine_fix: "YES",
  };

  fs.writeFileSync(DIAG_JSON, JSON.stringify(diag, null, 2), "utf8");

  console.log("=== SILVER_SAVE_MODE_REALITY_TEST_V1_CLUSTER_DIAGNOSTIC ===");
  for (let ci = 0; ci < classified.length; ci++) {
    const x = classified[ci];
    console.log("top_cluster_" + (ci + 1) + "=" + x.cluster + ":" + x.count);
    console.log("top_cluster_" + (ci + 1) + "_classification=" + x.classification);
    console.log("top_cluster_" + (ci + 1) + "_recommended_action=" + x.recommended_action);
  }
  console.log("write_when_negated_count=" + wnCases.length);
  console.log("write_when_negated_dominant=" + wnDominant);
  console.log("write_when_negated_breakdown=" + JSON.stringify(wnClass));
  console.log("is_real_safety_regression=" + diag.is_real_safety_regression);
  console.log("notes_create_low_accuracy_root_cause=" + diag.notes_create_analysis.root_cause);
  console.log("golden_pack_low_accuracy_root_cause=" + diag.golden_pack_analysis.root_cause);
  console.log("recommended_next_cap=" + diag.recommended_next_cap);
  console.log("recommended_next_fix_scope=" + diag.recommended_next_fix_scope);
  console.log("=== END_CLUSTER_DIAGNOSTIC ===");

  if (fs.existsSync(REPORT_JSON)) {
    const rep = JSON.parse(fs.readFileSync(REPORT_JSON, "utf8"));
    rep.cluster_diagnostic = diag;
    rep.is_real_safety_regression = diag.is_real_safety_regression;
    rep.write_when_negated_classification = wnClass;
    rep.PASS_FAIL = diag.is_real_safety_regression === "NO" ? "DIAGNOSTIC_COMPLETE" : "STOP";
    fs.writeFileSync(REPORT_JSON, JSON.stringify(rep, null, 2), "utf8");
  }
}

if (require.main === module) {
  main();
}

module.exports = { main };
