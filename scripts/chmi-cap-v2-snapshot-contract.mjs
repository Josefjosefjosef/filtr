/**
 * Empirical CHMI snapshot-contract runner (product-supersession model).
 * Independent oracle = newest-by-CAP-sent active infos (no selectLatestPerProductStream).
 * Production path = mtime head via processCapDocuments.
 *
 * Exit 0 = SNAPSHOT_CONTRACT_PASS
 */
import fs from "fs";
import path from "path";
import { listCapXmlFromIndex } from "./iu-info-events-lib.mjs";
import { capProductKeyFromUrl, selectLatestPerProductStream } from "./chmi-cap-v2/discovery-adapter.mjs";
import { parseCapAlertXml } from "./chmi-cap-v2/parse-cap.mjs";
import { processCapDocuments } from "./chmi-cap-v2/sync-core.mjs";
import { mergeFeedItemsById, revisionsToFeed } from "./chmi-cap-v2/normalize-feed.mjs";
import { latestRevisionForThread } from "./chmi-cap-v2/revisions.mjs";
import { groupListedByProductStream } from "./chmi-cap-v2/lifecycle.mjs";
import { createGeoRegistry } from "./chmi-cap-v2/geo-registry.mjs";
import { CHMI_OPENDATA_CAP_INDEX, CHMI_SYNC_UA, getChmiCapV2Config } from "./chmi-cap-v2/config.mjs";
import {
  validateStreamSnapshotContract,
  diagnosticStrictUnexpiredInclusion,
  oracleProductSupersessionActive,
  canonicalHazardKey,
  activeInfosAsOf,
} from "./chmi-cap-v2/snapshot-contract.mjs";

const OUT = path.join(process.env.TEMP || process.env.TMPDIR || ".", "iu_chmi_snapshot_contract.json");
const CACHE = path.join(process.env.TEMP || process.env.TMPDIR || ".", "chmi_cap_xml_cache");
const CONCURRENCY = 12;

function fold(s) {
  return String(s || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

async function fetchText(url) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), 45000);
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": CHMI_SYNC_UA, Accept: "*/*" },
      signal: ac.signal,
    });
    return { status: res.status, body: await res.text() };
  } finally {
    clearTimeout(t);
  }
}

async function loadXml(url) {
  fs.mkdirSync(CACHE, { recursive: true });
  const name = url.split("/").pop();
  const cp = path.join(CACHE, name);
  if (fs.existsSync(cp) && fs.statSync(cp).size > 100) return fs.readFileSync(cp, "utf8");
  const res = await fetchText(url);
  if (res.status < 200 || res.status >= 300) return null;
  fs.writeFileSync(cp, res.body);
  return res.body;
}

async function mapPool(items, limit, fn) {
  const out = new Array(items.length);
  let i = 0;
  async function worker() {
    while (i < items.length) {
      const idx = i++;
      out[idx] = await fn(items[idx], idx);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, Math.max(1, items.length)) }, () => worker()));
  return out;
}

function headViaProduction(doc, nowIso) {
  const config = getChmiCapV2Config({ IU_CHMI_CAP_V2_MODE: "active" });
  const registry = createGeoRegistry();
  const result = processCapDocuments([{ xml: doc.xml, sourceUrl: doc.sourceUrl }], { config, registry, receivedAt: nowIso });
  const tids = [...new Set(result.report.revisions.map((r) => r.alert_thread_id))];
  const latest = tids.map((tid) => latestRevisionForThread(result.store, tid)).filter(Boolean);
  return mergeFeedItemsById(revisionsToFeed(latest, { nowIso })).filter((i) => i.status === "aktivni");
}

async function main() {
  const nowIso = new Date().toISOString();
  const nowMs = Date.parse(nowIso);
  const report = {
    verifiedAt: nowIso,
    model: "chmi_product_supersession",
    verdict: "FAIL",
    snapshotContractValid: false,
    architectureDecision: null,
    streams: [],
    historicalSimulations: [],
    diagnosticsStrictInclusion: [],
    totals: {},
    alarms: [],
    refMetrics: {},
  };

  console.log("snapshot_contract: index...");
  const idx = await fetchText(CHMI_OPENDATA_CAP_INDEX);
  if (idx.status < 200 || idx.status >= 300) {
    report.alarms.push({ code: "INDEX_HTTP", status: idx.status });
    fs.writeFileSync(OUT, JSON.stringify(report, null, 2));
    process.exit(1);
  }
  const listed = listCapXmlFromIndex(idx.body, CHMI_OPENDATA_CAP_INDEX);
  const grouped = groupListedByProductStream(listed, capProductKeyFromUrl);
  const heads = selectLatestPerProductStream(listed);
  report.totals.listedXml = listed.length;
  report.totals.streamCount = grouped.size;
  report.totals.headDocuments = heads.length;

  console.log(`snapshot_contract: streams=${grouped.size} listed=${listed.length} caching XML...`);
  await mapPool(listed, CONCURRENCY, async (item, i) => {
    if (i % 50 === 0) console.log(`download ${i}/${listed.length}`);
    await loadXml(item.url);
  });

  let totalRefs = 0;
  let unresolved = 0;
  let crossDoc = 0;
  let anyFail = false;

  for (const [productKey, files] of grouped) {
    const docs = [];
    for (const f of files) {
      const xml = await loadXml(f.url);
      if (!xml) continue;
      try {
        const alert = parseCapAlertXml(xml, { sourceUrl: f.url });
        docs.push({
          xml,
          sourceUrl: f.url,
          productKey,
          mtime: f.mtime || 0,
          name: f.url.split("/").pop(),
          sent: alert.sent,
          identifier: alert.identifier,
          _alert: alert,
        });
      } catch {
        /* skip */
      }
    }
    docs.sort((a, b) => a.sent.localeCompare(b.sent) || a.name.localeCompare(b.name));
    const headMeta = heads.find((h) => h.productKey === productKey);
    const mtimeHead = docs.find((d) => d.sourceUrl === (headMeta && headMeta.url)) || docs[docs.length - 1];
    const validated = validateStreamSnapshotContract({
      productKey,
      historyDocsAsc: docs,
      mtimeHeadDoc: mtimeHead,
      asOfMs: nowMs,
    });
    const prodItems = headViaProduction(mtimeHead, nowIso);
    const oracle = oracleProductSupersessionActive(docs, nowMs);

    // Production vs independent sent-oracle (event|severity|expires)
    const prodKeys = new Set(
      prodItems.map((i) => {
        const c = i.capV2 || {};
        return [fold(c.event || String(i.title).split(" — ")[0]), fold(c.severity), fold(c.expires || i.validTo || "")].join("|");
      })
    );
    const oraKeys = new Set(oracle.active.map((h) => [h.event, h.severity, fold(h.expires)].join("|")));
    const prodMatch =
      [...prodKeys].every((k) => oraKeys.has(k)) && [...oraKeys].every((k) => prodKeys.has(k));

    totalRefs += validated.refStats.totalReferences;
    unresolved += validated.refStats.unresolvedReferences;
    crossDoc += validated.refStats.crossDocumentReferences;

    const streamRow = {
      productKey,
      historyFiles: docs.length,
      headName: mtimeHead.name,
      headActive: validated.headActiveCount,
      oracleActive: validated.oracleActiveCount,
      productionActive: prodItems.length,
      alertMatch: validated.ok && prodMatch,
      areaMatch: validated.areaAgree,
      mtimeSentAgree: validated.mtimeVsSent.agree,
      refStats: validated.refStats,
      alarms: validated.alarms,
      result: validated.ok && prodMatch ? "PASS" : "FAIL",
    };
    if (streamRow.result === "FAIL") {
      anyFail = true;
      report.alarms.push(...validated.alarms);
      if (!prodMatch) report.alarms.push({ code: "PROD_VS_ORACLE_MISMATCH", productKey });
    }
    report.streams.push(streamRow);
    console.log(
      `stream=${productKey} hist=${docs.length} head=${streamRow.headActive} oracle=${streamRow.oracleActive} prod=${streamRow.productionActive} result=${streamRow.result}`
    );

    // Historical: at each sampled moment, mtime/sent head among prefix must match sent-oracle of prefix
    const step = docs.length > 60 ? Math.ceil(docs.length / 20) : Math.max(1, Math.floor(docs.length / 12) || 1);
    for (let i = 0; i < docs.length; i += step) {
      const prefix = docs.slice(0, i + 1);
      const thenHead = prefix[prefix.length - 1]; // sent-order head
      const v = validateStreamSnapshotContract({
        productKey,
        historyDocsAsc: prefix,
        mtimeHeadDoc: thenHead, // at historical moment use sent head as both
        asOfMs: Date.parse(thenHead.sent) || nowMs,
      });
      report.historicalSimulations.push({
        productKey,
        momentIndex: i,
        historySize: prefix.length,
        headName: thenHead.name,
        match: v.ok,
        headActive: v.headActiveCount,
        oracleActive: v.oracleActiveCount,
      });
      if (!v.ok) {
        anyFail = true;
        report.alarms.push({ code: "HISTORICAL_SUPERSESSION_MISMATCH", productKey, headName: thenHead.name });
      }
    }

    // Diagnostic only: strict inclusion samples (expected CHMI omissions)
    for (let i = Math.max(1, docs.length - 15); i < docs.length; i++) {
      const viol = diagnosticStrictUnexpiredInclusion(docs[i - 1]._alert, docs[i]._alert);
      if (viol.length) {
        report.diagnosticsStrictInclusion.push({
          productKey,
          older: docs[i - 1].name,
          newer: docs[i].name,
          omissions: viol.map((v) => v.event),
        });
      }
    }
  }

  report.refMetrics = {
    totalReferences: totalRefs,
    unresolvedReferences: unresolved,
    crossDocumentReferences: crossDoc,
  };
  // Under product-supersession, unresolved refs to aged-out Alert roots are OK (head self-contained).
  report.totals.historicalSimulations = report.historicalSimulations.length;
  report.totals.historicalMismatches = report.historicalSimulations.filter((s) => !s.match).length;
  report.totals.strictInclusionDiagnostics = report.diagnosticsStrictInclusion.length;
  report.snapshotContractValid = !anyFail && report.totals.historicalMismatches === 0;
  report.verdict = report.snapshotContractValid ? "SNAPSHOT_CONTRACT_PASS" : "SNAPSHOT_CONTRACT_FAIL";
  report.architectureDecision = report.snapshotContractValid
    ? "VARIANT_A_CHMI_PRODUCT_SUPERSESSION_HEAD_ONLY"
    : "VARIANT_B_UNLIMITED_LIFECYCLE_REPLAY";

  fs.writeFileSync(OUT, JSON.stringify(report, null, 2));
  console.log("CHMI_CAP_SNAPSHOT_CONTRACT=" + report.verdict);
  console.log("architectureDecision=" + report.architectureDecision);
  console.log("historicalMismatches=" + report.totals.historicalMismatches);
  console.log("strictInclusionDiagnostics=" + report.totals.strictInclusionDiagnostics);
  console.log("unresolvedReferences=" + unresolved + " (informational under supersession)");
  console.log("report=" + OUT);
  process.exit(report.snapshotContractValid ? 0 : 1);
}

main().catch((e) => {
  console.error("CHMI_CAP_SNAPSHOT_CONTRACT=FAIL");
  console.error(String(e && e.stack ? e.stack : e));
  process.exit(1);
});
