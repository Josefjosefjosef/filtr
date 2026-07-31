#!/usr/bin/env node
/**
 * Guard: open-ended smog segments with distinct firstValidFrom must not collapse.
 * Uses revision-aware ledger (301116 @ 13:12 → expand @ 13:17).
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
const fails = [];
function ok(name, cond, detail) {
  if (!cond) fails.push(name + (detail != null ? "=" + detail : ""));
}

function read(name) {
  return fs.readFileSync(path.join(FIX, name), "utf8");
}

const base = "https://opendata.chmi.cz/meteorology/weather/alerts/cap/";
const nowIso = "2026-07-31T12:30:00.000Z";
const docs = [
  {
    xml: read("alert-smog-oustecky-301116-1312.xml"),
    sourceUrl: base + "alert-smog-oustecky-301116-1312.xml",
  },
  {
    xml: read("alert-smog-expand-praha-sc-1317.xml"),
    sourceUrl: base + "alert-smog-expand-praha-sc-1317.xml",
  },
];
const built = buildTerritoryOnsetLedgerFromOrderedDocuments(docs, { nowIso });
const head = (built.itemsByStep[1] || []).filter(isPublishableChmiItem);
const split = applyTerritoryOnsetLedgerToFeed([], head, built.ledger, { nowIso });
const smog = (split.items || []).filter((i) => /smogov/i.test((i.capV2 && i.capV2.event) || i.title || ""));
ok("split_smog_2", smog.length === 2, String(smog.length));
const byVf = Object.fromEntries(
  smog.map((i) => [normalizeCapInstant(i.validFrom), (i.region.orpIds || []).length])
);
ok(
  "split_has_1312_16",
  byVf[normalizeCapInstant("2026-07-30T13:12:59+02:00")] === 16,
  JSON.stringify(byVf)
);
ok(
  "split_has_1317_27",
  byVf[normalizeCapInstant("2026-07-31T13:17:45+02:00")] === 27,
  JSON.stringify(byVf)
);
ok("split_ids_distinct", new Set(smog.map((i) => i.id)).size === 2, smog.map((i) => i.id).join(","));

// Same-onset expand may stay one card — use older fixture with shared onset
const sameDocs = [
  {
    xml: read("alert-smog-oustecky-1125.xml"),
    sourceUrl: base + "alert-smog-oustecky-1125.xml",
  },
  {
    xml: read("alert-smog-expand-same-onset-1125.xml"),
    sourceUrl: base + "alert-smog-expand-same-onset-1125.xml",
  },
];
const sameBuilt = buildTerritoryOnsetLedgerFromOrderedDocuments(sameDocs, { nowIso });
const sameHead = (sameBuilt.itemsByStep[1] || []).filter(isPublishableChmiItem);
const sameSplit = applyTerritoryOnsetLedgerToFeed([], sameHead, sameBuilt.ledger, { nowIso });
const smogSame = (sameSplit.items || []).filter((i) =>
  /smogov/i.test((i.capV2 && i.capV2.event) || i.title || "")
);
ok("same_onset_one_segment", smogSame.length === 1, String(smogSame.length));
ok(
  "same_onset_orp_43",
  smogSame[0] && (smogSame[0].region.orpIds || []).length === 43,
  smogSame[0] && String((smogSame[0].region.orpIds || []).length)
);

ok(
  "instant_z_eq_offset",
  normalizeCapInstant("2026-07-30T13:12:59+02:00") === normalizeCapInstant("2026-07-30T11:12:59.000Z"),
  "tz"
);

const src = fs.readFileSync(path.join(REPO, "scripts/chmi-cap-v2-prod-sync.mjs"), "utf8");
ok("prod_sync_wires_split", /applyTerritoryOnsetLedgerToFeed|splitOpenEndedByPriorTerritoryOnset/.test(src));
ok("prod_sync_ledger_state", /openEndedOrpOnset/.test(src));

if (fails.length) {
  console.error("IU_CHMI_SMOG_DISTINCT_VALIDFROM_GUARD=FAIL");
  for (const f of fails) console.error("FAIL " + f);
  process.exit(1);
}
console.log("IU_CHMI_SMOG_DISTINCT_VALIDFROM_GUARD=PASS");
console.log(
  "split=" +
    JSON.stringify(
      smog.map((i) => ({
        id: i.id,
        validFrom: i.validFrom,
        orp: (i.region.orpIds || []).length,
        title: i.title,
      }))
    )
);
