/**
 * SILVER_SAVE_MODE_REALITY_TEST_V1 — deterministic case generator + evaluation core.
 * Diagnostic only — no engine changes.
 */
"use strict";

const core = require("./rhc-v3-deterministic-core.cjs");
const validator = require("./silver-clean-payload-validator-v1.cjs");
const saveCore = require("./silver-save-understanding-validator-repair-v1-core.cjs");
const actionCore = require("./silver-action-mode-v1-core.cjs");
const payloadCore = require("./silver-semantic-payload-engine-v1-core.cjs");
const { foldCs } = require("./audit_silver_realistic_mobile_corpus.cjs");

const CORE_ID = "silver_save_mode_reality_test_v1_core";
const DETERMINISTIC_SEED = 0x53534d52; // "SSMR"
const CASES_PER_BLOCK = 10000;

const GOLDEN_MANUAL_PROBES = [
  {
    id: "G01",
    input:
      "Hele Silver prosím tě já teď řídím takže jen rychle — zejtra někdy kolem půl desátý mám myslím toho doktora na Praze 4 jak jsme se o tom bavili a napiš mi tam prosím že si mám vzít výsledky krve a kartičku pojišťovny protože to zase zapomenu",
    intent: "calendar.create",
    group: "calendar_write",
    checks: { titleHas: "doktor", locHas: "praha", noteHas: "vzít" },
  },
  {
    id: "G02",
    input:
      "Silver prosím tě až budeš mít chvilku tak mi tam někam do kalendáře dej na příští středu myslím že to bylo asi kolem jedenáctý schůzku s tím elektrikářem jak měl přijet kvůli těm zásuvkám do Brna a napiš mi tam že musím nachystat smlouvu a klíče od sklepa",
    intent: "calendar.create",
    group: "calendar_write",
    checks: { titleHas: "elektrik", locHas: "brn", noteHas: "smlouv" },
  },
  {
    id: "G03",
    input:
      "Hele Silvere připomeň mi zejtra odpoledne koupit mamce kytku ale ne moc drahou a ještě tam dej že se mám stavit v lékárně protože jinak zase zapomenu a možná kdyby byl čas tak se stavit ještě v DMku",
    intent: "tasks.create",
    group: "task_write",
    checks: { titleHas: "kytku", noteHas: "lékár" },
  },
  {
    id: "G04",
    input:
      "Prosím tě Silver ulož mi někam že děti budou příští víkend u Karolíny na tý adrese ve Zlíně jak už ji máme uloženou ať to kdyžtak najdu až to budu potřebovat protože si to nikdy nepamatuju",
    intent: "notes.create",
    group: "note_write",
    checks: { bodyHas: "děti", bodyLacks: ["silver", "ulož mi"] },
  },
  {
    id: "G05",
    input:
      "Silvere já teď nemůžu moc psát takže jen rychle — v pondělí ráno servis auta v Brně myslím v devět a napiš tam že mám vzít techničák a zimní kola pokud budou ještě v kufru a možná zavolat předem",
    intent: "calendar.create",
    group: "calendar_write",
    checks: { titleHas: "servis", locHas: "brn", noteHas: "technič" },
  },
  {
    id: "G06",
    input:
      "Hele dej mi prosím do úkolů že mám někdy během týdne zavolat právníkovi kvůli tý smlouvě a ještě mi připomeň že mu mám poslat ty fotky a dokumenty co chtěl minule protože na to určitě zase zapomenu",
    intent: "tasks.create",
    group: "task_write",
    checks: { titleHas: "právn", noteHas: "fotk" },
  },
  {
    id: "G07",
    input:
      "Silver zejtra kolem oběda asi ve dvanáct nebo půl jedný schůzka s Tománkem někde u Anděla a napiš mi tam že nesmím zapomenout vzít ten podepsanej papír co mi posílal mailem a ještě možná notebook",
    intent: "calendar.create",
    group: "calendar_write",
    checks: { titleHas: "tomán", locHas: "anděl", noteHas: "papír" },
  },
  {
    id: "G08",
    input:
      "Hele Silver dej mi tam příští pátek myslím někdy kolem druhý odpoledne schůzku s účetní v Brně kvůli daním a napiš tam že mám vytisknout ty faktury a připravit smlouvy co jsme řešili minule",
    intent: "calendar.create",
    group: "calendar_write",
    checks: { titleHas: "účetní", locHas: "brn", noteHas: "faktur" },
  },
  {
    id: "G09",
    input:
      "Silvere prosím tě rychle mi ulož že mamka bude v sobotu večer u nás a že mám koupit pití a něco k jídlu protože jinak zase všechno zapomenu",
    intent: "notes.create",
    group: "note_write",
    checks: { bodyHas: "mamka", bodyLacks: ["silvere"] },
  },
  {
    id: "G10",
    input:
      "Silver dej mi prosím do kalendáře na další úterý někdy dopoledne asi kolem desátý schůzku s panem Novotným u něj v kanceláři na Vinohradech a napiš tam že mám vzít obě smlouvy, občanku a ty papíry co jsem tisknul včera večer",
    intent: "calendar.create",
    group: "calendar_write",
    checks: { titleHas: "novotn", locHas: "vinohrad", noteHas: "smlouv" },
  },
  {
    id: "G11",
    input:
      "Hele prosím tě Silvere ulož mi úkol že mám do konce týdne zavolat tomu instalatérovi kvůli té koupelně, domluvit termín, zeptat se na cenu a hlavně mu říct že dopoledne většinou nejsem doma",
    intent: "tasks.create",
    group: "task_write",
    checks: { titleHas: "instalat" },
  },
  {
    id: "G12",
    input:
      "Silver zapiš si prosím tě někam že náhradní klíče od sklepa jsou v horním šuplíku u mámy, ale nepiš to jako úkol, jen ať to později najdu",
    intent: "notes.create",
    group: "note_write",
    checks: { bodyHas: "klíč", bodyLacks: ["silver", "zapiš"] },
  },
  {
    id: "G13",
    input:
      "Ahoj Silver zejtra ráno v osm nebo možná čtvrt na devět technik kvůli internetu Praha 6 a napiš mi tam že mám připravit smlouvu, router a přístup do sklepa",
    intent: "calendar.create",
    group: "calendar_write",
    checks: { titleHas: "technik", locHas: "praha", noteHas: "smlouv" },
  },
  {
    id: "G14",
    input:
      "Silvere přidej mi do úkolů na pondělí ráno že mám poslat Karolíně peníze na kluky a dej tam poznámku že jí mám zároveň napsat omluvu a potvrdit kdy přijedou",
    intent: "tasks.create",
    group: "task_write",
    checks: { titleHas: "karol", noteHas: "omluv" },
  },
  {
    id: "G15",
    input:
      "Silver ulož mi do poznámek že u auta je potřeba do konce měsíce vyřešit servis, technickou, zimní kola a ještě zavolat do pojišťovny kvůli zelené kartě",
    intent: "notes.create",
    group: "note_write",
    checks: { bodyHas: "auta", bodyLacks: ["silver"] },
  },
];

const CALENDAR_TEMPLATES = {
  simple_calendar: [
    "Ulož mi schůzku s {person} {date} v {time}",
    "Dej do kalendáře {date} {entity} v {time}",
    "Přidej {date} {entity} v {place}",
  ],
  long_chaotic_calendar: [
    "Hele Silver prosím tě já teď řídím — {date} kolem {time} {entity} v {place} a napiš tam že {note}",
    "ee jo hele prosimte uloz mi do kalendare {date} schuzku s {person} v {time} v {place} a pripomen mi {note} no diky",
  ],
  with_all_slots: [
    "Silver {date} v {time} {entity} v {place} a napiš mi tam že {note}",
    "Dej mi do kalendáře {date} kolem {time} schůzku s {person} v {place} napiš tam {note}",
  ],
  no_location: ["{date} v {time} {entity}", "Ulož {date} {entity} v {time}"],
  no_time: ["{date} {entity} v {place}", "Schůzka s {person} {date}"],
  time_window: ["{date} od {time} do {time2} {entity}", "{date} někdy mezi {time} a {time2} {entity}"],
  uncertain_time: ["{date} asi kolem {time} {entity}", "{date} možná v {time} schůzku s {person}"],
  event_note: ["{date} {entity} a napiš tam že {note}", "Schůzka {date} s {person} připomeň {note}"],
  location_contamination: ["{date} {entity} v {place} máme se potkat v {place}", "{entity} {date} adresa {place}"],
  assistant_name: ["Silver {date} {entity} v {time}", "Silvere dej {date} schůzku s {person}"],
  command_wrapper: ["Ulož mi do kalendáře {date} {entity}", "Dej mi tam {date} {entity} v {time}"],
  mobile_dictation: ["jo hele {date} {entity} v {time} no", "teda prosim {date} schuzku s {person} v {place}"],
  no_diacritics: ["uloz mi {date} schuzku s {person} v {time} v {place}", "dej do kalendare {date} {entity}"],
  missing_letters: ["uloz m {date} schuzk s {person}", "dej do kalendare {date} {entity} v {plac}"],
  typos: ["uloz mi zeTone {date} schuzku s {person}", "pridej {date} schuzku s {person} v {time}"],
  mid_sentence_correction: [
    "{date} doktor ne vlastně {entity} v {time} v {place}",
    "Schůzka s {person} ne s {person2} {date} v {time}",
  ],
};

const TASK_TEMPLATES = {
  simple_task: ["Přidej úkol {task}", "Dej mi do úkolů {task}"],
  with_deadline: ["{task} {date}", "Připomeň mi {date} {task}"],
  task_note: ["{task} {date} a napiš tam že {note}", "Úkol {task} dej poznámku {note}"],
  reminder_phrasing: ["Připomeň mi {date} {task}", "Silver připomeň {task} {date}"],
  embedded_note: ["{task} a ještě tam dej že {note}", "Hoď úkol {task} napiš {note}"],
  do_ukolu: ["Dej mi do úkolů {task} {date}", "Hoď mi do úkolů že {task}"],
  pripomen_mi: ["Připomeň mi {date} {task}", "Silver připomeň {task}"],
  assistant_name: ["Silvere {task} {date}", "Silver úkol {task}"],
  command_wrapper: ["Přidej mi úkol {task}", "Dej mi do úkolů {task} {date}"],
  no_diacritics: ["pridej ukol {task} {date}", "dej mi do ukolu {task}"],
  missing_letters: ["pridej ukol {task} zejtr", "dej do ukolu {task}"],
  typos: ["pridej ukol {task} zejtra rano", "pripomen mi {task}"],
  long_chaotic_task: [
    "Hele Silvere připomeň mi {date} {task} a ještě tam dej že {note} protože jinak zapomenu",
    "no jo kamo pridej ukol {task} {date} a napis tam ze {note} prosim rychle",
  ],
  note_body_contamination: ["{task} {date} poznámka {note}", "Úkol {task} body {note}"],
};

const NOTE_TEMPLATES = {
  simple_note: ["Ulož poznámku {note}", "Zapiš si {note}"],
  long_note: [
    "Silver ulož mi do poznámek že {note} a ještě {note2} protože si to nepamatuju",
    "Prosím tě ulož někam že {note} a taky {note2}",
  ],
  temporal_not_deadline: ["Ulož že {note} do konce měsíce", "Zapiš {note} příští týden"],
  with_address: ["Ulož {note} adresa {place}", "Zapiš si {note} ve {place}"],
  with_person: ["Ulož že {person} {note}", "Zapiš {note} o {person}"],
  uloz_nekam: ["Ulož mi někam že {note}", "Silver ulož někam {note}"],
  zapis_si: ["Zapiš si že {note}", "Silver zapiš si {note}"],
  assistant_name: ["Silvere ulož {note}", "Silver zapiš {note}"],
  command_wrapper: ["Ulož mi do poznámek {note}", "Dej do poznámek {note}"],
  no_diacritics: ["uloz mi do poznamek ze {note}", "zapis si {note}"],
  missing_letters: ["uloz mi do poznamek ze {not}", "zapis si {note}"],
  typos: ["uloz mi do poznamky ze {note}", "zapis si {note}"],
  broken_czech: ["uloz mi nevim co {note} tam nekam", "zapis {note} no vis"],
  note_vs_task: ["Ulož {note} ale ne jako úkol", "Zapiš si {note} nepiš to jako úkol"],
};

const ENTITIES = {
  person: ["Petrem", "Novotným", "Tománkem", "elektrikářem", "panem Novotným"],
  person2: ["Kubou", "Pavlem", "Martinou"],
  date: ["zítra", "v pátek", "příští středu", "pondělí ráno", "příští pátek", "další úterý"],
  time: ["9:00", "10:30", "11:00", "12:00", "14:00", "odpoledne", "půl desáté"],
  time2: ["11:00", "13:00", "15:00", "17:00"],
  place: ["Praze 4", "Brně", "u Anděla", "Praze 6", "Vinohradech", "Zlíně"],
  entity: ["doktor", "servis auta", "schůzka s účetní", "technik", "zubař"],
  note: [
    "vzít kartičku pojišťovny",
    "nachystat smlouvu",
    "vzít techničák",
    "poslat fotky",
    "připravit router",
  ],
  note2: ["klíče od sklepa", "dokumenty", "občanku"],
  task: [
    "koupit mléko",
    "zavolat právníkovi",
    "poslat email",
    "koupit mamce kytku",
    "zavolat instalatérovi",
  ],
};

const MUTATION_KINDS = [
  "none",
  "no_diacritics",
  "missing_letter",
  "typo",
  "double_word",
  "filler",
  "hesitation",
  "self_correction",
  "broken_order",
  "short",
  "long",
  "assistant",
  "command_wrapper",
  "uncertain_time",
  "uncertain_location",
  "note_suffix",
  "multi_slot",
];

const MUTATION_ERROR_CAP = 20;
let mutationErrorLog = [];

function resetMutationErrors() {
  mutationErrorLog = [];
}

function recordMutationError(ctx, kind, err) {
  if (mutationErrorLog.length >= MUTATION_ERROR_CAP) return;
  mutationErrorLog.push({
    ctx: String(ctx || ""),
    kind: String(kind || ""),
    error: String((err && err.message) || err || "unknown"),
  });
}

function ensureString(value, fallback) {
  if (value == null) return String(fallback || "");
  const s = typeof value === "string" ? value : String(value);
  return s;
}

function normalizeWhitespace(s) {
  return ensureString(s).replace(/\s+/g, " ").trim();
}

function stripDiacriticsSafe(s) {
  return normalizeWhitespace(
    ensureString(s).normalize("NFD").replace(/[\u0300-\u036f]/g, "")
  );
}

function typoLiteSafe(s) {
  return normalizeWhitespace(
    ensureString(s)
      .replace(/\bzítra\b/gi, "zejtra")
      .replace(/\bmléko\b/gi, "mlíko")
      .replace(/\bprotože\b/gi, "ptže")
      .replace(/\bschůzka\b/gi, "schuzka")
      .replace(/\bpoznámka\b/gi, "poznamka")
      .replace(/\bkalendáře\b/gi, "kalendare")
      .replace(/\búkol\b/gi, "ukol")
  );
}

function injectHesitationSafe(s, rng) {
  const parts = normalizeWhitespace(s).split(/\s+/).filter(Boolean);
  if (parts.length < 4) return normalizeWhitespace(s);
  const infixes = [" jako ", " no ", " fakt ", " trochu ", " nějak "];
  const ins = core.pickFrom(rng, infixes).trim();
  const at = 2 + Math.floor(rng() * Math.max(1, parts.length - 3));
  parts.splice(at, 0, ins);
  return parts.join(" ");
}

function applyMutationLayersSafe(text, mask, rng, ctx) {
  const original = normalizeWhitespace(text);
  if (!original) return original;
  let s = original;
  try {
    if (typeof core.applyMutationLayers === "function") {
      const out = core.applyMutationLayers(s, mask >>> 0, rng);
      s = normalizeWhitespace(out);
      if (s) return s;
    }
  } catch (e) {
    recordMutationError(ctx, "applyMutationLayers", e);
  }

  try {
    if (mask & core.M.MOBILE_PREFIX) s = core.pickFrom(rng, ["jo hele ", "teda ", "promiň "]) + s;
    if (mask & core.M.FILLER_PREFIX) s = core.pickFrom(rng, ["hele ", "ee ", "no jo "]) + s;
    if (mask & core.M.HESITATION) s = injectHesitationSafe(s, rng);
    if (mask & core.M.TYPO_LITE) s = typoLiteSafe(s);
    if (mask & core.M.STRIP_DIACRITICS) s = stripDiacriticsSafe(s);
    if (mask & core.M.FILLER_SUFFIX) s = s + core.pickFrom(rng, [" díky", " prosím", " jo"]);
    if (mask & core.M.EMOTIONAL) s = s + core.pickFrom(rng, [" — spěchám.", " díky moc"]);
    s = normalizeWhitespace(s);
    return s || original;
  } catch (e) {
    recordMutationError(ctx, "applyMutationLayersSafe_fallback", e);
    return original;
  }
}

function mulberry32(seed) {
  return core.mulberry32(seed >>> 0);
}

function fillTemplate(tpl, rng) {
  const template = ensureString(tpl, "test");
  return normalizeWhitespace(
    template.replace(/\{([a-z0-9_]+)\}/g, function (_, key) {
      const pool = ENTITIES[key] || [key];
      return ensureString(core.pickFrom(rng, pool), key);
    })
  );
}

function dropRandomLetter(s, rng) {
  const t = normalizeWhitespace(s);
  if (t.length < 8) return t;
  try {
    const idx = 3 + Math.floor(rng() * Math.max(1, t.length - 6));
    return t.slice(0, idx) + t.slice(idx + 1);
  } catch {
    return t;
  }
}

function doubleRandomWord(s, rng) {
  const parts = normalizeWhitespace(s).split(/\s+/);
  if (parts.length < 4) return normalizeWhitespace(s);
  try {
    const at = 1 + Math.floor(rng() * (parts.length - 2));
    parts.splice(at, 0, parts[at]);
    return parts.join(" ");
  } catch {
    return parts.join(" ");
  }
}

function shufflePartialOrder(s, rng) {
  const parts = normalizeWhitespace(s).split(/\s+/);
  if (parts.length < 6) return normalizeWhitespace(s);
  try {
    const chunk = parts.splice(2, 3);
    chunk.reverse();
    parts.splice(2, 0, ...chunk);
    return parts.join(" ");
  } catch {
    return parts.join(" ");
  }
}

function addSelfCorrection(s) {
  return normalizeWhitespace(
    ensureString(s).replace(/\b(doktor|schůzku|úkol|poznámku)\b/i, function (m) {
      return m + " ne vlastně";
    })
  );
}

function shortenVariant(s) {
  const parts = normalizeWhitespace(s).split(/\s+/);
  if (parts.length <= 8) return normalizeWhitespace(s);
  return parts.slice(0, Math.floor(parts.length * 0.65)).join(" ");
}

function lengthenVariant(s, rng) {
  const extras = [
    " protože to zase zapomenu",
    " jak jsme se o tom bavili",
    " ať to později najdu",
    " no stress díky moc",
  ];
  return normalizeWhitespace(ensureString(s) + core.pickFrom(rng, extras));
}

function applyGoldenMutation(text, kind, rng, ctx) {
  const original = normalizeWhitespace(text);
  if (!original) return original;
  let s = original;
  let mask = 0;
  try {
    switch (kind) {
      case "no_diacritics":
        s = stripDiacriticsSafe(s);
        break;
      case "missing_letter":
        s = dropRandomLetter(s, rng);
        break;
      case "typo":
        s = typoLiteSafe(s);
        break;
      case "double_word":
        s = doubleRandomWord(s, rng);
        break;
      case "filler":
        mask = core.M.FILLER_PREFIX | core.M.FILLER_SUFFIX;
        break;
      case "hesitation":
        s = injectHesitationSafe(s, rng);
        break;
      case "self_correction":
        s = addSelfCorrection(s);
        break;
      case "broken_order":
        s = shufflePartialOrder(s, rng);
        break;
      case "short":
        s = shortenVariant(s);
        break;
      case "long":
        s = lengthenVariant(s, rng);
        break;
      case "assistant":
        s = "Silver " + s;
        break;
      case "command_wrapper":
        s = "Ulož mi do kalendáře " + s;
        break;
      case "uncertain_time":
        s = ensureString(s).replace(/\bv \d{1,2}(:\d{2})?\b/i, " asi kolem desáté");
        break;
      case "uncertain_location":
        s = ensureString(s).replace(/\b(v|ve|na)\s+[A-ZÁČĎÉĚÍŇÓŘŠŤÚŮÝŽ][^\s,]+/i, " někde u centra");
        break;
      case "note_suffix":
        s = s + " a napiš tam že si mám vzít dokumenty";
        break;
      case "multi_slot":
        s = s + " a ještě připomeň koupit mléko";
        break;
      default:
        break;
    }
    if (mask) s = applyMutationLayersSafe(s, mask, rng, ctx + ":golden:" + kind);
    s = normalizeWhitespace(s);
    return s || original;
  } catch (e) {
    recordMutationError(ctx, kind, e);
    return original;
  }
}

function safeMutateInput(input, mutateFn, ctx) {
  const original = normalizeWhitespace(input);
  if (!original) return original;
  try {
    const out = normalizeWhitespace(mutateFn(original));
    return out || original;
  } catch (e) {
    recordMutationError(ctx, "safeMutateInput", e);
    return original;
  }
}

function deriveTags(family, mutationKind) {
  const tags = [family];
  if (mutationKind && mutationKind !== "none") tags.push(mutationKind);
  if (family.indexOf("mobile") >= 0 || family.indexOf("dictation") >= 0) tags.push("mobile_dictation");
  if (family.indexOf("long") >= 0 || family.indexOf("chaotic") >= 0) tags.push("long_chaotic");
  if (family.indexOf("no_diacritics") >= 0 || mutationKind === "no_diacritics") tags.push("no_diacritics");
  if (family.indexOf("missing") >= 0 || mutationKind === "missing_letter") tags.push("missing_letter");
  if (family.indexOf("typo") >= 0 || mutationKind === "typo") tags.push("typo");
  if (family.indexOf("broken") >= 0 || mutationKind === "broken_order") tags.push("broken_word_order");
  return tags;
}

function generateBlockCases(block, templates, groupDefault, count, seedSalt) {
  const families = Object.keys(templates);
  const sizes = core.allocateFamilySizes(count, families.length);
  const cases = [];
  for (let fi = 0; fi < families.length; fi++) {
    const family = families[fi];
    const tpls = templates[family];
    const familyCount = sizes[fi];
    const baseSeed = (DETERMINISTIC_SEED ^ seedSalt ^ (family.length * 982451653) ^ (fi * 1597334677)) >>> 0;
    for (let i = 0; i < familyCount; i++) {
      const caseId = block + "_" + family + "_" + String(i).padStart(5, "0");
      const rng = mulberry32((baseSeed ^ (i * 2654435761)) >>> 0);
      let input = fillTemplate(tpls[i % tpls.length], rng);
      const mask = core.deriveMutationMask(family, i, baseSeed);
      input = applyMutationLayersSafe(input, mask, rng, caseId + ":block");
      const mutationKind = MUTATION_KINDS[i % MUTATION_KINDS.length];
      if (block === "golden_pack_extreme") {
        input = applyGoldenMutation(input, mutationKind, rng, caseId);
      }
      input = normalizeWhitespace(input) || fillTemplate(tpls[i % tpls.length], rng);
      cases.push({
        id: caseId,
        block,
        family,
        input,
        group: groupDefault,
        expectedIntent:
          groupDefault === "calendar_write"
            ? "calendar.create"
            : groupDefault === "task_write"
              ? "tasks.create"
              : "notes.create",
        tags: deriveTags(family, mutationKind),
        goldenProbe: null,
      });
    }
  }
  return cases;
}

function generateGoldenPackCases(count) {
  const perBase = Math.floor(count / GOLDEN_MANUAL_PROBES.length);
  const rem = count - perBase * GOLDEN_MANUAL_PROBES.length;
  const cases = [];
  for (let bi = 0; bi < GOLDEN_MANUAL_PROBES.length; bi++) {
    const probe = GOLDEN_MANUAL_PROBES[bi];
    const n = perBase + (bi < rem ? 1 : 0);
    const baseSeed = (DETERMINISTIC_SEED ^ 0x600d ^ (bi * 2246822519)) >>> 0;
    for (let i = 0; i < n; i++) {
      const caseId = "golden_" + probe.id + "_" + String(i).padStart(4, "0");
      const rng = mulberry32((baseSeed ^ (i * 3266489917)) >>> 0);
      const mutationKind = MUTATION_KINDS[i % MUTATION_KINDS.length];
      let input = applyGoldenMutation(probe.input, mutationKind, rng, caseId);
      const mask = core.deriveMutationMask("golden_pack_extreme", i, baseSeed);
      input = applyMutationLayersSafe(input, mask, rng, caseId + ":golden_layers");
      input = normalizeWhitespace(input) || normalizeWhitespace(probe.input);
      cases.push({
        id: caseId,
        block: "golden_pack_extreme",
        family: "golden_manual_" + probe.id,
        input,
        group: probe.group,
        expectedIntent: probe.intent,
        tags: deriveTags("golden_extreme", mutationKind).concat(["golden_manual"]),
        goldenProbe: probe,
      });
    }
  }
  return cases;
}

function generateAllCases() {
  resetMutationErrors();
  const calendar = generateBlockCases(
    "calendar.create",
    CALENDAR_TEMPLATES,
    "calendar_write",
    CASES_PER_BLOCK,
    0xca1
  );
  const tasks = generateBlockCases("tasks.create", TASK_TEMPLATES, "task_write", CASES_PER_BLOCK, 0x7a5);
  const notes = generateBlockCases("notes.create", NOTE_TEMPLATES, "note_write", CASES_PER_BLOCK, 0x007);
  const golden = generateGoldenPackCases(CASES_PER_BLOCK);
  return calendar.concat(tasks, notes, golden);
}

function getMutationErrorReport() {
  return {
    mutation_error_count: mutationErrorLog.length,
    mutation_error_examples: mutationErrorLog.slice(),
  };
}

function lacksAll(hay, needles) {
  const h = foldCs(hay);
  for (let i = 0; i < needles.length; i++) {
    if (h.indexOf(foldCs(needles[i])) >= 0) return false;
  }
  return true;
}

function hasNegWrite(fold) {
  return (
    /\b(nepis|nepiš|nevytvarej|nevytvoř|neukladej|neukládej|nic\s+nevytvarej|nic\s+neukladej)\b/.test(fold) ||
    /\b(nejde\s+o\s+ukol|ne\s+jako\s+ukol|nepis\s+to\s+jako)\b/.test(fold)
  );
}

function evaluateGoldenProbe(turn, probe) {
  const ch = probe.checks || {};
  const title = validator.draftField(turn, "title");
  const note = validator.draftField(turn, "note");
  const body = validator.draftField(turn, "body");
  const loc = validator.draftField(turn, "location");
  let ok = String(turn.normalizedIntent || "") === probe.intent;
  if (ch.titleHas && foldCs(title).indexOf(foldCs(ch.titleHas)) < 0) ok = false;
  if (ch.noteHas && foldCs(note).indexOf(foldCs(ch.noteHas)) < 0) ok = false;
  if (ch.bodyHas && foldCs(body).indexOf(foldCs(ch.bodyHas)) < 0) ok = false;
  if (ch.locHas && foldCs(loc).indexOf(foldCs(ch.locHas)) < 0) ok = false;
  if (ch.titleLacks && !lacksAll(title, ch.titleLacks)) ok = false;
  if (ch.bodyLacks && !lacksAll(body, ch.bodyLacks)) ok = false;
  return ok;
}

function evaluateCase(c, turn) {
  const payloadVal = validator.validateCleanPayload(turn, c.input);
  const saveVal = saveCore.validateSaveUnderstanding(turn, c.input);
  const modeVal = actionCore.validateSaveSearchTurn(turn, c.input);
  const intent = String(turn.normalizedIntent || "");
  const foldIn = foldCs(c.input);

  let intentOk = intent === c.expectedIntent;
  if (c.goldenProbe) {
    intentOk = evaluateGoldenProbe(turn, c.goldenProbe);
  } else {
    intentOk = intent === c.expectedIntent;
  }

  const negNoteCue =
    /\b(nepis\s+to\s+jako\s+ukol|ne\s+jako\s+ukol|nepis\s+to\s+jako|nepiš\s+to\s+jako)\b/.test(foldIn) &&
    c.block === "notes.create";

  const payloadClean = payloadVal.pass && saveVal.pass;
  const semanticOk = intentOk && payloadClean;
  const validatorRepairOk = saveVal.pass;

  const title = validator.draftField(turn, "title");
  const note = validator.draftField(turn, "note");
  const body = validator.draftField(turn, "body");
  const loc = validator.draftField(turn, "location");

  const violations = []
    .concat(payloadVal.violations || [])
    .concat(saveVal.issues || [])
    .concat(modeVal.violations || []);

  const metrics = {
    assistant_name_leakage:
      (validator.hasAssistantNameLeakage(title) ? 1 : 0) +
      (validator.hasAssistantNameLeakage(body) ? 1 : 0) +
      (validator.hasAssistantNameLeakage(note) ? 1 : 0),
    command_wrapper_leakage:
      (payloadCore.hasInstructionLeakage(title) ? 1 : 0) +
      (payloadCore.hasInstructionLeakage(body) ? 1 : 0) +
      (payloadCore.hasInstructionLeakage(note) ? 1 : 0),
    title_contains_assistant_name: validator.hasAssistantNameLeakage(title) ? 1 : 0,
    title_contains_command_wrapper: payloadCore.hasInstructionLeakage(title) ? 1 : 0,
    title_contains_date_time: saveCore.hasTemporalInTitleWhenSlotsFilled(turn) ? 1 : 0,
    title_contains_location: saveCore.hasLocationInTitleWhenLocFilled(turn) ? 1 : 0,
    title_contains_note: /\b(napis\s+tam|pripomen\s+mi|jeste\s+tam\s+dej)\b/.test(foldCs(title)) ? 1 : 0,
    event_note_contains_command_wrapper:
      intent === "calendar.create" && payloadCore.hasInstructionLeakage(note) ? 1 : 0,
    task_note_contains_command_wrapper:
      intent === "tasks.create" && payloadCore.hasInstructionLeakage(note) ? 1 : 0,
    note_body_contains_command_wrapper:
      intent === "notes.create" && payloadCore.hasInstructionLeakage(body) ? 1 : 0,
    event_note_became_standalone_note:
      payloadCore.isEventNoteContext(c.input) && intent === "notes.create" ? 1 : 0,
    task_note_became_standalone_note:
      payloadCore.isTaskNoteContext(c.input) && intent === "notes.create" ? 1 : 0,
    dirty_title: !payloadVal.pass && violations.some((v) => /title|raw_command|assistant_name_in_title/.test(v)) ? 1 : 0,
    dirty_note: !payloadVal.pass && violations.some((v) => /note|event_note|task_note/.test(v)) ? 1 : 0,
    dirty_body: !payloadVal.pass && violations.some((v) => /body|note_body/.test(v)) ? 1 : 0,
    dirty_location: !payloadVal.pass && violations.some((v) => /location|address/.test(v)) ? 1 : 0,
    cross_field_contamination: violations.some((v) =>
      /title_contains|location_contains|leaked|contamination|field/.test(v)
    )
      ? 1
      : 0,
    create_without_card: modeVal.violations.indexOf("create_without_structured_draft_card") >= 0 ? 1 : 0,
    query_with_draft_card: modeVal.violations.indexOf("query_with_draft_card") >= 0 ? 1 : 0,
    dangerous_write: 0,
    false_write: 0,
    query_created_write: 0,
    write_when_negated: 0,
    repair_pass_false_positive: 0,
    repair_pass_deleted_meaning: 0,
    confidence_warning_ok: 1,
  };

  const createLike = intent.indexOf(".create") >= 0 && turn.processingState === "READY_TO_SAVE";
  if (hasNegWrite(foldIn) && createLike && !negNoteCue) metrics.write_when_negated = 1;
  if (modeVal.violations.indexOf("query_routed_as_create") >= 0) metrics.query_created_write = 1;
  if (metrics.write_when_negated || metrics.query_created_write) metrics.dangerous_write = 1;
  if (!intentOk && createLike) metrics.false_write = 1;

  const conf = turn.draft && turn.draft.meta ? turn.draft.meta.saveUnderstandingConfidence : "high";
  if (/\b(myslim|myslím|asi|mozna|možná|nevim|nevím)\b/.test(foldIn)) {
    metrics.confidence_warning_ok = conf === "medium" || conf === "low" ? 1 : 0;
  }

  if (saveVal.pass === false && payloadVal.pass === true) metrics.repair_pass_false_positive = 1;
  if (saveVal.pass === true && intentOk === false && c.goldenProbe) metrics.repair_pass_deleted_meaning = 1;

  const pass = intentOk && payloadClean && modeVal.pass && metrics.dangerous_write === 0;

  return {
    pass,
    intentOk,
    payloadClean,
    semanticOk,
    validatorRepairOk,
    intent,
    violations,
    primaryFail: violations[0] || (intentOk ? "" : "intent_mismatch"),
    metrics,
    confidence: conf,
  };
}

function aggregateMetrics(results, blockFilter) {
  const filtered = blockFilter ? results.filter((r) => r.case.block === blockFilter) : results;
  const total = filtered.length;
  const pass = filtered.filter((r) => r.eval.pass).length;
  const agg = {
    total,
    pass,
    accuracy: total ? pass / total : 1,
  };
  return agg;
}

function tagAccuracy(results, tag) {
  const subset = results.filter((r) => r.case.tags && r.case.tags.indexOf(tag) >= 0);
  if (!subset.length) return 1;
  return subset.filter((r) => r.eval.pass).length / subset.length;
}

function fieldCleanliness(results, block, field) {
  const subset = results.filter((r) => r.case.block === block);
  if (!subset.length) return 1;
  let clean = 0;
  for (let i = 0; i < subset.length; i++) {
    const m = subset[i].eval.metrics;
    const dirtyKey =
      field === "title"
        ? "dirty_title"
        : field === "body"
          ? "dirty_body"
          : field === "note"
            ? "dirty_note"
            : "dirty_location";
    if (!m[dirtyKey]) clean++;
  }
  return clean / subset.length;
}

function topFailClusters(results, n) {
  const counts = {};
  for (let i = 0; i < results.length; i++) {
    if (results[i].eval.pass) continue;
    const k = results[i].eval.primaryFail || "unknown";
    counts[k] = (counts[k] || 0) + 1;
  }
  return Object.keys(counts)
    .sort((a, b) => counts[b] - counts[a])
    .slice(0, n)
    .map((k) => ({ cluster: k, count: counts[k] }));
}

function verifyDeterministicReplay(generateFn) {
  const a = generateFn().map((c) => c.id + "|" + c.input);
  const b = generateFn().map((c) => c.id + "|" + c.input);
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

module.exports = {
  CORE_ID,
  DETERMINISTIC_SEED,
  CASES_PER_BLOCK,
  GOLDEN_MANUAL_PROBES,
  generateAllCases,
  getMutationErrorReport,
  evaluateCase,
  aggregateMetrics,
  tagAccuracy,
  fieldCleanliness,
  topFailClusters,
  verifyDeterministicReplay,
  applyMutationLayersSafe,
  applyGoldenMutation,
  stripDiacriticsSafe,
  typoLiteSafe,
};
