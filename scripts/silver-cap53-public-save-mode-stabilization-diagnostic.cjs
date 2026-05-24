#!/usr/bin/env node
/**
 * SILVER_CAP53_PUBLIC_SAVE_MODE_STABILIZATION_DIAGNOSTIC — cluster-first CAP53 failures.
 */
"use strict";

const fs = require("fs");
const path = require("path");
const core = require("./rhc-v3-deterministic-core.cjs");
const validator = require("./silver-clean-payload-validator-v1.cjs");
const payloadCore = require("./silver-semantic-payload-engine-v1-core.cjs");
const saveCore = require("./silver-save-understanding-validator-repair-v1-core.cjs");
const antiDup = require("./silver-audit-anti-duplication-v1.cjs");
const harness = require("./audit_silver_realistic_mobile_corpus.cjs");
const { loadEngine, ctxForCase, foldCs } = harness;

const REPO = path.resolve(__dirname, "..");
const REPORT_JSON = path.join(__dirname, "silver-cap53-public-save-mode-stabilization-diagnostic-report.json");

const FAMILIES = [
  "event_note_calendar",
  "event_note_wrapper",
  "pure_note_no_calendar",
  "instruction_prefix_note",
  "voice_mobile_chaos",
  "delayed_note_tail",
];

const TEMPLATES = {
  event_note_calendar: [
    "Silver {date} schůzku s {person} v {place} a do poznámky napiš {note}",
    "hele {date} v {time} doktor {place} jo a připomeň mi {note}",
    "uloz mi tam prosimte ze mam {date} {person} a jeste tam napis {note}",
  ],
  event_note_wrapper: [
    "{date} {person} v {place} dej mi do poznámky {note}",
    "Silver {date} servis v {time} připomeň mi {note}",
  ],
  pure_note_no_calendar: [
    "Silver ulož mi někam že {note}",
    "zapiš si prosím že {note}",
  ],
  instruction_prefix_note: [
    "Silver {date} {person} v {place} do poznámky napiš že {note}",
    "{date} schůzka připomeň mi že {note}",
  ],
  voice_mobile_chaos: [
    "hele prosim te {date} v {time} schuzka s {person} nekde na {place} jo a pripomen mi {note}",
  ],
  delayed_note_tail: [
    "Silver {date} {person} a vlastně {place} připomeň {note}",
  ],
};

const ENTITIES = {
  date: ["zítra", "v pátek", "ve středu", "pondělí"],
  time: ["v 10", "v 9", "odpoledne"],
  place: ["Praha 4", "Vinohradech", "Brně"],
  person: ["Petrem", "pravnikem", "Pavlem", "doktorem"],
  note: ["vzít smlouvy", "roušku", "zavolat Pavlíkovi"],
};

function classifyFailure(c, turn, violations) {
  const v0 = violations[0] || "unknown";
  const fold = foldCs(c.input);
  if (v0 === "event_note_leaked_to_notes_create") {
    if (payloadCore.isNotesModuleContext(c.input)) return "HARNESS_OR_GOLD_PROBLEM";
    if (!payloadCore.isCalendarSchedulingContext(c.input)) return "AMBIGUOUS_USER_INPUT";
    return "TRUE_ENGINE_BUG";
  }
  if (v0 === "instruction_prefix_in_note") return "TRUE_ENGINE_BUG";
  if (v0 === "unknown" && turn.normalizedIntent === "unknown") return "SAFE_CLARIFICATION_OK";
  if (/\bne\s+uklad/.test(fold) && turn.normalizedIntent.indexOf(".create") >= 0) return "SAFETY_RISK";
  if (v0 === "unknown") return "TEMPLATE_DNA_PROBLEM";
  return "TRUE_ENGINE_BUG";
}

function main() {
  const eng = loadEngine();
  const casesPerFamily = parseInt(process.env.SPG_CASES_PER_FAMILY || "120", 10);
  const rawCases = [];
  for (let fi = 0; fi < FAMILIES.length; fi++) {
    const family = FAMILIES[fi];
    const tpls = TEMPLATES[family] || ["test"];
    const baseSeed = ((family.length * 982451653) ^ 5303) >>> 0;
    for (let i = 0; i < casesPerFamily; i++) {
      const rng = core.mulberry32((baseSeed ^ (i * 2654435761)) >>> 0);
      let input = String(tpls[i % tpls.length] || "")
        .replace(/\{([a-z_]+)\}/g, function (_, key) {
          const pool = ENTITIES[key] || [key];
          return core.pickFrom(rng, pool);
        });
      const mask = core.deriveMutationMask(family, i, baseSeed);
      input = core.applyMutationLayers(input, mask, rng);
      rawCases.push({
        id: family + "_" + String(i).padStart(4, "0"),
        family,
        input,
        group: family.indexOf("pure_note") >= 0 ? "note_write" : "calendar_write",
      });
    }
  }
  const filtered = antiDup.filterUniqueCases(rawCases);
  const cases = filtered.accepted;
  const clusterCounts = {};
  const classCounts = {};
  const samples = {};
  let pass = 0;
  for (let ci = 0; ci < cases.length; ci++) {
    const c = cases[ci];
    const turn = eng.processUserTurn(c.input, eng.createEmptyDraft(), ctxForCase(c.group));
    const payloadVal = validator.validateCleanPayload(turn, c.input);
    const saveVal = saveCore.validateSaveUnderstanding(turn, c.input);
    const violations = payloadVal.violations.concat(saveVal.issues.filter(function (x) {
      return payloadVal.violations.indexOf(x) < 0;
    }));
    const ok = payloadVal.pass && saveVal.pass;
    if (ok) pass++;
    else {
      const v0 = violations[0] || "unknown";
      clusterCounts[v0] = (clusterCounts[v0] || 0) + 1;
      const cls = classifyFailure(c, turn, violations);
      classCounts[cls] = (classCounts[cls] || 0) + 1;
      if (!samples[v0]) samples[v0] = [];
      if (samples[v0].length < 5) {
        samples[v0].push({
          id: c.id,
          input: c.input.slice(0, 160),
          intent: turn.normalizedIntent,
          classification: cls,
          violations: violations.slice(0, 4),
        });
      }
    }
  }
  const accuracy = cases.length ? pass / cases.length : 1;
  const top = Object.keys(clusterCounts)
    .sort(function (a, b) {
      return clusterCounts[b] - clusterCounts[a];
    })
    .slice(0, 8)
    .map(function (k) {
      return { cluster: k, count: clusterCounts[k] };
    });
  const report = {
    harness_id: "silver_cap53_public_save_mode_stabilization_diagnostic",
    cases_total: cases.length,
    accuracy,
    pass_count: pass,
    fail_count: cases.length - pass,
    top_fail_clusters: top,
    failure_classification: classCounts,
    samples,
    event_note_leaked_to_notes_create_count: clusterCounts.event_note_leaked_to_notes_create || 0,
    instruction_prefix_in_note_count: clusterCounts.instruction_prefix_in_note || 0,
    pass_fail: (clusterCounts.event_note_leaked_to_notes_create || 0) === 0 ? "PASS" : "FAIL",
  };
  fs.writeFileSync(REPORT_JSON, JSON.stringify(report, null, 2), "utf8");
  console.log("=== SILVER_CAP53_PUBLIC_SAVE_MODE_STABILIZATION_DIAGNOSTIC ===");
  console.log("cases_total=" + cases.length);
  console.log("accuracy=" + Math.round(accuracy * 10000) / 100 + "%");
  console.log(
    "event_note_leaked_to_notes_create_count=" + (clusterCounts.event_note_leaked_to_notes_create || 0)
  );
  console.log("instruction_prefix_in_note_count=" + (clusterCounts.instruction_prefix_in_note || 0));
  console.log("top_remaining_cluster=" + (top[0] ? top[0].cluster : "NONE"));
  console.log("PASS_FAIL=" + report.pass_fail);
  console.log("=== END_SILVER_CAP53_PUBLIC_SAVE_MODE_STABILIZATION_DIAGNOSTIC ===");
  process.exit(report.pass_fail === "PASS" ? 0 : 1);
}

main();
