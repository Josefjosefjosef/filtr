/**
 * CHMI open-data product-supersession snapshot contract.
 *
 * Empirically, ČHMÚ publishes each product stream file as a full superseding
 * snapshot of that product's current warnings. A later Update may omit a
 * previously listed hazard to end it (without Cancel). Empty expires on
 * historical files must NOT keep ghost alerts alive across supersession.
 *
 * Contract (Variant A — head-only is safe when this holds):
 * 1. Newest-by-mtime and newest-by-CAP-sent select the same head (or sent-head
 *    is the mtime-head).
 * 2. Head document is self-contained for publication (all current infos present).
 * 3. Concurrent product streams are discovered independently (no whitelist).
 * 4. If a listed file newer-by-sent than the chosen head appears, FAIL.
 *
 * Strict unexpired-inclusion (older hazards with future expires must appear in
 * newer) is NOT required by CHMI practice — omission ends hazards. That check
 * is available as diagnostic only.
 */
import { parseCapAlertXml } from "./parse-cap.mjs";
import { parseCapReferences } from "./identity.mjs";

function fold(s) {
  return String(s || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

export function realInfoBlocks(alert) {
  return (alert.infos || []).filter((i) => {
    const ev = fold(i.event);
    if (/^zadn|^no warning|^none$/.test(ev)) return false;
    if (/^None$/i.test(String(i.severity || ""))) return false;
    return true;
  });
}

/**
 * Infos eligible for public publication as of `asOfMs`.
 * Matches normalize-feed classifyChmiTemporalState publishable set:
 *   requires onset + expires, expires > onset, expires > asOfMs
 *   (covers temporally active AND scheduled / future onset).
 * Missing expires is NOT treated as forever-active — those are nezaraditelne.
 */
export function activeInfosAsOf(alert, asOfMs) {
  if (/^Cancel$/i.test(String(alert.msgType || ""))) return [];
  if (!/^Actual$/i.test(String(alert.status || "Actual"))) return [];
  return realInfoBlocks(alert).filter((i) => {
    const onset = Date.parse(i.onset || i.effective || "") || 0;
    const exp = Date.parse(i.expires || "") || 0;
    if (!onset || !exp) return false;
    if (exp <= onset) return false;
    if (exp <= asOfMs) return false;
    return true;
  });
}

export function canonicalHazardKey(info) {
  const geos = [];
  for (const a of info.areas || []) {
    for (const g of a.geocodes || []) {
      if (g.valueName && g.value) geos.push(`${fold(g.valueName)}:${g.value}`);
    }
  }
  geos.sort();
  return [fold(info.event), fold(info.severity), fold(info.expires), geos.join(",")].join("|");
}

/**
 * Independent oracle for CHMI product-supersession:
 * current state = active infos in the newest document by CAP sent (not mtime).
 * Does not use selectLatestPerProductStream / normalize-feed.
 */
export function oracleProductSupersessionActive(docsAsc, asOfMs = Date.now()) {
  if (!docsAsc || !docsAsc.length) return { active: [], head: null, refStats: emptyRefStats() };
  const sorted = [...docsAsc].sort((a, b) => {
    const sa = a.sent || (a._alert && a._alert.sent) || "";
    const sb = b.sent || (b._alert && b._alert.sent) || "";
    return sa.localeCompare(sb) || String(a.sourceUrl || "").localeCompare(String(b.sourceUrl || ""));
  });
  const head = sorted[sorted.length - 1];
  const alert = head._alert || parseCapAlertXml(head.xml, { sourceUrl: head.sourceUrl });
  const infos = activeInfosAsOf(alert, asOfMs);
  const refStats = analyzeHeadReferences(alert, sorted);
  return {
    active: infos.map((i) => ({
      event: fold(i.event),
      severity: fold(i.severity),
      certainty: fold(i.certainty),
      urgency: fold(i.urgency),
      onset: i.onset || "",
      expires: i.expires || "",
      key: canonicalHazardKey(i),
      areaCount: (i.areas || []).length,
      geocodes: geocodesOf(i),
    })),
    head: { name: head.name || head.sourceUrl, sent: alert.sent, msgType: alert.msgType, identifier: alert.identifier },
    refStats,
  };
}

function geocodesOf(info) {
  const out = [];
  for (const a of info.areas || []) {
    for (const g of a.geocodes || []) {
      if (g.valueName && g.value) out.push(`${fold(g.valueName)}:${g.value}`);
    }
  }
  return out.sort();
}

function emptyRefStats() {
  return {
    totalReferences: 0,
    referencesResolvedInsideHead: 0,
    referencesResolvedFromHistory: 0,
    unresolvedReferences: 0,
    crossDocumentReferences: 0,
  };
}

export function analyzeHeadReferences(alert, historyDocsAsc) {
  const stats = emptyRefStats();
  const parsed = parseCapReferences(alert.references);
  if (!parsed.refs.length) return stats;
  const idents = new Set((historyDocsAsc || []).map((d) => (d._alert && d._alert.identifier) || d.identifier).filter(Boolean));
  idents.add(alert.identifier);
  for (const r of parsed.refs) {
    stats.totalReferences += 1;
    if (r.identifier === alert.identifier) {
      stats.referencesResolvedInsideHead += 1;
    } else if (idents.has(r.identifier)) {
      stats.referencesResolvedFromHistory += 1;
      stats.crossDocumentReferences += 1;
    } else {
      stats.unresolvedReferences += 1;
      stats.crossDocumentReferences += 1;
    }
  }
  return stats;
}

/**
 * Compare mtime-selected head vs sent-selected head for one stream's listings.
 * @param {{ url: string, mtime?: number, name?: string }[]} listedAscOrAny
 * @param {{ url: string, sent: string, name?: string }[]} docsWithSent
 */
export function compareMtimeVsSentHead(listed, docsWithSent) {
  const byMtime = [...(listed || [])].sort(
    (a, b) => (b.mtime || 0) - (a.mtime || 0) || String(b.url).localeCompare(String(a.url))
  )[0];
  const bySent = [...(docsWithSent || [])].sort(
    (a, b) => String(b.sent || "").localeCompare(String(a.sent || "")) || String(b.url || b.sourceUrl || "").localeCompare(String(a.url || a.sourceUrl || ""))
  )[0];
  const mtimeUrl = byMtime ? byMtime.url : null;
  const sentUrl = bySent ? bySent.sourceUrl || bySent.url : null;
  return {
    mtimeUrl,
    sentUrl,
    agree: !!(mtimeUrl && sentUrl && mtimeUrl === sentUrl),
    mtimeName: byMtime ? byMtime.name || String(mtimeUrl).split("/").pop() : null,
    sentName: bySent ? bySent.name || String(sentUrl).split("/").pop() : null,
  };
}

/**
 * Validate product-supersession contract for one stream.
 * Production head docs = [mtimeHeadDoc]; history = all docs for oracle.
 */
export function validateStreamSnapshotContract(opts) {
  const {
    productKey,
    historyDocsAsc = [],
    mtimeHeadDoc = null,
    asOfMs = Date.now(),
  } = opts || {};
  const alarms = [];
  const oracle = oracleProductSupersessionActive(historyDocsAsc, asOfMs);
  if (!mtimeHeadDoc) {
    alarms.push({ code: "MISSING_MTIME_HEAD", productKey });
    return { ok: false, productKey, alarms, oracle, snapshotContractValid: false };
  }
  const headAlert = mtimeHeadDoc._alert || parseCapAlertXml(mtimeHeadDoc.xml, { sourceUrl: mtimeHeadDoc.sourceUrl });
  const headActive = activeInfosAsOf(headAlert, asOfMs).map((i) => ({
    key: canonicalHazardKey(i),
    event: fold(i.event),
    severity: fold(i.severity),
    expires: i.expires || "",
    areaCount: (i.areas || []).length,
    geocodes: geocodesOf(i),
  }));

  const headKeys = new Set(headActive.map((h) => h.key));
  const oracleKeys = new Set(oracle.active.map((h) => h.key));
  const onlyHead = [...headKeys].filter((k) => !oracleKeys.has(k));
  const onlyOracle = [...oracleKeys].filter((k) => !headKeys.has(k));
  const agree = onlyHead.length === 0 && onlyOracle.length === 0;

  if (!agree) {
    alarms.push({ code: "HEAD_VS_SENT_ORACLE_MISMATCH", productKey, onlyHead: onlyHead.slice(0, 8), onlyOracle: onlyOracle.slice(0, 8) });
  }

  // Area universe
  const headAreas = new Set(headActive.flatMap((h) => h.geocodes));
  const oracleAreas = new Set(oracle.active.flatMap((h) => h.geocodes));
  const areaAgree =
    headAreas.size === oracleAreas.size && [...headAreas].every((a) => oracleAreas.has(a));
  if (!areaAgree) {
    alarms.push({
      code: "HEAD_VS_ORACLE_AREA_MISMATCH",
      productKey,
      headAreas: headAreas.size,
      oracleAreas: oracleAreas.size,
    });
  }

  // Cross-doc refs on head are expected for Update chains; unresolved means Alert root aged out of index.
  // Under product-supersession, unresolved refs do NOT block publication (head is self-contained),
  // but we record them. Fail only if head is Update/Cancel AND has zero infos while history oracle has active.
  const refStats = analyzeHeadReferences(headAlert, historyDocsAsc);
  if (/^(Update|Cancel)$/i.test(headAlert.msgType) && headActive.length === 0 && oracle.active.length > 0) {
    alarms.push({ code: "EMPTY_HEAD_WITH_ORACLE_ACTIVE", productKey });
  }

  const mtimeVsSent = compareMtimeVsSentHead(
    historyDocsAsc.map((d) => ({ url: d.sourceUrl, mtime: d.mtime || 0, name: d.name })),
    historyDocsAsc.map((d) => ({
      url: d.sourceUrl,
      sourceUrl: d.sourceUrl,
      sent: d.sent || (d._alert && d._alert.sent) || "",
      name: d.name,
    }))
  );
  if (!mtimeVsSent.agree) {
    alarms.push({ code: "MTIME_SENT_HEAD_DISAGREE", productKey, ...mtimeVsSent });
  }

  return {
    ok: alarms.length === 0,
    snapshotContractValid: alarms.length === 0,
    productKey,
    headActiveCount: headActive.length,
    oracleActiveCount: oracle.active.length,
    headAreas: headAreas.size,
    oracleAreas: oracleAreas.size,
    areaAgree,
    refStats,
    mtimeVsSent,
    alarms,
    headActive,
    oracleActive: oracle.active,
  };
}

/**
 * Diagnostic: strict unexpired-inclusion between consecutive docs (NOT CHMI publish gate).
 * Returns violations where older had unexpired hazard missing from newer.
 */
export function diagnosticStrictUnexpiredInclusion(olderAlert, newerAlert) {
  const newerSentMs = Date.parse(newerAlert.sent || "") || Date.now();
  const newerKeys = new Set(activeInfosAsOf(newerAlert, newerSentMs).map(canonicalHazardKey));
  const violations = [];
  for (const info of activeInfosAsOf(olderAlert, newerSentMs)) {
    const exp = Date.parse(info.expires || "") || 0;
    // Only flag when expires is explicitly in the future beyond newer.sent
    if (!exp || exp <= newerSentMs) continue;
    const key = canonicalHazardKey(info);
    if (!newerKeys.has(key)) {
      // Also try event-only match (severity/area may change via Update)
      const eventInNewer = activeInfosAsOf(newerAlert, newerSentMs).some((i) => fold(i.event) === fold(info.event));
      if (!eventInNewer) {
        violations.push({ event: info.event, severity: info.severity, expires: info.expires, key });
      }
    }
  }
  return violations;
}
