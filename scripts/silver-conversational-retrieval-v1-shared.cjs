#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");
const harness = require("./audit_silver_realistic_mobile_corpus.cjs");
const pbux = require("./silver-public-beta-ux-hardening-v1-shared.cjs");
const core = require("./rhc-v3-deterministic-core.cjs");

const REPO = path.resolve(__dirname, "..");
const WRITE_INTENTS = new Set([
  "calendar.create",
  "tasks.create",
  "notes.create",
  "create.storage_disambiguation"
]);
const STATIC_ASSISTANT = new Set(["assistant.capability", "assistant.help", "assistant.guidance"]);

const AUDIT_FAMILIES = [
  "conversational_retrieval_without_find",
  "implicit_read_intent",
  "memory_recall_phrasing",
  "partial_memory_recall",
  "conversational_search_realism",
  "retrieval_without_search_verbs",
  "human_memory_style_queries",
  "fragment_recall_queries",
  "note_fragment_recall",
  "task_fragment_recall",
  "calendar_fragment_recall",
  "lexical_retrieval_ranking_v2",
  "retrieval_top_candidate_quality",
  "retrieval_false_clarification",
  "retrieval_no_save_contamination",
  "retrieval_after_help_turn",
  "retrieval_after_update_turn",
  "retrieval_after_save_turn",
  "long_session_memory_recall",
  "stale_retrieval_ownership",
  "retrieval_alias_memory",
  "conversational_recall_mobile",
  "dirty_czech_recall",
  "spoken_czech_recall",
  "public_beta_memory_queries",
  "confused_user_recall",
  "temporal_memory_recall",
  "retrieval_truthfulness_v2",
  "retrieval_not_found_behavior",
  "conversational_followup_recall"
];

const TIER_A_REPLAY = [
  {
    id: "SCR_REPLAY_001",
    family: "conversational_retrieval_without_find",
    input: "tu poznámku o tričku",
    mode: "retrieval_rank",
    tier: "A",
    expectNoteId: "n_shirt_new"
  },
  {
    id: "SCR_REPLAY_002",
    family: "implicit_read_intent",
    input: "to co sem resil s Kubou",
    mode: "retrieval_rank",
    tier: "A",
    expectNoteId: "n_shirt_new"
  },
  {
    id: "SCR_REPLAY_003",
    family: "memory_recall_phrasing",
    input: "jak sem psal doktorovi",
    mode: "retrieval_rank",
    tier: "A",
    expectNoteId: "n_doctor_new"
  },
  {
    id: "SCR_REPLAY_004",
    family: "retrieval_after_save_turn",
    input: "RETRIEVAL_AFTER_SAVE_CHAIN",
    mode: "long_session",
    tier: "A",
    expectNoteId: "n_shirt_new"
  },
  {
    id: "SCR_REPLAY_005",
    family: "retrieval_after_help_turn",
    input: "RETRIEVAL_AFTER_HELP_CHAIN",
    mode: "long_session",
    tier: "A",
    expectNoteId: "n_shirt_new"
  },
  {
    id: "SCR_REPLAY_006",
    family: "retrieval_not_found_behavior",
    input: "to co mam o neexistujicim xyzabc",
    mode: "truthfulness",
    tier: "A",
    expectNotFound: true
  }
];

const FAMILY_TEMPLATES = {
  conversational_retrieval_without_find: [
    "tu poznamku o tricku",
    "to co sem resil s Kubou",
    "jak sem psal doktorovi",
    "to o hypotéce",
    "to co mam o dovolené",
    "to co sem mel napsany",
    "to s pravnikem",
    "to jak sem resil internet",
    "to co sem resil vcera",
    "to co mam v poznamkach",
    "to co sem mel v ukolech",
    "tu schuzku s Kubou",
    "jak sem resil pojistku",
    "to o aute",
    "to co sem resil minulej tejden",
    "jak sem psal o dovolene",
    "to co sem mel u doktora",
    "to co mam s Katkou",
    "to jak sem resil internet s O2"
  ],
  implicit_read_intent: [
    "to co sem resil s Kubou",
    "co sem resil minulej tejden",
    "to co mam o aute",
    "jak sem psal o pojistce",
    "to co sem si psal s Katkou",
    "to co mam o dovoleny",
    "tu vec s Novakem",
    "to co sem mel napsany",
    "jak sem resil internet",
    "co mam o hypotéce",
    "to co mam s pravnikem",
    "to co sem resil vcera",
    "to co sem mel v poznamkach"
  ],
  memory_recall_phrasing: [
    "tu poznamku o tricku",
    "to jak sem psal o doktorovi",
    "to co mam o dovolene",
    "to s pravnikem",
    "to o aute",
    "co mam o hypotéce"
  ],
  partial_memory_recall: [
    "to o doktorovi",
    "to s Kubou",
    "to o aute",
    "to o pojistce",
    "to s Katkou",
    "vec s Novakem"
  ],
  conversational_search_realism: [
    "tu poznamku o tricku",
    "to co sem resil s Kubou",
    "jak sem psal doktorovi",
    "to o hypotéce",
    "to co mam v poznamkach"
  ],
  retrieval_without_search_verbs: [
    "tu poznamku o tricku",
    "to co sem resil s Kubou",
    "jak sem psal doktorovi",
    "to o aute",
    "to co mam o dovoleny",
    "to s pravnikem"
  ],
  human_memory_style_queries: [
    "to co sem mel napsany",
    "to co sem resil vcera",
    "co sem resil minulej tejden",
    "to co mam v poznamkach",
    "to jak sem resil internet"
  ],
  fragment_recall_queries: [
    "to o doktorovi",
    "to s Kubou",
    "tu vec s Novakem",
    "to o aute",
    "to o hypotéce"
  ],
  note_fragment_recall: [
    "tu poznamku o tricku",
    "to co mam v poznamkach",
    "jak sem psal doktorovi",
    "to co mam o dovoleny",
    "to o pojistce"
  ],
  task_fragment_recall: [
    "ten ukol o doktorovi",
    "to co sem mel v ukolech",
    "ten ukol s Kubou"
  ],
  calendar_fragment_recall: [
    "tu schuzku s Kubou",
    "to co sem resil s Kubou",
    "tu schuzku s doktorem"
  ],
  lexical_retrieval_ranking_v2: [
    "tu poznamku o tricku",
    "jak sem psal doktorovi",
    "to co sem resil s Kubou",
    "to o aute",
    "to o hypotéce"
  ],
  retrieval_top_candidate_quality: [
    "tu poznamku o tricku",
    "jak sem psal doktorovi",
    "to co sem resil s Kubou",
    "to o doktorovi",
    "to s Kubou"
  ],
  retrieval_false_clarification: [
    "tu poznamku o tricku",
    "jak sem psal doktorovi",
    "to co sem resil s Kubou",
    "to o aute"
  ],
  retrieval_no_save_contamination: [
    "tu poznamku o tricku",
    "to co sem resil s Kubou",
    "jak sem psal doktorovi",
    "to o hypotéce"
  ],
  retrieval_after_help_turn: ["RETRIEVAL_AFTER_HELP_CHAIN"],
  retrieval_after_update_turn: ["RETRIEVAL_AFTER_UPDATE_CHAIN"],
  retrieval_after_save_turn: ["RETRIEVAL_AFTER_SAVE_CHAIN"],
  long_session_memory_recall: ["LONG_SESSION_MEMORY_CHAIN"],
  stale_retrieval_ownership: ["STALE_RETRIEVAL_CHAIN"],
  retrieval_alias_memory: [
    "to co mam s Katkou",
    "to s Kubou",
    "tu vec s Novakem",
    "to co sem resil s Kubou"
  ],
  conversational_recall_mobile: [
    "hele tu poznamku o tricku",
    "no to co sem resil s Kubou",
    "kratce jak sem psal doktorovi"
  ],
  dirty_czech_recall: [
    "tu poznamku o tricku",
    "to co sem resil s Kubou",
    "jak sem psal doktorovi",
    "to o aute",
    "co mam o hypotéce"
  ],
  spoken_czech_recall: [
    "hele to co sem resil s Kubou",
    "prosim tu poznamku o tricku",
    "no jak sem psal doktorovi"
  ],
  public_beta_memory_queries: [
    "to co mam v poznamkach",
    "to co sem mel napsany",
    "co sem resil minulej tejden",
    "to co sem resil vcera"
  ],
  confused_user_recall: [
    "nevím to co sem psal o doktorovi",
    "fakt nevim tu poznamku o tricku",
    "to co sem asi resil s Kubou"
  ],
  temporal_memory_recall: [
    "to co sem resil vcera",
    "co sem resil minulej tejden",
    "to co sem mel u doktora"
  ],
  retrieval_truthfulness_v2: [
    "to co mam o neexistujicim xyzabc",
    "tu poznamku o neexistujicim qqqzzz",
    "to o neznamem xyzabc123"
  ],
  retrieval_not_found_behavior: [
    "to co mam o neexistujicim xyzabc",
    "tu poznamku o neexistujicim qqqzzz",
    "to s neznamou osobou xyzabc"
  ],
  conversational_followup_recall: ["CONVERSATIONAL_FOLLOWUP_RECALL_CHAIN"]
};

const PREFIXES = ["", "Hele ", "No ", "Silver ", "Prosím ", "Krátce ", "Vlastně ", "Fakt "];
const SUFFIXES = ["", "?", " prosím?", " stručně?"];
const CHAOS_FILLERS = ["", "fakt ", "nevím ", "urgentně ", "můžeš mi říct "];

const FAMILY_BUDGETS = {
  conversational_retrieval_without_find: 240,
  implicit_read_intent: 140,
  memory_recall_phrasing: 80,
  partial_memory_recall: 70,
  conversational_search_realism: 80,
  retrieval_without_search_verbs: 120,
  human_memory_style_queries: 70,
  fragment_recall_queries: 70,
  note_fragment_recall: 90,
  task_fragment_recall: 50,
  calendar_fragment_recall: 50,
  lexical_retrieval_ranking_v2: 90,
  retrieval_top_candidate_quality: 90,
  retrieval_false_clarification: 70,
  retrieval_no_save_contamination: 70,
  retrieval_after_help_turn: 55,
  retrieval_after_update_turn: 55,
  retrieval_after_save_turn: 55,
  long_session_memory_recall: 55,
  stale_retrieval_ownership: 50,
  retrieval_alias_memory: 60,
  conversational_recall_mobile: 100,
  dirty_czech_recall: 100,
  spoken_czech_recall: 50,
  public_beta_memory_queries: 70,
  confused_user_recall: 50,
  temporal_memory_recall: 70,
  retrieval_truthfulness_v2: 50,
  retrieval_not_found_behavior: 50,
  conversational_followup_recall: 45
};

function mainCommit() {
  try {
    return execSync("git rev-parse HEAD", { cwd: REPO, encoding: "utf8" }).trim();
  } catch {
    return "unknown";
  }
}

function foldCs(s) {
  return String(s || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function modeForFamily(family) {
  if (family.indexOf("truth") >= 0 || family.indexOf("not_found") >= 0) return "truthfulness";
  if (family.indexOf("long_session") >= 0 || family.indexOf("stale") >= 0) return "long_session";
  if (family.indexOf("after_") >= 0 || family.indexOf("followup") >= 0) return "long_session";
  if (
    family.indexOf("retrieval") >= 0 ||
    family.indexOf("recall") >= 0 ||
    family.indexOf("implicit") >= 0 ||
    family.indexOf("fragment") >= 0 ||
    family.indexOf("lexical") >= 0 ||
    family.indexOf("memory") >= 0 ||
    family.indexOf("conversational") >= 0
  ) {
    return "retrieval_rank";
  }
  return "retrieval_rank";
}

function expectNoteIdFromInput(input, family) {
  const fam = String(family || "");
  if (fam === "task_fragment_recall" || fam === "calendar_fragment_recall") return "";
  const f = foldCs(input);
  if (/\btrick|tričk|kub/.test(f) && !/\bdoktor/.test(f)) return "n_shirt_new";
  if (/\bdoktor/.test(f)) return "n_doctor_new";
  if (/\bpin\b/.test(f)) return "n_pin";
  if (/\bkub/.test(f)) return "n_shirt_new";
  if (/\bkatk/.test(f)) return "n_shirt_new";
  return "";
}

function enrichCase(c) {
  const out = Object.assign({}, c);
  if (!out.expectNoteId && out.mode === "retrieval_rank" && !out.expectNotFound) {
    const nid = expectNoteIdFromInput(out.input, out.family);
    if (nid) out.expectNoteId = nid;
  }
  if (!out.mode) out.mode = modeForFamily(out.family);
  return out;
}

function buildCorpusV1(targetCount) {
  const cases = [];
  for (let i = 0; i < TIER_A_REPLAY.length; i++) {
    cases.push(enrichCase(TIER_A_REPLAY[i]));
  }
  const rng = core.mulberry32(0x53435231);
  let n = cases.length;
  const budgetSum = AUDIT_FAMILIES.reduce(function (acc, fam) {
    return acc + (FAMILY_BUDGETS[fam] || 40);
  }, 0);
  const minTarget = budgetSum + TIER_A_REPLAY.length + 32;
  const effectiveTarget = Math.max(targetCount, minTarget);
  const perFamilyDefault = Math.max(40, Math.ceil((effectiveTarget - cases.length) / AUDIT_FAMILIES.length));
  for (let fi = 0; fi < AUDIT_FAMILIES.length; fi++) {
    const family = AUDIT_FAMILIES[fi];
    const tpls = FAMILY_TEMPLATES[family] || ["tu poznamku o tricku"];
    const count = FAMILY_BUDGETS[family] || perFamilyDefault;
    for (let i = 0; i < count; i++) {
      n++;
      const base = tpls[i % tpls.length];
      if (base.indexOf("CHAIN") > 0) {
        cases.push(
          enrichCase({
            id: "SCR_" + String(n).padStart(6, "0"),
            family: family,
            input: base,
            mode: modeForFamily(family),
            tier: "B"
          })
        );
        continue;
      }
      const modeHint = modeForFamily(family);
      const lightPrefix =
        modeHint === "retrieval_rank" ||
        family.indexOf("implicit") >= 0 ||
        family.indexOf("without_search") >= 0 ||
        family.indexOf("fragment") >= 0 ||
        family.indexOf("memory_recall") >= 0 ||
        family.indexOf("ranking") >= 0;
      const pfx = lightPrefix
        ? ["", "Hele ", "Prosím ", "Krátce "][Math.floor(rng() * 4)]
        : PREFIXES[Math.floor(rng() * PREFIXES.length)];
      const sfx = lightPrefix ? ["", "?"][Math.floor(rng() * 2)] : SUFFIXES[Math.floor(rng() * SUFFIXES.length)];
      const chaosPick = lightPrefix ? "" : CHAOS_FILLERS[Math.floor(rng() * CHAOS_FILLERS.length)];
      let input = chaosPick + pfx + base + sfx;
      const mask = core.deriveMutationMask(family, i, 0x53435231);
      input = core.applyMutationLayers(input, mask, rng);
      cases.push(
        enrichCase({
          id: "SCR_" + family.slice(0, 10).toUpperCase() + "_" + String(n).padStart(6, "0"),
          family: family,
          input: input,
          mode: modeForFamily(family),
          tier: "B"
        })
      );
    }
  }
  while (cases.length < effectiveTarget) {
    n++;
    const family = AUDIT_FAMILIES[n % AUDIT_FAMILIES.length];
    const tpls = FAMILY_TEMPLATES[family] || ["tu poznamku o tricku"];
    const base = tpls[n % tpls.length];
    if (base.indexOf("CHAIN") > 0) {
      cases.push(
        enrichCase({
          id: "SCR_PAD_" + String(n).padStart(6, "0"),
          family: family,
          input: base,
          mode: modeForFamily(family),
          tier: "B"
        })
      );
      continue;
    }
    const mask = core.deriveMutationMask(family, n, 0x53435231);
    let input = core.applyMutationLayers(base, mask, rng);
    cases.push(
      enrichCase({
        id: "SCR_PAD_" + String(n).padStart(6, "0"),
        family: family,
        input: input,
        mode: modeForFamily(family),
        tier: "B"
      })
    );
  }
  return cases.slice(0, effectiveTarget).map(enrichCase);
}

function turnMsg(turn) {
  return String((turn.readAnswer && turn.readAnswer.message) || turn.assistantLead || turn.userFacingSummary || "");
}

function runLongSessionChain(eng, chainId, ctx) {
  const issues = [];
  try {
    if (eng.iuSilverConversationReset) eng.iuSilverConversationReset();
  } catch (e0) {
    void e0;
  }
  let prev = eng.createEmptyDraft();
  const steps =
    chainId === "RETRIEVAL_AFTER_HELP_CHAIN"
      ? ["Jak fungují úkoly?", "tu poznámku o tričku"]
      : chainId === "RETRIEVAL_AFTER_UPDATE_CHAIN"
        ? ["Dnešní schůzku s Novákem přesuň na 22", "jak sem psal doktorovi"]
        : chainId === "RETRIEVAL_AFTER_SAVE_CHAIN" || chainId === "LONG_SESSION_MEMORY_CHAIN"
          ? ["Zítra v 10 schůzka s Kubou", "tu poznámku o tričku"]
          : chainId === "STALE_RETRIEVAL_CHAIN"
            ? ["Zítra v 10 schůzka", "Ne", "tu poznámku o tričku"]
            : chainId === "CONVERSATIONAL_FOLLOWUP_RECALL_CHAIN"
              ? ["to co sem resil s Kubou", "a co doktor?"]
              : ["Jak funguje kalendář?", "tu poznámku o tričku"];
  let lastTurn = null;
  for (let si = 0; si < steps.length; si++) {
    lastTurn = eng.processUserTurn(steps[si], prev, ctx || harness.ctxForCase("calendar_write"));
    prev = lastTurn.draft && lastTurn.draft.targetContainer !== "none" ? lastTurn.draft : prev;
  }
  const intent = String(lastTurn.normalizedIntent || "");
  if (WRITE_INTENTS.has(intent)) issues.push("long_session_save_leak:" + intent);
  if (lastTurn.processingState === "CLARIFICATION" && chainId.indexOf("STALE") >= 0) {
    issues.push("false_clarification:" + String(lastTurn.clarificationReason || ""));
  }
  const sr = lastTurn.silverSearchResult || (lastTurn.readAnswer && lastTurn.readAnswer.silverSearch);
  const note = sr && sr.bestResult && sr.bestResult.payload && sr.bestResult.payload.note;
  if (chainId.indexOf("RETRIEVAL") >= 0 || chainId.indexOf("MEMORY") >= 0 || chainId.indexOf("FOLLOWUP") >= 0) {
    const msgLs = turnMsg(lastTurn);
    const expectRx =
      chainId.indexOf("UPDATE") >= 0 ? /\bdoktor/i : chainId.indexOf("FOLLOWUP") >= 0 ? /\bdoktor|trick|kub/i : /\btrick|kub|tričk/i;
    if (lastTurn.processingState !== "READ_OK" && intent.indexOf(".read") < 0 && intent !== "global.search") {
      issues.push("long_session_read_miss:" + intent);
    } else if (lastTurn.processingState === "READ_OK" && !expectRx.test(msgLs)) {
      issues.push("long_session_wrong_content");
    }
  }
  const peek = eng.iuSilverSessionStateGovernancePeekV1 ? eng.iuSilverSessionStateGovernancePeekV1() : {};
  if (peek.stalePayloadReuse) issues.push("stale_payload_reuse");
  if (peek.staleRetrievalOwnership) issues.push("stale_retrieval_ownership");
  return { issues, lastTurn };
}

function evaluateRetrievalRank(eng, c, ctx) {
  const turn = eng.processUserTurn(c.input, eng.createEmptyDraft(), ctx);
  const issues = [];
  const intent = String(turn.normalizedIntent || "");
  const ps = String(turn.processingState || "");
  if (WRITE_INTENTS.has(intent)) issues.push("retrieval_write_leak:" + intent);
  if (c.family === "calendar_fragment_recall") {
    if (ps === "READ_OK" && (intent.indexOf(".read") >= 0 || intent === "global.search")) {
      return { issues, turn };
    }
    issues.push("calendar_fragment_miss:" + intent + ":" + ps);
    return { issues, turn };
  }
  if (c.family === "task_fragment_recall") {
    if (ps === "READ_OK" && (intent.indexOf(".read") >= 0 || intent === "global.search")) {
      return { issues, turn };
    }
    issues.push("task_fragment_miss:" + intent + ":" + ps);
    return { issues, turn };
  }
  if (turn.draft && turn.draft.targetContainer && turn.draft.targetContainer !== "none" && WRITE_INTENTS.has(intent)) {
    issues.push("draft_save_contamination");
  }
  if (ps === "CLARIFICATION" && c.family === "retrieval_false_clarification") {
    issues.push("false_clarification:" + String(turn.clarificationReason || ""));
  } else if (ps === "CLARIFICATION" && c.expectNoteId && c.family === "retrieval_false_clarification") {
    issues.push("false_clarification:" + String(turn.clarificationReason || ""));
  }
  const sr = turn.silverSearchResult || (turn.readAnswer && turn.readAnswer.silverSearch);
  const br = sr && sr.bestResult;
  let note = br && br.payload && br.payload.note;
  if (c.expectNoteId && note && String(note.id) !== c.expectNoteId) {
    let foundAlt = false;
    const rows = sr && sr.results ? sr.results : [];
    for (let ri = 0; ri < rows.length && ri < 5; ri++) {
      const nn = rows[ri].payload && rows[ri].payload.note;
      if (nn && String(nn.id) === c.expectNoteId) {
        foundAlt = true;
        note = nn;
        break;
      }
    }
    if (!foundAlt) {
      issues.push("wrong_top_candidate:" + String(note.id) + "!=" + c.expectNoteId);
    }
  }
  if (c.expectNoteId && (!note || !note.id)) {
    if (intent.indexOf(".read") < 0 && ps !== "READ_OK") {
      issues.push("missing_top_candidate");
    } else if (ps === "READ_OK") {
      const msg = turnMsg(turn);
      const exp = c.expectNoteId;
      if (exp === "n_shirt_new" && !/\b(trick|kub|tričk)/i.test(msg)) issues.push("missing_top_candidate");
      else if (exp === "n_doctor_new" && !/\bdoktor/i.test(msg)) issues.push("missing_top_candidate");
      else if (exp === "n_pin" && !/\bpin/i.test(msg)) issues.push("missing_top_candidate");
    } else {
      issues.push("missing_top_candidate");
    }
  }
  return { issues, turn };
}

function evaluateTruthfulness(eng, c, ctx) {
  const turn = eng.processUserTurn(c.input, eng.createEmptyDraft(), ctx);
  const issues = [];
  const intent = String(turn.normalizedIntent || "");
  if (WRITE_INTENTS.has(intent)) issues.push("truth_write_leak:" + intent);
  const msg = turnMsg(turn);
  const sr = turn.silverSearchResult || (turn.readAnswer && turn.readAnswer.silverSearch);
  const br = sr && sr.bestResult;
  if (c.expectNotFound) {
    if (br && br.payload && (br.payload.note || br.payload.event || br.payload.task)) {
      const tit = br.payload.note
        ? String(br.payload.note.title || "")
        : br.payload.event
          ? String(br.payload.event.title || "")
          : br.payload.task
            ? String(br.payload.task.title || "")
            : "";
      if (tit && foldCs(tit).indexOf("xyzabc") < 0 && foldCs(tit).indexOf("qqqzzz") < 0 && (br.score || 0) > 80) {
        issues.push("hallucinated_result:" + tit);
      }
    }
    if (
      !/\b(nenasel|nenašel|nic\s+jsem|nenašla|nenašel)\b/i.test(msg) &&
      br &&
      br.score > 120 &&
      br.payload &&
      (br.payload.note || br.payload.event)
    ) {
      issues.push("not_found_untruthful");
    }
  }
  return { issues, turn };
}

function evaluateCase(eng, c, ctxRank) {
  const mode = c.mode || modeForFamily(c.family);
  if (mode === "long_session" || (c.input && c.input.indexOf("CHAIN") > 0)) {
    const r = runLongSessionChain(eng, c.input, ctxRank);
    return { id: c.id, family: c.family, input: c.input, issues: r.issues, pass: r.issues.length === 0, turn: r.lastTurn };
  }
  if (mode === "truthfulness") {
    const r = evaluateTruthfulness(eng, c, ctxRank);
    return { id: c.id, family: c.family, input: c.input, issues: r.issues, pass: r.issues.length === 0, turn: r.turn };
  }
  try {
    if (eng.iuSilverConversationReset) eng.iuSilverConversationReset();
  } catch (e0) {
    void e0;
  }
  const r = evaluateRetrievalRank(eng, c, ctxRank);
  return { id: c.id, family: c.family, input: c.input, issues: r.issues, pass: r.issues.length === 0, turn: r.turn };
}

function runAudit(harnessId, cases, reportPath, extra) {
  const eng = harness.loadEngine();
  const ctxRank = pbux.buildRankingSeedCtx();
  const results = [];
  let pass = 0;
  let helpContamination = 0;
  let wrongTop = 0;
  let staleLeaks = 0;
  let hallucinationCount = 0;
  let falseClarification = 0;
  let notFoundTruthful = 0;
  for (let i = 0; i < cases.length; i++) {
    const r = evaluateCase(eng, cases[i], ctxRank);
    results.push(r);
    if (r.pass) pass++;
    else {
      for (let j = 0; j < r.issues.length; j++) {
        const iss = r.issues[j];
        if (iss.indexOf("write") >= 0 || iss.indexOf("save") >= 0 || iss.indexOf("draft") >= 0) helpContamination++;
        if (iss.indexOf("wrong_top") >= 0) wrongTop++;
        if (iss.indexOf("stale") >= 0) staleLeaks++;
        if (iss.indexOf("hallucin") >= 0) hallucinationCount++;
        if (iss.indexOf("false_clarification") >= 0) falseClarification++;
        if (iss.indexOf("not_found") >= 0) notFoundTruthful++;
      }
    }
  }
  const total = cases.length;
  const retrievalCases = cases.filter(function (x) {
    return (x.mode || modeForFamily(x.family)) === "retrieval_rank";
  }).length;
  const implicitCases = cases.filter(function (x) {
    return x.family.indexOf("implicit") >= 0 || x.family.indexOf("without_search") >= 0;
  }).length;
  const longSessionCases = cases.filter(function (x) {
    return (x.mode || modeForFamily(x.family)) === "long_session";
  }).length;
  const rankingCases = cases.filter(function (x) {
    return x.family.indexOf("ranking") >= 0 || x.family.indexOf("top_candidate") >= 0;
  }).length;
  const mobileCases = cases.filter(function (x) {
    return x.family.indexOf("mobile") >= 0 || x.family.indexOf("dirty") >= 0 || x.family.indexOf("spoken") >= 0;
  }).length;
  const report = Object.assign(
    {
      harness_id: harnessId,
      main_commit: mainCommit(),
      cases_total: total,
      pass_count: pass,
      fail_count: total - pass,
      accuracy_pct: total ? Math.round((pass / total) * 1000) / 10 : 0,
      generated_cases: total,
      retrieval_cases: retrievalCases,
      implicit_cases: implicitCases,
      ranking_cases: rankingCases,
      long_session_cases: longSessionCases,
      mobile_cases: mobileCases,
      wrong_top_candidate_count: wrongTop,
      stale_context_leaks: staleLeaks,
      help_contamination_count: helpContamination,
      hallucination_count: hallucinationCount,
      false_clarification_count: falseClarification,
      not_found_truthful_count: notFoundTruthful,
      audit_families: AUDIT_FAMILIES.slice(),
      fails: results
        .filter(function (x) {
          return !x.pass;
        })
        .slice(0, 40)
    },
    extra || {}
  );
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2) + "\n", "utf8");
  return { report, eng };
}

function filterFamilies(cases, families) {
  const set = new Set(families);
  return cases.filter(function (c) {
    return set.has(c.family);
  });
}

function filterMode(cases, mode) {
  return cases.filter(function (c) {
    return (c.mode || modeForFamily(c.family)) === mode;
  });
}

function filterFamilyPattern(cases, pattern) {
  const re = new RegExp(pattern);
  return cases.filter(function (c) {
    return re.test(c.family);
  });
}

function printHeader(tag, report, minPct) {
  console.log("=== " + tag.toUpperCase() + " ===");
  console.log("cases_total=" + report.cases_total);
  console.log("pass_count=" + report.pass_count);
  console.log("accuracy_pct=" + report.accuracy_pct);
  console.log("wrong_top_candidate_count=" + report.wrong_top_candidate_count);
  console.log("stale_context_leaks=" + report.stale_context_leaks);
  console.log("help_contamination_count=" + report.help_contamination_count);
  console.log("hallucination_count=" + report.hallucination_count);
  console.log("false_clarification_count=" + report.false_clarification_count);
  const passOk =
    report.help_contamination_count === 0 &&
    report.hallucination_count === 0 &&
    (minPct != null ? report.accuracy_pct >= minPct : report.pass_count === report.cases_total);
  console.log("PASS_FAIL=" + (passOk ? "PASS" : "FAIL"));
  console.log("=== END_" + tag.toUpperCase() + " ===");
  return passOk;
}

module.exports = {
  AUDIT_FAMILIES,
  TIER_A_REPLAY,
  buildCorpusV1,
  runAudit,
  filterFamilies,
  filterMode,
  filterFamilyPattern,
  printHeader,
  modeForFamily,
  expectNoteIdFromInput
};
