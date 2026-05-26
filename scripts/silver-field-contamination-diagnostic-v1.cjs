#!/usr/bin/env node
/**
 * SILVER_FIELD_CONTAMINATION_DIAGNOSTIC_V1 — wrapper/note/title/location/reminder/temporal contamination sources.
 */
"use strict";

const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");
const core = require("./rhc-v3-deterministic-core.cjs");
const shared = require("./silver-normalizer-field-ownership-v1-shared.cjs");
const harness = require("./audit_silver_realistic_mobile_corpus.cjs");
const { loadEngine, ctxForCase } = harness;

const REPO = path.resolve(__dirname, "..");
const REPORT_JSON = path.join(__dirname, "silver-field-contamination-diagnostic-v1-report.json");
const CASES = parseInt(process.env.SFC_DIAG_CASES || "400", 10);

const TEMPLATES = [
  "Ulož mi {date} schůzku s {person} v {place} a do poznámky napiš {note}",
  "Připomeň mi {date} {task} a napiš tam {note}",
  "Hele prosím tě {date} {person} v {place} jo a {note}",
  "Chci si uložit schůzku s {person} {date}",
  "Na zítřek mi přidej {event} v {time}",
  "Zapiš mi {event} v {place} a připomeň mi {note}",
];

const ENTITIES = {
  date: ["dnes", "zítra", "v pátek"],
  person: ["Pavlem", "klientem", "právníkem"],
  place: ["Brně", "Praze", "Motole"],
  time: ["15:00", "10:00"],
  event: ["poradu", "schůzku s týmem"],
  task: ["koupit mléko", "servis auta"],
  note: ["vzít smlouvu", "novou nabídku"],
};

function mainCommit() {
  try {
    return execSync("git rev-parse HEAD", { cwd: REPO, encoding: "utf8" }).trim();
  } catch {
    return "";
  }
}

function main() {
  const eng = loadEngine();
  const cases = [];
  for (let i = 0; i < CASES; i++) {
    const rng = core.mulberry32((i * 2654435761) >>> 0);
    let input = TEMPLATES[i % TEMPLATES.length].replace(/\{([a-z_]+)\}/g, function (_, key) {
      return core.pickFrom(rng, ENTITIES[key] || [key]);
    });
    input = core.applyMutationLayers(input, core.deriveMutationMask("contamination", i, 0x6355), rng);
    cases.push({ id: "c_" + i, input, group: "calendar_write" });
  }

  const clusters = {};
  const samples = {};
  let payloadCorruption = 0;
  let overwriteCollisions = 0;
  let cleanupCollisions = 0;
  let fieldOwnerCollisions = 0;

  for (let ci = 0; ci < cases.length; ci++) {
    const c = cases[ci];
    const turn = eng.processUserTurn(c.input, eng.createEmptyDraft(), ctxForCase(c.group));
    const items = shared.classifyContamination(turn, c.input, "post_finalize");
    if (items.length) payloadCorruption++;
    for (let ii = 0; ii < items.length; ii++) {
      const it = items[ii];
      const key = it.contamination_type;
      clusters[key] = (clusters[key] || 0) + 1;
      cleanupCollisions += it.cleanup_collision || 0;
      if (it.field_owner === "title" && (key.indexOf("location") >= 0 || key.indexOf("note") >= 0)) {
        fieldOwnerCollisions++;
      }
      if (!samples[key] || samples[key].length < 4) {
        samples[key] = samples[key] || [];
        samples[key].push({
          input: c.input,
          title: shared.draftField(turn, "title"),
          note: shared.draftField(turn, "note"),
          location: shared.draftField(turn, "location"),
          contamination_source: it.contamination_source,
          contamination_phase: it.contamination_phase,
          field_owner: it.field_owner,
        });
      }
    }
  }

  const rep = {
    harness_id: "silver_field_contamination_diagnostic_v1",
    main_commit: mainCommit(),
    cases_total: cases.length,
    payload_corruption_count: payloadCorruption,
    overwrite_collisions: overwriteCollisions,
    cleanup_collisions: cleanupCollisions,
    field_owner_collisions: fieldOwnerCollisions,
    contamination_sources: Object.keys(clusters).sort(function (a, b) {
      return (clusters[b] || 0) - (clusters[a] || 0);
    }),
    cluster_counts: clusters,
    samples,
  };
  fs.writeFileSync(REPORT_JSON, JSON.stringify(rep, null, 2));

  console.log("=== SILVER_FIELD_CONTAMINATION_DIAGNOSTIC_V1 ===");
  console.log("cases_total=" + cases.length);
  console.log("payload_corruption_count=" + payloadCorruption);
  console.log("overwrite_collisions=" + overwriteCollisions);
  console.log("cleanup_collisions=" + cleanupCollisions);
  console.log("field_owner_collisions=" + fieldOwnerCollisions);
  console.log("contamination_sources=" + rep.contamination_sources.join(","));
  console.log("PASS_FAIL=" + (payloadCorruption <= Math.floor(cases.length * 0.28) ? "PASS" : "FAIL"));
  console.log("=== END_SILVER_FIELD_CONTAMINATION_DIAGNOSTIC_V1 ===");
  process.exit(payloadCorruption <= Math.floor(cases.length * 0.28) ? 0 : 1);
}

if (require.main === module) main();
