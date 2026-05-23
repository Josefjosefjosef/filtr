#!/usr/bin/env node
"use strict";
const { runAudit } = require("./silver-product-gap-audit-v1-core.cjs");
const saveCore = require("./silver-save-understanding-validator-repair-v1-core.cjs");
const { foldCs } = require("./audit_silver_realistic_mobile_corpus.cjs");

runAudit({
  harnessId: "silver_save_repair_pass_audit_v1",
  reportFile: "silver-save-repair-pass-audit-v1-report.json",
  seedSalt: 7303,
  minAccuracy: 0.94,
  casesPerFamily: parseInt(process.env.SPG_CASES_PER_FAMILY || "2500", 10),
  families: ["repair_title", "repair_note", "repair_body"],
  templates: {
    repair_title: [
      "Silver prosím {date} v {time} schůzku s {person} v {place}",
      "Hele ulož mi {date} doktor {place} a napiš tam že {note}",
    ],
    repair_note: [
      "Schůzka s {person} {date} v {time} a napiš tam že {note}",
      "Úkol {task} {date} a dej tam poznámku že {note}",
    ],
    repair_body: ["Silver ulož mi do poznámek že {note}", "Ahoj Silver zapiš si že {note}"],
  },
  entities: {
    date: ["zítra", "příští úterý"],
    time: ["9:00", "11:00"],
    place: ["Praha 4", "Brně"],
    person: ["Petrem", "Novotným"],
    task: ["zavolat právníkovi"],
    note: ["vzít kartičku pojišťovny", "klíče od sklepa jsou u mámy"],
  },
  groupForCase: function (family, input) {
    if (family.indexOf("body") >= 0 || /\bpoznam/i.test(input)) return "note_write";
    if (/\bukol|úkol\b/i.test(input)) return "task_write";
    return "calendar_write";
  },
  extraPass: function (turn, c) {
    const intent = String(turn.normalizedIntent || "");
    if (intent.indexOf(".create") < 0) return false;
    const title = saveCore.draftField(turn, "title");
    const body = saveCore.draftField(turn, "body");
    const note = saveCore.draftField(turn, "note");
    const tf = foldCs(title);
    const bf = foldCs(body);
    const nf = foldCs(note);
    if (tf && /\bsilver\b/.test(tf)) return false;
    if (bf && /\buloz\s+mi\b/.test(bf) && !/\bprač|servis|klíč|děti\b/i.test(bf)) return false;
    if (nf && /\bnapis\s+tam\b/.test(nf)) return false;
    const meta = turn.draft && turn.draft.meta;
    if (meta && meta.saveUnderstandingConfidence === "low" && intent === "calendar.create") {
      if (meta.date !== "certain" || meta.time !== "certain") return true;
    }
    return saveCore.validateSaveUnderstanding(turn, c.input).pass;
  },
});
