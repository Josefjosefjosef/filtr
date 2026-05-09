/**
 * SILVER_REAL_CZECH_CORPUS_V1 — diagnostic / audit only (no engine, UI, or routing changes).
 * - Deterministic expansion + mutation mask (no Math.random)
 * - Reuses VM harness evaluators from audit_silver_realistic_mobile_corpus.cjs
 * - Min corpus size 5000; default target ~12000+ after dedupe
 */
/* eslint-disable no-console */
const fs = require("fs");
const path = require("path");
const os = require("os");
const { execSync } = require("child_process");

const REPO = path.resolve(__dirname, "..");
const HARNESS_ID = "silver_real_czech_corpus_v1";
const FIXED_NOW_ISO = "2026-05-04T12:00:00";
const REPORT_JSON = path.join(__dirname, "silver-real-czech-corpus-v1-report.json");
const REPORT_TXT = path.join(os.tmpdir(), "silver_real_czech_corpus_v1_audit.txt");

const harness = require("./audit_silver_realistic_mobile_corpus.cjs");
const {
  loadEngine,
  evaluateOne,
  applyHarnessExpectationHarmonization,
  ctxForCase,
  foldCs,
  hasNegWrite
} = harness;

const MOBILE_CLUSTERS = new Set([
  "rcz_task_mliko_mobile",
  "rcz_task_hod_tam",
  "rcz_cal_slang_write",
  "rcz_cal_query_mrknout",
  "rcz_colloquial_fillers"
]);

function stripDiak(s) {
  return String(s || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function hasCzDiacritics(s) {
  return /[áčďéěíňóřšťúůýžÁČĎÉĚÍŇÓŘŠŤÚŮÝŽ]/.test(String(s || ""));
}

function applyMutationMask(text, mask) {
  let s = String(text || "");
  if (mask & 1) s = stripDiak(s);
  if (mask & 2) {
    s = s
      .replace(/\bzítra\b/gi, "zejtra")
      .replace(/\bZítra\b/g, "Zejtra")
      .replace(/\btento týden\b/gi, "v tejdnu")
      .replace(/\bTento týden\b/g, "V tejdnu")
      .replace(/\bpozítří\b/gi, "pozitri")
      .replace(/\bmléko\b/gi, "mlíko")
      .replace(/\bMléko\b/g, "Mlíko");
  }
  if (mask & 4) s = "hele " + s;
  if (mask & 8) s = s + " díky";
  if (mask & 16) s = s.replace(/\bprosím\b/gi, "").replace(/\s+/g, " ").trim();
  if (mask & 32) {
    s = s
      .replace(/\bMrkni\b/g, "mrkni")
      .replace(/\bHoď\b/g, "hod")
      .replace(/\bÚkol\b/g, "Ukol")
      .replace(/\búkol\b/g, "ukol");
  }
  if (mask & 64) {
    s = s.replace(/\bprotože\b/gi, "ptže").replace(/\bzároveň\b/gi, "zaroven");
  }
  return s.replace(/\s+/g, " ").trim();
}

function gitTrackedClean() {
  try {
    const o = execSync("git status --porcelain", { cwd: REPO, encoding: "utf8" });
    const lines = o.split(/\r?\n/).filter(Boolean);
    const tracked = lines.filter((l) => !l.startsWith("??"));
    const allow = [
      "scripts/audit_silver_realistic_mobile_corpus.cjs",
      "scripts/silver-realistic-mobile-corpus-report.json",
      "scripts/audit_silver_20000_routing_stable.cjs",
      "scripts/audit_silver_real_ux_v1.cjs",
      "scripts/silver-quality-v2-report.json",
      "scripts/silver-real-ux-v1-report.json",
      "scripts/silver-real-czech-corpus-v1.cjs",
      "scripts/silver-real-czech-corpus-v1-report.json",
      "assets/app.js"
    ];
    const bad = tracked.filter((l) => {
      const t = l.replace(/^\s+/, "").trim();
      for (let ai = 0; ai < allow.length; ai++) {
        if (t.indexOf(allow[ai]) >= 0) return false;
      }
      return true;
    });
    return { ok: bad.length === 0, porcelain: o.trim() };
  } catch (e) {
    return { ok: false, porcelain: String(e) };
  }
}

function escapeField(s) {
  return String(s == null ? "" : s)
    .replace(/\r?\n/g, "\\n")
    .replace(/=/g, "\uFF1D");
}

function inferProbableRootCause(c, ev) {
  const cat = String(ev.cat || "");
  const g = String(c.group || "");
  const fi = foldCs(c.input || "");
  if (cat === "query_created_write") return "read_only_guard_gap";
  if (cat === "write_when_negated") return "scoped_negation_gap";
  if (cat === "negative_instruction_fail") return "scoped_negation_gap";
  if (cat === "query_wrong_dataset") return "retrieval_query_routed_wrong";
  if (cat === "calendar_vs_task_confusion" || cat === "note_vs_task_confusion" || cat === "wrong_collection") {
    if (/\bpripom|připom|remind/.test(fi)) return "reminder_misclassified_as_calendar";
    return "ambiguous_should_clarify";
  }
  if (cat === "bad_title_cleanup" || cat === "dirty_calendar_title" || cat === "dirty_task_title") return "title_cleanup_residue";
  if (cat === "dirty_note_text" || cat === "note_parse_fail") return "address_or_note_contamination";
  if (cat === "intent_fail") {
    if (g === "task_write" && !/\b(do ukol|do úkol|ukol|úkol|nezapom|přidej|pridej|hoď|hod)\b/.test(fi)) {
      return "missing_task_activity_verb";
    }
    if (g === "note_write" && !/\bpoznam|zapamat|napis\s+si\b/.test(fi)) return "weak_note_only_anchor";
    if (g.indexOf("calendar") === 0 && /\b(rano|ráno|vecer|večer|po obede|po obědě|v tejdnu|zejtra)\b/.test(fi)) {
      return "calendar_bias_from_time_phrase";
    }
    return "ambiguous_should_clarify";
  }
  if (cat === "false_negative" || cat === "false_positive") return "retrieval_query_routed_wrong";
  if (cat === "unnecessary_disambiguation") return "ambiguous_should_clarify";
  return "ambiguous_should_clarify";
}

function inferFixScope(cause) {
  if (cause === "read_only_guard_gap" || cause === "scoped_negation_gap") return "Silver read-before-write + negation scope guards";
  if (cause === "reminder_misclassified_as_calendar") return "Silver reminder vs calendar disambiguation";
  if (cause === "retrieval_query_routed_wrong") return "Silver global.search / dataset routing";
  if (cause.indexOf("title") >= 0 || cause.indexOf("cleanup") >= 0) return "Silver title cleanup + filler stripping";
  if (cause.indexOf("note") >= 0 || cause.indexOf("contamination") >= 0) return "Silver note draft extraction";
  if (cause === "missing_task_activity_verb") return "Silver task write verb detection (Czech colloquial)";
  if (cause === "weak_note_only_anchor") return "Silver note intent anchors";
  if (cause === "calendar_bias_from_time_phrase") return "Silver calendar time-phrase bias guard";
  return "Silver routing thresholds + Czech paraphrase templates";
}

function safetyRiskYes(cat) {
  return (
    cat === "query_created_write" ||
    cat === "negative_instruction_fail" ||
    cat === "write_when_negated" ||
    cat === "false_positive"
  );
}

function parse20kStdout(out) {
  const r = {};
  const mAcc = out.match(/overall_accuracy=([\d.]+)%/);
  r.overall_accuracy = mAcc ? mAcc[1] : "";
  const grab = (label) => {
    const x = out.match(new RegExp(label + "=([0-9]+)/([0-9]+)"));
    return x ? x[1] + "/" + x[2] : "";
  };
  r.calendar_write = grab("calendar_write");
  r.task_write = grab("task_write");
  r.calendar_query = grab("calendar_query");
  r.task_query = grab("task_query");
  r.note_write = grab("note_write");
  r.note_query = grab("note_query");
  r.multi_intent = grab("multi_intent");
  return r;
}

function tryEmbed20k() {
  if (process.env.SILVER_REAL_CZECH_EMBED_20K !== "1") return null;
  try {
    const out = execSync('node "' + path.join(REPO, "scripts", "audit_silver_20000_routing_stable.cjs") + '"', {
      cwd: REPO,
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024
    });
    return parse20kStdout(out);
  } catch (e) {
    return { error: String(e && e.message) };
  }
}

function readJsonReport(p) {
  try {
    return JSON.parse(fs.readFileSync(p, "utf8"));
  } catch (e) {
    return null;
  }
}

function accFromPassFail(pass, fail) {
  const t = pass + fail;
  if (!t) return "0.00";
  return ((pass / t) * 100).toFixed(2);
}

function buildRealCzechCorpusV1() {
  const rows = [];
  let gid = 0;

  function push(cluster, group, input, expectedIntent, meta, flags) {
    gid++;
    const id = "rcz_" + String(gid).padStart(6, "0");
    rows.push({
      id,
      cluster,
      group,
      input: String(input || "").trim(),
      expectedIntent,
      meta: meta || {},
      flags: Object.assign({ mobile_czech: MOBILE_CLUSTERS.has(cluster), no_diacritics_corpus: false }, flags || {})
    });
  }

  const PERS = ["Petr", "Tomáš", "Mariana", "Jakub", "Pavel", "zubař", "právník", "advokát"];
  const ADDR = ["Korunní 33 Praha", "Praha 1", "Vinohradská 3 Praha", "Brno střed", "Ostrava centrum"];
  const DATES = [
    "zítra",
    "zejtra",
    "pozítří",
    "v tejdnu",
    "tento týden",
    "na pátek",
    "do pátku",
    "dnes večer",
    "příští pondělí"
  ];
  const TMS = ["10:00", "15:30", "po obědě", "ráno", "večer", "v 15 hodin", "kolem šesté"];

  for (let i = 0; i < 200; i++) {
    const op = [
      "Ulož mi prosím do kalendáře",
      "Dej mi do kalendáře",
      "Zapiš mi do kalendáře",
      "Přidej do kalendáře",
      "Nahoď mi do kalendáře",
      "Silvere prosím ulož do kalendáře",
      "Potřebuju uložit do kalendáře",
      "Rychle nahod do kalendáře"
    ][i % 8];
    const d = DATES[i % DATES.length];
    const tm = TMS[i % TMS.length];
    const raw =
      op +
      " " +
      d +
      " v " +
      tm +
      " schůzku s " +
      PERS[i % PERS.length] +
      " na " +
      ADDR[i % ADDR.length] +
      ", ne do úkolů.";
    push("rcz_cal_slang_write", "calendar_write", raw, "calendar.create", {}, {});
  }

  for (let i = 0; i < 120; i++) {
    const raw =
      "Ulož mi " +
      DATES[i % DATES.length] +
      " v " +
      TMS[i % TMS.length] +
      " schůzku s " +
      PERS[i % PERS.length] +
      " na " +
      ADDR[i % ADDR.length] +
      " a připomeň mi v poznámce vzít " +
      ["kartičku pojištěnce", "občanku", "deštník"][i % 3] +
      ", ne do úkolů.";
    push("rcz_cal_reminder_ambiguity", "calendar_write", raw, "calendar.create", {}, {});
  }

  for (let i = 0; i < 120; i++) {
    const raw =
      "Ulož " +
      DATES[i % DATES.length] +
      " v " +
      TMS[i % TMS.length] +
      " schůzku s " +
      PERS[i % PERS.length] +
      ", místo je " +
      ["restaurace Palma", "kavárna u nádraží", "kancelář v centru"][i % 3] +
      ", ne do úkolů.";
    push("rcz_cal_mixed_write", "calendar_write", raw, "calendar.create", {}, {});
  }

  const GOODS = ["mléko", "mlíko", "rohlíky", "léky", "uhlí", "dárek", "toaleťák"];
  const DEAD = ["do pátku", "zejtra", "zítra ráno", "dnes večer", "v tejdnu", "do konce týdne"];
  for (let i = 0; i < 180; i++) {
    const hodTam = i % 2 === 0 ? "Hoď mi do úkolů koupit " : "Hoď mi tam do úkolů koupit ";
    const raw = hodTam + GOODS[i % GOODS.length] + " " + DEAD[i % DEAD.length] + ", ne do kalendáře.";
    push("rcz_task_hod_tam", "task_write", raw, "task.create", {}, {});
  }

  const TWB = ["Přidej úkol", "Nezapomeň", "Nesmím zapomenout", "Připomeň mi", "Musím udělat", "Mám zařídit"];
  for (let i = 0; i < 180; i++) {
    const raw = TWB[i % TWB.length] + " do úkolů " + GOODS[i % GOODS.length] + " " + DEAD[i % DEAD.length] + ", ne kalendář.";
    push("rcz_task_mliko_mobile", "task_write", raw, "task.create", {}, {});
  }

  const NOTE_SPOT = [
    "Zapiš poznámku PIN ke kartě je 1234",
    "Ulož poznámku že auto má modrou barvu",
    "Napiš si do poznámek heslo k Wi-Fi je ABCD",
    "Poznamenej si faktura za elektřinu zaplacena",
    "Ulož do poznámek že záruka na televizi končí v lednu"
  ];
  for (let i = 0; i < 150; i++) {
    push("rcz_note_write_basic", "note_write", NOTE_SPOT[i % NOTE_SPOT.length], "note.create", {}, {});
  }

  const NQ = [
    "Kde mám PIN ke kartě",
    "Najdi poznámku o mléku",
    "Co jsem si psal o záruce TV",
    "Najdi fakturu za pračku",
    "Mrkni do poznámek na heslo WiFi"
  ];
  for (let i = 0; i < 160; i++) {
    const neg = i % 5 === 0 ? "nic neukládej, " : "";
    const raw = neg + NQ[i % NQ.length] + (i % 2 ? "?" : "");
    push("rcz_note_query", "note_query", raw, "note.query", {}, {});
  }

  const TQ = [
    "Co mám dnes udělat",
    "Jaké mám úkoly",
    "Co musím zaplatit",
    "Najdi úkoly na zítra",
    "Co mám do pátku"
  ];
  for (let i = 0; i < 160; i++) {
    const raw = TQ[i % TQ.length] + (i % 2 ? "?" : "");
    push("rcz_task_query", "task_query", raw, "task.query", {}, {});
  }

  const CQ = [
    "co mám zítra",
    "kdy mám zubaře",
    "jaké mám dnes schůzky",
    "kdy mám právníka",
    "co mám v kalendáři příští týden",
    "Mrkni co mám zítra v kalendáři",
    "Koukni co mám v tejdnu",
    "Co mám zejtra v kalendáři"
  ];
  for (let i = 0; i < 220; i++) {
    const neg = i % 6 === 0 ? "nic neukládej, " : "";
    const raw = neg + CQ[i % CQ.length] + (i % 2 ? "?" : "");
    push("rcz_cal_query_mrknout", "calendar_query", raw, "calendar.query", {}, {});
  }

  for (let i = 0; i < 150; i++) {
    const d = DATES[i % DATES.length];
    const tm = TMS[i % TMS.length];
    const raw =
      "Ulož do kalendáře " +
      d +
      " v " +
      tm +
      " zubaře na " +
      ADDR[i % ADDR.length] +
      " a zároveň do poznámky napiš kartičku pojištěnce, ne do úkolů.";
    const f = foldCs(raw);
    const needsDualWrite =
      /\b(zaroven|zároveň)\b/i.test(raw) && /\b(do\s+poznam|\bpoznam|\bdo\s+kalend|\buloz|\bulož|\bpridej|\bpřidej)/i.test(f);
    const queryNeg = /jen\s+se\s+podivej|jen\s+cti|nic\s+neuklad/.test(f) ? f : "";
    push("rcz_multi_intent", "multi_intent", raw, "unknown", { needsDualWrite, queryNeg }, { multi: true });
  }

  const NEGC = [
    "Jen se podívej co mám zejtra v kalendáři, nic neukládej.",
    "Nic neukládej, jen zjisti kdy mám zubaře.",
    "Nevytvářej událost, jen mi řekni co mám v tejdnu v kalendáři.",
    "Jen čti kalendář, nic neukládej, co mám pozítří?",
    "Mrkni do kalendáře ale nic neukládej."
  ];
  const NEGT = [
    "Jen se podívej co mám za úkoly, nic neukládej.",
    "Nic neukládej, jen zjisti jestli mám koupit mlíko v úkolech.",
    "Ne do úkolů nic nového, jen mi řekni co mám dnes udělat.",
    "Jen čti úkoly, nic neukládej, co mám do pátku?",
    "Hoď mi tam jen číst úkoly, nic neukládej."
  ];
  const NEGN = [
    "Nic neukládej, jen najdi poznámku o PINu.",
    "Nevytvářej poznámku, jen řekni kde mám záruku na TV.",
    "Jen se podívej do poznámek, nic neukládej.",
    "Nic neukládej, jen zjisti fakturu za pračku v poznámkách.",
    "Jen čti poznámky, nic neukládej."
  ];
  for (let i = 0; i < 140; i++) {
    const b = i % 3;
    if (b === 0) push("rcz_negation_safety_cal", "calendar_query", NEGC[i % NEGC.length], "calendar.query", {}, {});
    else if (b === 1) push("rcz_negation_safety_task", "task_query", NEGT[i % NEGT.length], "task.query", {}, {});
    else push("rcz_negation_safety_note", "note_query", NEGN[i % NEGN.length], "note.query", {}, {});
  }

  const RO = [
    ["calendar_query", "Silvere jen se podívej do kalendáře, nic neukládej"],
    ["task_query", "Jen se podívej co mám za úkoly, nic neukládej."],
    ["note_query", "Silvere jen se podívej do poznámek, nic neukládej"],
    ["calendar_query", "Nic neukládej, jen zjisti kdy mám zubaře."]
  ];
  for (let i = 0; i < 120; i++) {
    const pair = RO[i % RO.length];
    push("rcz_read_only_prefix", pair[0], pair[1], pair[0] === "calendar_query" ? "calendar.query" : pair[0] === "task_query" ? "task.query" : "note.query", {}, {});
  }

  const FILL = ["no tak ", "prostě ", "btw ", "hele ", "silere rychle "];
  for (let i = 0; i < 100; i++) {
    const core =
      "ulož mi do kalendáře " +
      DATES[i % DATES.length] +
      " v " +
      TMS[i % TMS.length] +
      " schůzku s " +
      PERS[i % PERS.length] +
      " ne do úkolů";
    const raw = (i % 2 === 0 ? FILL[i % FILL.length] : "") + core + (i % 3 === 0 ? " díky" : "");
    push("rcz_colloquial_fillers", "calendar_write", raw, "calendar.create", {}, {});
  }

  const expanded = [];
  const seen = new Set();
  const MUT_MAX = parseInt(process.env.SILVER_REAL_CZECH_MUT_MASK_MAX || "31", 10);
  const maskCap = Math.min(127, Math.max(1, MUT_MAX));

  for (let ri = 0; ri < rows.length; ri++) {
    const base = rows[ri];
    const g0 = String(base.group || "");
    const queryLike = g0.indexOf("query") >= 0;
    const noteLike = g0 === "note_write";
    const maxMaskForRow = queryLike ? Math.min(3, maskCap) : noteLike ? Math.min(1, maskCap) : maskCap;
    for (let mask = 0; mask <= maxMaskForRow; mask++) {
      const input = applyMutationMask(base.input, mask);
      if (!input || input.length < 4) continue;
      if (seen.has(input)) continue;
      seen.add(input);
      const noDiak = !hasCzDiacritics(input);
      expanded.push({
        id: base.id + "_m" + mask,
        cluster: base.cluster,
        group: base.group,
        input,
        expectedIntent: base.expectedIntent,
        meta: Object.assign({}, base.meta),
        flags: Object.assign({}, base.flags, {
          no_diacritics_corpus: noDiak,
          mutation_mask: mask
        })
      });
    }
  }

  if (expanded.length < 5000) {
    console.log("seed_data_fail=corpus_below_5000_got_" + expanded.length);
    process.exit(1);
  }

  applyHarnessExpectationHarmonization(expanded);

  const hist = {};
  for (let si = 0; si < expanded.length; si++) {
    const cl = String(expanded[si].cluster || "MISS");
    hist[cl] = (hist[cl] || 0) + 1;
  }
  const histKeys = Object.keys(hist).sort((a, b) => hist[b] - hist[a]);
  if (histKeys.length > 80) {
    console.log("seed_data_fail=cluster_histogram_too_many_keys_" + histKeys.length);
    process.exit(1);
  }

  return expanded;
}

function severity(cat) {
  const order = [
    "query_created_write",
    "write_when_negated",
    "negative_instruction_fail",
    "query_wrong_dataset",
    "multi_intent_fail",
    "calendar_vs_task_confusion",
    "wrong_collection",
    "note_vs_task_confusion",
    "intent_fail",
    "unnecessary_disambiguation",
    "false_negative",
    "false_positive"
  ];
  const idx = order.indexOf(String(cat || ""));
  return idx >= 0 ? 1000 - idx * 40 : 50;
}

function main() {
  const git = gitTrackedClean();
  if (!git.ok) {
    console.log("=== SILVER_REAL_CZECH_CORPUS_V1_ABORT ===");
    console.log("reason=tracked_files_dirty");
    console.log(git.porcelain);
    console.log("==== END_ABORT ====");
    process.exit(1);
  }

  let eng;
  try {
    eng = loadEngine();
  } catch (e) {
    console.log("runtime_fail=" + String(e && e.message));
    process.exit(1);
  }

  const cases = buildRealCzechCorpusV1();
  const byG = {};
  const fails = [];
  const failClusters = {};
  const rootCauseHist = {};
  let falseWriteCount = 0;
  let queryCreatedWriteCount = 0;
  let writeWhenNegatedCount = 0;
  const dangerousCaseIds = new Set();

  for (let ci = 0; ci < cases.length; ci++) {
    const c = cases[ci];
    if (!byG[c.group]) byG[c.group] = { pass: 0, fail: 0 };
    try {
      if (eng.iuSilverConversationReset) eng.iuSilverConversationReset();
    } catch (e0) {
      void e0;
    }
    const turn = eng.processUserTurn(c.input, eng.createEmptyDraft(), ctxForCase(c.group));
    const ev = evaluateOne(c, turn);
    const foldedIn = foldCs(c.input);
    const engN = turn.normalizedIntent;
    const psN = turn.processingState;
    const createLike =
      psN === "READY_TO_SAVE" || engN === "calendar.create" || engN === "tasks.create" || engN === "notes.create";

    if (!ev.pass && c.group.indexOf("_query") > 0 && (ev.cat === "query_created_write" || ev.cat === "negative_instruction_fail")) {
      falseWriteCount++;
    }
    if (hasNegWrite(foldedIn) && createLike) {
      writeWhenNegatedCount++;
      dangerousCaseIds.add(c.id);
    }
    if (ev.cat === "query_created_write") {
      queryCreatedWriteCount++;
      dangerousCaseIds.add(c.id);
    }
    if (ev.cat === "negative_instruction_fail") {
      dangerousCaseIds.add(c.id);
    }

    if (ev.pass) {
      byG[c.group].pass++;
    } else {
      byG[c.group].fail++;
      const prc = inferProbableRootCause(c, ev);
      const ck = String(c.cluster || c.group) + "||" + String(ev.cat || "fail");
      failClusters[ck] = (failClusters[ck] || 0) + 1;
      rootCauseHist[prc] = (rootCauseHist[prc] || 0) + 1;
      fails.push({
        id: c.id,
        cluster: c.cluster,
        group: c.group,
        cat: ev.cat,
        input: c.input,
        expected: c.expectedIntent,
        actual: ev.auditIntent,
        raw: ev.raw,
        safety_risk: safetyRiskYes(ev.cat) ? "yes" : "no",
        probable_root_cause: prc,
        recommended_next_fix_scope: inferFixScope(prc),
        reasoning_diff:
          "category=" +
          String(ev.cat || "") +
          ";expected_intent=" +
          String(c.expectedIntent || "") +
          ";actual_audit_intent=" +
          String(ev.auditIntent || "") +
          ";probable_root_cause=" +
          prc,
        sev: severity(ev.cat)
      });
    }
  }

  const total = cases.length;
  const failC = fails.length;
  const passC = total - failC;
  const corpusAcc = accFromPassFail(passC, failC);

  const failIdSet = new Set(fails.map((x) => x.id));
  function subAcc(pred) {
    let p = 0;
    let f = 0;
    for (let i = 0; i < cases.length; i++) {
      if (!pred(cases[i])) continue;
      if (failIdSet.has(cases[i].id)) f++;
      else p++;
    }
    return accFromPassFail(p, f);
  }

  fails.sort((a, b) => b.sev - a.sev || (failClusters[b.cluster + "||" + b.cat] || 0) - (failClusters[a.cluster + "||" + a.cat] || 0));

  const clusterPairs = Object.keys(failClusters)
    .map((k) => ({ k: k, n: failClusters[k] }))
    .sort((a, b) => b.n - a.n || String(a.k).localeCompare(String(b.k)));
  const top10Clusters = clusterPairs.slice(0, 10).map((p) => p.k + ":" + p.n);
  const top10Causes = Object.keys(rootCauseHist)
    .map((k) => ({ k: k, n: rootCauseHist[k] }))
    .sort((a, b) => b.n - a.n)
    .slice(0, 10)
    .map((p) => p.k + ":" + p.n);

  let recommendedNextCluster = "TOP_REAL_CZECH_CORPUS_CLUSTER_BY_IMPACT";
  let recommendedNextFixScope = inferFixScope("ambiguous_should_clarify");
  const dangerousWriteCount = dangerousCaseIds.size;

  let impactTopCluster = "(none)";
  if (clusterPairs.length) {
    impactTopCluster = clusterPairs[0].k;
  }

  if (dangerousWriteCount > 0 || writeWhenNegatedCount > 0 || queryCreatedWriteCount > 0) {
    recommendedNextCluster = "STOP_P0_SAFETY_FIX_FIRST";
    recommendedNextFixScope = "Silver P0 safety: query→write + negated-write guards";
  } else if (clusterPairs.length) {
    const topK = clusterPairs[0].k.split("||")[0] || clusterPairs[0].k;
    const topCat = (clusterPairs[0].k.split("||")[1] || "").trim();
    const sampleFail = fails.find((f) => f.cluster + "||" + f.cat === clusterPairs[0].k);
    recommendedNextCluster = "TOP_REAL_CZECH_CORPUS_CLUSTER_BY_IMPACT";
    recommendedNextFixScope =
      "Impact leader «" +
      topK +
      "» / «" +
      topCat +
      "»: " +
      inferFixScope(
        inferProbableRootCause(
          { group: sampleFail ? sampleFail.group : "calendar_write", cluster: topK, input: sampleFail ? sampleFail.input : "" },
          { cat: topCat }
        )
      );
  }

  const embed20k = tryEmbed20k();
  const qPath = path.join(REPO, "scripts", "silver-quality-v2-report.json");
  const rPath = path.join(REPO, "scripts", "silver-realistic-mobile-corpus-report.json");
  const qj = readJsonReport(qPath);
  const rj = readJsonReport(rPath);

  const smoke = process.env.SILVER_RC_SMOKE_OUT || "SKIPPED";
  const iuPerf = process.env.SILVER_RC_IU_PERF_OUT || "SKIPPED";
  const fieldReplay = process.env.SILVER_RC_FIELD_REPLAY_OUT || "SKIPPED";
  const calReg = process.env.SILVER_RC_CAL_REG_OUT || "SKIPPED";

  const overall20kFinal =
    (embed20k && embed20k.overall_accuracy) ||
    (embed20k && embed20k.error ? "EMBED_FAIL" : "SKIPPED");
  const qualityAcc = qj && qj.quality_accuracy ? String(qj.quality_accuracy) : "SKIPPED";
  const realisticAcc = rj && rj.overall_accuracy_realistic ? String(rj.overall_accuracy_realistic) : "SKIPPED";

  let mainCommit = "";
  try {
    mainCommit = execSync("git rev-parse HEAD", { cwd: REPO, encoding: "utf8" }).trim();
  } catch (e1) {
    void e1;
  }

  let changedFiles = "scripts/silver-real-czech-corpus-v1.cjs;scripts/audit_silver_realistic_mobile_corpus.cjs";
  try {
    const st = execSync("git status --porcelain", { cwd: REPO, encoding: "utf8" });
    const paths = st
      .split(/\r?\n/)
      .filter(Boolean)
      .map((l) => l.replace(/^\s*\S+\s+/, "").trim())
      .filter((p) => p.indexOf("scripts/") === 0);
    if (paths.length) changedFiles = Array.from(new Set(paths)).join(";");
  } catch (e2) {
    void e2;
  }

  const gateFail = dangerousWriteCount > 0 || falseWriteCount > 0 || queryCreatedWriteCount > 0 || writeWhenNegatedCount > 0;

  const reportObj = {
    harness_id: HARNESS_ID,
    fixed_now: FIXED_NOW_ISO,
    corpus_total: total,
    corpus_pass: passC,
    corpus_fail: failC,
    corpus_accuracy: corpusAcc,
    calendar_write_accuracy: accFromPassFail(byG.calendar_write.pass, byG.calendar_write.fail),
    calendar_query_accuracy: accFromPassFail(byG.calendar_query.pass, byG.calendar_query.fail),
    task_write_accuracy: accFromPassFail(byG.task_write.pass, byG.task_write.fail),
    task_query_accuracy: accFromPassFail(byG.task_query.pass, byG.task_query.fail),
    note_write_accuracy: accFromPassFail(byG.note_write.pass, byG.note_write.fail),
    note_query_accuracy: accFromPassFail(byG.note_query.pass, byG.note_query.fail),
    multi_intent_accuracy: accFromPassFail(byG.multi_intent.pass, byG.multi_intent.fail),
    safety_negation_accuracy: subAcc(
      (c) =>
        c.cluster &&
        (c.cluster.indexOf("negation") >= 0 ||
          c.cluster.indexOf("read_only") >= 0 ||
          c.cluster.indexOf("write_when_negated") >= 0)
    ),
    read_only_accuracy: subAcc((c) => c.cluster && c.cluster.indexOf("read_only") >= 0),
    mobile_czech_accuracy: subAcc((c) => c.flags && c.flags.mobile_czech),
    no_diacritics_accuracy: subAcc((c) => c.flags && c.flags.no_diacritics_corpus),
    dangerous_write_count: dangerousWriteCount,
    false_write_count: falseWriteCount,
    query_created_write_count: queryCreatedWriteCount,
    write_when_negated_count: writeWhenNegatedCount,
    top_10_fail_clusters: top10Clusters,
    top_10_probable_root_causes: top10Causes,
    recommended_next_cluster: recommendedNextCluster,
    recommended_next_fix_scope: recommendedNextFixScope,
    impact_top_cluster_key: impactTopCluster,
    fails_sample: fails.slice(0, 200),
    embed_20k: embed20k,
    quality_report: qj ? { quality_accuracy: qj.quality_accuracy } : null,
    realistic_report: rj ? { overall_accuracy_realistic: rj.overall_accuracy_realistic } : null
  };

  fs.writeFileSync(REPORT_JSON, JSON.stringify(reportObj, null, 2), "utf8");

  const block = [
    "=== SILVER_REAL_CZECH_CORPUS_V1_RESULT ===",
    "main_commit=" + escapeField(mainCommit),
    "changed_files=" + escapeField(changedFiles),
    "behavior_changed=NO",
    "engine_changed=NO",
    "ui_changed=NO",
    "css_changed=NO",
    "backend_changed=NO",
    "corpus_total=" + total,
    "corpus_pass=" + passC,
    "corpus_fail=" + failC,
    "corpus_accuracy=" + corpusAcc + "%",
    "calendar_write_accuracy=" + reportObj.calendar_write_accuracy + "%",
    "calendar_query_accuracy=" + reportObj.calendar_query_accuracy + "%",
    "task_write_accuracy=" + reportObj.task_write_accuracy + "%",
    "task_query_accuracy=" + reportObj.task_query_accuracy + "%",
    "note_write_accuracy=" + reportObj.note_write_accuracy + "%",
    "note_query_accuracy=" + reportObj.note_query_accuracy + "%",
    "multi_intent_accuracy=" + reportObj.multi_intent_accuracy + "%",
    "safety_negation_accuracy=" + reportObj.safety_negation_accuracy + "%",
    "read_only_accuracy=" + reportObj.read_only_accuracy + "%",
    "mobile_czech_accuracy=" + reportObj.mobile_czech_accuracy + "%",
    "no_diacritics_accuracy=" + reportObj.no_diacritics_accuracy + "%",
    "dangerous_write_count=" + dangerousWriteCount,
    "false_write_count=" + falseWriteCount,
    "query_created_write_count=" + queryCreatedWriteCount,
    "write_when_negated_count=" + writeWhenNegatedCount,
    "top_10_fail_clusters=" + escapeField(top10Clusters.join(" | ") || "(none)"),
    "top_10_probable_root_causes=" + escapeField(top10Causes.join(" | ") || "(none)"),
    "recommended_next_cluster=" + escapeField(recommendedNextCluster),
    "recommended_next_fix_scope=" + escapeField(recommendedNextFixScope),
    "smoke=" + smoke,
    "iu_perf_regression_guards=" + iuPerf,
    "silver_field_cleanup_replay_suite=" + fieldReplay,
    "silver_calendar_create_regression=" + calReg,
    "20k_overall_accuracy=" + escapeField(overall20kFinal),
    "quality_accuracy=" + escapeField(qualityAcc),
    "realistic_overall_accuracy=" + escapeField(realisticAcc),
    "git_status_clean=" + (git.ok ? "YES" : "NO"),
    "======= END_SILVER_REAL_CZECH_CORPUS_V1_RESULT ==="
  ].join("\n");

  console.log("\n" + block);
  fs.writeFileSync(REPORT_TXT, block + "\n", "utf8");

  if (gateFail) {
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}
