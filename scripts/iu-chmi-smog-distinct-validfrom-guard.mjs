#!/usr/bin/env node
/**
 * Guard: open-ended smog (O₃) segments with distinct validFrom must not collapse.
 *
 * Frozen CAP chain (2026-07-31):
 *   A alert-smog-oustecky-1125.xml — Ústecký 16 ORP, onset 11:25:23+02:00
 *   B alert-smog-expand-praha-sc-1317.xml — Praha+SČ+Ústecký 43 ORP, onset 13:17:45+02:00
 *
 * Expected after split: 2 segments (16 @ 11:25, 27 @ 13:17), never 43 @ 13:17 only.
 * Negative: same onset expand may remain one segment with 43 unique ORP.
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { processCapDocuments } from "./chmi-cap-v2/sync-core.mjs";
import { createGeoRegistry } from "./chmi-cap-v2/geo-registry.mjs";
import { latestRevisionForThread } from "./chmi-cap-v2/revisions.mjs";
import {
  isPublishableChmiItem,
  mergeFeedItemsById,
  normalizeCapInstant,
  revisionsToFeed,
  splitOpenEndedByPriorTerritoryOnset,
} from "./chmi-cap-v2/normalize-feed.mjs";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const FIX = path.join(REPO, "scripts/fixtures/chmi-cap-v2");
const fails = [];
function ok(name, cond, detail) {
  if (!cond) fails.push(name + (detail != null ? "=" + detail : ""));
}

function read(name) {
  return fs.readFileSync(path.join(FIX, name), "utf8");
}

function toFeed(xml, sourceUrl, nowIso) {
  const one = processCapDocuments([{ xml, sourceUrl }], {
    registry: createGeoRegistry(),
    receivedAt: nowIso,
  });
  const tids = [...new Set(one.report.revisions.map((r) => r.alert_thread_id))];
  const revs = tids.map((tid) => latestRevisionForThread(one.store, tid)).filter(Boolean);
  return mergeFeedItemsById(revisionsToFeed(revs, { nowIso })).filter((i) => isPublishableChmiItem(i));
}

const nowA = "2026-07-31T12:00:00.000Z";
const nowB = "2026-07-31T12:30:00.000Z";

const feedA = toFeed(
  read("alert-smog-oustecky-1125.xml"),
  "https://opendata.chmi.cz/meteorology/weather/alerts/cap/alert-smog-oustecky-1125.xml",
  nowA
);
const smogA = feedA.filter((i) => /smogov/i.test((i.capV2 && i.capV2.event) || i.title || ""));
ok("a_smog_count_1", smogA.length === 1, String(smogA.length));
ok("a_orp_16", smogA[0] && (smogA[0].region.orpIds || []).length === 16, smogA[0] && String((smogA[0].region.orpIds || []).length));
ok(
  "a_validFrom_1125",
  smogA[0] && normalizeCapInstant(smogA[0].validFrom) === normalizeCapInstant("2026-07-31T11:25:23+02:00"),
  smogA[0] && smogA[0].validFrom
);

const feedB = toFeed(
  read("alert-smog-expand-praha-sc-1317.xml"),
  "https://opendata.chmi.cz/meteorology/weather/alerts/cap/alert-smog-expand-praha-sc-1317.xml",
  nowB
);
const smogBraw = feedB.filter((i) => /smogov/i.test((i.capV2 && i.capV2.event) || i.title || ""));
ok("b_raw_smog_1", smogBraw.length === 1, String(smogBraw.length));
ok("b_raw_orp_43", smogBraw[0] && (smogBraw[0].region.orpIds || []).length === 43, smogBraw[0] && String((smogBraw[0].region.orpIds || []).length));

const split = splitOpenEndedByPriorTerritoryOnset(feedA, feedB, { nowIso: nowB, ledger: {} });
const smogSplit = (split.items || []).filter((i) => /smogov/i.test((i.capV2 && i.capV2.event) || i.title || ""));
ok("split_smog_2", smogSplit.length === 2, String(smogSplit.length));
const byVf = Object.fromEntries(
  smogSplit.map((i) => [normalizeCapInstant(i.validFrom), (i.region.orpIds || []).length])
);
ok(
  "split_has_1125_16",
  byVf[normalizeCapInstant("2026-07-31T11:25:23+02:00")] === 16,
  JSON.stringify(byVf)
);
ok(
  "split_has_1317_27",
  byVf[normalizeCapInstant("2026-07-31T13:17:45+02:00")] === 27,
  JSON.stringify(byVf)
);
ok("split_ids_distinct", new Set(smogSplit.map((i) => i.id)).size === 2, smogSplit.map((i) => i.id).join(","));
ok(
  "split_no_43_card",
  !smogSplit.some((i) => (i.region.orpIds || []).length === 43),
  smogSplit.map((i) => (i.region.orpIds || []).length).join(",")
);

// Negative: same onset → may stay one card with 43 ORP
const feedSame = toFeed(
  read("alert-smog-expand-same-onset-1125.xml"),
  "https://opendata.chmi.cz/meteorology/weather/alerts/cap/alert-smog-expand-same-onset-1125.xml",
  nowB
);
const sameSplit = splitOpenEndedByPriorTerritoryOnset(feedA, feedSame, { nowIso: nowB, ledger: {} });
const smogSame = (sameSplit.items || []).filter((i) => /smogov/i.test((i.capV2 && i.capV2.event) || i.title || ""));
ok("same_onset_one_segment", smogSame.length === 1, String(smogSame.length));
ok(
  "same_onset_orp_43",
  smogSame[0] && (smogSame[0].region.orpIds || []).length === 43,
  smogSame[0] && String((smogSame[0].region.orpIds || []).length)
);

// Instant identity: Z vs +02:00 same moment
ok(
  "instant_z_eq_offset",
  normalizeCapInstant("2026-07-31T11:25:23+02:00") === normalizeCapInstant("2026-07-31T09:25:23.000Z"),
  "tz"
);

// One-second difference must not collapse
ok(
  "instant_one_sec_diff",
  normalizeCapInstant("2026-07-31T13:17:45+02:00") !== normalizeCapInstant("2026-07-31T13:17:46+02:00"),
  "1s"
);

const src = fs.readFileSync(path.join(REPO, "scripts/chmi-cap-v2-prod-sync.mjs"), "utf8");
ok("prod_sync_wires_split", /splitOpenEndedByPriorTerritoryOnset/.test(src), "wire");
ok("prod_sync_ledger_state", /openEndedOrpOnset/.test(src), "ledger");

if (fails.length) {
  console.error("IU_CHMI_SMOG_DISTINCT_VALIDFROM_GUARD=FAIL");
  for (const f of fails) console.error("FAIL " + f);
  process.exit(1);
}
console.log("IU_CHMI_SMOG_DISTINCT_VALIDFROM_GUARD=PASS");
console.log(
  "split=" +
    JSON.stringify(
      smogSplit.map((i) => ({
        id: i.id,
        validFrom: i.validFrom,
        orp: (i.region.orpIds || []).length,
        title: i.title,
      }))
    )
);
