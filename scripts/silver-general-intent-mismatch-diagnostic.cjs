/**
 * SILVER general_intent_mismatch cluster diagnostic (colloquial read-vs-write replay).
 * harness_id: silver_general_intent_mismatch_diagnostic_v1
 */
/* eslint-disable no-console */
const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const REPO = path.resolve(__dirname, "..");
const HARNESS_ID = "silver_general_intent_mismatch_diagnostic_v1";
const TARGET_CLUSTER = "general_intent_mismatch";
const FIXED_NOW_ISO = "2026-05-04T12:00:00";
const REPORT_JSON = path.join(__dirname, "silver-general-intent-mismatch-diagnostic-report.json");

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
const VCERA = addDaysIso(TODAY, -1);

function buildSeed() {
  const events = [
    { id: "e_doktor", date: VCERA, time: "08:30", title: "Doktor", address: "Vinohradská 3 Praha", note: "minulá návštěva" },
    { id: "e_doktor_fut", date: ZITRA, time: "09:00", title: "Doktor", address: "Vinohradská 3 Praha", note: "budoucí" },
    { id: "e_pravnik", date: VCERA, time: "10:00", title: "Právník", address: "Brno", note: "" },
    { id: "e_bank", date: VCERA, time: "11:00", title: "Schůzka s bankou", address: "", note: "" },
    { id: "e_servis", date: VCERA, time: "09:00", title: "Servis", address: "Hlavní 12", note: "kontrola auta" },
    { id: "e_pohovor", date: VCERA, time: "10:00", title: "Pohovor", address: "Brno", note: "" },
    { id: "e_kuryr", date: TODAY, time: "12:30", title: "Kurýr", address: "Ostrava", note: "" },
    { id: "e_kontrola", date: VCERA, time: "14:00", title: "Kontrola", address: "Praha", note: "" },
    { id: "e_urad", date: TODAY, time: "16:30", title: "Termín u úřadu", address: "Praha 4", note: "" },
    { id: "e_klient", date: VCERA, time: "11:00", title: "Jednání s klientem", address: "", note: "" }
  ];
  const tasks = [
    { id: "t_mleko", title: "koupit mléko", status: "todo", dueAt: null, note: "", priority: "medium", createdAt: 1, updatedAt: 1 },
    { id: "t_najem", title: "zaplatit nájem", status: "todo", dueAt: null, note: "", priority: "medium", createdAt: 1, updatedAt: 1 },
    { id: "t_mama", title: "zavolat mámě", status: "todo", dueAt: null, note: "", priority: "medium", createdAt: 1, updatedAt: 1 },
    { id: "t_smlouva", title: "poslat smlouvu", status: "todo", dueAt: null, note: "", priority: "medium", createdAt: 1, updatedAt: 1 },
    { id: "t_ukol", title: "udělat úkol", status: "todo", dueAt: null, note: "", priority: "medium", createdAt: 1, updatedAt: 1 },
    { id: "t_balik", title: "vyzvednout balík", status: "todo", dueAt: null, note: "", priority: "medium", createdAt: 1, updatedAt: 1 }
  ];
  const notes = [
    { id: "n_heslo", title: "Heslo", content: "heslo k bance", createdAt: 1, updatedAt: 1, pinned: false, tags: [], deleted: false },
    { id: "n_banka", title: "Banka", content: "poznámka o bance", createdAt: 1, updatedAt: 1, pinned: false, tags: [], deleted: false },
    { id: "n_pravnik", title: "Právník", content: "poznámka o právníkovi", createdAt: 1, updatedAt: 1, pinned: false, tags: [], deleted: false },
    { id: "n_ucet", title: "Účet", content: "číslo účtu", createdAt: 1, updatedAt: 1, pinned: false, tags: [], deleted: false }
  ];
  return { events, tasks, notes };
}

const SEED = buildSeed();

function ctx() {
  return {
    now: FIXED_NOW,
    getEventsSnapshot: () => SEED.events,
    getTasksSnapshot: () => SEED.tasks,
    getNotesSnapshot: () => SEED.notes
  };
}

function buildCases() {
  const pos = [
    { id: "gim_pos_01", polarity: "positive", input: "vole kdy jsem měl toho doktora", expectedIntent: "calendar.query" },
    { id: "gim_pos_02", polarity: "positive", input: "hele kdy jsem byl u právníka", expectedIntent: "calendar.query" },
    { id: "gim_pos_03", polarity: "positive", input: "kdy jsem měl tu schůzku s bankou", expectedIntent: "calendar.query" },
    { id: "gim_pos_04", polarity: "positive", input: "kdy jsem měl servis auta", expectedIntent: "calendar.query" },
    { id: "gim_pos_05", polarity: "positive", input: "kdy jsem měl ten pohovor", expectedIntent: "calendar.query" },
    { id: "gim_pos_06", polarity: "positive", input: "kdy jsem měl kurýra", expectedIntent: "calendar.query" },
    { id: "gim_pos_07", polarity: "positive", input: "hele mrkni kdy jsem měl kontrolu", expectedIntent: "calendar.query" },
    { id: "gim_pos_08", polarity: "positive", input: "jen se podívej kdy jsem měl doktora", expectedIntent: "calendar.query" },
    { id: "gim_pos_09", polarity: "positive", input: "kdy jsem měl v kalendáři termín s úřadem", expectedIntent: "calendar.query" },
    { id: "gim_pos_10", polarity: "positive", input: "kdy jsem měl jednání s klientem", expectedIntent: "calendar.query" }
  ];
  const neg = [
    { id: "gim_neg_11", polarity: "negative", input: "kdy jsem měl koupit mlíko", expectNoWrite: true, forbidCalendarRead: true },
    { id: "gim_neg_12", polarity: "negative", input: "kdy jsem měl zaplatit nájem", expectNoWrite: true, forbidCalendarRead: true },
    { id: "gim_neg_13", polarity: "negative", input: "kdy jsem měl zavolat mámě", expectNoWrite: true, forbidCalendarRead: true },
    { id: "gim_neg_14", polarity: "negative", input: "kdy jsem měl poslat smlouvu", expectNoWrite: true, forbidCalendarRead: true },
    { id: "gim_neg_15", polarity: "negative", input: "kdy jsem měl udělat úkol", expectNoWrite: true, forbidCalendarRead: true },
    { id: "gim_neg_16", polarity: "negative", input: "kdy jsem měl vyzvednout balík", expectNoWrite: true, forbidCalendarRead: true },
    { id: "gim_neg_17", polarity: "negative", input: "kdy jsem si poznamenal heslo", expectNoWrite: true, forbidNoteCreate: true },
    { id: "gim_neg_18", polarity: "negative", input: "kdy jsem si psal poznámku o bance", expectNoWrite: true, forbidNoteCreate: true },
    { id: "gim_neg_19", polarity: "negative", input: "kdy jsem ukládal poznámku o právníkovi", expectNoWrite: true, forbidNoteCreate: true },
    { id: "gim_neg_20", polarity: "negative", input: "kdy jsem si zapsal číslo účtu", expectNoWrite: true, forbidNoteCreate: true },
    { id: "gim_neg_21", polarity: "negative", input: "nic neukládej jen mi řekni kdy jsem měl doktora", expectNoWrite: true, expectedIntent: "calendar.query" },
    { id: "gim_neg_22", polarity: "negative", input: "nechci nic vytvářet kdy jsem měl servis", expectNoWrite: true, expectedIntent: "calendar.query" },
    { id: "gim_neg_23", polarity: "negative", input: "jen se ptám kdy jsem měl schůzku", expectNoWrite: true, expectedIntent: "calendar.query" },
    { id: "gim_neg_24", polarity: "negative", input: "kdy jsem měl doktora ale nic nepřidávej", expectNoWrite: true, expectedIntent: "calendar.query" }
  ];
  return pos
    .map((c) => ({ ...c, group: "calendar_query", slice: TARGET_CLUSTER }))
    .concat(neg.map((c) => ({ ...c, group: "calendar_query", slice: TARGET_CLUSTER })));
}

function isWriteTurn(turn) {
  const eng = String(turn.normalizedIntent || "");
  const ps = String(turn.processingState || "");
  if (ps === "READY_TO_SAVE") return true;
  return eng === "calendar.create" || eng === "tasks.create" || eng === "notes.create";
}

function classifyBucket(c, turn, ev) {
  const eng = String(turn.normalizedIntent || "");
  const ps = String(turn.processingState || "");
  const raw = String(ev.raw || "");

  if (isWriteTurn(turn) && c.expectNoWrite) {
    return "safety_risk";
  }

  if (c.polarity === "positive") {
    if (ev.pass) return "pass";
    if (eng === "clarification" || /upresni|upřesni/i.test(raw)) return "safe_clarification";
    if (eng !== "calendar.read" && ev.cat === "intent_fail") return "true_engine_fail";
    if (ev.cat === "retrieval_content_miss" || ev.cat === "false_negative") return "ranking_weakness";
    if (ev.cat === "retrieval_summary_miss") return "summary_weakness";
    if (ev.cat) return "true_engine_fail";
    return "pass";
  }

  if (c.forbidNoteCreate && eng === "notes.create") {
    return "safety_risk";
  }
  if (c.forbidCalendarRead && eng === "calendar.read") {
    return "true_engine_fail";
  }
  if (c.forbidCalendarRead && /\bkdy\s+(?:jsem|sem)\s+m(?:el|ela|eli)\b/.test(foldCs(c.input))) {
    const taskLike =
      /\b(koupit|zavolat|zaplatit|udelat|poslat|vyzvednout|pripomenout|napsat|odeslat)\b/.test(foldCs(c.input));
    if (taskLike && eng === "calendar.read") {
      return "true_engine_fail";
    }
  }
  if (c.expectedIntent && !ev.pass) {
    if (isWriteTurn(turn)) return "safety_risk";
    return "true_engine_fail";
  }
  if (ev.pass || !isWriteTurn(turn)) return "pass";
  return "safety_risk";
}

function evaluatePositive(c, turn, evHarness) {
  if (evHarness.pass) return { pass: true, cat: "" };
  return evHarness;
}

function evaluateNegative(c, turn) {
  const eng = String(turn.normalizedIntent || "");
  const folded = foldCs(c.input);
  if (isWriteTurn(turn)) {
    return { pass: false, cat: "query_created_write", auditIntent: eng, raw: rawUserMessage(turn) };
  }
  if (c.forbidNoteCreate && eng === "notes.create") {
    return { pass: false, cat: "query_created_write", auditIntent: eng, raw: rawUserMessage(turn) };
  }
  if (c.forbidCalendarRead && eng === "calendar.read") {
    return { pass: false, cat: "calendar_vs_task_confusion", auditIntent: eng, raw: rawUserMessage(turn) };
  }
  if (c.forbidCalendarRead && /\bkdy\s+(?:jsem|sem)\s+m(?:el|ela|eli)\b/.test(folded)) {
    const taskLike =
      /\b(koupit|zavolat|zaplatit|udelat|poslat|vyzvednout|pripomenout|napsat|odeslat)\b/.test(folded);
    if (taskLike && eng === "calendar.read") {
      return { pass: false, cat: "calendar_vs_task_confusion", auditIntent: eng, raw: rawUserMessage(turn) };
    }
  }
  if (hasNegWrite(folded) && isWriteTurn(turn)) {
    return { pass: false, cat: "write_when_negated", auditIntent: eng, raw: rawUserMessage(turn) };
  }
  if (c.expectedIntent) {
    const ok = eng === "calendar.read" || eng === "calendar.query";
    if (!ok) return { pass: false, cat: "intent_fail", auditIntent: eng, raw: rawUserMessage(turn) };
  }
  return { pass: true, cat: "", auditIntent: eng, raw: rawUserMessage(turn) };
}

function mainCommit() {
  try {
    return execSync("git rev-parse HEAD", { cwd: REPO, encoding: "utf8" }).trim();
  } catch {
    return "UNKNOWN";
  }
}

function runTurn(eng, c) {
  try {
    if (eng.iuSilverConversationReset) eng.iuSilverConversationReset();
  } catch {}
  const empty = eng.createEmptyDraft();
  return eng.processUserTurn(c.input, empty, ctx());
}

function main() {
  let eng;
  try {
    eng = loadEngine();
  } catch (e) {
    console.log(String(e && e.message));
    process.exit(1);
  }
  const cases = buildCases();
  const results = [];
  const buckets = {
    true_engine_fail: 0,
    harness_issue: 0,
    ambiguity: 0,
    ranking_weakness: 0,
    retrieval_weakness: 0,
    summary_weakness: 0,
    safe_clarification: 0,
    safety_risk: 0
  };

  let posPass = 0;
  let posTotal = 0;
  let negPass = 0;
  let negTotal = 0;

  for (let i = 0; i < cases.length; i++) {
    const c = cases[i];
    const turn = runTurn(eng, c);
    let ev;
    if (c.polarity === "positive") {
      posTotal++;
      ev = evaluateOne(c, turn);
      ev = evaluatePositive(c, turn, ev);
      if (ev.pass) posPass++;
    } else {
      negTotal++;
      ev = evaluateNegative(c, turn);
      if (ev.pass) negPass++;
    }
    const bucket = classifyBucket(c, turn, ev);
    if (bucket !== "pass") buckets[bucket] = (buckets[bucket] || 0) + 1;
    results.push({
      id: c.id,
      polarity: c.polarity,
      input: c.input,
      status: ev.pass ? "PASS" : "FAIL",
      cat: ev.cat || "",
      normalizedIntent: turn.normalizedIntent,
      processingState: turn.processingState,
      bucket: bucket === "pass" ? "" : bucket
    });
  }

  const trueEngine = buckets.true_engine_fail || 0;
  const safetyRisk = buckets.safety_risk || 0;
  let dominant = "none";
  let maxN = 0;
  const keys = Object.keys(buckets);
  for (let k = 0; k < keys.length; k++) {
    const key = keys[k];
    if (buckets[key] > maxN) {
      maxN = buckets[key];
      dominant = key;
    }
  }
  const readyForFix = trueEngine > 0 && safetyRisk === 0 && dominant === "true_engine_fail";
  const recommendedFixScope = readyForFix
    ? "assets/app.js — narrow colloquial read-vs-write cue patches (lead strip vole/hele/mrkni + entity banka/klient/kuryr/servis + note-like guards)"
    : safetyRisk > 0
      ? "STOP — isolate safety before engine change"
      : "harness_or_ambiguity_only — no engine change";

  const report = {
    harness_id: HARNESS_ID,
    cluster: TARGET_CLUSTER,
    main_commit: mainCommit(),
    total_cases: cases.length,
    positive_total: posTotal,
    positive_pass: posPass,
    negative_total: negTotal,
    negative_pass: negPass,
    true_engine_fail_count: trueEngine,
    harness_issue_count: buckets.harness_issue || 0,
    ambiguity_count: buckets.ambiguity || 0,
    ranking_weakness_count: buckets.ranking_weakness || 0,
    retrieval_weakness_count: buckets.retrieval_weakness || 0,
    summary_weakness_count: buckets.summary_weakness || 0,
    safe_clarification_count: buckets.safe_clarification || 0,
    safety_risk_count: safetyRisk,
    dominant_root_cause: dominant,
    ready_for_engine_fix: readyForFix,
    recommended_fix_scope: recommendedFixScope,
    results
  };

  fs.writeFileSync(REPORT_JSON, JSON.stringify(report, null, 2) + "\n", "utf8");

  console.log("=== SILVER_GENERAL_INTENT_MISMATCH_DIAGNOSTIC ===");
  console.log("cluster=" + TARGET_CLUSTER);
  console.log("main_commit=" + report.main_commit);
  console.log("total_cases=" + report.total_cases);
  console.log("positive_total=" + report.positive_total);
  console.log("positive_pass=" + report.positive_pass);
  console.log("negative_total=" + report.negative_total);
  console.log("negative_pass=" + report.negative_pass);
  console.log("true_engine_fail_count=" + report.true_engine_fail_count);
  console.log("ambiguity_count=" + report.ambiguity_count);
  console.log("ranking_weakness_count=" + report.ranking_weakness_count);
  console.log("retrieval_weakness_count=" + report.retrieval_weakness_count);
  console.log("summary_weakness_count=" + report.summary_weakness_count);
  console.log("harness_issue_count=" + report.harness_issue_count);
  console.log("safe_clarification_count=" + report.safe_clarification_count);
  console.log("safety_risk_count=" + report.safety_risk_count);
  console.log("dominant_root_cause=" + report.dominant_root_cause);
  console.log("ready_for_engine_fix=" + report.ready_for_engine_fix);
  console.log("recommended_fix_scope=" + report.recommended_fix_scope);
  console.log("=== END_SILVER_GENERAL_INTENT_MISMATCH_DIAGNOSTIC ===");
}

main();
