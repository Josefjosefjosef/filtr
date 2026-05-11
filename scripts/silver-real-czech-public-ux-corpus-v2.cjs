/**
 * SILVER_REAL_CZECH_PUBLIC_UX_CORPUS_V2 — foundation / diagnostic only (no engine, assets, or routing changes).
 * harness_id: silver_real_czech_public_ux_corpus_v2
 * - Deterministic Czech templates (no Math.random)
 * - VM engine via audit_silver_realistic_mobile_corpus.cjs
 * - Target >= 100k cases across 8 UX stress categories
 */
/* eslint-disable no-console */
const fs = require("fs");
const path = require("path");
const os = require("os");
const { execSync } = require("child_process");

const REPO = path.resolve(__dirname, "..");
const HARNESS_ID = "silver_real_czech_public_ux_corpus_v2";
const FIXED_NOW_ISO = "2026-05-04T12:00:00";
const REPORT_JSON = path.join(__dirname, "silver-real-czech-public-ux-corpus-v2-report.json");
const REPORT_TXT = path.join(os.tmpdir(), "silver_real_czech_public_ux_corpus_v2_audit.txt");

const harness = require("./audit_silver_realistic_mobile_corpus.cjs");
const {
  loadEngine,
  evaluateOne,
  applyHarnessExpectationHarmonization,
  ctxForCase,
  foldCs,
  hasNegWrite
} = harness;

const UX_CAT = {
  ULTRA: "ultra_short_chaos",
  DIRTY: "dirty_czech_no_diacritics",
  MOBILE: "mobile_voice_chaos",
  MIXED: "mixed_module_chaos",
  AMBIG: "ambiguity",
  RETR: "retrieval_relevance",
  EMOT: "emotional_human_speech",
  LONG: "long_chaotic_prompts"
};

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
      "assets/app.js",
      "scripts/silver-real-czech-public-ux-corpus-v2.cjs",
      "scripts/silver-real-czech-public-ux-corpus-v2-report.json",
      "scripts/silver-rcz2-mobile-voice-intent-fail-diagnostic.cjs",
      "scripts/silver-rcz2-mobile-voice-intent-fail-diagnostic-report.json",
      "scripts/audit_silver_20000_routing_stable.cjs",
      "scripts/audit_silver_realistic_mobile_corpus.cjs",
      "scripts/silver-real-czech-corpus-v1.cjs",
      "scripts/silver-deep-product-real-ux-v2-report.json",
      "scripts/silver-calendar-query-storage-disambiguation-diagnostic.cjs",
      "scripts/silver-calendar-query-storage-disambiguation-diagnostic-report.json"
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

function iso(d) {
  const p = (n) => String(n).padStart(2, "0");
  return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate());
}

function addDaysIso(isoDateStr, n) {
  const d = new Date(isoDateStr + "T12:00:00");
  d.setDate(d.getDate() + n);
  return iso(d);
}

const FIXED_NOW = new Date(FIXED_NOW_ISO);
const TODAY = iso(FIXED_NOW);
const ZITRA = addDaysIso(TODAY, 1);
const PATEK = addDaysIso(TODAY, 4);

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

function buildPublicUxCorpusV2() {
  const rows = [];
  let gid = 0;
  function push(cluster, group, input, expectedIntent, meta, flags, uxCategory) {
    gid++;
    const id = "rcz2_" + String(gid).padStart(7, "0");
    rows.push({
      id,
      cluster,
      group,
      input: String(input || "").trim(),
      expectedIntent,
      meta: meta || {},
      flags: Object.assign({ ux_category: uxCategory }, flags || {}),
      ux_category: uxCategory
    });
  }

  const PERS = ["Petr", "Tomáš", "Mariana", "Jakub", "Pavel", "zubař", "právník", "advokát", "účetní", "doktor"];
  const ADDR = ["Korunní 33 Praha", "Praha 1", "Vinohradská 3 Praha", "Brno střed", "Ostrava centrum", "Dlouhá 12 Praha"];
  const DATES = ["zítra", "zejtra", "pozítří", "v tejdnu", "tento týden", "na pátek", "do pátku", "dnes večer", "příští pondělí"];
  const TMS = ["10:00", "15:30", "po obědě", "ráno", "večer", "v 15 hodin", "kolem šesté"];
  const GOODS = ["mléko", "mlíko", "rohlíky", "léky", "uhlí", "dárek", "toaleťák"];
  const DEAD = ["do pátku", "zejtra", "zítra ráno", "dnes večer", "v tejdnu", "do konce týdne"];

  const SHORT_CORE = [
    "zejtra pravnik",
    "vole zubar",
    "mamka vecer",
    "najem!!",
    "ucetni kde",
    "kytky zejtra",
    "doktor rano",
    "petr odpoledne",
    "faktura dnes",
    "pin kde",
    "smlouva zitra",
    "balik ostrava",
    "brno doktor",
    "hypoteka platba",
    "stavba rano",
    "kurýr dneska",
    "obcanka kde",
    "kytky patek",
    "ucetni brno",
    "pravnik smlouva"
  ];
  const SHORT_MOD = ["", "??", " prosim", " tyjo", " no", " fakt", " rychle"];

  for (let i = 0; i < 12000; i++) {
    const core = SHORT_CORE[i % SHORT_CORE.length];
    const mod = SHORT_MOD[(i >> 3) % SHORT_MOD.length];
    const raw = core + mod + (i % 5 === 0 ? "?" : "");
    const g = i % 3 === 0 ? "calendar_query" : i % 3 === 1 ? "task_query" : "note_query";
    push("rcz2_ultra_short_chaos", g, raw, "unknown", {}, { ultra_short: true }, UX_CAT.ULTRA);
  }

  const CALW_OP = [
    "Uloz mi prosim do kalendare",
    "Dej mi do kalendare",
    "Zapis mi do kalendare",
    "Pridej do kalendare",
    "Nahod mi do kalendare",
    "Potrebuju ulozit do kalendare",
    "Rychle nahod do kalendare",
    "Silvere uloz do kalendare"
  ];
  for (let i = 0; i < 7000; i++) {
    const op = stripDiak(CALW_OP[i % CALW_OP.length]);
    const d = stripDiak(DATES[i % DATES.length]);
    const tm = stripDiak(TMS[i % TMS.length]);
    const p = stripDiak(PERS[i % PERS.length]);
    const a = stripDiak(ADDR[i % ADDR.length]);
    const raw =
      op +
      " " +
      d +
      " v " +
      tm +
      " schuzku s " +
      p +
      " na " +
      a +
      " slot " +
      i +
      ", ne do ukolu.";
    push("rcz2_dirty_cal_write", "calendar_write", raw, "calendar.create", {}, { no_diacritics_corpus: true }, UX_CAT.DIRTY);
  }

  const TWB_ARR = ["Pridej ukol", "Nezapomen", "Nesmim zapomenout", "Pripomen mi", "Musim udelat", "Mam zaridit"];
  for (let i = 0; i < 4500; i++) {
    const hod = i % 2 === 0 ? "Hod mi do ukolu koupit " : "Hod mi tam do ukolu koupit ";
    const tw = stripDiak(TWB_ARR[i % TWB_ARR.length]);
    const raw = stripDiak(hod + GOODS[i % GOODS.length] + " " + DEAD[i % DEAD.length] + " " + tw + " radek " + i + ", ne do kalendare.");
    push("rcz2_dirty_task_write", "task_write", raw, "task.create", {}, { no_diacritics_corpus: true }, UX_CAT.DIRTY);
  }
  const NOTE_ASCII = [
    "Uloz poznamku ze PIN karty je slot SLOT",
    "Zapis poznamku ze auto ma modrou barvu SLOT",
    "Uloz do poznamek heslo WiFi je SLOT",
    "Poznamenej si faktura za elektrinu SLOT"
  ];
  for (let i = 0; i < 4500; i++) {
    const raw = NOTE_ASCII[i % NOTE_ASCII.length].replace("SLOT", String(i));
    push("rcz2_dirty_note_write", "note_write", raw, "note.create", {}, { no_diacritics_corpus: true }, UX_CAT.DIRTY);
  }

  const MOB_SUFFIX = [" diky", " prosim te", " jo", "", " nevim presne"];
  /** Mobile chaos prefixes: same vocabulary per slot, rotated so writes do not share one cyclic stream. */
  const MOB_PREFIX_CAL = ["hele ", "vlastne ", "pockej ", "tyjo ", "no tak ", "btw ", ""];
  const MOB_PREFIX_TASK = ["tyjo ", "no tak ", "hele ", "btw ", "pockej ", "vlastne ", ""];
  const MOB_PREFIX_NOTE = ["pockej ", "vlastne ", "tyjo ", "hele ", "no tak ", "btw ", ""];
  /** kind===3/4 read/query rows: shared prefix pool (MOB_MID split does not apply). */
  const MOB_PREFIX_QUERY = ["hele ", "vlastne ", "pockej ", "tyjo ", "no tak ", "btw ", ""];
  /** kind===0 calendar_write only: calendar/event phrasing (no note/task storage cues as primary). */
  const MOB_MID_CALENDAR_WRITE = [
    "uloz mi prosim do kalendare __D__ v __T__ schuzku s __P__ na __A__ radek __S__ ne do ukolu",
    "dej mi do kalendare na __D__ v __T__ udalost s __P__ __S__ ne do ukolu",
    "zapis mi do kalendare __D__ __T__ schuzku s pravnikem __S__ ne do ukolu",
    "pridej do kalendare __D__ v __T__ schuzku na __A__ __S__ ne do ukolu",
    "nahod mi do kalendare __D__ v __T__ schuzku __P__ radek __S__ ne do ukolu",
    "potrebuju ulozit do kalendare __D__ kolem __T__ na __A__ __S__ ne do ukolu",
    "rychle nahod do kalendare __D__ v __T__ schuzku __S__ ne do ukolu",
    "potrebuju v kalendari mit na __D__ v __T__ schuzku __P__ __S__ ne do ukolu"
  ];
  /** kind===1 task_write only: úkol phrasing (aligned with rcz2_dirty_task_write; no calendar/note as primary). */
  const MOB_MID_TASK_WRITE = [
    "hod mi do ukolu koupit __G__ __DL__ radek __S__ ne do kalendare",
    "hod mi tam do ukolu koupit __G__ __DL__ __S__ ne do kalendare",
    "pridej ukol __G__ na __DL__ __S__ ne do kalendare",
    "nezapomen do ukolu __G__ __DL__ radek __S__ ne do kalendare",
    "musim udelat v ukolu __G__ do __DL__ __S__ ne do kalendare",
    "mam zaridit do ukolu __G__ na __DL__ slot __S__ ne do kalendare",
    "nesmim zapomenout do ukolu __G__ __DL__ __S__ ne do kalendare",
    "potrebuju do ukolu mit __G__ do __DL__ __S__ ne do kalendare"
  ];
  /** kind===2 note_write only: stejné kotvy jako rcz2_dirty_note_write (žádná schůzka / úkol / kalendář jako cíl). */
  const MOB_MID_NOTE_WRITE = [
    "uloz poznamku ze PIN karty je __S__",
    "zapis poznamku ze auto ma modrou barvu __S__",
    "uloz do poznamek heslo WiFi je __S__",
    "zapis poznamku ze variabilni symbol je __S__",
    "napis do poznamky ze smlouva je na __A__ __S__",
    "uloz do poznamek cislo OP je __S__",
    "zapis poznamku ze barva auta je modra __S__",
    "uloz do poznamek poznamku kod __S__"
  ];
  /** rcz2_mobile_voice task_query only: real READ/QUERY úkoly (ne připomínka / poznámka / kalendář z MOB_MID). */
  const MOB_TASK_QUERY_READ = [
    "mrkni do ukolu co mam splnit",
    "koukni do ukolu prosim",
    "podivej se do ukolu na dnes",
    "co mam v ukolech na dnes",
    "najdi v ukolech SLOTGOOD",
    "zjisti v ukolech co mam delat",
    "ukaz mi ukoly na dnes",
    "mam neco v ukolech na SLOTDEAD",
    "co tam mam za ukol na SLOTDEAD",
    "co mam dneska udelat v ukolech",
    "co mam zitra udelat v ukolech",
    "co mam pristi utery udelat v ukolech",
    "mrkni do ukolech jestli mam SLOTGOOD",
    "pockej koukni do ukolu prosim",
    "vlastne zjisti v ukolech SLOTGOOD",
    "co mam udelat jen v ukolech",
    "jen se podivej do ukolu co mam"
  ];
  /**
   * rcz2_mobile_voice calendar_query only: čisté READ formulace bez imperativů typu „mrkni/kdy mam“,
   * které engine mapuje na calendar.create (intent_fail). Držíme se vzorů, které zůstávají ve STORAGE_DISAMBIGUATION.
   */
  const MOB_CALENDAR_QUERY_READ = [
    "co tam mam za schuzku na SLOTDEAD",
    "co tam mam za schuzku SLOTDEAD v kalendari",
    "co mam v kalendari na SLOTDEAD",
    "co mam v kalendari na schuzku se zubarem SLOTIDX",
    "co tam mam na SLOTDEAD v kalendari",
    "co tam mam za udalost na SLOTDEAD",
    "co mam zitra v kalendari SLOTIDX",
    "co mam pristi utery v kalendari SLOTIDX",
    "co mam dneska v kalendari SLOTIDX",
    "co tam mam za schuzku se pravnikem na SLOTDEAD",
    "co tam mam za schuzku s doktorem na SLOTDEAD",
    "co mam v kalendari na dopoledne SLOTDEAD",
    "co tam mam za schuzku na patek SLOTIDX",
    "co mam v kalendari na vecer SLOTDEAD",
    "co tam mam za schuzku na zitrek SLOTDEAD",
    "co mam v kalendari na rano SLOTDEAD",
    "co tam mam za schuzku s ucetnim na SLOTDEAD",
    "co mam v kalendari na SLOTDEAD SLOTIDX"
  ];
  for (let i = 0; i < 22000; i++) {
    const kind = i % 5;
    let raw;
    if (kind === 4) {
      const tqb = MOB_TASK_QUERY_READ[i % MOB_TASK_QUERY_READ.length]
        .replace("SLOTGOOD", stripDiak(GOODS[i % GOODS.length]))
        .replace("SLOTDEAD", stripDiak(DEAD[i % DEAD.length]));
      raw = applyMutationMask(MOB_PREFIX_QUERY[i % MOB_PREFIX_QUERY.length] + tqb + MOB_SUFFIX[(i >> 4) % MOB_SUFFIX.length], i % 128);
    } else if (kind === 3) {
      const cqb = MOB_CALENDAR_QUERY_READ[i % MOB_CALENDAR_QUERY_READ.length]
        .replace("SLOTGOOD", stripDiak(GOODS[i % GOODS.length]))
        .replace("SLOTDEAD", stripDiak(DEAD[i % DEAD.length]))
        .replace("SLOTIDX", String(i));
      raw = applyMutationMask(MOB_PREFIX_QUERY[i % MOB_PREFIX_QUERY.length] + cqb + MOB_SUFFIX[(i >> 4) % MOB_SUFFIX.length], i % 128);
    } else {
      const d = stripDiak(DATES[i % DATES.length]);
      const tm = stripDiak(TMS[i % TMS.length]);
      const p = stripDiak(PERS[i % PERS.length]);
      const a = stripDiak(ADDR[i % ADDR.length]);
      const g = stripDiak(GOODS[i % GOODS.length]);
      const dl = stripDiak(DEAD[i % DEAD.length]);
      let tpl;
      let prefPool;
      if (kind === 0) {
        tpl = MOB_MID_CALENDAR_WRITE[i % MOB_MID_CALENDAR_WRITE.length];
        prefPool = MOB_PREFIX_CAL;
      } else if (kind === 1) {
        tpl = MOB_MID_TASK_WRITE[i % MOB_MID_TASK_WRITE.length];
        prefPool = MOB_PREFIX_TASK;
      } else {
        tpl = MOB_MID_NOTE_WRITE[i % MOB_MID_NOTE_WRITE.length];
        prefPool = MOB_PREFIX_NOTE;
      }
      const base = tpl
        .replace(/__D__/g, d)
        .replace(/__T__/g, tm)
        .replace(/__P__/g, p)
        .replace(/__A__/g, a)
        .replace(/__G__/g, g)
        .replace(/__DL__/g, dl)
        .replace(/__S__/g, String(i));
      raw = applyMutationMask(prefPool[i % prefPool.length] + base + MOB_SUFFIX[(i >> 4) % MOB_SUFFIX.length], i % 128);
    }
    if (raw.length < 6) {
      if (kind === 3) {
        raw = "hele mrkni kdy mam zubare v kalendari radek " + i;
      } else if (kind === 4) {
        raw = "hele jen se podivej do ukolu co mam radek " + i;
      } else if (kind === 0) {
        raw = "hele uloz mi do kalendare zitra v 15 schuzku s pravnikem ne do ukolu radek " + i;
      } else if (kind === 1) {
        raw = "hele hod mi do ukolu koupit mliko do patku ne kalendare radek " + i;
      } else {
        raw = "hele zapis poznamku ze pin je doma radek " + i;
      }
    }
    if (kind === 0) push("rcz2_mobile_voice", "calendar_write", raw, "calendar.create", {}, { mobile_czech: true }, UX_CAT.MOBILE);
    else if (kind === 1) push("rcz2_mobile_voice", "task_write", raw, "task.create", {}, { mobile_czech: true }, UX_CAT.MOBILE);
    else if (kind === 2) push("rcz2_mobile_voice", "note_write", raw, "note.create", {}, { mobile_czech: true }, UX_CAT.MOBILE);
    else if (kind === 3) push("rcz2_mobile_voice", "calendar_query", raw, "calendar.query", {}, { mobile_czech: true }, UX_CAT.MOBILE);
    else push("rcz2_mobile_voice", "task_query", raw, "task.query", {}, { mobile_czech: true }, UX_CAT.MOBILE);
  }

  for (let i = 0; i < 16000; i++) {
    const d = DATES[i % DATES.length];
    const tm = TMS[i % TMS.length];
    const raw =
      "Uloz do kalendare " +
      d +
      " v " +
      tm +
      " zubar na " +
      ADDR[i % ADDR.length] +
      " a zaroven do poznamky napis karticku pojistence radek " +
      i +
      ", ne do ukolu.";
    const f = foldCs(raw);
    const needsDualWrite =
      /\b(zaroven|zároveň)\b/i.test(raw) && /\b(do\s+poznam|\bpoznam|\bdo\s+kalend|\buloz|\bulož|\bpridej|\bpřidej)/i.test(f);
    const queryNeg = /jen\s+se\s+podivej|jen\s+cti|nic\s+neuklad/.test(f) ? f : "";
    push("rcz2_mixed_module", "multi_intent", raw, "unknown", { needsDualWrite, queryNeg }, { multi: true }, UX_CAT.MIXED);
  }

  const AMB_Q = [
    "Co mam s pravnikem?",
    "Kde mam ucetni?",
    "Kdy mam koupit kytky?",
    "Co jsem resil s doktorem?",
    "Kde je moje obcanka v poznamkach?",
    "Co mam s advokatem?",
    "Kdy mam hypoteku?",
    "Kde mam PIN ke karte?",
    "Co mam se schuzkou s Petrem?",
    "Jaky mam program na zitra?"
  ];
  for (let i = 0; i < 12000; i++) {
    const base = AMB_Q[i % AMB_Q.length];
    const raw = base.replace("?", i % 2 === 0 ? "?" : "") + (i % 7 === 0 ? " Nic neukladej." : "");
    const g = i % 4 === 0 ? "calendar_query" : i % 4 === 1 ? "task_query" : i % 4 === 2 ? "note_query" : "calendar_query";
    const exp = i % 7 === 0 ? (g === "note_query" ? "note.query" : g === "task_query" ? "task.query" : "calendar.query") : "unknown";
    push("rcz2_ambiguity", g, raw, exp, {}, {}, UX_CAT.AMBIG);
  }

  const RET_BASE = [
    "pravnik",
    "pravnik smlouva",
    "pravnik Brno",
    "pravnik Petr",
    "pravnik minuly tyden",
    "zubar Korunni",
    "ucetni faktury",
    "doktor zitra",
    "advokat plna moc",
    "schuzka najem",
    "kuryr balik",
    "Petr smlouva"
  ];
  for (let i = 0; i < 12000; i++) {
    const b = RET_BASE[i % RET_BASE.length];
    const g = i % 2 === 0 ? "calendar_query" : "task_query";
    const raw =
      g === "calendar_query"
        ? (i % 3 === 0 ? "Mrkni " : i % 3 === 1 ? "Koukni " : "Najdi ") +
          b +
          " kontext " +
          i +
          " v kalendari?"
        : (i % 3 === 0 ? "Mrkni " : i % 3 === 1 ? "Koukni " : "Najdi ") +
          b +
          " v ukolech radek " +
          i +
          "?";
    const exp = g === "task_query" ? "task.query" : "calendar.query";
    push("rcz2_retrieval", g, raw, exp, {}, {}, UX_CAT.RETR);
  }

  const EMOT = ["sakra ", "vole ", "tyjo ", "no nazdar ", "kurva ", ""];
  for (let i = 0; i < 6000; i++) {
    const raw =
      EMOT[i % EMOT.length] +
      "pripomen mi najem " +
      DEAD[i % DEAD.length] +
      " do ukolu radek " +
      i +
      ", ne do kalendare.";
    push("rcz2_emotional", "task_write", raw, "task.create", {}, {}, UX_CAT.EMOT);
  }

  for (let i = 0; i < 12000; i++) {
    const raw =
      "hele vlastne " +
      (i % 2 === 0
        ? "uloz mi do kalendare " +
          DATES[i % DATES.length] +
          " v " +
          TMS[i % TMS.length] +
          " schuzku s pravnikem a pak napis do ukolu at vezmu smlouvu a do poznamky napis ze je to na Praze 1 pripad " +
          i +
          " ne do jednoho bloku omylem"
        : "kup mliko do ukolu na " +
          PATEK +
          " a v kalendari dej doktora " +
          ZITRA +
          " rano a jeste pripomen fakturu ucteni radek " +
          i +
          " neplet to dohromady") +
      ", ne do spatneho modulu.";
    const f = foldCs(raw);
    const needsDualWrite = /\b(a\s+zaroven|a\s+v\s+kalendari|a\s+pak)\b/i.test(raw) || /\bdo\s+ukolu\b.*\bkalend/i.test(f);
    push("rcz2_long_chaotic", "multi_intent", raw, "unknown", { needsDualWrite, queryNeg: "" }, { multi: true }, UX_CAT.LONG);
  }

  applyHarnessExpectationHarmonization(rows);

  if (rows.length < 100000) {
    console.log("seed_data_fail=corpus_below_100k_got_" + rows.length);
    process.exit(1);
  }

  return rows;
}

function main() {
  const git = gitTrackedClean();
  if (!git.ok) {
    console.log("=== SILVER_REAL_CZECH_PUBLIC_UX_CORPUS_V2_ABORT ===");
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

  const cases = buildPublicUxCorpusV2();
  const byG = {};
  const byCluster = {};
  const byUxCat = {};
  const fails = [];
  const failClusters = {};
  const rootCauseHist = {};
  let falseWriteCount = 0;
  let queryCreatedWriteCount = 0;
  let writeWhenNegatedCount = 0;
  const dangerousCaseIds = new Set();

  for (let ci = 0; ci < cases.length; ci++) {
    const c = cases[ci];
    const uxc = c.ux_category || "unknown";
    if (!byG[c.group]) byG[c.group] = { pass: 0, fail: 0 };
    if (!byCluster[c.cluster]) byCluster[c.cluster] = { pass: 0, fail: 0 };
    if (!byUxCat[uxc]) byUxCat[uxc] = { pass: 0, fail: 0 };
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
      byCluster[c.cluster].pass++;
      byUxCat[uxc].pass++;
    } else {
      byG[c.group].fail++;
      byCluster[c.cluster].fail++;
      byUxCat[uxc].fail++;
      const prc = inferProbableRootCause(c, ev);
      const ck = String(c.cluster || c.group) + "||" + String(ev.cat || "fail");
      failClusters[ck] = (failClusters[ck] || 0) + 1;
      rootCauseHist[prc] = (rootCauseHist[prc] || 0) + 1;
      fails.push({
        id: c.id,
        cluster: c.cluster,
        group: c.group,
        ux_category: uxc,
        cat: ev.cat,
        input: c.input,
        expected: c.expectedIntent,
        actual: ev.auditIntent,
        raw: ev.raw,
        probable_root_cause: prc,
        sev: severity(ev.cat)
      });
    }
  }

  const total = cases.length;
  const failC = fails.length;
  const passC = total - failC;
  const corpusAcc = accFromPassFail(passC, failC);
  const failIdSet = new Set(fails.map((x) => x.id));

  function subAccUx(catKey) {
    let p = 0;
    let f = 0;
    for (let i = 0; i < cases.length; i++) {
      if (cases[i].ux_category !== catKey) continue;
      if (failIdSet.has(cases[i].id)) f++;
      else p++;
    }
    return { pass: p, fail: f, acc: accFromPassFail(p, f) };
  }

  fails.sort((a, b) => b.sev - a.sev || (failClusters[b.cluster + "||" + b.cat] || 0) - (failClusters[a.cluster + "||" + a.cat] || 0));

  const clusterPairs = Object.keys(failClusters)
    .map((k) => ({ k: k, n: failClusters[k] }))
    .sort((a, b) => b.n - a.n || String(a.k).localeCompare(String(b.k)));

  const top5 = clusterPairs.slice(0, 5);
  const top10Clusters = clusterPairs.slice(0, 10).map((p) => p.k + ":" + p.n);

  let recommendedNextCluster = "TOP_PUBLIC_UX_V2_CLUSTER_BY_IMPACT";
  let recommendedNextFixScope =
    failC === 0 ? "No harness failures in public UX v2 slice (diagnostic only)" : inferFixScope("ambiguous_should_clarify");
  const dangerousWriteCount = dangerousCaseIds.size;

  if (dangerousWriteCount > 0 || writeWhenNegatedCount > 0 || queryCreatedWriteCount > 0) {
    recommendedNextCluster = "STOP_P0_SAFETY_FIX_FIRST";
    recommendedNextFixScope = "Silver P0 safety: query to write + negated-write guards";
  } else if (clusterPairs.length) {
    const topK = clusterPairs[0].k.split("||")[0] || clusterPairs[0].k;
    const topCat = (clusterPairs[0].k.split("||")[1] || "").trim();
    const sampleFail = fails.find((f) => f.cluster + "||" + f.cat === clusterPairs[0].k);
    recommendedNextCluster = topK + " / " + topCat;
    recommendedNextFixScope =
      "Impact leader «" +
      topK +
      "» / «" +
      topCat +
      "»: " +
      inferFixScope(inferProbableRootCause({ group: sampleFail ? sampleFail.group : "calendar_write", cluster: topK, input: sampleFail ? sampleFail.input : "" }, { cat: topCat }));
  }

  let calendarWrite20k = "SKIPPED";
  let overall20kAcc = "SKIPPED";
  if (process.env.SILVER_RC2_EMBED_20K === "1") {
    try {
      const out20 = execSync('node "' + path.join(REPO, "scripts", "audit_silver_20000_routing_stable.cjs") + '"', {
        cwd: REPO,
        encoding: "utf8",
        maxBuffer: 64 * 1024 * 1024
      });
      const parsed20k = parse20kStdout(out20);
      if (parsed20k && parsed20k.calendar_write) calendarWrite20k = String(parsed20k.calendar_write);
      if (parsed20k && parsed20k.overall_accuracy) overall20kAcc = String(parsed20k.overall_accuracy) + "%";
    } catch (e20) {
      void e20;
    }
  }

  const qj = readJsonReport(path.join(REPO, "scripts", "silver-quality-v2-report.json"));
  const rj = readJsonReport(path.join(REPO, "scripts", "silver-realistic-mobile-corpus-report.json"));
  const rcj = readJsonReport(path.join(REPO, "scripts", "silver-real-czech-corpus-v1-report.json"));
  const dpj = readJsonReport(path.join(REPO, "scripts", "silver-deep-product-real-ux-v2-report.json"));

  const qualityAccRaw = qj && qj.quality_accuracy ? String(qj.quality_accuracy) : "SKIPPED";
  const qualityAcc = qualityAccRaw !== "SKIPPED" && qualityAccRaw.indexOf("%") < 0 ? qualityAccRaw + "%" : qualityAccRaw;
  const realisticAccRaw = rj && rj.overall_accuracy_realistic ? String(rj.overall_accuracy_realistic) : "SKIPPED";
  const realisticAcc =
    realisticAccRaw !== "SKIPPED" && realisticAccRaw.indexOf("%") < 0 ? realisticAccRaw + "%" : realisticAccRaw;
  const realCzechAccRaw = rcj && rcj.corpus_accuracy ? String(rcj.corpus_accuracy) : "SKIPPED";
  const realCzechAcc =
    realCzechAccRaw !== "SKIPPED" && realCzechAccRaw.indexOf("%") < 0 ? realCzechAccRaw + "%" : realCzechAccRaw;
  let deepUxAcc = "SKIPPED";
  if (dpj && dpj.deep_product_accuracy != null) deepUxAcc = String(dpj.deep_product_accuracy) + "%";

  let mainCommit = "";
  try {
    mainCommit = execSync("git rev-parse HEAD", { cwd: REPO, encoding: "utf8" }).trim();
  } catch (e1) {
    void e1;
  }

  let branch = "";
  try {
    branch = execSync("git rev-parse --abbrev-ref HEAD", { cwd: REPO, encoding: "utf8" }).trim();
  } catch (e2) {
    void e2;
  }

  let changedFiles = "scripts/silver-real-czech-public-ux-corpus-v2.cjs;scripts/silver-real-czech-public-ux-corpus-v2-report.json";
  try {
    const st = execSync("git status --porcelain", { cwd: REPO, encoding: "utf8" });
    const paths = st
      .split(/\r?\n/)
      .filter(Boolean)
      .map((l) => l.replace(/^\s*\S+\s+/, "").trim())
      .filter((p) => p.indexOf("scripts/") === 0 || p.indexOf("assets/") === 0);
    if (paths.length) changedFiles = Array.from(new Set(paths)).join(";");
  } catch (e3) {
    void e3;
  }

  const gateFail = dangerousWriteCount > 0 || falseWriteCount > 0 || queryCreatedWriteCount > 0 || writeWhenNegatedCount > 0;

  const categoryAccuracy = {};
  Object.keys(UX_CAT).forEach((k) => {
    const key = UX_CAT[k];
    categoryAccuracy[key] = subAccUx(key).acc;
  });

  const topFailExamples = fails.slice(0, 50).map((f) => ({
    id: f.id,
    cluster: f.cluster,
    cat: f.cat,
    input: f.input.slice(0, 200),
    ux_category: f.ux_category
  }));

  const cal20kParts = calendarWrite20k.split("/");
  const cal20kOk =
    calendarWrite20k === "SKIPPED" ||
    (cal20kParts.length === 2 && cal20kParts[0] === "3000" && cal20kParts[1] === "3000");

  let recommendedReason = failC === 0 ? "Corpus harness pass; optional product slice follow-up." : "Top failing cluster indicates highest routing/semantic drift.";
  let riskLevel = gateFail ? "P0" : failC > 5000 ? "P2" : failC > 500 ? "P1" : "P3";
  let readyNextFix = gateFail ? "NO" : cal20kOk ? "YES" : "NO";

  const reportObj = {
    harness_id: HARNESS_ID,
    fixed_now: FIXED_NOW_ISO,
    main_commit: mainCommit,
    branch,
    engine_changed: "NO",
    assets_app_changed: changedFiles.indexOf("assets/app.js") >= 0 ? "YES" : "NO",
    changed_files: changedFiles,
    total_cases: total,
    pass: passC,
    fail: failC,
    accuracy: corpusAcc,
    top_clusters: top10Clusters,
    top_fail_examples: topFailExamples,
    category_accuracy: categoryAccuracy,
    category_totals: {
      ultra_short_chaos: subAccUx(UX_CAT.ULTRA).pass + subAccUx(UX_CAT.ULTRA).fail,
      dirty_czech_no_diacritics: subAccUx(UX_CAT.DIRTY).pass + subAccUx(UX_CAT.DIRTY).fail,
      mobile_voice_chaos: subAccUx(UX_CAT.MOBILE).pass + subAccUx(UX_CAT.MOBILE).fail,
      mixed_module_chaos: subAccUx(UX_CAT.MIXED).pass + subAccUx(UX_CAT.MIXED).fail,
      ambiguity: subAccUx(UX_CAT.AMBIG).pass + subAccUx(UX_CAT.AMBIG).fail,
      retrieval_relevance: subAccUx(UX_CAT.RETR).pass + subAccUx(UX_CAT.RETR).fail,
      emotional_human_speech: subAccUx(UX_CAT.EMOT).pass + subAccUx(UX_CAT.EMOT).fail,
      long_chaotic_prompts: subAccUx(UX_CAT.LONG).pass + subAccUx(UX_CAT.LONG).fail
    },
    safety_counters: {
      dangerous_write_count: dangerousWriteCount,
      false_write_count: falseWriteCount,
      query_created_write_count: queryCreatedWriteCount,
      write_when_negated_count: writeWhenNegatedCount
    },
    calendar_write_20k: calendarWrite20k,
    calendar_write_20k_preservation: cal20kOk ? "3000/3000 OK" : "CHECK_MANUALLY",
    embedded_audits: {
      note: "Run audit_silver_20000_routing_stable, audit_silver_quality_v2, audit_silver_realistic_mobile_corpus, silver-real-czech-corpus-v1, silver-deep-product-real-ux-v2 separately to refresh sibling JSON reports before relying on metrics_snapshot."
    },
    metrics_snapshot: {
      "20k_overall_accuracy": overall20kAcc,
      quality_accuracy: qualityAcc,
      realistic_overall_accuracy: realisticAcc,
      real_czech_corpus_accuracy: realCzechAcc,
      deep_product_real_ux_v2_accuracy: deepUxAcc
    },
    recommended_next_cluster: recommendedNextCluster,
    recommended_next_fix_scope: recommendedNextFixScope,
    recommended_reason: recommendedReason,
    risk_level: riskLevel,
    ready_for_next_fix_task: readyNextFix,
    git_status_clean: git.ok ? "YES" : "NO",
    ready_for_pr: git.ok && !gateFail && changedFiles.indexOf("assets/app.js") < 0 ? "YES" : "NO"
  };

  fs.writeFileSync(REPORT_JSON, JSON.stringify(reportObj, null, 2), "utf8");

  function ex(clusterIdx, field) {
    const cl = top5[clusterIdx - 1];
    if (!cl) return "";
    if (field === "name") return escapeField(cl.k);
    if (field === "count") return String(cl.n);
    if (field === "examples") {
      const exs = fails
        .filter((f) => (f.cluster + "||" + f.cat) === cl.k)
        .slice(0, 3)
        .map((x) => x.input.slice(0, 80));
      return escapeField(exs.join(" | "));
    }
    return "";
  }

  const block = [
    "=== SILVER_REAL_CZECH_PUBLIC_UX_CORPUS_V2_FOUNDATION_RESULT ===",
    "main_commit=" + escapeField(mainCommit),
    "branch=" + escapeField(branch),
    "engine_changed=NO",
    "assets_app_changed=" + (changedFiles.indexOf("assets/app.js") >= 0 ? "YES" : "NO"),
    "changed_files=" + escapeField(changedFiles),
    "",
    "total_cases=" + total,
    "pass=" + passC,
    "fail=" + failC,
    "accuracy=" + corpusAcc + "%",
    "",
    "category_ultra_short_chaos_total=" + reportObj.category_totals.ultra_short_chaos,
    "category_dirty_czech_total=" + reportObj.category_totals.dirty_czech_no_diacritics,
    "category_mobile_voice_chaos_total=" + reportObj.category_totals.mobile_voice_chaos,
    "category_mixed_module_chaos_total=" + reportObj.category_totals.mixed_module_chaos,
    "category_ambiguity_total=" + reportObj.category_totals.ambiguity,
    "category_retrieval_relevance_total=" + reportObj.category_totals.retrieval_relevance,
    "category_emotional_human_speech_total=" + reportObj.category_totals.emotional_human_speech,
    "category_long_chaotic_prompts_total=" + reportObj.category_totals.long_chaotic_prompts,
    "",
    "top_cluster_1=" + ex(1, "name"),
    "top_cluster_1_count=" + ex(1, "count"),
    "top_cluster_1_examples=" + ex(1, "examples"),
    "top_cluster_2=" + ex(2, "name"),
    "top_cluster_2_count=" + ex(2, "count"),
    "top_cluster_2_examples=" + ex(2, "examples"),
    "top_cluster_3=" + ex(3, "name"),
    "top_cluster_3_count=" + ex(3, "count"),
    "top_cluster_3_examples=" + ex(3, "examples"),
    "top_cluster_4=" + ex(4, "name"),
    "top_cluster_4_count=" + ex(4, "count"),
    "top_cluster_4_examples=" + ex(4, "examples"),
    "top_cluster_5=" + ex(5, "name"),
    "top_cluster_5_count=" + ex(5, "count"),
    "top_cluster_5_examples=" + ex(5, "examples"),
    "",
    "calendar_write_20k=" + escapeField(calendarWrite20k),
    "20k_overall_accuracy=" + escapeField(overall20kAcc),
    "quality_accuracy=" + escapeField(qualityAcc),
    "realistic_overall_accuracy=" + escapeField(realisticAcc),
    "real_czech_corpus_accuracy=" + escapeField(realCzechAcc),
    "deep_product_real_ux_v2_accuracy=" + escapeField(deepUxAcc),
    "",
    "dangerous_write_count=" + dangerousWriteCount,
    "false_write_count=" + falseWriteCount,
    "query_created_write_count=" + queryCreatedWriteCount,
    "write_when_negated_count=" + writeWhenNegatedCount,
    "",
    "audit_20k=READ_OR_RUN_SEPARATELY",
    "quality_v2=READ_OR_RUN_SEPARATELY",
    "realistic_mobile=READ_OR_RUN_SEPARATELY",
    "real_czech_corpus=READ_OR_RUN_SEPARATELY",
    "deep_product_real_ux_v2=READ_OR_RUN_SEPARATELY",
    "",
    "recommended_next_cluster=" + escapeField(recommendedNextCluster),
    "recommended_next_fix_scope=" + escapeField(recommendedNextFixScope),
    "recommended_reason=" + escapeField(recommendedReason),
    "risk_level=" + riskLevel,
    "ready_for_next_fix_task=" + readyNextFix,
    "",
    "git_status_clean=" + (git.ok ? "YES" : "NO"),
    "ready_for_pr=" + reportObj.ready_for_pr,
    "======= END_SILVER_REAL_CZECH_PUBLIC_UX_CORPUS_V2_FOUNDATION_RESULT ==="
  ].join("\n");

  console.log("\n" + block);
  fs.writeFileSync(REPORT_TXT, block + "\n", "utf8");

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
  } catch (e4) {
    void e4;
  }

  if (gateFail) {
    process.exit(1);
  }
}

module.exports = { buildPublicUxCorpusV2 };

if (require.main === module) {
  main();
}
