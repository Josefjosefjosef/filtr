/**
 * CHMI CAP v2 guard — fixtures only (no production CHMI network).
 * Exit 0 = PASS, 1 = FAIL.
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { getChmiCapV2Config, isLegacyProductionPath } from "./chmi-cap-v2/config.mjs";
import { parseCapAlertXml } from "./chmi-cap-v2/parse-cap.mjs";
import { parseSafeXml } from "./chmi-cap-v2/safe-xml.mjs";
import { buildCapIdentity, parseCapReferences } from "./chmi-cap-v2/identity.mjs";
import { processCapDocuments, tryAcquireLock, releaseLock, applyConditionalResult, atomicPublishDecision, suspiciousDrop, createSyncState } from "./chmi-cap-v2/sync-core.mjs";
import { revisionsToFeed } from "./chmi-cap-v2/normalize-feed.mjs";
import { migrateUserStatesDryRun } from "./chmi-cap-v2/migrate-ids.mjs";
import { createGeoRegistry } from "./chmi-cap-v2/geo-registry.mjs";
import { createFixtureDiscovery, resolveDiscoveryAdapter, selectLatestPerProductStream, capProductKeyFromUrl } from "./chmi-cap-v2/discovery-adapter.mjs";
import { shouldResetUnreadOnRevision } from "./chmi-cap-v2/unread-rules.mjs";
import { CHMI_PUBLIC_ALERTS_URL } from "./chmi-cap-v2/config.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIX = path.join(__dirname, "fixtures", "chmi-cap-v2");

const fails = [];
function ok(name, cond, detail) {
  if (!cond) fails.push(`${name}: ${detail || "failed"}`);
}

function read(name) {
  return fs.readFileSync(path.join(FIX, name), "utf8");
}

// --- config / flag default ---
{
  const c = getChmiCapV2Config({});
  ok("flag_default_off", c.mode === "off" && !c.enabled && !c.shadow, c.mode);
  ok("legacy_path_when_off", isLegacyProductionPath(c), "legacy");
  const shadow = getChmiCapV2Config({ IU_CHMI_CAP_V2_MODE: "shadow" });
  ok("shadow_mode", shadow.mode === "shadow" && shadow.shadow && !shadow.enabled, shadow.mode);
  const active = getChmiCapV2Config({ IU_CHMI_CAP_V2_MODE: "active" });
  ok("active_mode", active.enabled === true, String(active.enabled));
}

// --- XML safety ---
{
  let threw = false;
  try {
    parseSafeXml(read("unsafe-xxe.xml"));
  } catch (e) {
    threw = e.code === "XML_UNSAFE" || /forbidden|DOCTYPE|ENTITY/i.test(e.message);
  }
  ok("reject_xxe_dtd", threw, "expected XML_UNSAFE");

  let deep = "<a>".repeat(50) + "x" + "</a>".repeat(50);
  threw = false;
  try {
    parseSafeXml(deep, { maxXmlDepth: 20 });
  } catch (e) {
    threw = e.code === "XML_DEPTH";
  }
  ok("reject_deep_xml", threw, "expected XML_DEPTH");
}

// --- CAP parse + Czech preference ---
{
  const alert = parseCapAlertXml(read("alert-new.xml"));
  ok("parse_identifier", !!alert.identifier, "identifier");
  ok("parse_msgType_Alert", alert.msgType === "Alert", alert.msgType);
  ok("czech_info_preferred", alert.infos.length === 1 && /^cs/i.test(alert.infos[0].language), JSON.stringify(alert.selectedLanguages));
  ok("geocode_cisorp", alert.infos[0].areas[0].geocodes[0].value === "6203", "geocode");
  ok("fields_description", !!alert.infos[0].description, "description");
  ok("fields_instruction", !!alert.infos[0].instruction, "instruction");
}

// --- identity + lifecycle ---
{
  const a1 = parseCapAlertXml(read("alert-new.xml"));
  const id1 = buildCapIdentity(a1);
  const known = new Map([[id1.cap_message_id, id1.alert_thread_id]]);
  const a2 = parseCapAlertXml(read("alert-update-expand.xml"));
  const id2 = buildCapIdentity(a2, { knownThreads: known });
  ok("thread_stable_on_update", id1.alert_thread_id === id2.alert_thread_id, `${id1.alert_thread_id} vs ${id2.alert_thread_id}`);
  ok("cap_message_differs", id1.cap_message_id !== id2.cap_message_id, "same message id");
  ok("refs_parse", parseCapReferences(a2.references).ok && parseCapReferences(a2.references).refs.length === 1, "refs");

  const a3 = parseCapAlertXml(read("alert-cancel.xml"));
  const id3 = buildCapIdentity(a3, { knownThreads: known });
  ok("cancel_same_thread", id3.alert_thread_id === id1.alert_thread_id, id3.alert_thread_id);

  const fire = parseCapAlertXml(read("alert-fire-same-orp.xml"));
  const idFire = buildCapIdentity(fire);
  ok("parallel_hazard_different_thread", idFire.alert_thread_id !== id1.alert_thread_id, "threads collided");
  ok("hazard_instances_present", id1.hazards.length >= 1 && idFire.hazards.length >= 1, "hazards");
}

// --- process + geo quarantine + revisions immutable ---
{
  const docs = [
    { name: "alert-new.xml", xml: read("alert-new.xml") },
    { name: "alert-update-expand.xml", xml: read("alert-update-expand.xml") },
    { name: "alert-fire-same-orp.xml", xml: read("alert-fire-same-orp.xml") },
    { name: "alert-unknown-orp.xml", xml: read("alert-unknown-orp.xml") },
    { name: "alert-new.xml", xml: read("alert-new.xml") }, // duplicate
  ];
  const result = processCapDocuments(docs);
  ok("process_valid", result.report.valid >= 4, JSON.stringify(result.report));
  ok("process_duplicate", result.report.duplicates >= 1, String(result.report.duplicates));
  ok("quarantine_unknown_orp", result.report.quarantine.some((q) => q.code === "9999"), "no quarantine");
  const revIds = result.report.revisions.map((r) => r.cap_message_id);
  ok("revisions_unique", new Set(revIds).size === revIds.length, "dup revisions");

  const feed = revisionsToFeed(result.report.revisions);
  ok("feed_public_url", feed.every((i) => i.url === CHMI_PUBLIC_ALERTS_URL), feed[0] && feed[0].url);
  ok("feed_no_xml_url", feed.every((i) => !/\.xml/i.test(i.url)), "xml url leaked");
  ok("feed_stable_ids", feed.every((i) => String(i.id).startsWith("ie-chmi-v2-")), "bad id");
  ok(
    "feed_title_no_chmi_prefix",
    feed.every((i) => !/^\s*Výstraha\s+ČHMÚ\s*:/i.test(String(i.title || ""))),
    feed.map((i) => i.title).slice(0, 3).join(" | ")
  );
  ok(
    "feed_title_keeps_event",
    feed.some((i) => /sucho|bouř|vítr|déšť|mráz|povod/i.test(String(i.title || ""))),
    feed[0] && feed[0].title
  );
  ok(
    "feed_legal_provenance",
    feed.every((i) => i.legal && i.legal.approvalStatus && i.legal.distributionId),
    JSON.stringify(feed[0] && feed[0].legal)
  );
  ok("feed_precise_orp", feed.some((i) => i.region && i.region.precise === true && i.region.level === "orp"), "no precise");
  ok("feed_no_false_whole_kraj", !feed.some((i) => i.region && i.region.precise && i.region.level === "kraj" && !(i.region.orpIds || []).length), "false kraj");
  ok("parallel_same_orp_two_items", feed.filter((i) => i.region && i.region.orpCode === "6203").length >= 2, "merged hazards");

  // full CISORP registry
  const reg = createGeoRegistry();
  ok("registry_orp_complete", (reg.counts && reg.counts.orp) === 206, JSON.stringify(reg.counts));
  ok("registry_okres_complete", (reg.counts && reg.counts.okres) === 78, JSON.stringify(reg.counts));
  ok("registry_kraj_complete", (reg.counts && reg.counts.kraj) === 14, JSON.stringify(reg.counts));
  ok("registry_utf8_kraj", /Jihomoravsk[ýy] kraj/.test((reg.get("kraj", "CZ064") && reg.get("kraj", "CZ064").name) || ""), (reg.get("kraj", "CZ064") && reg.get("kraj", "CZ064").name) || "");
  ok("registry_alias_praha_1100", !!reg.get("orp", "1100") && reg.get("orp", "1100").code === "1000", "alias");
  ok("registry_brno_6203", !!reg.get("orp", "6203") && /brno/i.test(reg.get("orp", "6203").name), "brno");
  ok("registry_brno_parent_okres", !!(reg.get("orp", "6203") && reg.get("orp", "6203").parentId), (reg.get("orp", "6203") && reg.get("orp", "6203").parentId) || "");

  // Completeness: multi info + multi area + no drought-only whitelist + all ORPs preserved
  {
    const multi = processCapDocuments([{ xml: read("alert-multi-events-areas.xml") }]);
    ok("multi_info_parsed", multi.report.revisions[0] && (multi.report.revisions[0].hazards || []).length >= 3, String((multi.report.revisions[0] || {}).hazards && multi.report.revisions[0].hazards.length));
    const multiFeed = revisionsToFeed(multi.report.revisions);
    ok("multi_events_published", multiFeed.length >= 3, String(multiFeed.length));
    ok(
      "no_silent_zadna_filter_only",
      multiFeed.every((i) => !/^žádn/i.test(String((i.capV2 && i.capV2.event) || i.title || ""))),
      multiFeed.map((i) => i.title).join("|")
    );
    ok(
      "heat_and_drought_both",
      multiFeed.some((i) => /teplot/i.test(i.title || "")) && multiFeed.some((i) => /such/i.test(i.title || "")),
      multiFeed.map((i) => i.title).join("|")
    );
    const heat = multiFeed.find((i) => /Vysoké teploty/i.test(i.title || ""));
    ok("multi_area_orp_ids", heat && (heat.region.orpIds || []).length >= 3, heat && JSON.stringify(heat.region.orpIds));
    ok("multi_area_orp_names", heat && (heat.region.orpNames || []).length >= 3, heat && JSON.stringify(heat.region.orpNames));
    ok(
      "title_not_single_town_only",
      heat && /dalších|ORP|kraj/i.test(String(heat.region.summary || heat.title || "")),
      heat && (heat.region.summary || heat.title)
    );
    ok("description_published", heat && String(heat.description || "").length > 0, heat && heat.description);
    ok(
      "city_filter_haystack_plzen",
      heat && String(heat.capV2.searchText || "").includes("plzen"),
      heat && heat.capV2.searchText
    );
    const mapped = heat && heat.capV2 && heat.capV2.geo ? heat.capV2.geo.mappedAreas : 0;
    ok("geo_mapped_areas", mapped >= 3, String(mapped));
  }

  // No hard-coded max-3 publish in normalize path
  {
    const many = processCapDocuments([{ xml: read("alert-multi-events-areas.xml") }, { xml: read("alert-fire-same-orp.xml") }]);
    const f = revisionsToFeed(many.report.revisions);
    ok("no_hard_limit_three", f.length > 3, String(f.length));
  }

  // shadow must not publish
  const pub = atomicPublishDecision({
    mode: "shadow",
    validationOk: true,
    candidateSnapshot: { items: feed },
    lastKnownGood: { items: [] },
  });
  ok("shadow_no_publish", pub.publish === false && pub.reason === "shadow_or_off", pub.reason);
}

// --- cancel flow ---
{
  const result = processCapDocuments([
    { xml: read("alert-new.xml") },
    { xml: read("alert-cancel.xml") },
  ]);
  ok("cancel_counted", result.report.cancels >= 1, String(result.report.cancels));
  const feed = revisionsToFeed(result.report.revisions.filter((r) => /^Cancel$/i.test(r.msgType)));
  ok("cancel_status", feed.every((i) => i.status === "zruseno"), feed.map((i) => i.status).join(","));
}

// --- sync primitives ---
{
  const lock = { locked: false, runId: null, startedAt: null, expiresAt: null };
  const a = tryAcquireLock(lock, { runId: "r1", nowMs: 1000, ttlMs: 5000 });
  ok("lock_acquire", a.ok, "acquire");
  const b = tryAcquireLock(lock, { runId: "r2", nowMs: 2000, ttlMs: 5000 });
  ok("lock_single_flight", !b.ok, "second lock allowed");
  releaseLock(lock, "r1");
  const c = tryAcquireLock(lock, { runId: "r3", nowMs: 3000, ttlMs: 5000 });
  ok("lock_release", c.ok, "after release");

  const st = createSyncState("fixture://x");
  const r304 = applyConditionalResult({ status: 304, headers: {} }, st);
  ok("http_304", r304.action === "not_modified" && st.status === "not_modified", r304.action);

  const st2 = createSyncState("fixture://y");
  const body = read("alert-new.xml");
  const r200 = applyConditionalResult({ status: 200, headers: { etag: '"a"', "last-modified": "Wed, 01 Jul 2026 10:00:00 GMT" }, body }, st2);
  ok("http_200_process", r200.action === "process", r200.action);
  const rSame = applyConditionalResult({ status: 200, headers: { etag: '"a"' }, body }, st2);
  ok("hash_unchanged", rSame.action === "hash_unchanged", rSame.action);

  const st3 = createSyncState("fixture://z");
  applyConditionalResult({ status: 429, headers: { "retry-after": "120" } }, st3, { nowMs: Date.parse("2026-07-29T10:00:00Z") });
  ok("retry_after_backoff", !!st3.backoff_until && st3.status === "degraded", st3.backoff_until);

  ok("suspicious_drop", suspiciousDrop(10, 2) === true, "not suspicious");
  ok("suspicious_ok_small", suspiciousDrop(2, 0) === false, "false positive");
}

// --- migration dry-run ---
{
  const processed = processCapDocuments([{ xml: read("alert-new.xml") }]);
  const v2 = revisionsToFeed(processed.report.revisions);
  const legacyItems = [
    {
      id: "ie-chmi-deadbeef12",
      sourceId: "chmi",
      title: v2[0].title,
      region: { name: v2[0].region.name },
      publishedAt: v2[0].publishedAt,
      url: "https://opendata.chmi.cz/foo.xml?id=" + encodeURIComponent(processed.report.revisions[0].identifier.slice(-24)),
    },
  ];
  const mig = migrateUserStatesDryRun(
    { read: ["ie-chmi-deadbeef12"], saved: ["ie-chmi-deadbeef12"], hidden: [] },
    legacyItems,
    v2,
    { applyProbable: true }
  );
  ok("migration_dry_run", mig.dryRun === true, "not dry");
  ok("migration_no_loss_counts", mig.after.saved >= 1 && mig.after.read >= 1, JSON.stringify(mig.counts));
}

// --- unknown msgType ---
{
  const xml = read("alert-new.xml").replace("<msgType>Alert</msgType>", "<msgType>WeirdType</msgType>");
  const alert = parseCapAlertXml(xml);
  const id = buildCapIdentity(alert);
  ok("unknown_msgType_no_lifecycle", id.appliesLifecycle === false && id.msgTypeKnown === false, JSON.stringify(id));
}

// --- discovery adapter isolation (fixture; no network) ---
{
  const files = [{ name: "alert-new.xml", xml: read("alert-new.xml") }];
  const disc = createFixtureDiscovery(files);
  ok("discovery_type_fixture", disc.type === "fixture", disc.type);
  const latest = await disc.listLatest();
  ok("discovery_list", latest.length === 1, String(latest.length));
  const body = await disc.fetchBody("alert-new.xml");
  ok("discovery_fetch_body", !!body.body && body.status === 200, String(body.status));
  const resolved = resolveDiscoveryAdapter(
    { mode: "shadow", userAgent: "test" },
    { kind: "fixture", files }
  );
  ok("discovery_resolve_fixture", resolved.type === "fixture", resolved.type);
  ok("discovery_not_html_api", resolved.role !== "html_api", resolved.role || "none");
  const openDef = resolveDiscoveryAdapter({}, { kind: "opendata_active_streams" });
  ok("discovery_active_streams", openDef.type === "opendata_active_streams", openDef.type);
  ok("discovery_no_fixed_maxfiles_field", openDef.selection === "latest_per_product_stream", openDef.selection);
  const legacy = resolveDiscoveryAdapter({}, { kind: "opendata_newest_file" });
  ok("discovery_legacy_alias_to_streams", legacy.type === "opendata_active_streams", legacy.type);

  const selected = selectLatestPerProductStream([
    { url: "https://opendata.chmi.cz/meteorology/weather/alerts/cap/alert_cap_50_290800.xml", mtime: 100 },
    { url: "https://opendata.chmi.cz/meteorology/weather/alerts/cap/alert_cap_50_290854.xml", mtime: 200 },
    { url: "https://opendata.chmi.cz/meteorology/weather/alerts/cap/alert_cap_70_281200.xml", mtime: 150 },
    { url: "https://opendata.chmi.cz/meteorology/weather/alerts/cap/alert_cap_70_270100.xml", mtime: 50 },
  ]);
  ok("select_one_per_stream", selected.length === 2, String(selected.length));
  ok(
    "select_newest_50",
    selected.some((x) => x.productKey === "50" && /290854/.test(x.name)),
    JSON.stringify(selected)
  );
  ok(
    "select_newest_70",
    selected.some((x) => x.productKey === "70" && /281200/.test(x.name)),
    JSON.stringify(selected)
  );
  ok("product_key_50", capProductKeyFromUrl("alert_cap_50_290854.xml") === "50", capProductKeyFromUrl("alert_cap_50_x.xml"));
  ok("product_key_70", capProductKeyFromUrl("alert_cap_70_281200.xml") === "70", "70");

  // Regression: discovery-adapter must not contain fixed slice(0, maxFiles) completeness limit
  {
    const src = fs.readFileSync(path.join(__dirname, "chmi-cap-v2", "discovery-adapter.mjs"), "utf8");
    ok("no_slice_maxfiles_limit", !/\.slice\(\s*0\s*,\s*maxFiles\s*\)/.test(src), "slice(0,maxFiles) present");
    ok("no_maxfiles_env_knob", !/IU_CHMI_CAP_V2_MAX_FILES/.test(src), "MAX_FILES still referenced");
  }
}

// --- unread reset rules ---
{
  ok("unread_new", shouldResetUnreadOnRevision({ change_type: "new" }) === true, "new");
  ok("unread_area_expand", shouldResetUnreadOnRevision({ changeType: "area_expand" }) === true, "expand");
  ok("unread_minor_no", shouldResetUnreadOnRevision({ changeType: "area_reduce" }) === false, "reduce");
}

// --- lightweight parse performance budget (fixtures) ---
{
  const t0 = Date.now();
  for (let i = 0; i < 50; i++) parseCapAlertXml(read("alert-new.xml"));
  const ms = Date.now() - t0;
  ok("perf_parse_50_under_2s", ms < 2000, String(ms));
}

if (fails.length) {
  console.error("CHMI_CAP_V2_GUARD=FAIL");
  for (const f of fails) console.error("FAIL " + f);
  process.exit(1);
}
console.log("CHMI_CAP_V2_GUARD=PASS");
console.log("checks_ok mode_default=off fixtures_only=1 completeness=1");
process.exit(0);
