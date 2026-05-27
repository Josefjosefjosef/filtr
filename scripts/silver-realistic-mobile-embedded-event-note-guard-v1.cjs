#!/usr/bin/env node
/**
 * SILVER_REALISTIC_MOBILE_EMBEDDED_EVENT_NOTE_GUARD_V1 — Tier-A replay for embedded calendar event.note tails.
 */
"use strict";

const harness = require("./audit_silver_realistic_mobile_corpus.cjs");
const { loadEngine, foldCs, ctxForCase } = harness;

const CASES = [
  {
    id: "embedded_event_note_investor_podklady",
    input: "Zítra 15:00 investor v kavárně a nezapomenout vzít podklady",
    needle: "podklad",
  },
  {
    id: "embedded_event_note_kontrola_vysledky",
    input: "Dej do kalendáře kontrolu v úterý dopoledne a poznámka: vzít výsledky",
    needle: "vysled",
  },
];

function main() {
  const eng = loadEngine();
  const ctx = ctxForCase("calendar_write");
  let pass = 0;
  const fails = [];
  for (let i = 0; i < CASES.length; i++) {
    const c = CASES[i];
    try {
      if (eng.iuSilverConversationReset) eng.iuSilverConversationReset();
    } catch (eReset) {
      void eReset;
    }
    const tr = eng.processUserTurn(c.input, eng.createEmptyDraft(), ctx);
    const note = foldCs(String((tr.draft && tr.draft.note) || ""));
    const ok =
      tr.normalizedIntent === "calendar.create" &&
      !tr.silverCompanionNoteTurn &&
      note.indexOf(foldCs(c.needle)) >= 0;
    if (ok) pass++;
    else {
      fails.push({
        id: c.id,
        normalizedIntent: tr.normalizedIntent,
        companion: !!tr.silverCompanionNoteTurn,
        title: tr.draft && tr.draft.title,
        note: tr.draft && tr.draft.note,
      });
    }
  }
  console.log("=== SILVER_REALISTIC_MOBILE_EMBEDDED_EVENT_NOTE_GUARD_V1 ===");
  console.log("cases_total=" + CASES.length);
  console.log("pass_count=" + pass);
  console.log("fail_count=" + (CASES.length - pass));
  console.log("PASS_FAIL=" + (fails.length ? "FAIL" : "PASS"));
  if (fails.length) console.log("fails=" + JSON.stringify(fails));
  console.log("=== END_SILVER_REALISTIC_MOBILE_EMBEDDED_EVENT_NOTE_GUARD_V1 ===");
  process.exit(fails.length ? 1 : 0);
}

if (require.main === module) main();
