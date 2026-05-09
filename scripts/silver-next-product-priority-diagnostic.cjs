/**
 * SILVER_NEXT_PRODUCT_PRIORITY_DIAGNOSTIC — P1 UX slice outside 30k harness (diagnostic only).
 * harness_id: silver_next_product_priority_diagnostic_v1
 * Reuses VM engine + evaluateOne from audit_silver_realistic_mobile_corpus.cjs; adds update_vs_create + retrieval needles.
 */
/* eslint-disable no-console */
const fs = require("fs");
const path = require("path");
const os = require("os");
const { execSync } = require("child_process");

const REPO = path.resolve(__dirname, "..");
const HARNESS_ID = "silver_next_product_priority_diagnostic_v1";
const FIXED_NOW_ISO = "2026-05-04T12:00:00";
const REPORT_JSON = path.join(__dirname, "silver-next-product-priority-diagnostic-report.json");

const harness = require("./audit_silver_realistic_mobile_corpus.cjs");
const { loadEngine, evaluateOne, foldCs, rawUserMessage, hasNegWrite } = harness;

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
    { id: "e_ucetni", date: PRISTI_PONDELI, time: "11:00", title: "Účetní", address: "Dlouhá 12 Praha", note: "vzít faktury" },
    { id: "e_kuryr", date: TODAY, time: "12:30", title: "Kurýr", address: "Ostrava centrum", note: "převzít balík" }
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
    { id: "t10", title: "nabít telefon", status: "todo", dueAt: null, note: "", priority: "medium", createdAt: 1, updatedAt: 1 }
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
    { id: "n12", title: "Nabíječka", content: "nabíječka je v autě", createdAt: 1, updatedAt: 1, pinned: false, tags: [], deleted: false }
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

function ctxForDiagnostic(c) {
  const g = c.group;
  if (
    g.indexOf("_query") >= 0 ||
    g === "multi_intent" ||
    g === "task_write" ||
    g === "calendar_write" ||
    g === "note_write" ||
    (c.slice === "update_vs_create" && g === "update_vs_create")
  ) {
    return ctxQuery();
  }
  return ctxEmpty();
}

function buildCases() {
  return [
    {
      id: "rr_zubar",
      slice: "retrieval_relevance",
      group: "calendar_query",
      input: "Kdy mám zubaře?",
      expectedIntent: "calendar.query",
      retrievalNeedles: ["zubar", "zitre", "15:00", "korunn"]
    },
    {
      id: "rr_doktor_past",
      slice: "retrieval_relevance",
      group: "calendar_query",
      input: "Kdy jsem měl doktora?",
      expectedIntent: "calendar.query",
      retrievalNeedles: ["doktor", "lek", "vinohrad", "pozitr", "05-06", "5. 5.", "6. 5."]
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
      id: "rr_pin",
      slice: "retrieval_relevance",
      group: "note_query",
      input: "Najdi PIN.",
      expectedIntent: "note.query",
      retrievalNeedles: ["pin", "kart", "doma"]
    },
    {
      id: "rr_pravnik_tasks",
      slice: "retrieval_relevance",
      group: "task_query",
      input: "Co mám v úkolech s právníkem?",
      expectedIntent: "task.query",
      retrievalNeedles: ["pravnik", "smlouv", "ukol", "poslat"]
    },
    {
      id: "amb_mleko_deadline",
      slice: "ambiguous_command",
      group: "task_query",
      input: "Dokdy mám koupit mléko?",
      expectedIntent: "task.query"
    },
    {
      id: "amb_kytky",
      slice: "ambiguous_command",
      group: "task_query",
      input: "Kdy mám koupit kytky?",
      expectedIntent: "unknown"
    },
    {
      id: "amb_mama_week",
      slice: "ambiguous_command",
      group: "calendar_write",
      input: "V tejdnu zavolat mámě.",
      expectedIntent: "unknown"
    },
    {
      id: "uvc_posun_schuzku",
      slice: "update_vs_create",
      group: "update_vs_create",
      input: "Posuň schůzku.",
      expectedIntent: "non_create_ok"
    },
    {
      id: "uvc_zubar_patek",
      slice: "update_vs_create",
      group: "update_vs_create",
      input: "Změň zubaře na pátek.",
      expectedIntent: "non_create_ok"
    },
    {
      id: "uvc_pravnik",
      slice: "update_vs_create",
      group: "update_vs_create",
      input: "Přesuň právníka.",
      expectedIntent: "non_create_ok"
    },
    {
      id: "mc_zejtra_pravnik",
      slice: "messy_czech",
      group: "calendar_query",
      input: "vole zejtra právník",
      expectedIntent: "calendar.query",
      retrievalNeedles: ["pravnik", "zejtra", "zitre", "18:00", "18"]
    },
    {
      id: "mc_hod_mliko",
      slice: "messy_czech",
      group: "task_write",
      input: "hoď mi tam mlíko",
      expectedIntent: "task.create"
    },
    {
      id: "mc_mrknout_pravnik",
      slice: "messy_czech",
      group: "calendar_query",
      input: "mrkni právník",
      expectedIntent: "calendar.query",
      retrievalNeedles: ["pravnik", "18", "smlouv", "prah"]
    },
    {
      id: "mc_ucetni",
      slice: "messy_czech",
      group: "calendar_query",
      input: "kde mám účetní",
      expectedIntent: "calendar.query",
      retrievalNeedles: ["ucetn", "dlouh", "11:00", "pondel", "pristi"]
    }
  ];
}

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

function inferRootCause(cat) {
  const c = String(cat || "");
  if (c === "update_risk_new_create") return "implicit_reschedule_opened_new_calendar_draft";
  if (c === "retrieval_content_miss") return "answer_missing_entity_or_date_signal";
  if (c === "query_created_write") return "read_query_escalated_to_write";
  if (c === "false_negative") return "seed_hit_not_surfaced_in_reply";
  if (c === "intent_fail") return "routing_or_intent_mismatch";
  if (c === "query_wrong_dataset") return "wrong_module_for_query";
  if (c === "unnecessary_disambiguation") return "over_disambiguation_on_clear_utterance";
  if (c === "raw_response_empty") return "empty_or_too_short_user_message";
  return c || "unknown_bucket";
}

function mainCommit() {
  try {
    return execSync("git rev-parse main", { cwd: REPO, encoding: "utf8" }).trim();
  } catch {
    try {
      return execSync("git rev-parse HEAD", { cwd: REPO, encoding: "utf8" }).trim();
    } catch {
      return "UNKNOWN";
    }
  }
}

function gitStatusClean() {
  try {
    const o = execSync("git status --porcelain", { cwd: REPO, encoding: "utf8" });
    const lines = o.split(/\r?\n/).filter(Boolean);
    return lines.length === 0 ? "YES" : "NO";
  } catch {
    return "NO";
  }
}

function main() {
  const gitCleanBeforeRun = gitStatusClean();
  let eng;
  try {
    eng = loadEngine();
  } catch (e) {
    console.log(String(e && e.message));
    process.exit(1);
  }

  const cases = buildCases();
  const bySlice = {};
  const fails = [];
  const clusterCount = {};
  let dangerousWriteCount = 0;
  let falseWriteCount = 0;
  let queryCreatedWriteCount = 0;
  let writeWhenNegatedCount = 0;
  let passN = 0;
  let failN = 0;

  for (let ci = 0; ci < cases.length; ci++) {
    const c = cases[ci];
    if (!bySlice[c.slice]) bySlice[c.slice] = { pass: 0, fail: 0 };
    try {
      if (eng.iuSilverConversationReset) eng.iuSilverConversationReset();
    } catch {}
    const empty = eng.createEmptyDraft();
    const turn = eng.processUserTurn(c.input, empty, ctxForDiagnostic(c));
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

    if (ev.pass && c.retrievalNeedles && c.retrievalNeedles.length) {
      const fr = foldCs(ev.raw || "");
      const needleEv = retrievalNeedlePass(fr, c.retrievalNeedles);
      if (!needleEv.ok) {
        ev = { pass: false, cat: needleEv.cat, auditIntent: ev.auditIntent, raw: ev.raw };
      }
    }

    if (
      !ev.pass &&
      c.group.indexOf("_query") >= 0 &&
      (ev.cat === "query_created_write" || ev.cat === "negative_instruction_fail")
    ) {
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
      const ck = c.slice + "|" + (ev.cat || "fail");
      clusterCount[ck] = (clusterCount[ck] || 0) + 1;
      fails.push({
        id: c.id,
        slice: c.slice,
        input: c.input,
        cat: ev.cat,
        auditIntent: ev.auditIntent,
        raw: String(ev.raw || "").slice(0, 400),
        root_cause_guess: inferRootCause(ev.cat)
      });
    }
  }

  function pct(p, t) {
    if (!t) return "0.00";
    return ((100 * p) / t).toFixed(2);
  }

  function sliceAcc(slice) {
    const b = bySlice[slice];
    if (!b) return "0.00";
    const t = b.pass + b.fail;
    return pct(b.pass, t);
  }

  const total = cases.length;
  const accuracy = pct(passN, total);

  const clusterPairs = Object.keys(clusterCount)
    .map((k) => ({ k, n: clusterCount[k] }))
    .sort((a, b) => b.n - a.n);
  const top10Clusters = clusterPairs.slice(0, 10).map((x) => x.k + "=" + x.n);
  const rootTally = {};
  for (let fi = 0; fi < fails.length; fi++) {
    const r = fails[fi].root_cause_guess || "unknown";
    rootTally[r] = (rootTally[r] || 0) + 1;
  }
  const top10Roots = Object.keys(rootTally)
    .map((k) => ({ k, n: rootTally[k] }))
    .sort((a, b) => b.n - a.n)
    .slice(0, 10)
    .map((x) => x.k + "=" + x.n);

  let highestImpactSafeFix = "None in diagnostic harness (no engine edits in this task)";
  let recommendedNextCluster = "None";
  let recommendedNextFixScope = "No failing slice — monitor production retrieval logs";
  if (failN > 0 && clusterPairs.length) {
    recommendedNextCluster = clusterPairs[0].k;
    const leadCat = clusterPairs[0].k.split("|")[1] || "";
    if (leadCat === "update_risk_new_create") {
      highestImpactSafeFix = "Gate vague reschedule utterances: require entity/time match before READY_TO_SAVE calendar.create";
      recommendedNextFixScope = "assets/app.js iuSilverCalendarEngine reschedule vs create disambiguation";
    } else if (leadCat === "retrieval_content_miss" || leadCat === "false_negative") {
      highestImpactSafeFix = "Improve read-path summarization so entity/date tokens from seed appear in assistant text";
      recommendedNextFixScope = "assets/app.js read answer templates + global.search ranking";
    } else if (leadCat === "intent_fail" || leadCat === "query_wrong_dataset") {
      highestImpactSafeFix = "Tighten routing for colloquial Czech query vs write cues";
      recommendedNextFixScope = "assets/app.js intent classifier + disambiguation thresholds";
    } else {
      highestImpactSafeFix = "Address dominant fail category: " + leadCat;
      recommendedNextFixScope = "assets/app.js (see cluster " + recommendedNextCluster + ")";
    }
  }

  const report = {
    harness_id: HARNESS_ID,
    main_commit: mainCommit(),
    fixed_now_iso: FIXED_NOW_ISO,
    cases_total: total,
    cases_pass: passN,
    cases_fail: failN,
    accuracy,
    retrieval_relevance_accuracy: sliceAcc("retrieval_relevance"),
    ambiguous_command_accuracy: sliceAcc("ambiguous_command"),
    update_vs_create_accuracy: sliceAcc("update_vs_create"),
    messy_czech_accuracy: sliceAcc("messy_czech"),
    dangerous_write_count: dangerousWriteCount,
    false_write_count: falseWriteCount,
    query_created_write_count: queryCreatedWriteCount,
    write_when_negated_count: writeWhenNegatedCount,
    top_10_fail_clusters: top10Clusters,
    top_10_root_causes: top10Roots,
    highest_impact_safe_fix: highestImpactSafeFix,
    recommended_next_cluster: recommendedNextCluster,
    recommended_next_fix_scope: recommendedNextFixScope,
    fails,
    engine_changed: "NO",
    behavior_changed: "NO",
    changed_files: "scripts/silver-next-product-priority-diagnostic.cjs;scripts/silver-next-product-priority-diagnostic-report.json",
    git_status_clean: gitCleanBeforeRun
  };

  fs.writeFileSync(REPORT_JSON, JSON.stringify(report, null, 2), "utf8");

  const block = [
    "=== SILVER_NEXT_PRODUCT_PRIORITY_DIAGNOSTIC_RESULT ===",
    "main_commit=" + report.main_commit,
    "changed_files=" + report.changed_files,
    "engine_changed=" + report.engine_changed,
    "behavior_changed=" + report.behavior_changed,
    "",
    "cases_total=" + total,
    "cases_pass=" + passN,
    "cases_fail=" + failN,
    "accuracy=" + accuracy + "%",
    "",
    "retrieval_relevance_accuracy=" + report.retrieval_relevance_accuracy + "%",
    "ambiguous_command_accuracy=" + report.ambiguous_command_accuracy + "%",
    "update_vs_create_accuracy=" + report.update_vs_create_accuracy + "%",
    "messy_czech_accuracy=" + report.messy_czech_accuracy + "%",
    "",
    "dangerous_write_count=" + dangerousWriteCount,
    "false_write_count=" + falseWriteCount,
    "query_created_write_count=" + queryCreatedWriteCount,
    "write_when_negated_count=" + writeWhenNegatedCount,
    "",
    "top_10_fail_clusters=" + top10Clusters.join(";"),
    "top_10_root_causes=" + top10Roots.join(";"),
    "highest_impact_safe_fix=" + highestImpactSafeFix,
    "recommended_next_cluster=" + recommendedNextCluster,
    "recommended_next_fix_scope=" + recommendedNextFixScope,
    "",
    "git_status_clean=" + gitCleanBeforeRun,
    "======= END_SILVER_NEXT_PRODUCT_PRIORITY_DIAGNOSTIC_RESULT ==="
  ].join("\n");

  console.log(block);
}

main();
