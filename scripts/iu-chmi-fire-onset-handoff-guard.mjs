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
import { mergeOnsetLedgersPreferPrimary } from "./chmi-cap-v2/revision-chain-history.mjs";

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
ok(
  "handoff_rejects_pre_break_legacy_onsets",
  onset !== normalizeCapInstant("2026-07-19T14:48:30+02:00") &&
    onset !== normalizeCapInstant("2026-07-19T15:26:21+02:00") &&
    onset !== normalizeCapInstant("2026-07-30T11:37:29+02:00"),
  onset
);
ok("cold_start_ids_deterministic", JSON.stringify(firstIds) === JSON.stringify(secondIds), firstIds.join(","));

// Persisted pre-handoff onset must not resurrect when merging with history ledger.
const built = buildTerritoryOnsetLedgerFromOrderedDocuments(docs, { nowIso, seedLedger: {} });
const primarySem = Object.keys(built.ledger || {}).find((k) => /until-revoked/.test(k));
ok("history_ledger_has_sem", !!primarySem, Object.keys(built.ledger || {}).join("|"));
const stalePersisted = primarySem
  ? {
      [primarySem]: {
        "orp:6208": { validFrom: oldOnset, itemId: "stale", sourceDocument: "stale" },
      },
    }
  : {};
const merged = mergeOnsetLedgersPreferPrimary(built.ledger, stalePersisted);
const mergedOnset = primarySem && merged[primarySem] && merged[primarySem]["orp:6208"] && merged[primarySem]["orp:6208"].validFrom;
ok(
  "persist_merge_keeps_handoff_onset",
  normalizeCapInstant(mergedOnset) === normalizeCapInstant(newOnset),
  String(mergedOnset)
);

// Production sync evaluates days after the handoff midnight. Wall-clock "now"
// must not prevent detecting the timed→open-ended restart in history.
const lateNow = "2026-07-31T20:00:00.000Z";
const lateBuilt = buildTerritoryOnsetLedgerFromOrderedDocuments(docs, { nowIso: lateNow, seedLedger: {} });
const lateHead = (lateBuilt.itemsByStep.at(-1) || []).filter(isPublishableChmiItem);
const lateFeed = applyTerritoryOnsetLedgerToFeed([], lateHead, lateBuilt.ledger, { nowIso: lateNow });
const lateFire = (lateFeed.items || []).filter((item) =>
  /riziko požárů/i.test((item.capV2 && item.capV2.event) || item.title || "")
);
const late6208 = lateFire.find((item) =>
  (item.region && item.region.orpIds || []).some((orp) => String(orp).replace(/^orp:/, "") === "6208")
);
const lateOnset = late6208 && normalizeCapInstant(late6208.validFrom);
ok("late_sync_handoff_sets_new_onset", lateOnset === normalizeCapInstant(newOnset), lateOnset);
ok("late_sync_does_not_keep_old_onset", lateOnset !== normalizeCapInstant(oldOnset), lateOnset);

// Stale published feed cards must not resurrect pre-handoff onset via earliest-wins.
const stalePrev = [
  {
    id: "ie-chmi-v2-stale-prev",
    sourceId: "chmi",
    title: "Riziko požárů — Ivančice",
    validFrom: oldOnset,
    untilRevoked: true,
    region: { orpIds: ["orp:6208"] },
    capV2: {
      event: "Riziko požárů",
      severity: "Moderate",
      urgency: "Immediate",
      certainty: "Likely",
      untilRevoked: true,
    },
  },
];
const againstStale = applyTerritoryOnsetLedgerToFeed(stalePrev, lateHead, lateBuilt.ledger, {
  nowIso: lateNow,
});
const againstStale6208 = (againstStale.items || []).find((item) =>
  /riziko požárů/i.test((item.capV2 && item.capV2.event) || item.title || "") &&
  (item.region && item.region.orpIds || []).some((orp) => String(orp).replace(/^orp:/, "") === "6208")
);
ok(
  "stale_prev_feed_does_not_resurrect_old_onset",
  againstStale6208 && normalizeCapInstant(againstStale6208.validFrom) === normalizeCapInstant(newOnset),
  againstStale6208 && againstStale6208.validFrom
);

if (fails.length) {
  console.error("IU_CHMI_FIRE_ONSET_HANDOFF_GUARD=FAIL");
  for (const failure of fails) console.error("FAIL " + failure);
  process.exit(1);
}
console.log("IU_CHMI_FIRE_ONSET_HANDOFF_GUARD=PASS");
console.log("orp=6208");
console.log("firstContinuousValidFrom=" + item6208.validFrom);
console.log("ids=" + firstIds.join(","));
