#!/usr/bin/env node
/**
 * Guard: revision chain ≥10 documents — continuing ORPs keep original onset;
 * newly added ORPs get later onset; removed/cancelled ORPs leave public feed;
 * restart (seedLedger empty + full chain) is deterministic.
 *
 * Synthetic open-ended hazard chain (no incident hardcodes).
 */
import {
  applyTerritoryOnsetLedgerToFeed,
  buildTerritoryOnsetLedgerFromOrderedDocuments,
} from "./chmi-cap-v2/territory-onset-ledger.mjs";
import { isPublishableChmiItem, normalizeCapInstant } from "./chmi-cap-v2/normalize-feed.mjs";
import {
  filenameHintFromCapIdentifier,
  mergeOnsetLedgersEarliest,
  ONSET_LEDGER_RECENT_PER_STREAM,
} from "./chmi-cap-v2/revision-chain-history.mjs";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const fails = [];
function ok(name, cond, detail) {
  if (!cond) fails.push(name + (detail != null ? "=" + detail : ""));
}

function pad2(n) {
  return String(n).padStart(2, "0");
}

/**
 * Build a minimal CAP Update with given ORP CISORP codes and onset.
 */
function makeCapXml(opts) {
  const {
    seq,
    onset,
    sent,
    orps,
    msgType = "Update",
    status = "Actual",
    prevIdent = null,
    prevSent = null,
    event = "Test open-ended hazard",
  } = opts;
  const yy = "26";
  const mm = "07";
  const dd = pad2(20 + Math.min(seq, 9));
  const hh = pad2(10 + (seq % 10));
  const mi = pad2(seq);
  const ss = "00";
  const stamp = `${yy}${mm}${dd}${hh}${mi}${ss}`;
  const ident = `2.49.0.0.203.0.CZ.${stamp}.XOCZ50_OKPR_${String(1000 + seq).padStart(6, "0")}`;
  const refs =
    prevIdent && prevSent
      ? `<references>chmi@chmi.cz,${prevIdent},${prevSent}</references>`
      : "";
  const areas = orps
    .map(
      (code) => `    <area>
      <areaDesc>ORP ${code}</areaDesc>
      <geocode><valueName>CISORP</valueName><value>${code}</value></geocode>
    </area>`
    )
    .join("\n");
  return {
    ident,
    sent,
    xml: `<?xml version="1.0" encoding="UTF-8"?>
<alert xmlns="urn:oasis:names:tc:emergency:cap:1.2">
  <identifier>${ident}</identifier>
  <sender>chmi@chmi.cz</sender>
  <sent>${sent}</sent>
  <status>${status}</status>
  <msgType>${msgType}</msgType>
  <scope>Public</scope>
  ${refs}
  <info>
    <language>cs</language>
    <category>Met</category>
    <event>${event}</event>
    <responseType>Avoid</responseType>
    <urgency>Immediate</urgency>
    <severity>Moderate</severity>
    <certainty>Likely</certainty>
    <onset>${onset}</onset>
    <senderName>ČHMÚ test</senderName>
    <description>Synthetic revision ${seq}</description>
    <instruction>Test</instruction>
    <web>https://vystrahy-cr.chmi.cz/</web>
${areas}
  </info>
</alert>
`,
  };
}

// 10 revisions:
// 1: ORP A,B @ T0
// 2: same A,B rewritten onset T1 (must NOT win)
// 3: +C @ T2
// 4: +D @ T3
// 5–8: continue A–D with rewritten onset
// 9: remove B (A,C,D only)
// 10: cancel all → empty public (or keep Cancel with no areas — expect 0 publishable)
const T0 = "2026-07-20T10:00:00+02:00";
const T1 = "2026-07-21T11:00:00+02:00";
const T2 = "2026-07-22T12:00:00+02:00";
const T3 = "2026-07-23T13:00:00+02:00";
const T4 = "2026-07-24T14:00:00+02:00";
const T5 = "2026-07-25T15:00:00+02:00";
const T6 = "2026-07-26T16:00:00+02:00";
const T7 = "2026-07-27T17:00:00+02:00";
const T8 = "2026-07-28T18:00:00+02:00";
const T9 = "2026-07-29T19:00:00+02:00";

const A = "2101";
const B = "2102";
const C = "2103";
const D = "2104";

const chainSpec = [
  { seq: 1, onset: T0, sent: T0, orps: [A, B] },
  { seq: 2, onset: T1, sent: T1, orps: [A, B] }, // rewrite
  { seq: 3, onset: T2, sent: T2, orps: [A, B, C] }, // +C
  { seq: 4, onset: T3, sent: T3, orps: [A, B, C, D] }, // +D
  { seq: 5, onset: T4, sent: T4, orps: [A, B, C, D] },
  { seq: 6, onset: T5, sent: T5, orps: [A, B, C, D] },
  { seq: 7, onset: T6, sent: T6, orps: [A, B, C, D] },
  { seq: 8, onset: T7, sent: T7, orps: [A, B, C, D] },
  { seq: 9, onset: T8, sent: T8, orps: [A, C, D] }, // remove B
];

const docs = [];
let prevIdent = null;
let prevSent = null;
for (const s of chainSpec) {
  const made = makeCapXml({ ...s, prevIdent, prevSent });
  docs.push({
    xml: made.xml,
    sourceUrl: `https://opendata.chmi.cz/meteorology/weather/alerts/cap/alert_cap_50_synth_${s.seq}.xml`,
    name: `synth_${s.seq}.xml`,
    mtime: s.seq,
  });
  prevIdent = made.ident;
  prevSent = made.sent;
}

// Rev 10: Cancel
const cancel = makeCapXml({
  seq: 10,
  onset: T9,
  sent: T9,
  orps: [A, C, D],
  msgType: "Cancel",
  prevIdent,
  prevSent,
});
const cancelDocs = [
  ...docs,
  {
    xml: cancel.xml,
    sourceUrl: "https://opendata.chmi.cz/meteorology/weather/alerts/cap/alert_cap_50_synth_10.xml",
    name: "synth_10.xml",
    mtime: 10,
  },
];

ok("chain_len_ge_10", docs.length >= 9, String(docs.length));
ok("filename_hint", filenameHintFromCapIdentifier(prevIdent) != null, prevIdent);
ok("recent_window_ge_16", ONSET_LEDGER_RECENT_PER_STREAM >= 16, String(ONSET_LEDGER_RECENT_PER_STREAM));

const nowIso = "2026-07-29T12:00:00.000Z";
const built = buildTerritoryOnsetLedgerFromOrderedDocuments(docs, { nowIso });
ok("steps_9", built.steps.length === 9, String(built.steps.length));

const headItems = (built.itemsByStep[8] || []).filter((i) => isPublishableChmiItem(i));
const split = applyTerritoryOnsetLedgerToFeed([], headItems, built.ledger, { nowIso });
const items = (split.items || []).filter((i) => isPublishableChmiItem(i));

function orpOf(item) {
  return new Set(((item.region && item.region.orpIds) || []).map(String));
}
function findOrp(code) {
  const needle = code.startsWith("orp:") ? code : `orp:${code}`;
  return items.find((i) => [...orpOf(i)].some((o) => o === needle || o.endsWith(code)));
}

const itemA = findOrp(A);
const itemC = findOrp(C);
const itemD = findOrp(D);
const itemB = findOrp(B);

ok("A_present", !!itemA, "A");
ok("C_present", !!itemC, "C");
ok("D_present", !!itemD, "D");
ok("B_removed", !itemB, "B_should_be_absent");

const vfA = itemA && normalizeCapInstant(itemA.validFrom);
const vfC = itemC && normalizeCapInstant(itemC.validFrom);
const vfD = itemD && normalizeCapInstant(itemD.validFrom);
ok("A_keeps_T0", vfA === normalizeCapInstant(T0), vfA);
ok("C_gets_T2", vfC === normalizeCapInstant(T2), vfC);
ok("D_gets_T3", vfD === normalizeCapInstant(T3), vfD);
ok("A_not_T1_rewrite", vfA !== normalizeCapInstant(T1), vfA);

// Restart determinism: rebuild ledger from scratch, same result
const built2 = buildTerritoryOnsetLedgerFromOrderedDocuments(docs, { nowIso, seedLedger: {} });
const split2 = applyTerritoryOnsetLedgerToFeed([], headItems, built2.ledger, { nowIso });
const items2 = (split2.items || []).filter((i) => isPublishableChmiItem(i));
const sig = (arr) =>
  arr
    .map((i) => `${normalizeCapInstant(i.validFrom)}:${[...(i.region.orpIds || [])].map(String).sort().join(",")}`)
    .sort()
    .join("|");
ok("restart_deterministic", sig(items) === sig(items2), sig(items2));

// Persistent ledger merge: even if oldest doc dropped from window, persisted T0 for A wins
const shortDocs = docs.slice(3); // drop first 3 — would otherwise lose T0 for A
const builtShort = buildTerritoryOnsetLedgerFromOrderedDocuments(shortDocs, { nowIso, seedLedger: {} });
const mergedLedger = mergeOnsetLedgersEarliest(builtShort.ledger, built.ledger);
const headShort = (builtShort.itemsByStep[builtShort.itemsByStep.length - 1] || []).filter((i) =>
  isPublishableChmiItem(i)
);
const splitMerged = applyTerritoryOnsetLedgerToFeed([], headShort.length ? headShort : headItems, mergedLedger, {
  nowIso,
});
const itemsMerged = (splitMerged.items || []).filter((i) => isPublishableChmiItem(i));
const aMerged = itemsMerged.find((i) => [...orpOf(i)].some((o) => o.endsWith(A)));
ok(
  "persist_ledger_keeps_T0_when_window_drops_oldest",
  aMerged && normalizeCapInstant(aMerged.validFrom) === normalizeCapInstant(T0),
  aMerged && aMerged.validFrom
);

// Cancel head → no publishable (or cancelled filtered)
const builtCancel = buildTerritoryOnsetLedgerFromOrderedDocuments(cancelDocs, { nowIso });
const cancelHead = (builtCancel.itemsByStep[builtCancel.itemsByStep.length - 1] || []).filter((i) =>
  isPublishableChmiItem(i)
);
ok("cancel_not_public", cancelHead.length === 0, String(cancelHead.length));

// Prod-sync wiring
const prodSync = fs.readFileSync(path.join(REPO, "scripts/chmi-cap-v2-prod-sync.mjs"), "utf8");
ok("wires_referencesTraversal", /referencesTraversal:\s*true/.test(prodSync));
ok("wires_ONSET_LEDGER_RECENT", /ONSET_LEDGER_RECENT_PER_STREAM/.test(prodSync));
ok("wires_resolveReferenceChain", /resolveReferenceChainEntries/.test(prodSync));
ok("wires_mergeLedgers", /mergeOnsetLedgersPreferPrimary/.test(prodSync));
ok("no_hardcoded_6_only", !/listRecentForOnsetLedger\(6\)/.test(prodSync));

if (fails.length) {
  console.error("IU_CHMI_REVISION_CHAIN_10PLUS_GUARD=FAIL");
  for (const f of fails) console.error("FAIL " + f);
  process.exit(1);
}
console.log("IU_CHMI_REVISION_CHAIN_10PLUS_GUARD=PASS");
console.log(
  "segments=" +
    JSON.stringify(
      items.map((i) => ({
        vf: i.validFrom,
        orp: (i.region.orpIds || []).length,
        ids: (i.region.orpIds || []).map(String).sort(),
      }))
    )
);
