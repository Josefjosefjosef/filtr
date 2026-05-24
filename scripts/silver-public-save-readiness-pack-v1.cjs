#!/usr/bin/env node
/**
 * SILVER_PUBLIC_SAVE_READINESS_PACK_V1 — ≥2000 public save readiness cases (generator module).
 */
"use strict";

const core = require("./rhc-v3-deterministic-core.cjs");

const PACK_ID = "silver_public_save_readiness_pack_v1";
const CASES_PER_FAMILY = parseInt(process.env.PUBLIC_SAVE_CASES_PER_FAMILY || "85", 10);

const FAMILIES = [
  "cal_event_note_wrapper",
  "cal_do_poznamky_napis",
  "cal_reminder_tail",
  "cal_address_note",
  "cal_self_correction",
  "cal_delayed_title",
  "cal_delayed_location",
  "cal_delayed_note",
  "cal_no_punctuation",
  "cal_mobile_voice",
  "cal_filler_speech",
  "cal_broken_word_order",
  "cal_colloquial_czech",
  "cal_long_human",
  "task_create_note",
  "note_without_calendar",
  "ambiguous_clarify",
  "negative_no_write",
  "query_read_no_create",
  "draft_card_approval",
  "token_anchor_cases",
  "cross_field_duplicate",
  "voice_no_punctuation",
  "wrapper_collision",
  "address_note_title_overlap",
];

const TEMPLATES = {
  cal_event_note_wrapper: [
    "Silver {date} {person} v {place} a do poznámky napiš {note}",
    "{date} schůzka s {person} připomeň mi {note}",
  ],
  cal_do_poznamky_napis: [
    "Ulož {date} {person} do poznámky napiš {note}",
    "hele {date} doktor a dej mi do poznámky {note}",
  ],
  cal_reminder_tail: [
    "Silver {date} v {time} servis a napiš tam že {note}",
    "{date} {person} jo a připomeň {note}",
  ],
  cal_address_note: [
    "Silver {date} {person} v {place} připomeň {note}",
    "schůzka {date} na adrese {place} a {note}",
  ],
  cal_self_correction: [
    "Silver {date} {person} vlastně {person2} v {place}",
  ],
  cal_delayed_title: [
    "Silver {date} v {time} vlastně schůzka s {person}",
  ],
  cal_delayed_location: [
    "{date} {person} a jo vlastně na adrese {place}",
  ],
  cal_delayed_note: [
    "{date} {person} v {place} a vlastně připomeň {note}",
  ],
  cal_no_punctuation: [
    "hele {date} v {time} schuzka s {person} na {place} pripomen {note}",
  ],
  cal_mobile_voice: [
    "uloz mi tam prosimte ze mam {date} holice a jeste tam napis {note}",
  ],
  cal_filler_speech: [
    "hele prosím tě {date} {person} v {place} jo a {note}",
  ],
  cal_broken_word_order: [
    "{place} {date} {person} schůzka připomeň {note}",
  ],
  cal_colloquial_czech: [
    "Silver {date} někdy kolem {time} právník {place} a napiš mi tam {note}",
  ],
  cal_long_human: [
    "Silver prosím tě ulož mi do kalendáře na {date} schůzku s {person} v {time} na adrese {place} a připomeň mi že {note}",
  ],
  task_create_note: [
    "Silver dej mi do úkolů {date} {task} a připomeň že {note}",
  ],
  note_without_calendar: [
    "Prosím tě Silver ulož mi někam že {note}",
    "Silver zapiš si prosím že {note}",
  ],
  ambiguous_clarify: ["Silver něco na {date}"],
  negative_no_write: ["nic neukládej {date} {person}"],
  query_read_no_create: ["kolik mám schůzek {date}"],
  draft_card_approval: ["Silver {date} schůzku s {person} v {place}"],
  token_anchor_cases: [
    "zítra v deset schůzka s právníkem na Vinohradech jo a prosím tě připomeň mi vzít smlouvy",
  ],
  cross_field_duplicate: [
    "Silver '{title}' {date} v {place} a {note}",
  ],
  voice_no_punctuation: [
    "zejtra v 10 schuzka s pravnikem vinohrady pripomen vzit smlouvy",
  ],
  wrapper_collision: [
    "{date} {person} do poznámky napiš že {note}",
  ],
  address_note_title_overlap: [
    "Silver {date} schůzka {place} {person} a {note}",
  ],
};

const ENTITIES = {
  date: ["zítra", "v pátek", "ve středu", "pondělí", "příští středu"],
  time: ["v 10", "v 9", "odpoledne", "kolem desáté"],
  place: ["Praha 4", "Vinohradech", "Brně", "Masarykova 15"],
  person: ["Petrem", "pravnikem", "Pavlem", "doktorem"],
  person2: ["Novotným", "Kubou"],
  task: ["koupit mléko", "zavolat právníkovi"],
  note: ["vzít smlouvy", "roušku", "zavolat Pavlíkovi"],
  title: ["Prezentace projektu", "Kontrola auta"],
};

function groupForFamily(family) {
  if (family.indexOf("note_without") >= 0) return "note_write";
  if (family.indexOf("task_") >= 0) return "task_write";
  if (family.indexOf("query_") >= 0 || family.indexOf("negative_") >= 0) return "calendar_query";
  return "calendar_write";
}

function generatePackCases() {
  const rawCases = [];
  for (let fi = 0; fi < FAMILIES.length; fi++) {
    const family = FAMILIES[fi];
    const tpls = TEMPLATES[family] || ["Silver {date} {person}"];
    const baseSeed = ((family.length * 982451653) ^ 5311) >>> 0;
    for (let i = 0; i < CASES_PER_FAMILY; i++) {
      const rng = core.mulberry32((baseSeed ^ (i * 2654435761)) >>> 0);
      let input = String(tpls[i % tpls.length] || "")
        .replace(/\{([a-z_]+)\}/g, function (_, key) {
          const pool = ENTITIES[key] || [key];
          return core.pickFrom(rng, pool);
        });
      const mask = core.deriveMutationMask(family, i, baseSeed);
      input = core.applyMutationLayers(input, mask, rng);
      rawCases.push({
        id: "psr_" + family + "_" + String(i).padStart(4, "0"),
        family,
        input,
        group: groupForFamily(family),
      });
    }
  }
  return rawCases;
}

module.exports = {
  PACK_ID,
  FAMILIES,
  CASES_PER_FAMILY,
  generatePackCases,
  groupForFamily,
};

if (require.main === module) {
  const cases = generatePackCases();
  console.log("=== SILVER_PUBLIC_SAVE_READINESS_PACK_V1 ===");
  console.log("cases_total=" + cases.length);
  console.log("families=" + FAMILIES.length);
  console.log("cases_per_family=" + CASES_PER_FAMILY);
  console.log("=== END_SILVER_PUBLIC_SAVE_READINESS_PACK_V1 ===");
}
