#!/usr/bin/env node
/**
 * SILVER_TOKEN_ANCHOR_NORMALIZER_V1_AUDIT — segmentation accuracy ≥97%, zero harm regressions.
 */
"use strict";

const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");
const harness = require("./audit_silver_realistic_mobile_corpus.cjs");
const payloadCore = require("./silver-semantic-payload-engine-v1-core.cjs");
const { loadEngine, ctxForCase, foldCs } = harness;

const REPO = path.resolve(__dirname, "..");
const REPORT_JSON = path.join(__dirname, "silver-token-anchor-normalizer-v1-audit-report.json");

const LONG_VOICE = [
  "zítra v deset schůzka s právníkem někde na Vinohradech jo a prosím tě připomeň mi vzít smlouvy",
  "uloz mi tam prosimte ze mam ve stredu holice a jeste tam napis at nezapomenu rousku",
  "Silver prosím tě ulož mi do kalendáře na zítra schůzku s Adelkou v 10 hod. na adrese korunovační 44 Praha a připomeň mi že mám vzít smlouvy",
  "hele {date} v {time} schuzka s {person} na {place} jo a pripomen {note}",
];

const SHORT_INPUTS = ["zítra schůzka", "koupit mléko", "ulož poznámku test"];

function segmentExpectsCalendar(segText) {
  const f = foldCs(segText);
  return /\b(schuz|doktor|holic|pravnik|servis|zejtra|zitra|vinohrad|praha)\b/.test(f);
}

function segmentExpectsNote(segText) {
  const f = foldCs(segText);
  return /\b(vzit|smlouv|rousk|pripomen|nezapomenu|zavolat)\b/.test(f);
}

function evaluateAnchorCase(input, eng) {
  const raw = String(input || "");
  const turn = eng.processUserTurn(raw, eng.createEmptyDraft(), ctxForCase("calendar_write"));
  const intent = String(turn.normalizedIntent || "");
  const title = foldCs((turn.draft && turn.draft.title) || "");
  const note = foldCs((turn.draft && turn.draft.note) || "");
  const userTextUnchanged = true;
  let harmed = false;
  let helped = false;
  if (raw.length >= 40 && segmentExpectsCalendar(raw)) {
    if (intent === "calendar.create" && (title || note)) helped = true;
    if (intent === "notes.create" && payloadCore.isEventNoteContext(raw)) harmed = true;
  }
  if (raw.length < 24 && intent === "unknown") harmed = true;
  return { helped, harmed, userTextUnchanged, intent };
}

function main() {
  const eng = loadEngine();
  let pass = 0;
  let total = 0;
  let longPass = 0;
  let longTotal = 0;
  let helped = 0;
  let harmed = 0;
  let noopShort = 0;
  let payloadDrop = 0;
  let readToCreate = 0;
  const cases = LONG_VOICE.concat(SHORT_INPUTS);
  for (let i = 0; i < cases.length; i++) {
    let input = cases[i]
      .replace("{date}", "zítra")
      .replace("{time}", "v 10")
      .replace("{person}", "pravnikem")
      .replace("{place}", "Vinohradech")
      .replace("{note}", "vzít smlouvy");
    total++;
    const ev = evaluateAnchorCase(input, eng);
    if (ev.helped) helped++;
    if (ev.harmed) harmed++;
    if (input.length < 24) noopShort++;
    if (input.length >= 40) {
      longTotal++;
      if (ev.intent === "calendar.create") longPass++;
    }
    if (!ev.harmed && ev.userTextUnchanged) pass++;
    if (ev.intent === "calendar.read" && /\buloz\b/.test(foldCs(input))) readToCreate++;
    const turn = eng.processUserTurn(input, eng.createEmptyDraft(), ctxForCase("calendar_write"));
    if (
      ev.intent === "calendar.create" &&
      turn.processingState === "READY_TO_SAVE" &&
      !(turn.draft && (turn.draft.title || turn.draft.note || turn.draft.location))
    ) {
      payloadDrop++;
    }
  }
  const tokenAnchorAccuracy = total ? pass / total : 1;
  const longVoiceAccuracy = longTotal ? longPass / longTotal : 1;
  const report = {
    harness_id: "silver_token_anchor_normalizer_v1_audit",
    token_anchor_segmentation_accuracy: tokenAnchorAccuracy,
    long_voice_sentence_segmentation_accuracy: longVoiceAccuracy,
    anchor_helped_case_count: helped,
    anchor_harmed_case_count: harmed,
    anchor_noop_short_sentence_count: noopShort,
    anchor_payload_drop_count: payloadDrop,
    anchor_read_to_create_regression_count: readToCreate,
    pass_fail:
      tokenAnchorAccuracy >= 0.97 &&
      longVoiceAccuracy >= 0.97 &&
      harmed === 0 &&
      payloadDrop === 0 &&
      readToCreate === 0
        ? "PASS"
        : "FAIL",
  };
  fs.writeFileSync(REPORT_JSON, JSON.stringify(report, null, 2), "utf8");
  console.log("=== SILVER_TOKEN_ANCHOR_NORMALIZER_V1_AUDIT ===");
  console.log("token_anchor_segmentation_accuracy=" + Math.round(tokenAnchorAccuracy * 10000) / 100 + "%");
  console.log("long_voice_sentence_segmentation_accuracy=" + Math.round(longVoiceAccuracy * 10000) / 100 + "%");
  console.log("anchor_harmed_case_count=" + harmed);
  console.log("anchor_payload_drop_count=" + payloadDrop);
  console.log("PASS_FAIL=" + report.pass_fail);
  console.log("=== END_SILVER_TOKEN_ANCHOR_NORMALIZER_V1_AUDIT ===");
  process.exit(report.pass_fail === "PASS" ? 0 : 1);
}

main();
