#!/usr/bin/env node
/**
 * CAP55 shared calendar save audit helpers.
 */
"use strict";

const validator = require("./silver-clean-payload-validator-v1.cjs");
const payloadCore = require("./silver-semantic-payload-engine-v1-core.cjs");
const { foldCs } = require("./silver-semantic-payload-engine-v1-core.cjs");

const FIXED_NOW_ISO = "2026-05-04T12:00:00";

function draftField(turn, name) {
  return validator.draftField(turn, name);
}

function evaluateMustNot(turn, raw, mustNot) {
  const issues = [];
  const list = mustNot || [];
  const title = foldCs(draftField(turn, "title"));
  const note = foldCs(draftField(turn, "note"));
  const loc = foldCs(draftField(turn, "location"));
  const intent = String(turn.normalizedIntent || "");

  for (let i = 0; i < list.length; i++) {
    const rule = list[i];
    if (rule === "no_address_in_title" && /\b(praha|brno|ulice|nam\.|vinohrad|albert|lidl|hilton|marriott)\b/.test(title) && loc) {
      issues.push(rule);
    }
    if (rule === "no_wrapper_in_note" && note && payloadCore.hasInstructionLeakage(note)) issues.push(rule);
    if (rule === "no_notes_create" && intent === "notes.create" && payloadCore.isEventNoteContext(raw)) issues.push(rule);
    if (rule === "no_query_draft_card" && intent.indexOf(".read") >= 0 && turn.processingState === "READY_TO_SAVE") issues.push(rule);
    if (rule === "no_immediate_save" && turn.processingState === "SAVED") issues.push(rule);
  }
  const v = validator.validateCleanPayload(turn, raw);
  for (let vi = 0; vi < v.violations.length; vi++) {
    if (list.indexOf(v.violations[vi]) >= 0 || v.violations[vi] === "address_remains_in_title") issues.push(v.violations[vi]);
  }
  return issues;
}

function matchExpect(turn, expect) {
  const misses = [];
  if (!expect) return misses;
  const intent = String(turn.normalizedIntent || "");
  if (expect.module && intent !== expect.module) misses.push("module:" + intent + "!=" + expect.module);
  if (expect.processingState && turn.processingState !== expect.processingState) {
    misses.push("state:" + turn.processingState);
  }
  if (expect.draftCardRequired === true && turn.processingState !== "READY_TO_SAVE") {
    misses.push("draft_card");
  }
  const title = draftField(turn, "title");
  const note = draftField(turn, "note");
  const loc = draftField(turn, "location");
  if (expect.titleContains) {
    const tcList = Array.isArray(expect.titleContains) ? expect.titleContains : [expect.titleContains];
    let tcHit = false;
    for (let ti = 0; ti < tcList.length; ti++) {
      if (foldCs(title).indexOf(foldCs(tcList[ti])) >= 0) tcHit = true;
    }
    if (!tcHit) misses.push("title_missing:" + tcList.join("|"));
  }
  if (expect.titleNotContains) {
    for (let ti = 0; ti < expect.titleNotContains.length; ti++) {
      if (foldCs(title).indexOf(foldCs(expect.titleNotContains[ti])) >= 0) misses.push("title_has:" + expect.titleNotContains[ti]);
    }
  }
  if (expect.noteExact && foldCs(note) !== foldCs(expect.noteExact)) misses.push("note_exact");
  if (expect.noteContains) {
    const ncList = Array.isArray(expect.noteContains) ? expect.noteContains : [expect.noteContains];
    let ncHit = false;
    for (let ni = 0; ni < ncList.length; ni++) {
      if (foldCs(note).indexOf(foldCs(ncList[ni])) >= 0) ncHit = true;
    }
    if (!ncHit) misses.push("note_contains:" + ncList.join("|"));
  }
  if (expect.locationContains) {
    const lcList = Array.isArray(expect.locationContains) ? expect.locationContains : [expect.locationContains];
    let lcHit = false;
    for (let li = 0; li < lcList.length; li++) {
      if (foldCs(loc).indexOf(foldCs(lcList[li])) >= 0) lcHit = true;
    }
    if (!lcHit) misses.push("location:" + lcList.join("|"));
  }
  if (expect.titleExact && foldCs(title) !== foldCs(expect.titleExact)) misses.push("title_exact");
  return misses;
}

function evaluateCalendarCase(c, turn) {
  const raw = c.input;
  const mustIssues = evaluateMustNot(turn, raw, c.must_not || [
    "no_address_in_title",
    "no_wrapper_in_note",
    "no_notes_create",
    "address_remains_in_title",
  ]);
  const expectMisses = matchExpect(turn, c.expect);
  let pass = mustIssues.length === 0 && String(turn.normalizedIntent || "") === "calendar.create";
  if (pass && c.expect && c.expect.processingState && turn.processingState !== c.expect.processingState) pass = false;
  if (pass && expectMisses.length) pass = false;
  return { pass, mustIssues, expectMisses, intent: turn.normalizedIntent, state: turn.processingState };
}

function cap55EngineFlags(eng) {
  return {
    command_resolution_order_created: !!(
      eng.iuSilverCommandResolutionOrderV1 && eng.iuSilverCap55CommandResolutionOrderCreatedV1
    ),
    final_facts_resolver_created: !!(eng.iuSilverFinalFactsResolverV1 && eng.iuSilverCap55FinalFactsResolverCreatedV1),
  };
}

module.exports = {
  FIXED_NOW_ISO,
  evaluateCalendarCase,
  evaluateMustNot,
  matchExpect,
  cap55EngineFlags,
  draftField,
  foldCs,
};
