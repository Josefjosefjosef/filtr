#!/usr/bin/env node
/**
 * Frozen regression for ČHMÚ open-ended / segmentation / public URL (2026-07-30 snapshot semantics).
 * Clock is frozen — not dependent on wall-clock day of the test run.
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { parseCapAlertXml } from "./chmi-cap-v2/parse-cap.mjs";
import { buildCapIdentity, isChmiOutlookProductEvent, resolveExpiresFromSiblingInfos } from "./chmi-cap-v2/identity.mjs";
import {
  classifyChmiTemporalState,
  isPublishableChmiItem,
  revisionsToFeed,
} from "./chmi-cap-v2/normalize-feed.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIX = path.join(__dirname, "fixtures/chmi-cap-v2");
const fails = [];
function ok(name, cond, detail) {
  if (!cond) fails.push(name + (detail != null ? "=" + detail : ""));
}

const FROZEN = "2026-07-30T15:00:00+02:00";
const FROZEN_MS = Date.parse(FROZEN);

const xml = fs.readFileSync(path.join(FIX, "alert-open-ended-2026-07-30.xml"), "utf8");
const alert = parseCapAlertXml(xml);
const id = buildCapIdentity(alert);

ok("snapshot_info_count_27", (alert.infos || []).length === 27, String((alert.infos || []).length));
ok("snapshot_hazard_count_27", id.hazards.length === 27, String(id.hazards.length));

const outlook = id.hazards.filter((h) => isChmiOutlookProductEvent(h.event));
const concrete = id.hazards.filter((h) => !isChmiOutlookProductEvent(h.event));
ok("snapshot_outlook_eq_1", outlook.length === 1, String(outlook.length));
ok("snapshot_concrete_eq_26", concrete.length === 26, String(concrete.length));

const smog = concrete.filter((h) => /smog|oz[oó]n|O₃|O3/i.test(h.event || ""));
ok("snapshot_smog_present", smog.length === 1 && smog[0].untilRevoked === true, smog[0] && smog[0].event);

const openEnded = concrete.filter((h) => h.untilRevoked);
ok("snapshot_open_ended_ge_4", openEnded.length >= 4, String(openEnded.length));

const { filled } = resolveExpiresFromSiblingInfos(alert.infos || []);
ok("snapshot_no_cross_segment_sibling_fill", filled === 0, String(filled));

const feed = revisionsToFeed(
  [
    {
      cap_message_id: id.cap_message_id,
      alert_thread_id: id.alert_thread_id,
      identifier: alert.identifier,
      sent: alert.sent,
      published_at: alert.sent,
      msgType: alert.msgType,
      status: alert.status,
      sourceUrl: "https://opendata.chmi.cz/meteorology/weather/alerts/cap/alert_cap_50_20260730.xml",
      hazards: id.hazards.map((h) => ({
        ...h,
        web: h.web || "https://vystrahy-cr.chmi.cz/",
        geo: {
          links: (h.areas || []).flatMap((a) =>
            (a.geocodes || [])
              .filter((g) => /cisorp/i.test(g.valueName || ""))
              .map((g) => ({
                orpName: a.areaDesc || g.value,
                orpId: "orp:" + g.value,
                orpCode: g.value,
                precise: true,
                krajName: a.areaDesc || "",
              }))
          ),
          displayNames: (h.areas || []).map((a) => a.areaDesc).filter(Boolean),
        },
      })),
    },
  ],
  { nowIso: FROZEN }
);

const publishable = feed.filter((i) => isPublishableChmiItem(i));
const excluded = feed.filter((i) => i.capV2 && i.capV2.temporalReason === "excluded_product_type");
ok("snapshot_excluded_outlook_eq_1", excluded.length === 1, String(excluded.length));
ok("snapshot_publishable_eq_26", publishable.length === 26, String(publishable.length));
ok(
  "snapshot_smog_in_public",
  publishable.some((i) => /smog|oz[oó]n|O₃|O3/i.test((i.capV2 && i.capV2.event) || i.title || "")),
  "missing smog"
);
ok(
  "snapshot_no_fake_validTo_on_open",
  publishable.filter((i) => i.untilRevoked).every((i) => i.validTo == null || i.validTo === ""),
  "fake validTo"
);
ok(
  "snapshot_public_url_portal",
  publishable.every((i) => String(i.publicUrl || "") === "https://vystrahy-cr.chmi.cz/"),
  "publicUrl"
);
ok(
  "snapshot_canonical_unique",
  new Set(publishable.map((i) => i.canonicalUrl || i.id)).size === publishable.length,
  "canon"
);
ok(
  "snapshot_source_xml_audit",
  publishable.every((i) => /\.xml/i.test(String(i.capV2 && i.capV2.sourceDocumentUrl))),
  "sourceDocumentUrl"
);

// Distinct time windows for same event must not collapse to one card.
const heatStrong = publishable.filter((i) => /Velmi silná zátěž teplem/i.test((i.capV2 && i.capV2.event) || ""));
const heatIntervals = new Set(heatStrong.map((i) => `${i.validFrom}|${i.validTo || "OPEN"}`));
ok("snapshot_heat_intervals_kept", heatIntervals.size >= 5, String(heatIntervals.size));

const future = publishable.filter((i) => i.status === "naplanovano");
ok("snapshot_future_present", future.length >= 5, String(future.length));

const clsOpen = classifyChmiTemporalState({
  validFrom: "2026-07-30T13:12:00+02:00",
  validTo: "",
  untilRevoked: true,
  nowMs: FROZEN_MS,
});
ok("classify_open_active", clsOpen.status === "aktivni" && clsOpen.untilRevoked === true, clsOpen.reason);

if (fails.length) {
  console.error("IU_CHMI_CAP_OPEN_ENDED_SNAPSHOT_GUARD=FAIL");
  for (const f of fails) console.error("FAIL " + f);
  process.exit(1);
}
console.log("IU_CHMI_CAP_OPEN_ENDED_SNAPSHOT_GUARD=PASS");
console.log("frozen_now=" + FROZEN);
console.log("infos=27 concrete=26 outlook=1 publishable=" + publishable.length);
process.exit(0);
