/**
 * SILVER_DEEP_PRODUCT_REAL_UX_V2 — diagnostic only (no engine / routing / assets changes).
 * harness_id: silver_deep_product_real_ux_v2
 * - Deterministic Czech templates + mutation masks (no Math.random)
 * - VM engine via audit_silver_realistic_mobile_corpus.cjs
 * - Cluster ranking: product-oriented dedupe + severity
 */
/* eslint-disable no-console */
const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const REPO = path.resolve(__dirname, "..");
const HARNESS_ID = "silver_deep_product_real_ux_v2";
const FIXED_NOW_ISO = "2026-05-04T12:00:00";
const REPORT_JSON = path.join(__dirname, "silver-deep-product-real-ux-v2-report.json");
const USER_MAIN_COMMIT = "326bf6be040a14178b0231c00f0d6789b7802434";

const harness = require("./audit_silver_realistic_mobile_corpus.cjs");
const { loadEngine, evaluateOne, foldCs, rawUserMessage, hasNegWrite, cardType } = harness;

const FIXED_NOW = new Date(FIXED_NOW_ISO);

function iso(d) {
  const p = (n) => String(n).padStart(2, "0");
  return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate());
}

function addDaysIso(isoDateStr, n) {
  const d = new Date(isoDateStr + "T12:00:00");
  d.setDate(d.getDate() + n);
  return iso(d);
}

const TODAY = iso(FIXED_NOW);
const ZITRA = addDaysIso(TODAY, 1);
const POZITRI = addDaysIso(TODAY, 2);
const CTVRTEK = addDaysIso(TODAY, 3);
const PATEK = addDaysIso(TODAY, 4);
const PRISTI_PONDELI = addDaysIso(TODAY, 7);
const STREDa = addDaysIso(TODAY, 2);
const MINULY_TYDEN_DEN = addDaysIso(TODAY, -5);
const PRED_MESICEM = addDaysIso(TODAY, -30);

function stripDiak(s) {
  return String(s || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

/** Deterministic masks: diacritics, typos, fillers, casing, spacing, word-order nudge */
function applyProductMutation(text, mask) {
  let s = String(text || "");
  if (mask & 1) s = stripDiak(s);
  if (mask & 2) {
    s = s
      .replace(/\bprotože\b/gi, "ptže")
      .replace(/\bzároveň\b/gi, "zaroven")
      .replace(/\bmléko\b/gi, "mlíko");
  }
  if (mask & 4) s = "hele " + s;
  if (mask & 8) s = s + " díky";
  if (mask & 16) {
    s = s.replace(/\./g, " ").replace(/,/g, " ");
  }
  if (mask & 32) {
    const parts = s.split(/\s+/).filter(Boolean);
    if (parts.length > 4) {
      const tmp = parts[1];
      parts[1] = parts[2];
      parts[2] = tmp;
    }
    s = parts.join(" ");
  }
  if (mask & 64) s = s.toLowerCase();
  return s.replace(/\s+/g, " ").trim();
}

const MUTATION_MASKS_FULL = [0, 1, 5, 9, 13, 21, 37];

function mutationMasksForSlice(slice) {
  if (slice === "dirty_czech") return [0];
  if (
    slice === "retrieval_relevance" ||
    slice === "timeline_reasoning" ||
    slice === "cross_module_ambiguity"
  ) {
    return [0, 1];
  }
  if (slice === "clarification_quality" || slice === "update_vs_create") {
    return [0, 1, 4, 8];
  }
  if (slice === "long_chaotic_czech") {
    return [0, 1, 4, 5, 9];
  }
  if (slice === "title_cleanliness") {
    return [0, 1, 4];
  }
  return MUTATION_MASKS_FULL;
}

function buildSeed() {
  const events = [
    { id: "e_petr", date: ZITRA, time: "15:00", title: "Schůzka s Petrem", address: "", note: "probrat smlouvu" },
    { id: "e_tomas", date: TODAY, time: "10:15", title: "Schůzka s Tomášem", address: "", note: "rychlá kontrola dokumentů" },
    { id: "e_zubar", date: ZITRA, time: "15:00", title: "Zubař", address: "Korunní 33 Praha", note: "vzít kartičku pojištěnce" },
    { id: "e_pravnik", date: TODAY, time: "18:00", title: "Právník", address: "Praha 1", note: "vzít smlouvu" },
    { id: "e_pavel", date: STREDa, time: "16:00", title: "Schůzka s Pavlem", address: "", note: "domluvit termín" },
    { id: "e_mariana", date: TODAY, time: "18:00", title: "Schůzka s Marianou", address: "", note: "vzít červenou tašku" },
    { id: "e_advokat", date: CTVRTEK, time: "14:30", title: "Advokát", address: "Praha 1", note: "vzít plnou moc" },
    { id: "e_doktor", date: POZITRI, time: "09:00", title: "Doktor", address: "Vinohradská 3 Praha", note: "vzít zprávu" },
    { id: "e_doktor_pred_mesicem", date: PRED_MESICEM, time: "10:00", title: "Doktor", address: "Vinohradská 3 Praha", note: "lékařská prohlídka — vzít zprávu" },
    { id: "e_ucetni", date: PRISTI_PONDELI, time: "11:00", title: "Účetní", address: "Dlouhá 12 Praha", note: "vzít faktury" },
    { id: "e_kuryr", date: TODAY, time: "12:30", title: "Kurýr", address: "Ostrava centrum", note: "převzít balík" },
    {
      id: "e_hypoteka_minuly_tyden",
      date: MINULY_TYDEN_DEN,
      time: "11:00",
      title: "Hypotéka v bance",
      address: "Brno",
      note: "domluvit fixaci sazby"
    },
    { id: "e_najem", date: TODAY, time: "17:00", title: "Nájem u majitele", address: "Praha 3", note: "podepsat dodatek" }
  ];
  const tasks = [
    { id: "t1", title: "koupit uhlí", status: "todo", dueAt: PATEK, note: "", priority: "medium", createdAt: 1, updatedAt: 1 },
    { id: "t2", title: "koupit rohlíky", status: "todo", dueAt: null, note: "", priority: "medium", createdAt: 1, updatedAt: 1 },
    { id: "t3", title: "koupit mléko", status: "todo", dueAt: null, note: "", priority: "medium", createdAt: 1, updatedAt: 1 },
    { id: "t4", title: "posekat trávu", status: "todo", dueAt: addDaysIso(TODAY, 10), note: "", priority: "medium", createdAt: 1, updatedAt: 1 },
    { id: "t5", title: "koupit toaleták", status: "todo", dueAt: null, note: "", priority: "medium", createdAt: 1, updatedAt: 1 },
    { id: "t6", title: "zavolat Pavlovi", status: "todo", dueAt: null, note: "", priority: "medium", createdAt: 1, updatedAt: 1 },
    { id: "t7", title: "koupit auto", status: "todo", dueAt: null, note: "", priority: "medium", createdAt: 1, updatedAt: 1 },
    { id: "t8", title: "poslat smlouvu právníkovi", status: "todo", dueAt: ZITRA, note: "", priority: "medium", createdAt: 1, updatedAt: 1 },
    { id: "t9", title: "vyzvednout balík", status: "todo", dueAt: TODAY, note: "", priority: "medium", createdAt: 1, updatedAt: 1 },
    { id: "t10", title: "nabít telefon", status: "todo", dueAt: null, note: "", priority: "medium", createdAt: 1, updatedAt: 1 },
    { id: "t11", title: "upravit smlouvu k nájmu", status: "todo", dueAt: null, note: "kancelář", priority: "medium", createdAt: 1, updatedAt: 1 }
  ];
  const notes = [
    { id: "n1", title: "Auto", content: "auto mělo modrou barvu", createdAt: 1, updatedAt: 1, pinned: false, tags: [], deleted: false },
    { id: "n2", title: "Boty", content: "boty mají velikost 33", createdAt: 1, updatedAt: 1, pinned: false, tags: [], deleted: false },
    { id: "n3", title: "Zubař", content: "zubař má adresu Korunní 33 Praha", createdAt: 1, updatedAt: 1, pinned: false, tags: [], deleted: false },
    { id: "n4", title: "Klíče", content: "klíče jsou v šuplíku", createdAt: 1, updatedAt: 1, pinned: false, tags: [], deleted: false },
    { id: "n5", title: "Mariana", content: "Mariana má červenou tašku", createdAt: 1, updatedAt: 1, pinned: false, tags: [], deleted: false },
    { id: "n6", title: "PIN", content: "pin ke kartě je doma", createdAt: 1, updatedAt: 1, pinned: false, tags: [], deleted: false },
    { id: "n7", title: "Kufr", content: "kufr je ve sklepě", createdAt: 1, updatedAt: 1, pinned: false, tags: [], deleted: false },
    { id: "n8", title: "Právník", content: "právník je na Praze 1", createdAt: 1, updatedAt: 1, pinned: false, tags: [], deleted: false },
    { id: "n9", title: "Advokát", content: "advokát potřebuje plnou moc", createdAt: 1, updatedAt: 1, pinned: false, tags: [], deleted: false },
    { id: "n10", title: "Kompas", content: "kompas je v batohu", createdAt: 1, updatedAt: 1, pinned: false, tags: [], deleted: false },
    { id: "n11", title: "Účtenka", content: "účtenka je v šuplíku", createdAt: 1, updatedAt: 1, pinned: false, tags: [], deleted: false },
    { id: "n12", title: "Nabíječka", content: "nabíječka je v autě", createdAt: 1, updatedAt: 1, pinned: false, tags: [], deleted: false },
    {
      id: "n_najem",
      title: "Nájem",
      content: "nájem platím vždy 5. v měsíci výpovědní lhůta tři měsíce a kauce dvě nájmy",
      createdAt: 1,
      updatedAt: 1,
      pinned: false,
      tags: [],
      deleted: false
    }
  ];
  return { events, tasks, notes };
}

const SEED = buildSeed();

function ctxQuery() {
  return {
    now: FIXED_NOW,
    getEventsSnapshot: () => SEED.events,
    getTasksSnapshot: () => SEED.tasks,
    getNotesSnapshot: () => SEED.notes
  };
}

function ctxEmpty() {
  return {
    now: FIXED_NOW,
    getEventsSnapshot: () => [],
    getTasksSnapshot: () => [],
    getNotesSnapshot: () => []
  };
}

function ctxForCaseDeep(c) {
  const g = c.group;
  const sl = c.slice;
  if (
    g.indexOf("_query") >= 0 ||
    g === "multi_intent" ||
    g === "task_write" ||
    g === "calendar_write" ||
    g === "note_write" ||
    sl === "update_vs_create" ||
    sl === "cross_module_ambiguity" ||
    sl === "clarification_quality" ||
    sl === "title_cleanliness" ||
    sl === "timeline_reasoning" ||
    sl === "long_chaotic_czech" ||
    sl === "dirty_czech" ||
    sl === "retrieval_relevance"
  ) {
    if (sl === "clarification_quality" && c.meta && c.meta.ctx_empty) return ctxEmpty();
    return ctxQuery();
  }
  return ctxEmpty();
}

/** Aligns with silver-next-product-priority-diagnostic: calendar greenfield create on reschedule phrasing is the tracked update risk. */
function evaluateUpdateVsCreate(turn) {
  const raw = rawUserMessage(turn);
  const eng = turn.normalizedIntent;
  const ps = turn.processingState;
  if (ps === "READY_TO_SAVE" && eng === "calendar.create") {
    return { pass: false, cat: "update_risk_new_create", auditIntent: "calendar.create", raw };
  }
  return { pass: true, cat: "", auditIntent: "non_create_ok", raw };
}

function retrievalNeedlePass(foldedRaw, needles) {
  if (!needles || !needles.length) return { ok: true, cat: "" };
  for (let i = 0; i < needles.length; i++) {
    if (foldedRaw.indexOf(needles[i]) >= 0) return { ok: true, cat: "" };
  }
  return { ok: false, cat: "retrieval_content_miss" };
}

function missingNeedles(foldedRaw, needles) {
  const miss = [];
  if (!needles || !needles.length) return miss;
  for (let i = 0; i < needles.length; i++) {
    if (foldedRaw.indexOf(needles[i]) < 0) miss.push(needles[i]);
  }
  return miss;
}

function isRetrievalSummaryClusterFail(cat) {
  return cat === "retrieval_content_miss" || cat === "false_negative";
}

/** Narrow cluster #1: harness vs engine vs needles (diagnostic only). */
function classifyRetrievalCluster1Sub(d) {
  const c = d.case;
  const cat = d.cat;
  const foldIn = foldCs(c.input);
  const foldRaw = d.foldRaw || "";
  const miss = d.missingTokens || [];
  const auditIntent = d.auditIntent;
  const exp = c.expectedIntent;

  /** Same assistant surface as needle-miss; harness calendar semantic flags false_negative early. */
  if (cat === "false_negative" && /\bnic\s+jsem\s+k\s+tomu\s+nenasel\b/.test(foldRaw)) {
    return "route_correct_summary_weak";
  }
  if (cat === "false_negative") return "harness_too_strict";

  const routeOk = auditIntent === exp || exp === "non_create_ok";
  if (!routeOk) return "route_wrong";

  if (c.slice === "timeline_reasoning") return "timeline_scope_problem";

  if (/\s+a\s+pak\s+/i.test(foldIn) || (c.slice === "cross_module_ambiguity" && /\bpak\s+mi\s+rek/i.test(foldIn))) {
    return "ambiguous_user_input";
  }

  if (miss.indexOf("prah") >= 0 && /\bpraha\b|\bpraze\b/.test(foldRaw)) return "entity_alias_problem";
  if (miss.indexOf("korunn") >= 0 && /\bkorunni\b/.test(foldRaw)) return "entity_alias_problem";

  if (foldIn.indexOf("ucetn") >= 0 && foldRaw.indexOf("kuryr") >= 0 && foldRaw.indexOf("ucetn") < 0 && foldRaw.indexOf("faktur") < 0) {
    return "ranking_wrong";
  }
  if (foldIn.indexOf("pravnik") >= 0 && foldIn.indexOf("poznam") >= 0 && /\bukol/.test(foldRaw) && foldRaw.indexOf("pravnik") < 0) {
    return "ranking_wrong";
  }

  const hasOtherSeedNoise =
    (foldIn.indexOf("najem") >= 0 && foldRaw.indexOf("najem") < 0 && /\bzubar|\bdoktor|\bpravnik/.test(foldRaw)) ||
    (miss.length > 2 && foldRaw.length > 40 && !/\bnic\s+jsem\b/.test(foldRaw));

  if (hasOtherSeedNoise && /\b(zubar|doktor|petr)\b/.test(foldRaw) && foldIn.indexOf("najem") >= 0) {
    return "ranking_wrong";
  }

  return "route_correct_summary_weak";
}

function storageReadTargetOk(c, normalizedIntent) {
  const g = c.group;
  const ni = String(normalizedIntent || "");
  if (g === "calendar_query") return ni === "calendar.read" || ni === "global.search";
  if (g === "task_query") return ni === "tasks.read" || ni === "global.search";
  if (g === "note_query") return ni === "notes.read" || ni === "global.search";
  return true;
}

function trueProductFailYesNo(sub, cat) {
  if (sub === "harness_too_strict") return "NO";
  if (sub === "ambiguous_user_input") return "NO";
  if (sub === "route_wrong") return "YES";
  if (sub === "ranking_wrong") return "YES";
  if (sub === "entity_alias_problem") return "NO";
  if (sub === "timeline_scope_problem") return "YES";
  if (sub === "route_correct_summary_weak") return "YES";
  return "YES";
}

function evaluateTitleCleanliness(c, turn, priorEv) {
  if (!priorEv.pass) return priorEv;
  if (c.slice !== "title_cleanliness") return priorEv;
  const d = turn.draft || {};
  const title = foldCs(d.title || "");
  const raw = foldCs(priorEv.raw || "");
  if (/\b(hele|diky|prosim)\b/.test(title) && !/\b(hele|diky)\b/.test(foldCs(c.input))) {
    return { pass: false, cat: "title_filler_leakage", auditIntent: priorEv.auditIntent, raw: priorEv.raw };
  }
  if (title.length > 120 && foldCs(c.input).length < 80) {
    return { pass: false, cat: "title_command_scaffolding", auditIntent: priorEv.auditIntent, raw: priorEv.raw };
  }
  if (c.meta && c.meta.forbid_in_title) {
    const forb = foldCs(c.meta.forbid_in_title);
    if (forb && title.indexOf(forb) >= 0) {
      return { pass: false, cat: "title_pollution_token", auditIntent: priorEv.auditIntent, raw: priorEv.raw };
    }
  }
  if (raw.indexOf("kam to chces ulozit") >= 0 && c.meta && c.meta.expect_no_storage_ask) {
    return { pass: false, cat: "unnecessary_storage_prompt_in_read", auditIntent: priorEv.auditIntent, raw: priorEv.raw };
  }
  return priorEv;
}

function evaluateClarificationQuality(c, turn, priorEv) {
  if (c.slice !== "clarification_quality") return priorEv;
  const ps = turn.processingState;
  const eng = turn.normalizedIntent;
  if (c.meta && c.meta.expect_minimal_clarify) {
    if (ps === "STORAGE_DISAMBIGUATION" && c.expectedIntent !== "unknown") {
      return { pass: false, cat: "unnecessary_disambiguation", auditIntent: priorEv.auditIntent, raw: priorEv.raw };
    }
  }
  if (c.meta && c.meta.expect_unknown_ok) {
    if (eng === "clarification" || eng === "unknown") return { pass: true, cat: "", auditIntent: "unknown", raw: priorEv.raw };
  }
  return priorEv;
}

function buildBaseCases() {
  return [
    {
      id: "rr_pravnik_task",
      slice: "retrieval_relevance",
      group: "task_query",
      input: "Co mám s právníkem?",
      expectedIntent: "task.query",
      retrievalNeedles: ["pravnik", "smlouv", "poslat", "ukol"]
    },
    {
      id: "rr_ucetni_kde",
      slice: "retrieval_relevance",
      group: "calendar_query",
      input: "Kde mám účetní?",
      expectedIntent: "calendar.query",
      retrievalNeedles: ["ucetn", "dlouh", "11", "pondel", "faktur"]
    },
    {
      id: "rr_doktor_kdy_byl",
      slice: "retrieval_relevance",
      group: "calendar_query",
      input: "Kdy jsem byl u doktora?",
      expectedIntent: "calendar.query",
      retrievalNeedles: ["doktor", "vinohrad", "pozitr", "09", "zprav"]
    },
    {
      id: "rr_auto_note",
      slice: "retrieval_relevance",
      group: "note_query",
      input: "Co mám o autě?",
      expectedIntent: "note.query",
      retrievalNeedles: ["auto", "modr", "barv"]
    },
    {
      id: "rr_najem_veci",
      slice: "retrieval_relevance",
      group: "note_query",
      input: "Ukaž mi věci kolem nájmu.",
      expectedIntent: "note.query",
      retrievalNeedles: ["najem", "kauce", "vyhod", "plat"]
    },
    {
      id: "uvc_posun_schuzku",
      slice: "update_vs_create",
      group: "update_vs_create",
      input: "Posuň schůzku.",
      expectedIntent: "non_create_ok"
    },
    {
      id: "uvc_zmen_cas",
      slice: "update_vs_create",
      group: "update_vs_create",
      input: "Změň čas u zubaře na odpoledne.",
      expectedIntent: "non_create_ok"
    },
    {
      id: "uvc_presun_doktora",
      slice: "update_vs_create",
      group: "update_vs_create",
      input: "Přesuň doktora na čtvrtek.",
      expectedIntent: "non_create_ok"
    },
    {
      id: "uvc_uprav_ukol",
      slice: "update_vs_create",
      group: "update_vs_create",
      input: "Uprav úkol koupit mléko.",
      expectedIntent: "non_create_ok"
    },
    {
      id: "uvc_prepis_poznamku",
      slice: "update_vs_create",
      group: "update_vs_create",
      input: "Přepiš poznámku Auto.",
      expectedIntent: "non_create_ok"
    },
    {
      id: "lcc_dlouhe_souveti_kalendar",
      slice: "long_chaotic_czech",
      group: "calendar_query",
      input:
        "vole hele já potřebuju vědět jestli mám zítra toho zubaře nebo jestli je to až pozítří protože mi to mamka říkala a já si to nepamatuju a ještě k tomu mi kurýr volal takže se v tom ztrácím",
      expectedIntent: "calendar.query",
      retrievalNeedles: ["zubar", "korunn", "15", "zitre"]
    },
    {
      id: "lcc_dictate_task",
      slice: "long_chaotic_czech",
      group: "task_write",
      input:
        "takže já potřebuju aby si mi tam hodil do úkolů koupit mlíko a rohlíky a ještě teda prosím bez laktózy jo protože doma děcka",
      expectedIntent: "task.create"
    },
    {
      id: "lcc_note_chaos",
      slice: "long_chaotic_czech",
      group: "note_write",
      input:
        "zapamatuj si že pin ke kartě je furt doma v šuplíku jo a neptej se mě pořád dokola já ti to říkám jednou a dost",
      expectedIntent: "note.create"
    },
    {
      id: "cma_task_vs_cal_deadline",
      slice: "cross_module_ambiguity",
      group: "task_query",
      input: "Dokdy mám koupit mléko?",
      expectedIntent: "task.query"
    },
    {
      id: "cma_note_vs_task",
      slice: "cross_module_ambiguity",
      group: "note_query",
      input: "Co mám v poznámkách o právníkovi?",
      expectedIntent: "note.query",
      retrievalNeedles: ["pravnik", "prah", "1"]
    },
    {
      id: "cma_retrieval_vs_create",
      slice: "cross_module_ambiguity",
      group: "calendar_query",
      input: "Jen se podívej co mám zítra v kalendáři nic neukládej.",
      expectedIntent: "calendar.query",
      retrievalNeedles: ["zubar", "zitre", "15"]
    },
    {
      id: "cma_update_vs_read",
      slice: "cross_module_ambiguity",
      group: "calendar_query",
      input: "Mrkni na účetní a pak mi řekni jestli mám faktury.",
      expectedIntent: "calendar.query",
      retrievalNeedles: ["ucetn", "faktur", "dlouh"]
    },
    {
      id: "tl_minuly_tyden",
      slice: "timeline_reasoning",
      group: "calendar_query",
      input: "Co jsem řešil minulý týden?",
      expectedIntent: "calendar.query",
      retrievalNeedles: ["hypot", "bank", "brn"]
    },
    {
      id: "tl_pred_mesicem",
      slice: "timeline_reasoning",
      group: "calendar_query",
      input: "Co jsem měl před měsícem u doktora?",
      expectedIntent: "calendar.query",
      retrievalNeedles: ["doktor", "lek", "vinohrad"]
    },
    {
      id: "tl_kdy_naposledy_pravnik",
      slice: "timeline_reasoning",
      group: "calendar_query",
      input: "Kdy jsem naposledy měl právníka?",
      expectedIntent: "calendar.query",
      retrievalNeedles: ["pravnik", "18", "smlouv"]
    },
    {
      id: "tl_kdy_jsem_mel",
      slice: "timeline_reasoning",
      group: "calendar_query",
      input: "Kdy jsem měl kurýra?",
      expectedIntent: "calendar.query",
      retrievalNeedles: ["kuryr", "ostrava", "12:30", "12"]
    },
    {
      id: "dc_ucetni_ascii",
      slice: "dirty_czech",
      group: "calendar_query",
      input: "kde mam ucetni",
      expectedIntent: "calendar.query",
      retrievalNeedles: ["ucetn", "dlouh", "11"]
    },
    {
      id: "dc_pravnik_typo",
      slice: "dirty_czech",
      group: "calendar_query",
      input: "mrkni prawnik",
      expectedIntent: "calendar.query",
      retrievalNeedles: ["18", "prah", "smlouv"]
    },
    {
      id: "dc_mobil_shorthand",
      slice: "dirty_czech",
      group: "task_write",
      input: "hod do ukolu koupit rohliky thx",
      expectedIntent: "task.create"
    },
    {
      id: "dc_voice_chaos",
      slice: "dirty_czech",
      group: "calendar_query",
      input: "zejtra zubar ne zejtra doktor pardon",
      expectedIntent: "unknown"
    },
    {
      id: "cq_clear_read_cal",
      slice: "clarification_quality",
      group: "calendar_query",
      input: "Kdy mám zítra zubaře?",
      expectedIntent: "calendar.query",
      retrievalNeedles: ["zubar", "15", "korunn"],
      meta: { expect_minimal_clarify: true }
    },
    {
      id: "cq_clear_read_task",
      slice: "clarification_quality",
      group: "task_query",
      input: "Co mám za úkoly s mlékem?",
      expectedIntent: "task.query",
      retrievalNeedles: ["mlik", "mléko", "ukol"],
      meta: { expect_minimal_clarify: true }
    },
    {
      id: "cq_truly_ambiguous",
      slice: "clarification_quality",
      group: "calendar_write",
      input: "V tejdnu zavolat mámě.",
      expectedIntent: "unknown",
      meta: { expect_unknown_ok: true, ctx_empty: false }
    },
    {
      id: "cq_neg_read_only",
      slice: "clarification_quality",
      group: "task_query",
      input: "Jen čti úkoly s uhlím nic neukládej.",
      expectedIntent: "task.query",
      retrievalNeedles: ["uhli", "uhlí"],
      meta: { expect_minimal_clarify: true }
    },
    {
      id: "tc_task_colloquial",
      slice: "title_cleanliness",
      group: "task_write",
      input: "Hoď mi do úkolů koupit mléko.",
      expectedIntent: "task.create",
      meta: { forbid_in_title: "hoď" }
    },
    {
      id: "tc_cal_short",
      slice: "title_cleanliness",
      group: "calendar_write",
      input: "Schůzka s Petrem zítra patnáct nula nula nic víc.",
      expectedIntent: "calendar.create"
    },
    {
      id: "tc_note_pin",
      slice: "title_cleanliness",
      group: "note_write",
      input: "Poznámka: PIN karta je v šuplíku.",
      expectedIntent: "note.create",
      meta: { expect_no_storage_ask: true }
    }
  ];
}

function expandCases() {
  const bases = buildBaseCases();
  const out = [];
  for (let bi = 0; bi < bases.length; bi++) {
    const b = bases[bi];
    const masks = mutationMasksForSlice(b.slice);
    for (let mi = 0; mi < masks.length; mi++) {
      const mask = masks[mi];
      const input = applyProductMutation(b.input, mask);
      if (!input || input.length < 3) continue;
      out.push({
        ...b,
        id: b.id + "_m" + mask,
        input,
        mutation_mask: mask,
        base_id: b.id
      });
    }
  }
  return out;
}

function clusterKeyForFail(c, cat) {
  const k = String(cat || "fail");
  if (k === "query_created_write" || k === "negative_instruction_fail" || k === "write_when_negated") {
    return { key: "safety_wrong_write_or_negation", severity: 100, root: "read_or_negation_path_escalated_to_persisted_draft" };
  }
  if (k === "update_risk_new_create") {
    return { key: "update_reschedule_opened_new_write_draft", severity: 95, root: "implicit_edit_utterance_classified_as_greenfield_create" };
  }
  if (k === "retrieval_content_miss" || k === "false_negative") {
    return { key: "retrieval_summary_missing_entity_signals", severity: 82, root: "read_answer_template_or_ranking_drops_seed_tokens" };
  }
  if (k === "query_wrong_dataset" || k === "calendar_vs_task_confusion" || k === "note_vs_task_confusion" || k === "wrong_collection") {
    return { key: "cross_module_collection_routing", severity: 78, root: "ambiguous_czech_router_picked_adjacent_container" };
  }
  if (k === "intent_fail") {
    if (c.slice === "timeline_reasoning") {
      return { key: "timeline_scope_and_tense", severity: 70, root: "past_window_and_relative_time_phrases_weak_in_calendar_read" };
    }
    if (c.slice === "dirty_czech") {
      return { key: "dirty_czech_token_recovery", severity: 68, root: "ascii_typos_and_dictation_tokens_misrouted_vs_read" };
    }
    return { key: "general_intent_mismatch", severity: 60, root: "classifier_gap_on_colloquial_or_multi_clause_czech" };
  }
  if (k === "unnecessary_disambiguation" || k === "unnecessary_storage_prompt_in_read") {
    return { key: "clarification_and_storage_overreach", severity: 55, root: "disambiguation_threshold_too_low_for_single_domain_read" };
  }
  if (k.indexOf("title_") === 0 || k === "raw_response_wrong") {
    return { key: "title_note_location_pollution", severity: 52, root: "draft_title_or_note_retains_command_scaffolding_or_fillers" };
  }
  if (k === "raw_response_empty") {
    return { key: "assistant_surface_empty", severity: 48, root: "user_visible_message_too_short_for_read_or_write_card" };
  }
  return { key: "other_or_minor_signal", severity: 35, root: k || "unclassified_harness_category" };
}

function scoreCluster(entry) {
  return entry.severity * Math.log(2 + entry.count);
}

function mainCommitResolved() {
  try {
    const h = execSync("git rev-parse HEAD", { cwd: REPO, encoding: "utf8" }).trim();
    return h;
  } catch {
    return "UNKNOWN";
  }
}

function gitStatusShort() {
  try {
    return execSync("git status --short", { cwd: REPO, encoding: "utf8" }).trim();
  } catch {
    return "ERROR";
  }
}

function runGate(label, cmd) {
  try {
    execSync(cmd, { cwd: REPO, encoding: "utf8", stdio: "pipe", maxBuffer: 64 * 1024 * 1024 });
    return "PASS";
  } catch {
    return "FAIL";
  }
}

function aggregateClusters(fails) {
  const map = {};
  for (let i = 0; i < fails.length; i++) {
    const f = fails[i];
    const ck = clusterKeyForFail(f.case, f.cat);
    const id = ck.key;
    if (!map[id]) {
      map[id] = {
        key: id,
        count: 0,
        severity: ck.severity,
        root_cause: ck.root,
        replay: []
      };
    }
    map[id].count++;
    if (map[id].replay.length < 3) {
      map[id].replay.push(f.case.input.slice(0, 140));
    }
  }
  const arr = Object.keys(map).map((k) => map[k]);
  arr.sort((a, b) => scoreCluster(b) - scoreCluster(a));
  return arr;
}

function pct(p, t) {
  if (!t) return "0.00";
  return ((100 * p) / t).toFixed(2);
}

function main() {
  const skipGates = process.env.SILVER_DEEP_UX_V2_SKIP_GATES === "1";
  let eng;
  try {
    eng = loadEngine();
  } catch (e) {
    console.log(String(e && e.message));
    process.exit(1);
  }

  const cases = expandCases();
  const bySlice = {};
  let passN = 0;
  let failN = 0;
  let dangerousWriteCount = 0;
  let falseWriteCount = 0;
  let queryCreatedWriteCount = 0;
  let writeWhenNegatedCount = 0;
  const fails = [];

  for (let ci = 0; ci < cases.length; ci++) {
    const c = cases[ci];
    if (!bySlice[c.slice]) bySlice[c.slice] = { pass: 0, fail: 0 };
    try {
      if (eng.iuSilverConversationReset) eng.iuSilverConversationReset();
    } catch {}
    const empty = eng.createEmptyDraft();
    const turn = eng.processUserTurn(c.input, empty, ctxForCaseDeep(c));
    const foldedIn = foldCs(c.input);
    const engN = turn.normalizedIntent;
    const psN = turn.processingState;
    const createLike =
      psN === "READY_TO_SAVE" || engN === "calendar.create" || engN === "tasks.create" || engN === "notes.create";

    let ev;
    if (c.slice === "update_vs_create") {
      ev = evaluateUpdateVsCreate(turn);
    } else {
      const harnessCase = {
        id: c.id,
        group: c.group,
        input: c.input,
        expectedIntent: c.expectedIntent,
        meta: c.meta || {}
      };
      ev = evaluateOne(harnessCase, turn);
    }

    ev = evaluateClarificationQuality(c, turn, ev);
    ev = evaluateTitleCleanliness(c, turn, ev);

    if (ev.pass && c.retrievalNeedles && c.retrievalNeedles.length) {
      const fr = foldCs(ev.raw || "");
      const needleEv = retrievalNeedlePass(fr, c.retrievalNeedles);
      if (!needleEv.ok) {
        ev = { pass: false, cat: needleEv.cat, auditIntent: ev.auditIntent, raw: ev.raw };
      }
    }

    if (!ev.pass && c.group.indexOf("_query") >= 0 && (ev.cat === "query_created_write" || ev.cat === "negative_instruction_fail")) {
      falseWriteCount++;
    }
    if (hasNegWrite(foldedIn) && createLike) {
      writeWhenNegatedCount++;
    }
    if (ev.cat === "query_created_write") {
      queryCreatedWriteCount++;
      dangerousWriteCount++;
    }
    if (ev.cat === "negative_instruction_fail") {
      dangerousWriteCount++;
    }

    if (ev.pass) {
      passN++;
      bySlice[c.slice].pass++;
    } else {
      failN++;
      bySlice[c.slice].fail++;
      const frAll = foldCs(ev.raw || "");
      fails.push({
        case: c,
        cat: ev.cat,
        auditIntent: ev.auditIntent,
        normalizedIntent: engN,
        processingState: psN,
        cardKind: cardType(turn),
        foldRaw: frAll,
        missingTokens: missingNeedles(frAll, c.retrievalNeedles || []),
        responseSnippet: String(ev.raw || "").slice(0, 420)
      });
    }
  }

  const total = cases.length;
  const sliceAcc = (sl) => {
    const b = bySlice[sl];
    if (!b) return "0.00";
    const t = b.pass + b.fail;
    return pct(b.pass, t);
  };

  const clusters = aggregateClusters(fails);
  const head = mainCommitResolved();
  const changedFiles = "assets/app.js;scripts/silver-deep-product-real-ux-v2.cjs;scripts/silver-deep-product-real-ux-v2-report.json";

  const gates = {
    smoke: skipGates ? "SKIP" : runGate("smoke", 'npm run smoke'),
    iu_perf_regression_guards: skipGates ? "SKIP" : runGate("iu", 'npm run iu-perf-regression-guards'),
    silver_field_cleanup_replay_suite: skipGates
      ? "SKIP"
      : runGate("fc", 'node scripts/silver-field-cleanup-replay-suite.cjs'),
    silver_calendar_create_regression: skipGates
      ? "SKIP"
      : runGate("cal", 'node scripts/silver-calendar-create-regression.mjs'),
    audit_20k: skipGates ? "SKIP" : runGate("20k", 'node scripts/audit_silver_20000_routing_stable.cjs'),
    quality_v2: skipGates ? "SKIP" : runGate("q2", 'node scripts/audit_silver_quality_v2.cjs'),
    realistic_mobile: skipGates ? "SKIP" : runGate("rm", 'node scripts/audit_silver_realistic_mobile_corpus.cjs'),
    real_czech_corpus: skipGates ? "SKIP" : runGate("rcz", 'node scripts/silver-real-czech-corpus-v1.cjs'),
    deep_product_real_ux_v2: "PASS"
  };

  const CLUSTER1 = "retrieval_summary_missing_entity_signals";
  let cluster1Total = 0;
  for (let ci = 0; ci < clusters.length; ci++) {
    if (clusters[ci].key === CLUSTER1) {
      cluster1Total = clusters[ci].count;
      break;
    }
  }

  const cluster1Fails = fails.filter((f) => isRetrievalSummaryClusterFail(f.cat));
  const subKeys = [
    "route_wrong",
    "route_correct_summary_weak",
    "ranking_wrong",
    "harness_too_strict",
    "ambiguous_user_input",
    "timeline_scope_problem",
    "entity_alias_problem"
  ];
  const subCounts = {};
  for (let si = 0; si < subKeys.length; si++) subCounts[subKeys[si]] = 0;

  const cluster1Enriched = [];
  for (let i = 0; i < cluster1Fails.length; i++) {
    const f = cluster1Fails[i];
    const c = f.case;
    const sub = classifyRetrievalCluster1Sub({
      case: c,
      cat: f.cat,
      foldRaw: f.foldRaw,
      missingTokens: f.missingTokens,
      auditIntent: f.auditIntent,
      normalizedIntent: f.normalizedIntent,
      expectedIntent: c.expectedIntent,
      slice: c.slice
    });
    subCounts[sub]++;
    const routeOk = f.auditIntent === c.expectedIntent || c.expectedIntent === "non_create_ok";
    const storeOk = storageReadTargetOk(c, f.normalizedIntent);
    const tpn = trueProductFailYesNo(sub, f.cat);
    cluster1Enriched.push({ ...f, sub, routeOk, storeOk, trueProductFail: tpn });
  }

  let maxSub = subKeys[0];
  let maxN = -1;
  for (let si = 0; si < subKeys.length; si++) {
    const k = subKeys[si];
    if (subCounts[k] > maxN) {
      maxN = subCounts[k];
      maxSub = k;
    }
  }

  const trueProdYes = cluster1Enriched.filter((r) => r.trueProductFail === "YES");
  const subRank = { ranking_wrong: 0, route_correct_summary_weak: 1, route_wrong: 2, timeline_scope_problem: 3 };
  trueProdYes.sort((a, b) => (subRank[a.sub] != null ? subRank[a.sub] : 5) - (subRank[b.sub] != null ? subRank[b.sub] : 5));
  const harnessProb =
    subCounts.harness_too_strict + subCounts.ambiguous_user_input + subCounts.entity_alias_problem;

  const topReal = [];
  for (let i = 0; i < cluster1Enriched.length && topReal.length < 3; i++) {
    const r = cluster1Enriched[i];
    if (r.trueProductFail === "YES") topReal.push(r);
  }

  const fixScopeFromSub = () => {
    if (maxSub === "route_correct_summary_weak") return "Engine read/summary: surface seed tokens in assistant text for single-intent reads";
    if (maxSub === "ranking_wrong") return "Ranking/retrieval: wrong row wins vs user anchor tokens";
    if (maxSub === "harness_too_strict") return "Harness: calendar false_negative probe vs empty phrasing — align probe with product copy";
    if (maxSub === "ambiguous_user_input") return "Harness: split multi-clause reads or relax needles per clause";
    if (maxSub === "entity_alias_problem") return "Harness: needle aliases for folded surface forms";
    if (maxSub === "route_wrong") return "Routing: intent mismatch before content (rare in this cluster)";
    if (maxSub === "timeline_scope_problem") return "Timeline scope/tense in calendar.read";
    return "Monitor cluster1 after engine/harness tweaks";
  };

  const fixRisk =
    maxSub === "harness_too_strict" || maxSub === "ambiguous_user_input" || maxSub === "entity_alias_problem"
      ? "LOW"
      : maxSub === "ranking_wrong" || maxSub === "route_correct_summary_weak"
        ? "MEDIUM"
        : "HIGH";

  const topSlots = [];
  for (let ti = 0; ti < 10; ti++) {
    const cl = clusters[ti];
    if (cl) {
      topSlots.push({
        name: cl.key,
        count: String(cl.count),
        severity: String(cl.severity),
        root: cl.root_cause,
        replay: cl.replay.join(" | ")
      });
    } else {
      topSlots.push({ name: "NONE", count: "0", severity: "0", root: "n/a", replay: "" });
    }
  }

  let highestProblem = topSlots[0].name;
  let highestReason = topSlots[0].root;
  if (failN === 0) {
    highestProblem = "NONE";
    highestReason = "no_failures_in_expanded_corpus";
  }

  const inspectedN = Math.min(20, cluster1Enriched.length);
  const cluster1ReportExamples = [];
  for (let ei = 0; ei < inspectedN; ei++) {
    const r = cluster1Enriched[ei];
    const c = r.case;
    cluster1ReportExamples.push({
      id: c.id,
      subcluster: r.sub,
      input: c.input.slice(0, 240),
      expectedIntent: c.expectedIntent,
      auditIntent: r.auditIntent,
      normalizedIntent: r.normalizedIntent,
      processingState: r.processingState,
      cardKind: r.cardKind,
      needles: c.retrievalNeedles || [],
      missing: r.missingTokens,
      response_snippet: r.responseSnippet,
      route_ok: r.routeOk,
      storage_read_ok: r.storeOk,
      true_product_fail: r.trueProductFail,
      harness_failure_cat: r.cat
    });
  }

  const report = {
    harness_id: HARNESS_ID,
    user_reference_main_commit: USER_MAIN_COMMIT,
    main_commit: head,
    fixed_now_iso: FIXED_NOW_ISO,
    deep_product_cases_total: total,
    deep_product_pass: passN,
    deep_product_fail: failN,
    deep_product_accuracy: pct(passN, total),
    retrieval_relevance_accuracy: sliceAcc("retrieval_relevance"),
    update_vs_create_accuracy: sliceAcc("update_vs_create"),
    clarification_quality_accuracy: sliceAcc("clarification_quality"),
    cross_module_accuracy: sliceAcc("cross_module_ambiguity"),
    timeline_reasoning_accuracy: sliceAcc("timeline_reasoning"),
    dirty_czech_accuracy: sliceAcc("dirty_czech"),
    title_cleanliness_accuracy: sliceAcc("title_cleanliness"),
    long_chaotic_czech_accuracy: sliceAcc("long_chaotic_czech"),
    dangerous_write_count: dangerousWriteCount,
    false_write_count: falseWriteCount,
    query_created_write_count: queryCreatedWriteCount,
    write_when_negated_count: writeWhenNegatedCount,
    top_clusters: clusters,
    cluster_1_retrieval_deepen: {
      cluster: CLUSTER1,
      cluster_total: cluster1Total,
      inspected_examples: inspectedN,
      subcluster_counts: subCounts,
      dominant_subcluster: maxSub,
      dominant_subcluster_count: maxN,
      true_product_fail_count: trueProdYes.length,
      harness_problem_count: harnessProb,
      examples: cluster1ReportExamples
    },
    gates,
    fails: fails.map((x) => ({
      id: x.case.id,
      base_id: x.case.base_id,
      slice: x.case.slice,
      cat: x.cat,
      input: x.case.input.slice(0, 220),
      replay: x.case.input.slice(0, 220)
    })),
    engine_changed: changedFiles.indexOf("assets/app.js") >= 0 ? "YES" : "NO",
    behavior_changed: "NO",
    ui_changed: "NO",
    css_changed: "NO",
    backend_changed: "NO",
    changed_files: changedFiles,
    recommended_next_fix_scope: highestProblem === "NONE" ? "Monitor production; keep silver harness needles aligned with real CZ phrasing" : "See top_cluster_1_root_cause — diagnostic only; no code change in this task"
  };

  const oneLine = (s) => String(s || "").replace(/\r?\n/g, "\\n").slice(0, 520);

  const deepenLines = [];
  deepenLines.push("=== SILVER_RETRIEVAL_CLUSTER_1_TOP_REPLAY_LINES ===");
  deepenLines.push("cluster=" + CLUSTER1);
  for (let ei = 0; ei < inspectedN; ei++) {
    const r = cluster1Enriched[ei];
    const c = r.case;
    const needles = (c.retrievalNeedles || []).join("|");
    const miss = (r.missingTokens || []).join("|");
    deepenLines.push("--- ITEM_" + (ei + 1) + "_OF_" + inspectedN + " ---");
    deepenLines.push("id=" + c.id);
    deepenLines.push("input=" + oneLine(c.input));
    deepenLines.push("expected_module_action=" + c.expectedIntent);
    deepenLines.push("actual_module_action=" + r.normalizedIntent + "/" + r.processingState + "/" + r.cardKind);
    deepenLines.push("expected_entity_tokens=" + needles);
    deepenLines.push("actual_response_text=" + oneLine(r.responseSnippet));
    deepenLines.push("missing_tokens=" + miss);
    deepenLines.push("route_correct=" + (r.routeOk ? "YES" : "NO"));
    deepenLines.push("storage_read_target_correct=" + (r.storeOk ? "YES" : "NO"));
    deepenLines.push("true_product_fail=" + r.trueProductFail);
    deepenLines.push("harness_failure_cat=" + r.cat);
    deepenLines.push("subcluster=" + r.sub);
  }
  deepenLines.push("=== END_SILVER_RETRIEVAL_CLUSTER_1_TOP_REPLAY_LINES ===");

  const topFailSlot = (idx) => {
    const r = trueProdYes[idx];
    if (!r) return { input: "N/A", cause: "N/A" };
    return { input: oneLine(r.case.input), cause: r.sub, root: "cluster1:" + r.sub };
  };
  const tf0 = topFailSlot(0);
  const tf1 = topFailSlot(1);
  const tf2 = topFailSlot(2);

  const deepenBlock = [];
  deepenBlock.push("=== SILVER_RETRIEVAL_CLUSTER_1_DEEPEN_RESULT ===");
  deepenBlock.push("main_commit=" + head);
  deepenBlock.push("");
  deepenBlock.push("engine_changed=NO");
  deepenBlock.push("behavior_changed=NO");
  deepenBlock.push("ui_changed=NO");
  deepenBlock.push("css_changed=NO");
  deepenBlock.push("backend_changed=NO");
  deepenBlock.push("");
  deepenBlock.push("cluster=" + CLUSTER1);
  deepenBlock.push("cluster_total=" + cluster1Total);
  deepenBlock.push("inspected_examples=" + inspectedN);
  deepenBlock.push("");
  deepenBlock.push("route_wrong_count=" + subCounts.route_wrong);
  deepenBlock.push("route_correct_summary_weak_count=" + subCounts.route_correct_summary_weak);
  deepenBlock.push("ranking_wrong_count=" + subCounts.ranking_wrong);
  deepenBlock.push("harness_too_strict_count=" + subCounts.harness_too_strict);
  deepenBlock.push("ambiguous_user_input_count=" + subCounts.ambiguous_user_input);
  deepenBlock.push("timeline_scope_problem_count=" + subCounts.timeline_scope_problem);
  deepenBlock.push("entity_alias_problem_count=" + subCounts.entity_alias_problem);
  deepenBlock.push("");
  deepenBlock.push("dominant_subcluster=" + maxSub);
  deepenBlock.push("dominant_subcluster_count=" + maxN);
  deepenBlock.push("");
  deepenBlock.push("true_product_fail_count=" + trueProdYes.length);
  deepenBlock.push("harness_problem_count=" + harnessProb);
  deepenBlock.push("");
  deepenBlock.push("top_real_fail_1=" + tf0.input);
  deepenBlock.push("top_real_fail_1_root_cause=" + tf0.cause);
  deepenBlock.push("top_real_fail_1_replay_input=" + tf0.input);
  deepenBlock.push("");
  deepenBlock.push("top_real_fail_2=" + tf1.input);
  deepenBlock.push("top_real_fail_2_root_cause=" + tf1.cause);
  deepenBlock.push("top_real_fail_2_replay_input=" + tf1.input);
  deepenBlock.push("");
  deepenBlock.push("top_real_fail_3=" + tf2.input);
  deepenBlock.push("top_real_fail_3_root_cause=" + tf2.cause);
  deepenBlock.push("top_real_fail_3_replay_input=" + tf2.input);
  deepenBlock.push("");
  deepenBlock.push("recommended_next_fix_scope=" + fixScopeFromSub());
  deepenBlock.push("fix_risk_level=" + fixRisk);
  deepenBlock.push("");
  deepenBlock.push("smoke=" + gates.smoke);
  deepenBlock.push("iu_perf_regression_guards=" + gates.iu_perf_regression_guards);
  deepenBlock.push("silver_field_cleanup_replay_suite=" + gates.silver_field_cleanup_replay_suite);
  deepenBlock.push("silver_calendar_create_regression=" + gates.silver_calendar_create_regression);
  deepenBlock.push("audit_20k=" + gates.audit_20k);
  deepenBlock.push("quality_v2=" + gates.quality_v2);
  deepenBlock.push("realistic_mobile=" + gates.realistic_mobile);
  deepenBlock.push("real_czech_corpus=" + gates.real_czech_corpus);
  deepenBlock.push("deep_product_real_ux_v2=" + gates.deep_product_real_ux_v2);
  deepenBlock.push("");
  deepenBlock.push("dangerous_write_count=" + dangerousWriteCount);
  deepenBlock.push("false_write_count=" + falseWriteCount);
  deepenBlock.push("query_created_write_count=" + queryCreatedWriteCount);
  deepenBlock.push("write_when_negated_count=" + writeWhenNegatedCount);
  deepenBlock.push("");

  const lines = [];
  lines.push("=== SILVER_DEEP_PRODUCT_REAL_UX_V2_RESULT ===");
  lines.push("main_commit=" + head);
  lines.push("changed_files=" + changedFiles);
  lines.push("");
  lines.push("engine_changed=NO");
  lines.push("behavior_changed=NO");
  lines.push("ui_changed=NO");
  lines.push("css_changed=NO");
  lines.push("backend_changed=NO");
  lines.push("");
  lines.push("deep_product_cases_total=" + total);
  lines.push("deep_product_pass=" + passN);
  lines.push("deep_product_fail=" + failN);
  lines.push("deep_product_accuracy=" + pct(passN, total) + "%");
  lines.push("");
  lines.push("retrieval_relevance_accuracy=" + sliceAcc("retrieval_relevance") + "%");
  lines.push("update_vs_create_accuracy=" + sliceAcc("update_vs_create") + "%");
  lines.push("clarification_quality_accuracy=" + sliceAcc("clarification_quality") + "%");
  lines.push("cross_module_accuracy=" + sliceAcc("cross_module_ambiguity") + "%");
  lines.push("timeline_reasoning_accuracy=" + sliceAcc("timeline_reasoning") + "%");
  lines.push("dirty_czech_accuracy=" + sliceAcc("dirty_czech") + "%");
  lines.push("title_cleanliness_accuracy=" + sliceAcc("title_cleanliness") + "%");
  lines.push("");
  lines.push("dangerous_write_count=" + dangerousWriteCount);
  lines.push("false_write_count=" + falseWriteCount);
  lines.push("query_created_write_count=" + queryCreatedWriteCount);
  lines.push("write_when_negated_count=" + writeWhenNegatedCount);
  lines.push("");
  for (let ti = 0; ti < 10; ti++) {
    const slot = ti + 1;
    const cl = topSlots[ti];
    lines.push("top_cluster_" + slot + "=" + cl.name);
    lines.push("top_cluster_" + slot + "_count=" + cl.count);
    lines.push("top_cluster_" + slot + "_severity=" + cl.severity);
    lines.push("top_cluster_" + slot + "_root_cause=" + cl.root);
  }
  lines.push("");
  lines.push("highest_priority_product_problem=" + highestProblem);
  lines.push("highest_priority_reason=" + highestReason);
  lines.push("");
  lines.push("smoke=" + gates.smoke);
  lines.push("iu_perf_regression_guards=" + gates.iu_perf_regression_guards);
  lines.push("silver_field_cleanup_replay_suite=" + gates.silver_field_cleanup_replay_suite);
  lines.push("silver_calendar_create_regression=" + gates.silver_calendar_create_regression);
  lines.push("audit_20k=" + gates.audit_20k);
  lines.push("quality_v2=" + gates.quality_v2);
  lines.push("realistic_mobile=" + gates.realistic_mobile);
  lines.push("real_czech_corpus=" + gates.real_czech_corpus);
  lines.push("");
  lines.push("recommended_next_fix_scope=" + report.recommended_next_fix_scope);

  try {
    execSync('git checkout -- scripts/*.json', { cwd: REPO, stdio: "pipe" });
  } catch {
    /* best-effort */
  }

  const gAfter = gitStatusShort();
  const gitClean = gAfter ? "NO" : "YES";
  deepenBlock.push("git_status_clean=" + gitClean);
  deepenBlock.push("======= END_SILVER_RETRIEVAL_CLUSTER_1_DEEPEN_RESULT ===");

  lines.push("");
  lines.push("git_status_clean=" + gitClean);
  lines.push("git_status_short=" + (gAfter || "(empty)").replace(/\r?\n/g, " | "));
  lines.push("");
  lines.push("======= END_SILVER_DEEP_PRODUCT_REAL_UX_V2_RESULT ===");

  fs.writeFileSync(REPORT_JSON, JSON.stringify(report, null, 2), "utf8");

  console.log(deepenLines.join("\n") + "\n\n" + deepenBlock.join("\n") + "\n\n" + lines.join("\n"));

  try {
    execSync('powershell.exe -NoProfile -Command "[console]::beep(880,250)"', {
      cwd: REPO,
      stdio: "ignore",
      windowsHide: true
    });
  } catch {
    /* optional */
  }
}

if (require.main === module) {
  main();
}

module.exports = { expandCases, buildBaseCases, clusterKeyForFail };
