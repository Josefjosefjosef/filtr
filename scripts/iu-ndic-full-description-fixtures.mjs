#!/usr/bin/env node
/**
 * Full NDIC/RSD description preservation fixtures — pure, no network.
 * Proves summary/full separation and that impactFull is not derived from a ≤280 summary.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import {
  buildTrafficSummary,
  sanitizeTrafficComment,
  TRAFFIC_COMMENT_FULL_MAX,
  TRAFFIC_COMMENT_SUMMARY_MAX,
} from "./ndic-datex-v1/title.mjs";
import { processDatexBody } from "./ndic-datex-v1/sync-core.mjs";
import { feedItemToPublicationEvent } from "./ndic-datex-v1/traffic-ui-snapshot-persist.mjs";
import { buildTrafficPublicationProjection } from "./ndic-datex-v1/traffic-publication-projection.mjs";
import { buildTrafficCardProjection } from "./ndic-datex-v1/traffic-card-projection.mjs";
import { chooseImpactTexts } from "./ndic-datex-v1/traffic-card-content-v1.mjs";

const fails = [];
const results = [];
function ok(id, cond, detail) {
  if (cond) results.push({ id, pass: true });
  else {
    fails.push(id + (detail ? ":" + detail : ""));
    results.push({ id, pass: false });
  }
}

const LONG =
  "silnice II/452 (ulice tř. Práce), Bruntál, okr. Bruntál, stavební práce, zúžená vozovka na jeden jízdní pruh. " +
  "Objízdná trasa vedena po silnici I/11 přes Krnov a Opavu. Provoz řízen semafory. " +
  "Od 24.03.2025 01:00 Do 31.12.2026 20:00. Další upřesnění: uzavřen pravý jízdní pruh ve směru na Opavu, " +
  "přístup k obchodnímu centru zachován. Kontakt správce: pouze oficiální ŘSD/NDIC text. " +
  "XSS-like <script>alert(1)</script> a <b>tučné</b> musí zůstat plain text. " +
  "České znaky: příliš žluťoučký kůň úpěl ďábelské ódy — více vět. Konec.";

ok("len_long_gt_280", LONG.length > 280, String(LONG.length));
ok("summary_max_const", TRAFFIC_COMMENT_SUMMARY_MAX === 280);
ok("full_max_const", TRAFFIC_COMMENT_FULL_MAX === 12000);

{
  const full = sanitizeTrafficComment(LONG);
  const short = buildTrafficSummary(LONG);
  ok("sanitize_strips_tags", !full.includes("<script>") && !full.includes("<b>") && full.includes("alert(1)"));
  ok("sanitize_keeps_czech", full.includes("žluťoučký") && full.includes("ďábelské"));
  ok("summary_truncated", short.length <= 280 && /…$/.test(short));
  ok("full_gt_summary", full.length > short.length);
  ok("full_not_ellipsis_tail", !/…$/.test(full) && full.length > 280);
}

{
  ok("empty_full", sanitizeTrafficComment("") === "");
  ok("empty_summary", buildTrafficSummary("") === "");
}

{
  const shortSrc = "Nehoda na D1, km 12 — provoz omezen v jednom směru.";
  const full = sanitizeTrafficComment(shortSrc);
  const chosen = chooseImpactTexts(full, "Provoz omezen.", 160);
  ok("short_no_full", chosen.impactFull == null && chosen.impactShort === full);
}

{
  const sanitized = sanitizeTrafficComment(LONG);
  const chosen = chooseImpactTexts(sanitized, "Provoz omezen.", 160);
  ok("long_has_full", chosen.impactFull != null && chosen.impactFull.length > 280);
  ok("long_short_le_160", chosen.impactShort.length <= 160);
  ok("long_full_eq_source", chosen.impactFull === sanitized);
  ok("long_full_gt_short", chosen.impactFull.length > chosen.impactShort.length);
}

{
  ok("cap_12k", sanitizeTrafficComment("A".repeat(15000) + " konec").length === TRAFFIC_COMMENT_FULL_MAX);
}

{
  const dir = path.dirname(fileURLToPath(import.meta.url));
  const baseXml = readFileSync(path.join(dir, "ndic-datex-v1/fixtures/snapshot-base.xml"), "utf8");
  const longEsc = LONG.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const xml = baseXml.replace(
    /(<generalPublicComment>\s*<comment>\s*<value[^>]*>)([\s\S]*?)(<\/value>)/,
    "$1" + longEsc + "$3"
  );
  const processed = processDatexBody(xml, { prevItems: [], nowIso: "2026-08-10T18:00:00.000Z" });
  const items = [...(processed.items || []), ...(processed.quarantine || [])];
  ok("e2e_items", items.length > 0, String(items.length));
  const withFull = items.find((it) => it.summaryFull && it.summaryFull.length > 280);
  ok(
    "e2e_summaryFull",
    !!(withFull && withFull.summaryFull.length > 280),
    withFull ? String(withFull.summaryFull.length) : "none"
  );
  if (withFull) {
    ok("e2e_summary_short", withFull.summary.length <= 280);
    ok("e2e_full_gt_summary", withFull.summaryFull.length > withFull.summary.length);
    const ev = feedItemToPublicationEvent(withFull);
    ok(
      "e2e_event_summaryFull",
      !!(ev && ev.fields && ev.fields.summaryFull && String(ev.fields.summaryFull.value).length > 280)
    );
    const built = buildTrafficPublicationProjection(ev, {
      delayProven: false,
      previousStatus: null,
      changeKinds: [],
    });
    ok(
      "e2e_proj_ok",
      built.ok === true,
      built.rejectCode || (built.reasons && built.reasons.join(",")) || ""
    );
    if (built.ok) {
      const p = built.projection;
      ok("e2e_impactFull", !!(p.impactFull && p.impactFull.length > 280));
      ok("e2e_impactSummary_le_280", !p.impactSummary || p.impactSummary.length <= 280);
      ok(
        "e2e_full_not_summary",
        !!(p.impactFull && p.impactSummary && p.impactFull.length > p.impactSummary.length)
      );
      const card = buildTrafficCardProjection(p);
      ok("e2e_card_full", card.ok && card.card.impactFull && card.card.impactFull.length > 280);
    }
  }
}

const PASS = fails.length === 0;
console.log(
  JSON.stringify(
    {
      suite: "NDIC_FULL_DESCRIPTION_PRESERVATION",
      PASS,
      TEST_COUNT: results.length,
      SUCCESS_COUNT: results.filter((r) => r.pass).length,
      FAILURE_COUNT: fails.length,
      fails,
    },
    null,
    2
  )
);
process.exit(PASS ? 0 : 1);
