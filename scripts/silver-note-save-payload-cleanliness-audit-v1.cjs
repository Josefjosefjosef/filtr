#!/usr/bin/env node
"use strict";
const { runAudit } = require("./silver-product-gap-audit-v1-core.cjs");

runAudit({
  harnessId: "silver_note_save_payload_cleanliness_audit_v1",
  reportFile: "silver-note-save-payload-cleanliness-audit-v1-report.json",
  seedSalt: 404,
  minAccuracy: 0.95,
  casesPerFamily: parseInt(process.env.SPG_CASES_PER_FAMILY || "2500", 10),
  families: ["note_body_clean", "note_no_assistant", "note_instruction_strip"],
  templates: {
    note_body_clean: [
      "Ulož mi do poznámek že {note}",
      "Silver ulož poznámku že {note}",
    ],
    note_no_assistant: ["Ahoj Silver ulož mi do poznámek že {note}", "Silvere zapiš si že {note}"],
    note_instruction_strip: ["napiš do poznámek že {note}", "zapiš si že {note}"],
  },
  entities: {
    note: [
      "pračka má záruku do prosince 2028",
      "servis auta mám zaplatit do konce měsíce",
      "klíče od sklepa jsou u mámy",
    ],
  },
  groupForCase: function () {
    return "note_write";
  },
  probes: [
    {
      id: "F",
      input: "Silver ulož poznámku že servis auta mám zaplatit do konce měsíce",
      intent: "notes.create",
      group: "note_write",
      checks: { bodyHas: "servis" },
    },
    {
      id: "N",
      input: "Silver napiš do poznámek že klíče od sklepa jsou u mámy",
      intent: "notes.create",
      group: "note_write",
      checks: { bodyHas: "klíč" },
    },
  ],
});
