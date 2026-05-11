/**
 * SILVER_REAL_SCREENSHOT_UX_DIAGNOSTIC — P1 diagnostic slice only.
 * harness_id: silver_real_screenshot_ux_diagnostic_v1
 * No assets/app.js changes; VM engine read from bundle as in audit_silver_realistic_mobile_corpus.cjs
 */
/* eslint-disable no-console */
const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const REPO = path.resolve(__dirname, "..");
const HARNESS_ID = "silver_real_screenshot_ux_diagnostic_v1";
const FIXED_NOW_ISO = "2026-05-04T12:00:00";
const REPORT_JSON = path.join(__dirname, "silver-real-screenshot-ux-diagnostic-report.json");
const USER_REFERENCE_MAIN = "e408d2507986a9872a03139758abefca3f7cfe82";

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

/** Deep-product-aligned seed + screenshot-only notes (narozeniny, uložené věci). */
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
    },
    {
      id: "n_narozeniny",
      title: "Narozeniny",
      content: "teta má narozeniny 12. května vždy koupit květiny den předem",
      createdAt: 1,
      updatedAt: 1,
      pinned: false,
      tags: [],
      deleted: false
    },
    {
      id: "n_ulozene",
      title: "Uložené věci",
      content: "důležité dokumenty jsou ve spodní přihrádce věci z banky a pojistky",
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

function ctxForCase(c) {
  const g = c.group;
  const cluster = c.product_cluster;
  if (cluster === "module_negation_scope" && c.meta && c.meta.ctx_empty) return ctxEmpty();
  if (g.indexOf("_query") >= 0 || g === "multi_intent") return ctxQuery();
  if (g === "task_write" || g === "calendar_write" || g === "note_write") return ctxQuery();
  if (g === "update_vs_create") return ctxQuery();
  return ctxEmpty();
}

function evaluateUpdateVsCreate(turn) {
  const raw = rawUserMessage(turn);
  const eng = turn.normalizedIntent;
  const ps = turn.processingState;
  if (ps === "READY_TO_SAVE" && (eng === "calendar.create" || eng === "tasks.create" || eng === "notes.create")) {
    return { pass: false, cat: "update_intent_create", auditIntent: String(eng), raw };
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

function evaluateTitlePollutionTask(c, turn, prior) {
  if (!prior.pass) return prior;
  if (c.product_cluster !== "task_title_pollution") return prior;
  const d = turn.draft || {};
  const title = foldCs(d.title || "");
  const rawF = foldCs(prior.raw || "");
  if (/\b(dej|hod|napi[sš]|pripomen|upomink|do\s+ukol|musim\s+dnes)\b/.test(title)) {
    return { pass: false, cat: "task_title_command_glue", auditIntent: prior.auditIntent, raw: prior.raw };
  }
  if (title.length > 90 && foldCs(c.input).length < 70) {
    return { pass: false, cat: "task_title_scaffolding", auditIntent: prior.auditIntent, raw: prior.raw };
  }
  return prior;
}

function evaluateCalendarTitleNoteAddressPollution(c, turn, prior) {
  if (!prior.pass) return prior;
  if (c.product_cluster !== "calendar_title_note_address_pollution") return prior;
  const d = turn.draft || {};
  const title = foldCs(d.title || "");
  const addr = foldCs(d.address || "");
  const note = foldCs(d.note || "");
  const streetish = /\b(korunn|vinohrad|dlouh|prah|ostrava|brno)\b/.test(title);
  const addrWeak = addr.length < 4;
  if (streetish && addrWeak) {
    return { pass: false, cat: "address_leaked_into_title", auditIntent: prior.auditIntent, raw: prior.raw };
  }
  if (/\b(vzit|nezapomen|poznam|pozn[aá]mka)\b/.test(title) && note.length < 6) {
    return { pass: false, cat: "note_tail_in_title", auditIntent: prior.auditIntent, raw: prior.raw };
  }
  return prior;
}

function evaluateVagueTimePolicy(c, turn, prior) {
  if (!prior.pass) return prior;
  if (c.product_cluster !== "vague_time_policy") return prior;
  const eng = turn.normalizedIntent;
  const ps = turn.processingState;
  if (ps === "READY_TO_SAVE" && (eng === "calendar.create" || eng === "tasks.create")) {
    return { pass: false, cat: "vague_time_overcommit", auditIntent: String(eng), raw: prior.raw };
  }
  return prior;
}

function buildScreenshotCases() {
  return [
    {
      id: "ss_qtc_kolik_schuzek",
      product_cluster: "query_to_create",
      group: "calendar_query",
      input: "Kolik mám dnes schůzek?",
      expectedIntent: "calendar.query",
      retrievalNeedles: ["schuz", "udal", "10", "12", "17", "18"]
    },
    {
      id: "ss_qtc_v_kolik",
      product_cluster: "query_to_create",
      group: "calendar_query",
      input: "V kolik mám dneska schůzek?",
      expectedIntent: "calendar.query",
      retrievalNeedles: ["10", "12", "17", "18", "schuz"]
    },
    {
      id: "ss_qtc_ukoly_dnes",
      product_cluster: "query_to_create",
      group: "task_query",
      input: "Mám dnes nějaké úkoly?",
      expectedIntent: "task.query",
      retrievalNeedles: ["ukol", "balik", "uhli"]
    },
    {
      id: "ss_qtc_kolik_poznamek",
      product_cluster: "query_to_create",
      group: "note_query",
      input: "Kolik mám poznámek?",
      expectedIntent: "note.query",
      retrievalNeedles: ["poznam", "auto", "pin", "narozen"]
    },
    {
      id: "ss_nrf_pin_karta",
      product_cluster: "note_retrieval_fail",
      group: "note_query",
      input: "Kde mám PIN ke kartě?",
      expectedIntent: "note.query",
      retrievalNeedles: ["pin", "kart", "dom"]
    },
    {
      id: "ss_nrf_narozeniny",
      product_cluster: "note_retrieval_fail",
      group: "note_query",
      input: "Co mám v poznámkách o narozeninách?",
      expectedIntent: "note.query",
      retrievalNeedles: ["narozen", "teta", "kvet"]
    },
    {
      id: "ss_nrf_ulozene_veci",
      product_cluster: "note_retrieval_fail",
      group: "note_query",
      input: "Ukaž mi uložené věci kolem dokumentů.",
      expectedIntent: "note.query",
      retrievalNeedles: ["dokument", "prihrad", "bank", "ulozen"]
    },
    {
      id: "ss_nrf_obsah_zubar",
      product_cluster: "note_retrieval_fail",
      group: "note_query",
      input: "Jaká adresa je u zubaře v poznámkách?",
      expectedIntent: "note.query",
      retrievalNeedles: ["korunn", "33", "prah"]
    },
    {
      id: "ss_ttp_dej_do_ukolu",
      product_cluster: "task_title_pollution",
      group: "task_write",
      input: "Dej mi do úkolů že musím zaplatit nájem.",
      expectedIntent: "task.create"
    },
    {
      id: "ss_ttp_pripominka",
      product_cluster: "task_title_pollution",
      group: "task_write",
      input: "Připomínka dnes musím vyzvednout balík.",
      expectedIntent: "task.create"
    },
    {
      id: "ss_ttp_lepidlo",
      product_cluster: "task_title_pollution",
      group: "task_write",
      input: "Hoď do úkolů prosím koupit mléko díky.",
      expectedIntent: "task.create"
    },
    {
      id: "ss_calpoll_adresa_v_nazvu",
      product_cluster: "calendar_title_note_address_pollution",
      group: "calendar_write",
      input: "Schůzka banka zítra v 10:00 Korunní 33 Praha celé jen do názvu nic do adresy.",
      expectedIntent: "calendar.create"
    },
    {
      id: "ss_calpoll_vzit_do_pozn",
      product_cluster: "calendar_title_note_address_pollution",
      group: "calendar_write",
      input: "Zubař zítra 15:00 vzít kartičku — adresu dej do adresy ne do poznámky.",
      expectedIntent: "calendar.create"
    },
    {
      id: "ss_calpoll_tail",
      product_cluster: "calendar_title_note_address_pollution",
      group: "calendar_write",
      input: "Právník dnes v 18:00 poznámka: vzít smlouvu a občanku odděleně.",
      expectedIntent: "calendar.create"
    },
    {
      id: "ss_rvc_pripomen_task",
      product_cluster: "reminder_vs_calendar",
      group: "task_write",
      input: "Připomeň mi zítra v 8 nakoupit mléko.",
      expectedIntent: "task.create"
    },
    {
      id: "ss_rvc_upominka",
      product_cluster: "reminder_vs_calendar",
      group: "task_write",
      input: "Upomínka: dnes musím zavolat účetní.",
      expectedIntent: "task.create"
    },
    {
      id: "ss_rvc_task_not_cal",
      product_cluster: "reminder_vs_calendar",
      group: "task_write",
      input: "Připomeň mi v 17:00 zaplatit nájem.",
      expectedIntent: "task.create"
    },
    {
      id: "ss_mns_ne_poznamky_kal",
      product_cluster: "module_negation_scope",
      group: "calendar_write",
      input: "Tohle nepiš do poznámek, jen do kalendáře: schůzka banka zítra 10:00.",
      expectedIntent: "calendar.create"
    },
    {
      id: "ss_mns_ne_kal_poz",
      product_cluster: "module_negation_scope",
      group: "note_write",
      input: "Ne do kalendáře, ulož jen do poznámek: heslo WiFi doma je modrá-hvězda-99.",
      expectedIntent: "note.create",
      meta: { ctx_empty: true }
    },
    {
      id: "ss_mns_redirect",
      product_cluster: "module_negation_scope",
      group: "calendar_write",
      input: "Neukládej to do poznámek, chci to v kalendáři: kurýr dnes 12:30.",
      expectedIntent: "calendar.create"
    },
    {
      id: "ss_ui_posun",
      product_cluster: "update_intent",
      group: "update_vs_create",
      input: "Posuň schůzku s právníkem na čtvrtek odpoledne.",
      expectedIntent: "non_create_ok"
    },
    {
      id: "ss_ui_zmen_cas",
      product_cluster: "update_intent",
      group: "update_vs_create",
      input: "Změň čas u zubaře na pátek dopoledne.",
      expectedIntent: "non_create_ok"
    },
    {
      id: "ss_ui_presun",
      product_cluster: "update_intent",
      group: "update_vs_create",
      input: "Přesuň doktora na příští pondělí.",
      expectedIntent: "non_create_ok"
    },
    {
      id: "ss_ui_odloz",
      product_cluster: "update_intent",
      group: "update_vs_create",
      input: "Odlož schůzku s Petrem o den později.",
      expectedIntent: "non_create_ok"
    },
    {
      id: "ss_vtp_vecer",
      product_cluster: "vague_time_policy",
      group: "calendar_write",
      input: "Schůzka s Pavlem zítra někdy večer.",
      expectedIntent: "calendar.create"
    },
    {
      id: "ss_vtp_po_obede",
      product_cluster: "vague_time_policy",
      group: "calendar_write",
      input: "Účetní v pondělí po obědě.",
      expectedIntent: "calendar.create"
    },
    {
      id: "ss_vtp_kolem_sedme",
      product_cluster: "vague_time_policy",
      group: "calendar_write",
      input: "Kurýr dnes kolem sedmé.",
      expectedIntent: "calendar.create"
    },
    {
      id: "ss_vtp_task_vecer",
      product_cluster: "vague_time_policy",
      group: "task_write",
      input: "Úkol koupit uhlí zítra někdy večer.",
      expectedIntent: "task.create"
    }
  ];
}

function mainCommitResolved() {
  try {
    const mb = execSync("git merge-base HEAD origin/main", { cwd: REPO, encoding: "utf8" }).trim();
    if (mb) return mb;
  } catch {
    /* no origin/main */
  }
  try {
    return execSync("git rev-parse HEAD", { cwd: REPO, encoding: "utf8" }).trim();
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

function main() {
  let eng;
  try {
    eng = loadEngine();
  } catch (e) {
    console.log(String(e && e.message));
    process.exit(1);
  }

  const cases = buildScreenshotCases();
  const fails = [];
  const clusterFailCounts = {};
  const clusterNames = [
    "query_to_create",
    "note_retrieval_fail",
    "task_title_pollution",
    "calendar_title_note_address_pollution",
    "reminder_vs_calendar",
    "module_negation_scope",
    "update_intent",
    "vague_time_policy"
  ];
  for (let i = 0; i < clusterNames.length; i++) clusterFailCounts[clusterNames[i]] = 0;

  let passN = 0;
  let safetyRisk = 0;

  for (let ci = 0; ci < cases.length; ci++) {
    const c = cases[ci];
    try {
      if (eng.iuSilverConversationReset) eng.iuSilverConversationReset();
    } catch {}
    const empty = eng.createEmptyDraft();
    const turn = eng.processUserTurn(c.input, empty, ctxForCase(c));
    const foldedIn = foldCs(c.input);
    const engN = turn.normalizedIntent;
    const psN = turn.processingState;

    let ev;
    if (c.group === "update_vs_create") {
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

    ev = evaluateTitlePollutionTask(c, turn, ev);
    ev = evaluateCalendarTitleNoteAddressPollution(c, turn, ev);
    ev = evaluateVagueTimePolicy(c, turn, ev);

    if (ev.pass && c.retrievalNeedles && c.retrievalNeedles.length) {
      const fr = foldCs(ev.raw || "");
      const needleEv = retrievalNeedlePass(fr, c.retrievalNeedles);
      if (!needleEv.ok) {
        ev = { pass: false, cat: needleEv.cat, auditIntent: ev.auditIntent, raw: ev.raw };
      }
    }

    const safetyCase =
      (hasNegWrite(foldedIn) && (psN === "READY_TO_SAVE" || engN === "calendar.create" || engN === "tasks.create" || engN === "notes.create")) ||
      ev.cat === "query_created_write" ||
      ev.cat === "negative_instruction_fail" ||
      ev.cat === "write_when_negated";
    if (safetyCase) safetyRisk++;

    if (ev.pass) {
      passN++;
    } else {
      fails.push({
        id: c.id,
        product_cluster: c.product_cluster,
        cat: ev.cat,
        input: c.input,
        normalizedIntent: engN,
        processingState: psN,
        cardKind: cardType(turn)
      });
      clusterFailCounts[c.product_cluster]++;
    }
  }

  const total = cases.length;
  const failN = fails.length;

  const sortedClusters = clusterNames.map((k) => ({ key: k, count: clusterFailCounts[k] })).sort((a, b) => b.count - a.count);

  const pickSample = (cluster, idx) => {
    const hit = fails.filter((f) => f.product_cluster === cluster);
    if (hit[idx]) return hit[idx].input.slice(0, 200);
    const any = cases.filter((x) => x.product_cluster === cluster);
    if (any[idx]) return any[idx].input.slice(0, 200);
    return "N/A";
  };

  const head = mainCommitResolved();
  const gShort = gitStatusShort();
  const gitClean = gShort ? "NO" : "YES";

  const top1 = sortedClusters[0];
  const top2 = sortedClusters[1];
  const top3 = sortedClusters[2];

  const safeFix =
    safetyRisk === 0 && top1 && top1.count > 0 && top1.key !== "module_negation_scope" ? "YES" : safetyRisk > 0 ? "NO" : "YES";

  const report = {
    harness_id: HARNESS_ID,
    user_reference_main_commit: USER_REFERENCE_MAIN,
    main_commit: head,
    fixed_now_iso: FIXED_NOW_ISO,
    engine_changed: "NO",
    assets_app_changed: "NO",
    samples_total: total,
    pass: passN,
    fail: failN,
    cluster_fail_counts: clusterFailCounts,
    fails,
    git_status_clean: gitClean,
    git_status_short: gShort || "(empty)"
  };

  fs.writeFileSync(REPORT_JSON, JSON.stringify(report, null, 2), "utf8");

  const block = [];
  block.push("=== SILVER_REAL_SCREENSHOT_UX_DIAGNOSTIC_RESULT ===");
  block.push("main_commit=" + head);
  block.push("engine_changed=NO");
  block.push("assets_app_changed=NO");
  block.push("");
  block.push("samples_total=" + total);
  block.push("");
  block.push("query_to_create_count=" + clusterFailCounts.query_to_create);
  block.push("note_retrieval_fail_count=" + clusterFailCounts.note_retrieval_fail);
  block.push("task_title_pollution_count=" + clusterFailCounts.task_title_pollution);
  block.push("calendar_title_note_address_pollution_count=" + clusterFailCounts.calendar_title_note_address_pollution);
  block.push("reminder_vs_calendar_count=" + clusterFailCounts.reminder_vs_calendar);
  block.push("module_negation_scope_count=" + clusterFailCounts.module_negation_scope);
  block.push("update_intent_count=" + clusterFailCounts.update_intent);
  block.push("vague_time_policy_count=" + clusterFailCounts.vague_time_policy);
  block.push("safety_risk_count=" + safetyRisk);
  block.push("");
  block.push("top_product_cluster_1=" + (top1 ? top1.key : "NONE"));
  block.push("top_product_cluster_1_count=" + (top1 ? top1.count : 0));
  block.push("top_product_cluster_2=" + (top2 ? top2.key : "NONE"));
  block.push("top_product_cluster_2_count=" + (top2 ? top2.count : 0));
  block.push("top_product_cluster_3=" + (top3 ? top3.key : "NONE"));
  block.push("top_product_cluster_3_count=" + (top3 ? top3.count : 0));
  block.push("");
  block.push("sample_query_to_create_1=" + pickSample("query_to_create", 0));
  block.push("sample_query_to_create_2=" + pickSample("query_to_create", 1));
  block.push("sample_query_to_create_3=" + pickSample("query_to_create", 2));
  block.push("");
  block.push("sample_note_retrieval_fail_1=" + pickSample("note_retrieval_fail", 0));
  block.push("sample_note_retrieval_fail_2=" + pickSample("note_retrieval_fail", 1));
  block.push("sample_note_retrieval_fail_3=" + pickSample("note_retrieval_fail", 2));
  block.push("");
  block.push("sample_title_pollution_1=" + pickSample("task_title_pollution", 0));
  block.push("sample_title_pollution_2=" + pickSample("task_title_pollution", 1));
  block.push("sample_title_pollution_3=" + pickSample("task_title_pollution", 2));
  block.push("");
  block.push("safe_fix_candidate=" + safeFix);
  block.push("recommended_next_fix_cluster=" + (top1 && top1.count > 0 ? top1.key : "none"));
  block.push("recommended_next_scope=engine_intent_and_draft_surface_only");
  block.push("deferred_scope=routing_normalizer_ui_css_backend");
  block.push("");
  block.push("git_status_clean=" + gitClean);
  block.push("======= END_SILVER_REAL_SCREENSHOT_UX_DIAGNOSTIC_RESULT ===");

  console.log(block.join("\n"));

  try {
    execSync('powershell.exe -NoProfile -Command "[console]::beep(880,250)"', {
      cwd: REPO,
      stdio: "ignore",
      windowsHide: true
    });
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

module.exports = { buildScreenshotCases, buildSeed };
