#!/usr/bin/env node
/**
 * Guard the generic open-ended → timed → open-ended territory handoff.
 * The fixture uses ORP 6208 but production matching is event semantics + time.
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import {
  applyTerritoryOnsetLedgerToFeed,
  buildTerritoryOnsetLedgerFromOrderedDocuments,
} from "./chmi-cap-v2/territory-onset-ledger.mjs";
import { isPublishableChmiItem, normalizeCapInstant } from "./chmi-cap-v2/normalize-feed.mjs";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const FIX = path.join(REPO, "scripts/fixtures/chmi-cap-v2");
const base = "https://opendata.chmi.cz/meteorology/weather/alerts/cap/";
const nowIso = "2026-07-29T13:00:00.000Z";
const oldOnset = "2026-07-20T10:00:00+02:00";
const newOnset = "2026-07-30T00:00:00+02:00";
const files = [
  "alert-fire-handoff-open.xml",
  "alert-fire-handoff-timed-open.xml",
  "alert-fire-handoff-head.xml",
];
const docs = files.map((name, index) => ({
  name,
  mtime: index,
  sourceUrl: base + name,
  xml: fs.readFileSync(path.join(FIX, name), "utf8"),
}));
const fails = [];
function ok(name, condition, detail) {
  if (!condition) fails.push(name + (detail != null ? "=" + detail : ""));
}
function coldStart() {
  const built = buildTerritoryOnsetLedgerFromOrderedDocuments(docs, { nowIso, seedLedger: {} });
  const head = (built.itemsByStep.at(-1) || []).filter(isPublishableChmiItem);
  return applyTerritoryOnsetLedgerToFeed([], head, built.ledger, { nowIso });
}

const first = coldStart();
const second = coldStart();
const fire = (first.items || []).filter((item) => /riziko požárů/i.test((item.capV2 && item.capV2.event) || item.title || ""));
const item6208 = fire.find((item) =>
  (item.region && item.region.orpIds || []).some((orp) => String(orp).replace(/^orp:/, "") === "6208")
);
const onset = item6208 && normalizeCapInstant(item6208.validFrom);
const firstIds = (first.items || []).map((item) => item.id).sort();
const secondIds = (second.items || []).map((item) => item.id).sort();

ok("one_current_fire_segment", fire.length === 1, String(fire.length));
ok("orp_6208_present", !!item6208, "6208");
ok("handoff_sets_new_onset", onset === normalizeCapInstant(newOnset), onset);
ok("handoff_does_not_keep_old_onset", onset !== normalizeCapInstant(oldOnset), onset);
ok("cold_start_ids_deterministic", JSON.stringify(firstIds) === JSON.stringify(secondIds), firstIds.join(","));

if (fails.length) {
  console.error("IU_CHMI_FIRE_ONSET_HANDOFF_GUARD=FAIL");
  for (const failure of fails) console.error("FAIL " + failure);
  process.exit(1);
}
console.log("IU_CHMI_FIRE_ONSET_HANDOFF_GUARD=PASS");
console.log("orp=6208");
console.log("firstContinuousValidFrom=" + item6208.validFrom);
console.log("ids=" + firstIds.join(","));
