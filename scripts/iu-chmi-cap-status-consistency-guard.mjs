#!/usr/bin/env node
/**
 * CHMI CAP temporal status consistency guard.
 * Asserts pipeline status / temporalState / badge / publishability stay aligned,
 * and that status=aktivni is never used for scheduled/expired/invalid items.
 *
 * Frozen clock — not dependent on wall-clock now.
 */
import {
  classifyChmiTemporalState,
  isPublishableChmiItem,
  refreshItemTemporalFields,
  revisionsToFeed,
} from "./chmi-cap-v2/normalize-feed.mjs";

const fails = [];
function ok(name, cond, detail) {
  if (!cond) fails.push(name + (detail != null ? "=" + detail : ""));
}

const FROZEN = "2026-07-30T12:00:00+02:00";
const FROZEN_MS = Date.parse(FROZEN);

const baseRev = {
  cap_message_id: "capmsg:guard|status|2026-07-30T10:00:00+02:00",
  alert_thread_id: "thread:status-guard",
  identifier: "status-guard-id",
  sent: "2026-07-30T10:00:00+02:00",
  published_at: "2026-07-30T10:00:00+02:00",
  msgType: "Alert",
  status: "Actual",
  sourceUrl: "https://opendata.chmi.cz/meteorology/weather_reports/cap/alert_cap_50_status.xml",
  hazards: [],
};

function feedFor(hazard, nowIso = FROZEN) {
  return revisionsToFeed(
    [
      {
        ...baseRev,
        hazards: [hazard],
      },
    ],
    { nowIso }
  );
}

const activeH = {
  hazard_instance_id: "haz:statusactive00001",
  event: "Bouřky",
  severity: "Moderate",
  urgency: "Immediate",
  certainty: "Likely",
  valid_from: "2026-07-30T08:00:00+02:00",
  valid_to: "2026-07-30T20:00:00+02:00",
  headline: "Bouřky",
  web: "https://vystrahy-cr.chmi.cz/",
  geo: {
    links: [{ orpName: "Praha", orpId: "orp:1000", orpCode: "1000", precise: true, krajName: "Hlavní město Praha" }],
    displayNames: ["Praha"],
  },
};

{
  const items = feedFor(activeH);
  const it = items[0];
  ok("active_status", it && it.status === "aktivni", it && it.status);
  ok("active_temporal", it && it.capV2.temporalState === "active", it && it.capV2.temporalState);
  ok("active_badge", it && it.capV2.badgeActive === true, "badge");
  ok("active_publishable", it && isPublishableChmiItem(it), "publishable");
}

{
  const items = feedFor({
    ...activeH,
    hazard_instance_id: "haz:statussched000001",
    valid_from: "2026-07-31T00:00:00+02:00",
    valid_to: "2026-07-31T12:00:00+02:00",
  });
  const it = items[0];
  ok("scheduled_not_aktivni", it && it.status === "naplanovano", it && it.status);
  ok("scheduled_temporal", it && it.capV2.temporalState === "scheduled", it && it.capV2.temporalState);
  ok("scheduled_badge_off", it && it.capV2.badgeActive === false, "badge");
  ok("scheduled_publishable", it && isPublishableChmiItem(it), "publishable");
  ok("scheduled_not_active_count_semantics", it && it.status !== "aktivni", it && it.status);
}

{
  const items = feedFor({
    ...activeH,
    hazard_instance_id: "haz:statusended000001",
    valid_from: "2026-07-29T00:00:00+02:00",
    valid_to: "2026-07-29T18:00:00+02:00",
  });
  const it = items[0];
  ok("expired_status", it && it.status === "ukonceno", it && it.status);
  ok("expired_badge_off", it && it.capV2.badgeActive === false, "badge");
  ok("expired_not_publishable", it && !isPublishableChmiItem(it), "publishable");
}

{
  // Force cancel via revision
  const cancelItems = revisionsToFeed(
    [{ ...baseRev, msgType: "Cancel", hazards: [{ ...activeH, hazard_instance_id: "haz:statuscancel00001" }] }],
    { nowIso: FROZEN }
  );
  const it = cancelItems[0];
  ok("cancelled_status", it && it.status === "zruseno", it && it.status);
  ok("cancelled_badge_off", it && it.capV2.badgeActive === false, "badge");
  ok("cancelled_not_publishable", it && !isPublishableChmiItem(it), "publishable");
}

{
  const items = feedFor({
    ...activeH,
    hazard_instance_id: "haz:statusnovto000001",
    valid_to: "",
    untilRevoked: false,
    openEnded: false,
  });
  const it = items[0];
  ok("missing_to_invalid", it && it.status === "nezaraditelne", it && it.status);
  ok("missing_to_not_aktivni", it && it.status !== "aktivni", it && it.status);
  ok("missing_to_not_publishable", it && !isPublishableChmiItem(it), "publishable");
}

{
  const items = feedFor({
    ...activeH,
    hazard_instance_id: "haz:statusopen0000001",
    event: "Smogová situace – troposférický ozón O₃",
    valid_to: "",
    untilRevoked: true,
    web: "https://vystrahy-cr.chmi.cz/",
  });
  const it = items[0];
  ok("until_revoked_active_status", it && it.status === "aktivni", it && it.status);
  ok("until_revoked_publishable", it && isPublishableChmiItem(it), "publishable");
  ok("until_revoked_flag", it && it.untilRevoked === true, "untilRevoked");
  ok("until_revoked_public_url", it && /vystrahy-cr\.chmi\.cz\/?$/i.test(String(it.publicUrl || it.url || "")), it && it.url);
}

{
  const items = feedFor({
    ...activeH,
    hazard_instance_id: "haz:statusopenfut00001",
    valid_from: "2026-07-31T00:00:00+02:00",
    valid_to: "",
    untilRevoked: true,
    web: "https://vystrahy-cr.chmi.cz/",
  });
  const it = items[0];
  ok("until_revoked_scheduled_status", it && it.status === "naplanovano", it && it.status);
  ok("until_revoked_scheduled_publishable", it && isPublishableChmiItem(it), "publishable");
}

{
  const items = feedFor({
    ...activeH,
    hazard_instance_id: "haz:statusoutlook0001",
    event: "Výhled nebezpečných jevů",
    valid_from: "2026-08-02T00:00:00+02:00",
    valid_to: "",
    untilRevoked: true,
    productExcluded: true,
    web: "https://vystrahy-cr.chmi.cz/",
  });
  const it = items[0];
  ok("outlook_excluded_reason", it && it.capV2.temporalReason === "excluded_product_type", it && it.capV2 && it.capV2.temporalReason);
  ok("outlook_not_publishable", it && !isPublishableChmiItem(it), "publishable");
}

{
  const items = feedFor({
    ...activeH,
    hazard_instance_id: "haz:statusnovfrom00001",
    valid_from: "",
  });
  const it = items[0];
  ok("missing_from_invalid", it && it.status === "nezaraditelne", it && it.status);
}

{
  const items = feedFor({
    ...activeH,
    hazard_instance_id: "haz:statusbadint000001",
    valid_from: "2026-07-30T20:00:00+02:00",
    valid_to: "2026-07-30T08:00:00+02:00",
  });
  const it = items[0];
  ok("bad_interval_invalid", it && it.status === "nezaraditelne", it && it.status);
}

// classifyChmiTemporalState unit + midnight / TZ
{
  const cls = classifyChmiTemporalState({
    validFrom: "2026-07-30T23:50:00+02:00",
    validTo: "2026-07-31T02:00:00+02:00",
    nowMs: Date.parse("2026-07-31T00:30:00+02:00"),
  });
  ok("midnight_classify_active", cls.temporalState === "active", cls.temporalState);

  const winter = classifyChmiTemporalState({
    validFrom: "2026-01-15T10:00:00+01:00",
    validTo: "2026-01-16T00:00:00+01:00",
    nowMs: Date.parse("2026-01-15T12:00:00+01:00"),
  });
  ok("winter_classify_active", winter.temporalState === "active", winter.temporalState);

  const summer = classifyChmiTemporalState({
    validFrom: "2026-07-30T08:00:00+02:00",
    validTo: "2026-07-30T20:00:00+02:00",
    nowMs: FROZEN_MS,
  });
  ok("summer_classify_active", summer.temporalState === "active", summer.temporalState);
}

// refreshItemTemporalFields: scheduled → active without inventing times
{
  const scheduled = feedFor({
    ...activeH,
    hazard_instance_id: "haz:statusrefresh00001",
    valid_from: "2026-07-31T00:00:00+02:00",
    valid_to: "2026-07-31T12:00:00+02:00",
  })[0];
  ok("refresh_pre_scheduled", scheduled.status === "naplanovano", scheduled.status);
  const refreshed = refreshItemTemporalFields(scheduled, Date.parse("2026-07-31T01:00:00+02:00"));
  ok("refresh_post_active", refreshed.status === "aktivni", refreshed.status);
  ok("refresh_post_badge", refreshed.capV2.badgeActive === true, "badge");
  const expired = refreshItemTemporalFields(scheduled, Date.parse("2026-07-31T12:00:00+02:00"));
  ok("refresh_post_expired", expired.status === "ukonceno", expired.status);
}

// Monitoring naming: activeCount must not equal publishable for mixed set
{
  const mixed = [
    ...feedFor(activeH),
    ...feedFor({
      ...activeH,
      hazard_instance_id: "haz:statusmixsched0001",
      valid_from: "2026-07-31T00:00:00+02:00",
      valid_to: "2026-07-31T12:00:00+02:00",
    }),
  ];
  const activeCount = mixed.filter((i) => i.status === "aktivni").length;
  const scheduledCount = mixed.filter((i) => i.status === "naplanovano").length;
  const publishableCount = mixed.filter((i) => isPublishableChmiItem(i)).length;
  ok("counts_active_eq_1", activeCount === 1, String(activeCount));
  ok("counts_scheduled_eq_1", scheduledCount === 1, String(scheduledCount));
  ok("counts_publishable_eq_2", publishableCount === 2, String(publishableCount));
  ok("counts_active_ne_publishable", activeCount !== publishableCount, `${activeCount}!=${publishableCount}`);
}

if (fails.length) {
  console.error("IU_CHMI_CAP_STATUS_CONSISTENCY_GUARD=FAIL");
  for (const f of fails) console.error("FAIL " + f);
  process.exit(1);
}
console.log("IU_CHMI_CAP_STATUS_CONSISTENCY_GUARD=PASS");
console.log("frozen_now=" + FROZEN);
process.exit(0);
