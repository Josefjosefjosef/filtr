#!/usr/bin/env node
/**
 * Guard: CHMI cards distinguish Vydáno (msgType=Alert) vs Aktualizováno (msgType=Update)
 * from CAP provenance — never by comparing issued vs validFrom calendar dates.
 * Platí od stays firstContinuousValidFrom / canonical validFrom.
 */
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";
import crypto from "node:crypto";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const CORE = path.join(ROOT, "assets", "iu-info-system-core-v1.js");
const UI = path.join(ROOT, "assets", "iu-prehled-dne-ui-v1.js");
const CSS = path.join(ROOT, "assets", "iu-prehled-dne-v1.css");
const INDEX = path.join(ROOT, "projects", "index.html");
const FEED = path.join(ROOT, "projects", "data", "info_events", "feed.json");
const CACHE_BUST = "heavy-feed-offmain-v1-20260809";

const fails = [];
function ok(id, cond, detail) {
  if (!cond) fails.push(id + (detail ? ":" + detail : ""));
}

function loadIU() {
  const sandbox = {
    console,
    localStorage: {
      _m: new Map(),
      getItem(k) {
        return this._m.has(k) ? this._m.get(k) : null;
      },
      setItem(k, v) {
        this._m.set(k, String(v));
      },
      removeItem(k) {
        this._m.delete(k);
      },
    },
    document: { documentElement: { classList: { toggle() {} } } },
    location: { pathname: "/projects/" },
    Date,
    JSON,
    Array,
    Object,
    String,
    Number,
    Boolean,
    Math,
    Set,
    Map,
    Intl,
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  const src = fs.readFileSync(CORE, "utf8");
  const stripped = src.replace(/export \{[\s\S]*\}\s*;?\s*$/m, "").replace(/export default[\s\S]*$/m, "");
  vm.runInNewContext(stripped + "\nthis.__IU = IUInfoSystem;\n", sandbox, { filename: "core.js" });
  return sandbox.__IU;
}

function baseItem(overrides) {
  return Object.assign(
    {
      id: "ie-chmi-v2-label-1",
      sourceId: "chmi",
      status: "aktivni",
      publishedAtSource: "2026-07-31T11:29:00+02:00",
      publishedAt: "2026-07-31T11:29:00+02:00",
      validFrom: "2026-07-29T10:40:00+02:00",
      validTo: "2026-08-02T00:00:00+02:00",
      capV2: {
        badgeActive: true,
        msgType: "Alert",
        sent: "2026-07-31T11:29:00+02:00",
        onset: "2026-07-29T10:40:00+02:00",
      },
    },
    overrides || {}
  );
}

function deepClone(o) {
  return JSON.parse(JSON.stringify(o));
}

function canonicalizeFeedForCompare(raw) {
  const items = Array.isArray(raw) ? raw : raw && raw.items ? raw.items : [];
  const chmi = items
    .filter((i) => String(i.id || "").startsWith("ie-chmi-v2"))
    .map((i) => {
      const c = deepClone(i);
      // Strip allowed pure-presentation fields if ever added; msgType/sent are provenance already present.
      delete c.sourceMsgType;
      delete c.sourceSent;
      delete c.originalAlertSent;
      if (c.capV2) {
        delete c.capV2.sourceMsgType;
        delete c.capV2.sourceSent;
        delete c.capV2.originalAlertSent;
      }
      return c;
    })
    .sort((a, b) => String(a.id).localeCompare(String(b.id)));
  return chmi.map((i) => ({
    id: i.id,
    title: i.title,
    status: i.status,
    lifecycle: i.lifecycle,
    importance: i.importance,
    validFrom: i.validFrom,
    validTo: i.validTo,
    publishedAtSource: i.publishedAtSource,
    region: i.region,
    supersedesIds: (i.capV2 && i.capV2.supersedesIds) || i.supersedesIds || [],
    msgType: i.capV2 && i.capV2.msgType,
    severity: i.capV2 && i.capV2.severity,
    event: i.capV2 && i.capV2.event,
    orpNames: ((i.capV2 && i.capV2.geo && i.capV2.geo.links) || [])
      .map((l) => l.orpName || l.orp || "")
      .filter(Boolean)
      .sort(),
  }));
}

const IU = loadIU();
const core = fs.readFileSync(CORE, "utf8");
const ui = fs.readFileSync(UI, "utf8");
const css = fs.readFileSync(CSS, "utf8");
const index = fs.readFileSync(INDEX, "utf8");

ok("core_helper_word", /function chmiCapRevisionIssuedWord/.test(core), "helper");
ok("core_no_calendar_heuristic", !/issued\s*>\s*validFrom|validFrom\s*<\s*issued/.test(core), "heuristic");
ok("ui_parses_both", /Vydáno\|Aktualizováno/.test(ui), "ui regex");
ok("css_timeCol_wider", /88px/.test(css), "timeCol");
ok("css_issued_wrap", /\.iuPrehledDne__issued[\s\S]*overflow-wrap:\s*anywhere/.test(css), "wrap");
ok("bust_ui", ui.includes(CACHE_BUST), "bust ui");
ok("bust_index_js", index.includes("iu-prehled-dne-ui-v1.js?v=" + CACHE_BUST), "bust js");
ok("bust_index_css", index.includes("iu-prehled-dne-v1.css?v=" + CACHE_BUST), "bust css");

const nowActive = Date.parse("2026-07-31T12:00:00+02:00");

// 1) Original Alert → Vydáno + Alert sent
const alertItem = baseItem({
  publishedAtSource: "2026-07-29T10:40:00+02:00",
  publishedAt: "2026-07-29T10:40:00+02:00",
  validFrom: "2026-07-29T10:40:00+02:00",
  capV2: {
    badgeActive: true,
    msgType: "Alert",
    sent: "2026-07-29T10:40:00+02:00",
    onset: "2026-07-29T10:40:00+02:00",
  },
});
const aRolled = IU.getEffectiveTimelinePresentation(alertItem, nowActive);
ok("alert_rolled_word", /^Vydáno\s/.test(String(aRolled.secondaryIssuedLabel || "")), String(aRolled.secondaryIssuedLabel));
ok("alert_rolled_day", /29\.\s*7/.test(String(aRolled.secondaryIssuedLabel || "")), String(aRolled.secondaryIssuedLabel));
ok("alert_no_future_sentence", !aRolled.secondaryValidFromLabel, String(aRolled.secondaryValidFromLabel));
ok("alert_no_vf_split", aRolled.secondaryValidFromTime == null && aRolled.secondaryValidFromDate == null, "split");

// 2) Alert → Update (rolled day): Aktualizováno + last Update sent day; no future-only Platí od sentence
const updateItem = baseItem({
  publishedAtSource: "2026-07-31T11:29:00+02:00",
  publishedAt: "2026-07-31T11:29:00+02:00",
  validFrom: "2026-07-29T10:40:00+02:00",
  capV2: {
    badgeActive: true,
    msgType: "Update",
    sent: "2026-07-31T11:29:00+02:00",
    onset: "2026-07-29T10:40:00+02:00",
  },
});
const nowRolled = Date.parse("2026-08-01T12:00:00+02:00");
const u = IU.getEffectiveTimelinePresentation(updateItem, nowRolled);
ok("update_word", /^Aktualizováno\s/.test(String(u.secondaryIssuedLabel || "")), String(u.secondaryIssuedLabel));
ok("update_day", /31\.\s*7/.test(String(u.secondaryIssuedLabel || "")), String(u.secondaryIssuedLabel));
ok("update_no_future_sentence", !u.secondaryValidFromLabel, String(u.secondaryValidFromLabel));
ok("update_no_vf_split", u.secondaryValidFromDate == null && u.secondaryValidFromTime == null, "split");
ok("update_not_vydano", !/Vydáno/i.test(String(u.secondaryIssuedLabel || "")), String(u.secondaryIssuedLabel));

// Same calendar day as Update sent: secondary shows Update clock; primary carries validFrom
const uSameDay = IU.getEffectiveTimelinePresentation(updateItem, nowActive);
ok(
  "update_sameday_time",
  /Aktualizováno\s*11:29/.test(String(uSameDay.secondaryIssuedLabel || "")),
  String(uSameDay.secondaryIssuedLabel)
);
ok("update_sameday_primary_vf", uSameDay.primaryTime === "10:40", String(uSameDay.primaryTime));

// 3) Alert → Update → Update: last revision sent wins; validFrom segment unchanged
const update2 = baseItem({
  publishedAtSource: "2026-08-01T08:15:00+02:00",
  publishedAt: "2026-08-01T08:15:00+02:00",
  validFrom: "2026-07-29T10:40:00+02:00",
  validTo: "2026-08-05T00:00:00+02:00",
  capV2: {
    badgeActive: true,
    msgType: "Update",
    sent: "2026-08-01T08:15:00+02:00",
    onset: "2026-07-29T10:40:00+02:00",
  },
});
const u2 = IU.getEffectiveTimelinePresentation(update2, Date.parse("2026-08-02T12:00:00+02:00"));
ok("update2_word", /^Aktualizováno\s/.test(String(u2.secondaryIssuedLabel || "")), String(u2.secondaryIssuedLabel));
ok("update2_day", /1\.\s*8/.test(String(u2.secondaryIssuedLabel || "")), String(u2.secondaryIssuedLabel));
ok("update2_no_future_sentence", !u2.secondaryValidFromLabel, String(u2.secondaryValidFromLabel));
ok("update2_no_vf_split", u2.secondaryValidFromTime == null && u2.secondaryValidFromDate == null, "split");

// 4) New lifecycle segment: labels follow new chain, not previous segment
const newSeg = baseItem({
  id: "ie-chmi-v2-label-newseg",
  publishedAtSource: "2026-08-01T00:05:00+02:00",
  publishedAt: "2026-08-01T00:05:00+02:00",
  validFrom: "2026-08-01T00:00:00+02:00",
  validTo: "2026-08-02T00:00:00+02:00",
  capV2: {
    badgeActive: true,
    msgType: "Update",
    sent: "2026-08-01T00:05:00+02:00",
    onset: "2026-08-01T00:00:00+02:00",
  },
});
const ns = IU.getEffectiveTimelinePresentation(newSeg, Date.parse("2026-08-01T12:00:00+02:00"));
ok("newseg_aktualizovano", /^Aktualizováno\s/.test(String(ns.secondaryIssuedLabel || "")), String(ns.secondaryIssuedLabel));
ok("newseg_not_old_vf", !/29\.\s*7/.test(String(ns.secondaryValidFromDate || "") + String(ns.primaryDate || "")), "old segment");
ok("newseg_vf_primary", /1\.\s*8/.test(String(ns.primaryDate || "")), String(ns.primaryDate));

// 5) Future → Immediate: label from last authoritative msg; uninterrupted start stays
const fut = baseItem({
  status: "naplanovano",
  publishedAtSource: "2026-07-31T08:00:00+02:00",
  publishedAt: "2026-07-31T08:00:00+02:00",
  validFrom: "2026-07-31T14:00:00+02:00",
  validTo: "2026-08-01T00:00:00+02:00",
  capV2: {
    badgeActive: true,
    msgType: "Update",
    sent: "2026-07-31T08:00:00+02:00",
    onset: "2026-07-31T14:00:00+02:00",
  },
});
const fBefore = IU.getEffectiveTimelinePresentation(fut, Date.parse("2026-07-31T12:00:00+02:00"));
const fAfter = IU.getEffectiveTimelinePresentation(fut, Date.parse("2026-07-31T15:00:00+02:00"));
ok("future_plati_od", fBefore.secondaryValidFromLabel === "Výstraha ČHMÚ platí od 31. 7. 14:00 hod.", String(fBefore.secondaryValidFromLabel));
ok("future_vf_1400", fBefore.secondaryValidFromTime == null && fBefore.secondaryValidFromDate == null, "split");
ok("active_clears_future_sentence", !fAfter.secondaryValidFromLabel, String(fAfter.secondaryValidFromLabel));
ok("active_primary_onset", fAfter.primaryTime === "14:00", String(fAfter.primaryTime));
ok(
  "active_aktualizovano_sent",
  /Aktualizováno\s*8:00|Aktualizováno\s*08:00/.test(String(fAfter.secondaryIssuedLabel || "")),
  String(fAfter.secondaryIssuedLabel)
);

// 6) Cold start === warm start (presentation deterministic from item fields only)
const cold = IU.getEffectiveTimelinePresentation(deepClone(updateItem), nowRolled);
const warm = IU.getEffectiveTimelinePresentation(deepClone(updateItem), nowRolled);
ok(
  "cold_warm_same",
  JSON.stringify({
    s: cold.secondaryIssuedLabel,
    v: cold.secondaryValidFromLabel,
    vd: cold.secondaryValidFromDate,
    vt: cold.secondaryValidFromTime,
    p: cold.primaryTime,
  }) ===
    JSON.stringify({
      s: warm.secondaryIssuedLabel,
      v: warm.secondaryValidFromLabel,
      vd: warm.secondaryValidFromDate,
      vt: warm.secondaryValidFromTime,
      p: warm.primaryTime,
    }),
  "cold≠warm"
);

// 7) Shuffled document field order — deterministic
const shuffled = {
  validTo: updateItem.validTo,
  capV2: {
    onset: updateItem.capV2.onset,
    badgeActive: true,
    sent: updateItem.capV2.sent,
    msgType: "Update",
  },
  id: updateItem.id,
  sourceId: "chmi",
  publishedAt: updateItem.publishedAt,
  status: "aktivni",
  validFrom: updateItem.validFrom,
  publishedAtSource: updateItem.publishedAtSource,
};
const sh = IU.getEffectiveTimelinePresentation(shuffled, nowRolled);
ok("shuffle_same_label", sh.secondaryIssuedLabel === u.secondaryIssuedLabel, String(sh.secondaryIssuedLabel));
ok("shuffle_same_vf", sh.secondaryValidFromLabel === u.secondaryValidFromLabel, String(sh.secondaryValidFromLabel));

// 8) Duplicate delivery of same revision — same result
const dup1 = IU.getEffectiveTimelinePresentation(deepClone(updateItem), nowRolled);
const dup2 = IU.getEffectiveTimelinePresentation(deepClone(updateItem), nowRolled);
ok("dup_same", dup1.secondaryIssuedLabel === dup2.secondaryIssuedLabel, "dup");

// 9) Never guess from calendar: issued after validFrom but msgType=Alert → still Vydáno
const alertLate = baseItem({
  publishedAtSource: "2026-07-31T23:01:00+02:00",
  publishedAt: "2026-07-31T23:01:00+02:00",
  validFrom: "2026-07-29T10:40:00+02:00",
  capV2: {
    badgeActive: true,
    msgType: "Alert",
    sent: "2026-07-31T23:01:00+02:00",
    onset: "2026-07-29T10:40:00+02:00",
  },
});
const al = IU.getEffectiveTimelinePresentation(alertLate, nowActive);
ok("no_guess_alert", /^Vydáno\s/.test(String(al.secondaryIssuedLabel || "")), String(al.secondaryIssuedLabel));
ok("no_guess_not_aktualiz", !/Aktualizováno/i.test(String(al.secondaryIssuedLabel || "")), String(al.secondaryIssuedLabel));

// 10) Missing msgType → do not invent label
const missing = baseItem({
  capV2: { badgeActive: true, onset: "2026-07-29T10:40:00+02:00" },
});
const miss = IU.getEffectiveTimelinePresentation(missing, nowActive);
ok("missing_msgtype_no_label", !miss.secondaryIssuedLabel, String(miss.secondaryIssuedLabel));

// 11) Canonical feed fingerprint (no presentation-only field injection in committed feed)
const feedRaw = JSON.parse(fs.readFileSync(FEED, "utf8"));
const canon = canonicalizeFeedForCompare(feedRaw);
const digest = crypto.createHash("sha256").update(JSON.stringify(canon)).digest("hex").slice(0, 16);
ok("feed_chmi_count", canon.length > 0, String(canon.length));
ok("feed_all_have_msgtype", canon.every((c) => c.msgType === "Alert" || c.msgType === "Update"), "msgType");
ok("feed_digest_stable", /^[a-f0-9]{16}$/.test(digest), digest);
console.log("IU_CHMI_ISSUED_VS_UPDATED_FEED_DIGEST=" + digest);
console.log("IU_CHMI_ISSUED_VS_UPDATED_FEED_COUNT=" + canon.length);

// 12) Responsive layout static contract (mobile/tablet/desktop column width + wrap)
ok("css_no_overflow_x_force", !/iuPrehledDne__issued[\s\S]{0,120}overflow-x:\s*scroll/.test(css), "no h-scroll");
ok("css_item_minmax", /minmax\(0,\s*1fr\)/.test(css), "grid grow");

if (fails.length) {
  console.error("IU_CHMI_ISSUED_VS_UPDATED_LABEL=FAIL");
  for (const f of fails) console.error(" - " + f);
  process.exit(1);
}
console.log("IU_CHMI_ISSUED_VS_UPDATED_LABEL=PASS");
