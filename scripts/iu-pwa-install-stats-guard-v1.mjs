#!/usr/bin/env node
/**
 * Guard: anonymous PWA install stats contract (client + worker + public UI).
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");
const fails = [];
function fail(m) {
  fails.push(m);
}

const client = fs.readFileSync(path.join(ROOT, "assets/iu-analytics-client.js"), "utf8");
const types = fs.readFileSync(path.join(ROOT, "cloudflare/iu-analytics/src/types.ts"), "utf8");
const aggregate = fs.readFileSync(path.join(ROOT, "cloudflare/iu-analytics/src/aggregate.ts"), "utf8");
const store = fs.readFileSync(path.join(ROOT, "cloudflare/iu-analytics/src/store.ts"), "utf8");
const privacy = fs.readFileSync(path.join(ROOT, "cloudflare/iu-analytics/src/privacy.ts"), "utf8");
const indexTs = fs.readFileSync(path.join(ROOT, "cloudflare/iu-analytics/src/index.ts"), "utf8");
const migration = fs.readFileSync(
  path.join(ROOT, "cloudflare/iu-analytics/migrations/0002_pwa_installs.sql"),
  "utf8"
);
const publicPage = fs.readFileSync(path.join(ROOT, "projects/statistiky/index.html"), "utf8");

if (!/"pwa_install"/.test(types)) fail("types:missing_pwa_install_allowlist");
if (!/pwa_installs/.test(migration) || !/ADD COLUMN pwa_installs/.test(migration)) {
  fail("migration:missing_additive_pwa_installs");
}
if (/DROP TABLE|DROP COLUMN/i.test(migration)) fail("migration:must_be_additive_only");

if (!/event\.type === "pwa_install"/.test(aggregate)) fail("aggregate:missing_pwa_install_branch");
if (!/pwa_installs:\s*1/.test(aggregate)) fail("aggregate:missing_pwa_bump");
// Ensure pwa branch does not share visits bump in same block naively — visits bump stays on page_view only.
if (!/event\.type === "page_view"[\s\S]*?visits:\s*1/.test(aggregate)) fail("aggregate:page_view_visits_intact");

if (!/sumPwaInstalls/.test(store)) fail("store:missing_sumPwaInstalls");
if (!/pwa_installs = pwa_installs \+ excluded\.pwa_installs/.test(store)) {
  fail("store:missing_pwa_upsert");
}

if (!/client_count_forbidden/.test(privacy)) fail("privacy:missing_client_count_reject");
if (!/pwaInstalls/.test(indexTs) || !/PWA_INSTALLS_SINCE/.test(indexTs)) {
  fail("public:missing_pwaInstalls_payload");
}
if (!/agregovaný počet/.test(indexTs) && !/PWA instalace jsou evidovány pouze jako agregovaný/.test(indexTs)) {
  fail("public:missing_pwa_anonymization_audit");
}

if (!/iu_pwa_install_counted_v1/.test(client)) fail("client:missing_counted_marker");
if (!/iu_pwa_install_pending_v1/.test(client)) fail("client:missing_pending_marker");
if (!/appinstalled/.test(client)) fail("client:missing_appinstalled_hook");
if (!/display-mode:\s*standalone/.test(client)) fail("client:missing_standalone_detect");
if (!/accepted \|\| 0\) < 1/.test(client) && !/Number\(j\.accepted/.test(client)) {
  fail("client:missing_ack_before_marker");
}
// Marker must be set only after ACK path (lsSet counted after accepted check).
const countedIdx = client.indexOf('lsSet(PWA_COUNTED_KEY, "1")');
const acceptedIdx = client.indexOf("Number(j.accepted");
if (countedIdx < 0 || acceptedIdx < 0 || countedIdx < acceptedIdx) {
  fail("client:counted_marker_must_follow_ack");
}
if (!/isAnalyticsGranted/.test(client)) fail("client:consent_gate_missing");
if (/fingerprint|advertising.?id|device_id/i.test(client) && /pwa_install/.test(client)) {
  // Soft: block obvious tracking keys near pwa send body
  if (/fingerprint/.test(client.split("sendPwaInstallAck")[1] || "")) fail("client:fingerprint_in_pwa_send");
}

if (!/Zaznamenané instalace PWA/.test(publicPage)) fail("ui:missing_pwa_card_label");
if (!/sPwaInstalls/.test(publicPage)) fail("ui:missing_pwa_stat_id");
if (!/pwaInstalls/.test(publicPage)) fail("ui:missing_pwa_api_bind");
if (!/nepočet unikátních osob|nepředstavuje počet unikátních osob/i.test(publicPage)) {
  fail("ui:missing_not_unique_people_copy");
}
if (!/Instalace PWA měříme pouze anonymně a agregovaně/.test(publicPage)) {
  fail("ui:missing_codex_pwa_item");
}

if (fails.length) {
  console.error("[iu-pwa-install-stats-guard] FAIL");
  fails.forEach((f) => console.error(" - " + f));
  process.exit(1);
}
console.log("[iu-pwa-install-stats-guard] OK");
