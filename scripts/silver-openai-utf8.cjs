#!/usr/bin/env node
/**
 * OpenAI / SILVER_NEXT_ACTION.md UTF-8 decode + mojibake repair (scripts-only).
 * Mirrors scripts/silver-utf8-handoff.ps1 scoring + legacy byte re-encode path.
 */
"use strict";

const fs = require("fs");
const path = require("path");
const { SILVER_NEXT_ACTION_MOJIBAKE_RE } = require("./silver-next-action-planner-handoff.cjs");

const CZECH_GOOD_CHARS =
  "áčďéěíňóřšťúůýžÁČĎÉĚÍŇÓŘŠŤÚŮÝŽ—";
const CZECH_BAD_CHARS = "ĂÄŹÂÃ";

const LEGACY_DECODE_LABELS = ["windows-1252", "iso-8859-1", "windows-1250"];

/** @type {Map<string, Map<string, number>>} */
const reverseByteMaps = new Map();

function getReverseByteMap(label) {
  if (reverseByteMaps.has(label)) return reverseByteMaps.get(label);
  const dec = new TextDecoder(label);
  const map = new Map();
  for (let b = 0; b < 256; b++) {
    const ch = dec.decode(Uint8Array.of(b));
    if (ch.length === 1 && !map.has(ch)) map.set(ch, b);
  }
  reverseByteMaps.set(label, map);
  return map;
}

function czechTextScore(text) {
  const t = String(text || "");
  if (!t) return 0;
  let score = 0;
  for (const ch of t) {
    if (CZECH_GOOD_CHARS.includes(ch)) score++;
    if (CZECH_BAD_CHARS.includes(ch)) score--;
  }
  if (t.includes("\u2014")) score += 2;
  if (t.includes("â€")) score -= 3;
  return score;
}

function hasSilverUtf8MojibakeMarkersCore(text) {
  const t = String(text || "");
  if (!t) return false;
  for (const ch of CZECH_BAD_CHARS) {
    if (t.includes(ch)) return true;
  }
  if (t.includes("\u00e2\u20ac")) return true;
  if (t.includes("\u00c3\u009a")) return true;
  if (t.includes("p\u017d")) return true;
  return false;
}

function hasSilverUtf8MojibakeMarkers(text) {
  const t = String(text || "");
  if (!t) return false;
  if (hasSilverUtf8MojibakeMarkersCore(t)) return true;
  if (SILVER_NEXT_ACTION_MOJIBAKE_RE.test(t)) return true;
  const score = czechTextScore(t);
  const repaired = repairSilverUtf8MojibakeText(t);
  if (repaired !== t && czechTextScore(repaired) > score) return true;
  return false;
}

function legacyBytesFromMisdecodedText(text, label) {
  const map = getReverseByteMap(label);
  const bytes = [];
  for (const ch of String(text || "")) {
    const cp = ch.codePointAt(0);
    if (cp < 128) {
      bytes.push(cp);
      continue;
    }
    const b = map.get(ch);
    if (b === undefined) return null;
    bytes.push(b);
  }
  return Buffer.from(bytes);
}

function repairSilverUtf8MojibakeText(text) {
  const input = String(text || "");
  if (!input) return input;
  if (!hasSilverUtf8MojibakeMarkersCore(input) && !SILVER_NEXT_ACTION_MOJIBAKE_RE.test(input)) {
    return input;
  }

  /** @type {string[]} */
  const candidates = [input];
  for (const label of LEGACY_DECODE_LABELS) {
    try {
      const buf = legacyBytesFromMisdecodedText(input, label);
      if (buf) candidates.push(buf.toString("utf8"));
    } catch {
      /* skip */
    }
  }
  try {
    candidates.push(Buffer.from(input, "latin1").toString("utf8"));
  } catch {
    /* skip */
  }

  let best = input;
  let bestScore = czechTextScore(input);
  for (const cand of candidates) {
    const sc = czechTextScore(cand);
    if (sc > bestScore) {
      bestScore = sc;
      best = cand;
    }
  }
  return best;
}

/**
 * @param {string} text
 * @param {{ repaired?: { value: string } }} [opts]
 * @returns {string}
 */
function repairSilverOpenAiUtf8Text(text, opts) {
  const input = String(text || "");
  const fixed = repairSilverUtf8MojibakeText(input);
  if (opts && opts.repaired && typeof opts.repaired === "object") {
    opts.repaired.value = fixed !== input ? "YES" : "NO";
  }
  return fixed;
}

async function decodeFetchBodyUtf8(res) {
  const buf = Buffer.from(await res.arrayBuffer());
  return buf.toString("utf8");
}

function parseOpenAiChatCompletionRaw(raw) {
  return JSON.parse(String(raw || ""));
}

function extractOpenAiChatMessageContent(json) {
  const msg = (((json || {}).choices || [])[0] || {}).message || {};
  return String(msg.content || "");
}

/**
 * @param {string} rawUtf8
 * @returns {{ json: object, content: string, repaired: string }}
 */
function coerceOpenAiChatCompletionText(rawUtf8) {
  const json = parseOpenAiChatCompletionRaw(rawUtf8);
  const rawContent = extractOpenAiChatMessageContent(json).trim();
  const repairedRef = { value: "NO" };
  const content = repairSilverOpenAiUtf8Text(rawContent, { repaired: repairedRef });
  return { json, content, repaired: repairedRef.value };
}

function writeUtf8FileNoBom(absPath, text) {
  const body = String(text || "");
  fs.writeFileSync(absPath, body.endsWith("\n") ? body : body + "\n", { encoding: "utf8" });
}

function runOpenAiNextActionUtf8Selftest() {
  let ok = true;
  const sampleGood =
    "ÚKOL PRO CURSOR — Ověřte případně čistý ě\n\n```powershell\nGet-Content -LiteralPath .\\SILVER_NEXT_ACTION.md\n```\n";
  const utf8Bytes = Buffer.from(sampleGood, "utf8");
  const sampleBad = new TextDecoder("windows-1252").decode(utf8Bytes);

  if (!hasSilverUtf8MojibakeMarkers(sampleBad)) {
    console.error("OPENAI_NEXT_ACTION_UTF8_SELFTEST_FAIL detect_mojibake_sample");
    ok = false;
  }
  if (hasSilverUtf8MojibakeMarkers(sampleGood)) {
    console.error("OPENAI_NEXT_ACTION_UTF8_SELFTEST_FAIL clean_sample_marked_bad");
    ok = false;
  }

  const repairedRef = { value: "NO" };
  const fixed = repairSilverOpenAiUtf8Text(sampleBad, { repaired: repairedRef });
  if (repairedRef.value !== "YES") {
    console.error("OPENAI_NEXT_ACTION_UTF8_SELFTEST_FAIL repair_flag");
    ok = false;
  }
  if (fixed.trim() !== sampleGood.trim()) {
    console.error("OPENAI_NEXT_ACTION_UTF8_SELFTEST_FAIL repair_roundtrip");
    ok = false;
  }
  if (hasSilverUtf8MojibakeMarkers(fixed)) {
    console.error("OPENAI_NEXT_ACTION_UTF8_SELFTEST_FAIL mojibake_after_repair");
    ok = false;
  }

  const mockJson = JSON.stringify({
    choices: [{ message: { content: sampleBad } }],
  });
  const coerced = coerceOpenAiChatCompletionText(mockJson);
  if (coerced.content !== sampleGood.trim()) {
    console.error("OPENAI_NEXT_ACTION_UTF8_SELFTEST_FAIL openai_json_coerce");
    ok = false;
  }

  const tempDir = path.join(
    require("os").tmpdir(),
    "silver-openai-next-action-utf8-selftest-" + String(Date.now()),
  );
  fs.mkdirSync(tempDir, { recursive: true });
  const nextPath = path.join(tempDir, "SILVER_NEXT_ACTION.md");
  const md =
    "<!-- SILVER_NEXT_ACTION: selftest -->\n\n" +
    sampleGood;
  writeUtf8FileNoBom(nextPath, md);
  const readBack = fs.readFileSync(nextPath, "utf8");
  if (!readBack.includes("ÚKOL PRO CURSOR")) {
    console.error("OPENAI_NEXT_ACTION_UTF8_SELFTEST_FAIL file_roundtrip_ukol");
    ok = false;
  }
  if (hasSilverUtf8MojibakeMarkers(readBack)) {
    console.error("OPENAI_NEXT_ACTION_UTF8_SELFTEST_FAIL file_roundtrip_mojibake");
    ok = false;
  }
  try {
    fs.rmSync(tempDir, { recursive: true, force: true });
  } catch {
    /* ignore */
  }

  if (ok) console.log("OPENAI_NEXT_ACTION_UTF8_SELFTEST_PASS");
  return ok;
}

module.exports = {
  CZECH_GOOD_CHARS,
  CZECH_BAD_CHARS,
  czechTextScore,
  hasSilverUtf8MojibakeMarkers,
  hasSilverUtf8MojibakeMarkersCore,
  repairSilverUtf8MojibakeText,
  repairSilverOpenAiUtf8Text,
  decodeFetchBodyUtf8,
  parseOpenAiChatCompletionRaw,
  extractOpenAiChatMessageContent,
  coerceOpenAiChatCompletionText,
  writeUtf8FileNoBom,
  runOpenAiNextActionUtf8Selftest,
};
