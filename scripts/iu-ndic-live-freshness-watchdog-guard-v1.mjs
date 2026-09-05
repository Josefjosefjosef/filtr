#!/usr/bin/env node
/**
 * Guard: NDIC live path observability must exist (R2 meta endpoint + client URL +
 * freshness thresholds). Does not require network — static contract only.
 * Live HTTP probe is optional via IU_NDIC_LIVE_FRESHNESS_PROBE=1.
 */
import fs from "node:fs";
import path from "node:path";
import https from "node:https";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const fails = [];
function ok(id, cond, detail) {
  if (!cond) fails.push(id + (detail ? ":" + detail : ""));
}

const overview = fs.readFileSync(path.join(ROOT, "assets", "iu-traffic-overview-v1.js"), "utf8");
const worker = fs.readFileSync(
  path.join(ROOT, "cloudflare", "iu-site-redirects", "src", "index.ts"),
  "utf8"
);
const anomaly = fs.readFileSync(
  path.join(ROOT, "scripts", "ndic-datex-v1", "live-anomaly-guard.mjs"),
  "utf8"
);

ok("client_live_meta_url", /TRAFFIC_LIVE_META_URL/.test(overview));
ok("worker_serves_meta", /serveLiveMeta/.test(worker));
ok("anomaly_zero_guard", /CATASTROPHIC_ZERO_CARDS/.test(anomaly));
ok("publish_headers_published_at", /x-iu-ndic-published-at/.test(worker));

function get(url) {
  return new Promise((resolve, reject) => {
    https
      .get(url, { headers: { "Cache-Control": "no-cache", "User-Agent": "InfoUzel-NDIC-Watchdog/1.0" } }, (res) => {
        const chunks = [];
        res.on("data", (d) => chunks.push(d));
        res.on("end", () =>
          resolve({
            status: res.statusCode,
            headers: res.headers,
            body: Buffer.concat(chunks).toString("utf8"),
          })
        );
      })
      .on("error", reject);
  });
}

let probe = null;
if (String(process.env.IU_NDIC_LIVE_FRESHNESS_PROBE || "") === "1") {
  try {
    const metaUrl =
      "https://infouzel.cz/projects/data/info_events/ndic_datex_v1/traffic_live_meta.json?cb=" +
      Date.now();
    const headUrl =
      "https://infouzel.cz/projects/data/info_events/ndic_datex_v1/traffic_offline_snapshot.json?iu_head=1&limit=50&cb=" +
      Date.now();
    const [metaRes, headRes] = await Promise.all([get(metaUrl), get(headUrl)]);
    probe = {
      metaStatus: metaRes.status,
      headStatus: headRes.status,
      headKind: headRes.headers["x-iu-ndic-snapshot-kind"] || null,
      headBytes: headRes.body.length,
      liveSource: headRes.headers["x-iu-ndic-live-source"] || null,
    };
    ok("probe_meta_http", metaRes.status === 200, String(metaRes.status));
    ok("probe_head_http", headRes.status === 200, String(headRes.status));
    ok("probe_head_small", headRes.body.length < 2_500_000, String(headRes.body.length));
    if (headRes.status === 200) {
      try {
        const j = JSON.parse(headRes.body);
        ok("probe_head_capped", Array.isArray(j.cards) && j.cards.length <= 200, String(j.cards && j.cards.length));
        ok("probe_card_count_total", Number(j.cardCount) > 100, String(j.cardCount));
      } catch (e) {
        ok("probe_head_json", false, String(e && e.message));
      }
    }
    if (metaRes.status === 200) {
      try {
        const m = JSON.parse(metaRes.body);
        const pub = m.publishedAt || m.processedAt || null;
        const ageMin = pub ? (Date.now() - Date.parse(pub)) / 60000 : null;
        probe.publishedAt = pub;
        probe.ageMin = ageMin;
        ok("probe_meta_fresh_6h", ageMin != null && ageMin < 360, String(ageMin));
      } catch (e) {
        ok("probe_meta_json", false, String(e && e.message));
      }
    }
  } catch (e) {
    ok("probe_network", false, String(e && e.message));
  }
}

const report = {
  NDIC_LIVE_FRESHNESS_WATCHDOG_GUARD: fails.length ? "FAIL" : "PASS",
  fails,
  probe,
};
console.log(JSON.stringify(report, null, 2));
if (fails.length) process.exit(1);
