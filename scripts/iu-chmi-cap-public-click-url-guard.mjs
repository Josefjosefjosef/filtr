#!/usr/bin/env node
/**
 * Guard: every public CHMI card click target is exactly https://vystrahy-cr.chmi.cz/
 * Canonical stays unique (CAP XML + hid). sourceDocumentUrl remains audit-only.
 * publisherWebUrl may hold original CAP <web> (including ovzduší) but never drives click.
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { parseCapAlertXml } from "./chmi-cap-v2/parse-cap.mjs";
import { buildCapIdentity } from "./chmi-cap-v2/identity.mjs";
import {
  chmiUnifiedPublicClickUrl,
  isPublishableChmiItem,
  revisionsToFeed,
} from "./chmi-cap-v2/normalize-feed.mjs";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const FIX = path.join(REPO, "scripts/fixtures/chmi-cap-v2");
const FEED = path.join(REPO, "projects/data/info_events/feed.json");
const UI = path.join(REPO, "assets/iu-prehled-dne-ui-v1.js");
const fails = [];
function ok(name, cond, detail) {
  if (!cond) fails.push(name + (detail != null ? "=" + detail : ""));
}

const PORTAL = "https://vystrahy-cr.chmi.cz/";
ok("unified_helper", chmiUnifiedPublicClickUrl() === PORTAL, chmiUnifiedPublicClickUrl());

const ui = fs.readFileSync(UI, "utf8");
ok("ui_forces_portal", /https:\/\/vystrahy-cr\.chmi\.cz\//.test(ui) && /chmiPublicDetailUrl/.test(ui), "ui");
ok("ui_never_opens_xml_comment", /Never open CAP XML/.test(ui), "xml ban");
ok("ui_chmi_no_xml_fallback", /never fall back to XML/.test(ui), "fallback");

const feed = JSON.parse(fs.readFileSync(FEED, "utf8"));
const chmi = (feed.items || []).filter((i) => i && i.sourceId === "chmi" && isPublishableChmiItem(i));
ok("feed_chmi_present", chmi.length >= 1, String(chmi.length));
ok(
  "feed_all_public_portal",
  chmi.every((i) => String(i.publicUrl || "") === PORTAL && String(i.url || "") === PORTAL),
  chmi.filter((i) => i.publicUrl !== PORTAL).map((i) => i.id).slice(0, 5).join(",")
);
ok(
  "feed_no_xml_public",
  chmi.every((i) => !/\.xml/i.test(String(i.url || "")) && !/\.xml/i.test(String(i.publicUrl || ""))),
  "xml"
);
ok(
  "feed_source_xml_audit",
  chmi.every((i) => /\.xml/i.test(String(i.capV2 && i.capV2.sourceDocumentUrl))),
  "sourceDocumentUrl"
);
ok(
  "feed_canonical_unique_not_portal",
  new Set(chmi.map((i) => i.canonicalUrl)).size === chmi.length &&
    chmi.every((i) => !/vystrahy-cr\.chmi\.cz\/?$/i.test(String(i.canonicalUrl || ""))),
  "canon"
);
ok(
  "feed_no_ovzdusi_public",
  chmi.every((i) => !/ovzdusi\.chmi\.cz/i.test(String(i.url || "")) && !/ovzdusi\.chmi\.cz/i.test(String(i.publicUrl || ""))),
  "ovzdusi"
);

// Synthetic: with web, without web, ovzduší web, smog open-ended, scheduled
const baseRev = {
  cap_message_id: "capmsg:puburl|t|2026-07-30T10:00:00+02:00",
  alert_thread_id: "thread:puburl",
  identifier: "puburl-id",
  sent: "2026-07-30T10:00:00+02:00",
  published_at: "2026-07-30T10:00:00+02:00",
  msgType: "Alert",
  status: "Actual",
  sourceUrl: "https://opendata.chmi.cz/meteorology/weather/alerts/cap/alert_cap_50_pub.xml",
};
const geo = {
  links: [{ orpName: "Praha", orpId: "orp:1000", orpCode: "1000", precise: true, krajName: "Hlavní město Praha" }],
  displayNames: ["Praha"],
};
function itemFor(h) {
  return revisionsToFeed([{ ...baseRev, hazards: [h] }], { nowIso: "2026-07-30T15:00:00+02:00" })[0];
}

const withWeb = itemFor({
  hazard_instance_id: "haz:pubwithweb000001",
  event: "Vysoké teploty",
  severity: "Moderate",
  valid_from: "2026-07-30T08:00:00+02:00",
  valid_to: "2026-07-31T12:00:00+02:00",
  web: "https://vystrahy-cr.chmi.cz/",
  geo,
});
ok("with_web_portal", withWeb && withWeb.publicUrl === PORTAL && withWeb.url === PORTAL, withWeb && withWeb.url);
ok("with_web_publisher", withWeb && withWeb.publisherWebUrl === PORTAL, withWeb && withWeb.publisherWebUrl);

const noWeb = itemFor({
  hazard_instance_id: "haz:pubnoweb00000001",
  event: "Riziko požárů",
  severity: "Moderate",
  valid_from: "2026-07-30T08:00:00+02:00",
  valid_to: "",
  untilRevoked: true,
  web: "",
  geo,
});
ok("no_web_still_portal", noWeb && noWeb.publicUrl === PORTAL && noWeb.url === PORTAL, noWeb && noWeb.url);
ok("no_web_no_xml_click", noWeb && !/\.xml/i.test(noWeb.url), noWeb && noWeb.url);
ok("no_web_source_xml", noWeb && /\.xml/i.test(noWeb.capV2.sourceDocumentUrl), "src");

const ovzdusi = itemFor({
  hazard_instance_id: "haz:pubovzdusi000001",
  event: "Smogová situace – troposférický ozón O₃",
  severity: "Moderate",
  valid_from: "2026-07-30T13:12:00+02:00",
  valid_to: "",
  untilRevoked: true,
  web: "https://ovzdusi.chmi.cz/SVRS.php?showPol=O3",
  geo,
});
ok("smog_public_portal", ovzdusi && ovzdusi.publicUrl === PORTAL && ovzdusi.url === PORTAL, ovzdusi && ovzdusi.url);
ok(
  "smog_publisher_kept",
  ovzdusi && /ovzdusi\.chmi\.cz/i.test(String(ovzdusi.publisherWebUrl || "")),
  ovzdusi && ovzdusi.publisherWebUrl
);

const future = itemFor({
  hazard_instance_id: "haz:pubfuture0000001",
  event: "Extrémní zátěž teplem",
  severity: "Extreme",
  valid_from: "2026-07-31T00:00:00+02:00",
  valid_to: "2026-08-01T00:00:00+02:00",
  web: "https://vystrahy-cr.chmi.cz/",
  geo,
});
ok("future_portal", future && future.status === "naplanovano" && future.publicUrl === PORTAL, future && future.status);

// Fixture open-ended snapshot: all publishable use portal
const snapXml = fs.readFileSync(path.join(FIX, "alert-open-ended-2026-07-30.xml"), "utf8");
const alert = parseCapAlertXml(snapXml);
const id = buildCapIdentity(alert);
const snapFeed = revisionsToFeed(
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
        geo: {
          links: [{ orpName: "Praha", orpId: "orp:1000", orpCode: "1000", precise: true, krajName: "Hlavní město Praha" }],
          displayNames: ["Praha"],
        },
      })),
    },
  ],
  { nowIso: "2026-07-30T15:00:00+02:00" }
).filter((i) => isPublishableChmiItem(i));
ok("snap_all_portal", snapFeed.every((i) => i.publicUrl === PORTAL), String(snapFeed.length));
ok("snap_no_xml_click", snapFeed.every((i) => !/\.xml/i.test(i.url)), "xml");

// Regression: shared groupKey must not collapse distinct CHMI CAP segments in the UI filter.
{
  const corePath = path.join(REPO, "assets/iu-info-system-core-v1.js");
  const coreSrc = fs.readFileSync(corePath, "utf8");
  ok(
    "core_no_chmi_segment_cluster",
    /Never collapse by shared event-day groupKey/.test(coreSrc) &&
      /ev\.capV2 \|\| String\(ev\.sourceId \|\| ""\) === "chmi"/.test(coreSrc),
    "dedupeCluster"
  );
  ok(
    "feed_unique_ids_gt_groupkeys",
    new Set(chmi.map((i) => i.id)).size === chmi.length &&
      new Set(chmi.map((i) => i.groupKey)).size < chmi.length,
    "segments_share_groupKey_but_keep_unique_ids"
  );
}

if (fails.length) {
  console.error("IU_CHMI_CAP_PUBLIC_CLICK_URL_GUARD=FAIL");
  for (const f of fails) console.error("FAIL " + f);
  process.exit(1);
}
console.log("IU_CHMI_CAP_PUBLIC_CLICK_URL_GUARD=PASS");
console.log("portal=" + PORTAL);
console.log("feed_chmi=" + chmi.length);
process.exit(0);
