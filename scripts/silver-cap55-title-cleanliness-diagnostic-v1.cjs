#!/usr/bin/env node
/**
 * SILVER_CAP55_TITLE_CLEANLINESS_DIAGNOSTIC_V1 — instruction_prefix + raw_command title clusters.
 */
"use strict";

const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");
const validator = require("./silver-clean-payload-validator-v1.cjs");
const payloadCore = require("./silver-semantic-payload-engine-v1-core.cjs");
const harness = require("./audit_silver_realistic_mobile_corpus.cjs");
const core = require("./rhc-v3-deterministic-core.cjs");
const { loadEngine, ctxForCase, foldCs } = harness;

const REPO = path.resolve(__dirname, "..");
const REPORT_JSON = path.join(__dirname, "silver-cap55-title-cleanliness-diagnostic-v1-report.json");

const FAMILIES = [
  "instruction_prefix_title",
  "raw_command_title_cluster",
  "filler_phrase_save_commands",
  "mobile_voice_payloads",
  "title_pollution_cleanup",
];

const TEMPLATES = {
  instruction_prefix_title: [
    "zapiš mi {event} zítra v {time}",
    "hele prosím tě {event} v pátek v {time}",
    "nezapomeň hoď tam zítra {event}",
    "do kalendáře naplánuj {event} v {time}",
    "dej tam zítra v {time} {event}",
  ],
  raw_command_title_cluster: [
    "zapiš mi tam zítra v {time} {event}",
    "uloz mi tam prosimte ze mam zitra v {time} {event}",
    "hele zapiš mi zítra v {time} schůzku s {person}",
  ],
  filler_phrase_save_commands: [
    "prostě zapiš do kalendáře zítra v {time} {event}",
    "no jo ulož mi zítra {event} v {time}",
  ],
  mobile_voice_payloads: [
    "uloz mi tam prosimte ze mam zitra v {time} {event} a jeste tam napis {note}",
  ],
  title_pollution_cleanup: [
    "potřebuju zítra v {time} {event} v {place}",
    "mám mít zítra v {time} {event}",
  ],
};

const ENTITIES = {
  time: ["8:00", "9:30", "14:00", "17:00"],
  event: ["schůzku s právníkem", "trénink", "zubaře", "poradu", "prezentaci"],
  person: ["Pavlem", "Markem", "Karlem"],
  place: ["Praze", "Brně"],
  note: ["jít nalačno", "vzít smlouvy"],
};

function classifyViolation(v) {
  if (v === "instruction_prefix_in_title") return "instruction_prefix_in_title";
  if (v === "raw_command_stored_as_title") return "raw_command_stored_as_title";
  if (v.indexOf("title") >= 0) return "title_other";
  return v;
}

function main() {
  const eng = loadEngine();
  const casesPerFamily = parseInt(process.env.CAP55_TITLE_CASES || "80", 10);
  const cases = [];
  for (let fi = 0; fi < FAMILIES.length; fi++) {
    const family = FAMILIES[fi];
    const tpls = TEMPLATES[family] || TEMPLATES.instruction_prefix_title;
    const baseSeed = ((family.length * 982451653) ^ 0x6355) >>> 0;
    for (let i = 0; i < casesPerFamily; i++) {
      const rng = core.mulberry32((baseSeed ^ (i * 2654435761)) >>> 0);
      let input = String(tpls[i % tpls.length] || "").replace(/\{([a-z_]+)\}/g, function (_, key) {
        return core.pickFrom(rng, ENTITIES[key] || [key]);
      });
      input = core.applyMutationLayers(input, core.deriveMutationMask(family, i, baseSeed), rng);
      cases.push({ id: family + "_" + i, family, input, group: "calendar_write" });
    }
  }

  const clusters = {};
  const samples = {};
  let pass = 0;
  for (let ci = 0; ci < cases.length; ci++) {
    const c = cases[ci];
    const turn = eng.processUserTurn(c.input, eng.createEmptyDraft(), ctxForCase(c.group));
    const pv = validator.validateCleanPayload(turn, c.input);
    const title = validator.draftField(turn, "title");
    const titleViolations = (pv.violations || []).filter(function (v) {
      return v === "instruction_prefix_in_title" || v === "raw_command_stored_as_title";
    });
    if (titleViolations.length === 0) pass++;
    else {
      for (let vi = 0; vi < titleViolations.length; vi++) {
        const key = classifyViolation(titleViolations[vi]);
        clusters[key] = (clusters[key] || 0) + 1;
        if (!samples[key] || samples[key].length < 5) {
          samples[key] = samples[key] || [];
          samples[key].push({ input: c.input, title, intent: turn.normalizedIntent, violations: titleViolations });
        }
      }
    }
  }

  const instructionPrefix = clusters.instruction_prefix_in_title || 0;
  const rawCommand = clusters.raw_command_stored_as_title || 0;
  const rep = {
    harness_id: "silver_cap55_title_cleanliness_diagnostic_v1",
    main_commit: execSync("git rev-parse HEAD", { cwd: REPO, encoding: "utf8" }).trim(),
    cases_total: cases.length,
    pass,
    fail: cases.length - pass,
    instruction_prefix_in_title_count: instructionPrefix,
    raw_command_stored_as_title_count: rawCommand,
    top_fail_cluster: Object.keys(clusters)
      .sort(function (a, b) {
        return clusters[b] - clusters[a];
      })
      .slice(0, 5)
      .join(","),
    leakage_examples: samples,
    PASS_FAIL: instructionPrefix === 0 && rawCommand === 0 ? "PASS" : "FAIL",
  };
  fs.writeFileSync(REPORT_JSON, JSON.stringify(rep, null, 2), "utf8");
  console.log("=== SILVER_CAP55_TITLE_CLEANLINESS_DIAGNOSTIC_V1 ===");
  console.log("cases_total=" + rep.cases_total);
  console.log("pass=" + rep.pass + "/" + rep.cases_total);
  console.log("instruction_prefix_in_title_count=" + instructionPrefix);
  console.log("raw_command_stored_as_title_count=" + rawCommand);
  console.log("top_fail_cluster=" + rep.top_fail_cluster);
  console.log("PASS_FAIL=" + rep.PASS_FAIL);
  console.log("=== END_SILVER_CAP55_TITLE_CLEANLINESS_DIAGNOSTIC_V1 ===");
  if (rep.PASS_FAIL !== "PASS") process.exit(1);
}

main();
