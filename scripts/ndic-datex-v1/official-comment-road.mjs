/**
 * Source-backed road identity from official NDIC comment when structured/TMC road is empty.
 * Lightweight (no presenter import) — safe for 1GB VPS live tick memory budget.
 * Fail-closed: primary prose only; never invents roads from detour text.
 */

function clean(s) {
  return String(s || "").replace(/\s+/g, " ").trim();
}

function normalizeMotorwayRoadToken(raw) {
  const t = clean(raw).toUpperCase().replace(/\s+/g, "");
  if (!/^[DER]\d{1,3}[A-Z]?$/.test(t)) return "";
  return t;
}

/**
 * Split primary event prose from a trailing detour/route section.
 */
export function splitPrimaryVsDetourCommentLite(rawText) {
  const text = clean(rawText);
  if (!text) return { primaryText: "", detourText: "" };
  const m = text.match(/\bObjížďk[ay]\b|\bObjízdn[áa]\s+tras|\bObjizdka\b/i);
  if (!m || m.index == null) return { primaryText: text, detourText: "" };
  return {
    primaryText: clean(text.slice(0, m.index)),
    detourText: clean(text.slice(m.index)),
  };
}

/**
 * Explicit motorway tokens from official NDIC primary comment only.
 */
export function extractMotorwayNumbersFromOfficialCommentLite(rawText) {
  const { primaryText } = splitPrimaryVsDetourCommentLite(rawText);
  const text = primaryText || clean(rawText);
  if (!text) return [];
  const found = [];
  const push = (tok) => {
    const n = normalizeMotorwayRoadToken(tok);
    if (n && !found.includes(n)) found.push(n);
  };
  const lead = text.match(/^\s*([DER]\d{1,3}[A-Za-z]?)\b/i);
  if (lead) push(lead[1]);
  const dalniceRe = /\bdálnice\s+([DER]\d{1,3}[A-Za-z]?)\b/gi;
  let dm;
  while ((dm = dalniceRe.exec(text))) push(dm[1]);
  const exitPaired = text.match(
    /\b([DER]\d{1,3}[A-Za-z]?)\s+(?:výjezd|sjezd|nájezd)?\s*EXIT(?:u|e)?\s+\d{1,4}[A-Za-z]?\b/i
  );
  if (exitPaired) push(exitPaired[1]);
  return found;
}

/**
 * Classed silnice I/II/III from primary official comment.
 */
function extractClassedRoadFromOfficialComment(rawText) {
  const { primaryText } = splitPrimaryVsDetourCommentLite(rawText);
  const text = primaryText || clean(rawText);
  if (!text) return "";
  const re =
    /\b(?:(?:na\s+)?silnici|silnice|sil\.)\s*(?:č\.\s*)?((?:I{1,3}|II|III)\s*\/\s*\d{1,6}[A-Za-z]?)\b/i;
  const m = text.match(re);
  if (!m) return "";
  return clean(m[1]).replace(/\s+/g, "").replace(/^(i{1,3}|ii|iii)\//i, (x) => x.toUpperCase());
}

/**
 * @param {string|null|undefined} comment
 * @returns {string}
 */
export function extractRoadNumberFromNdicComment(comment) {
  const text = String(comment || "").trim();
  if (!text) return "";
  const mw = extractMotorwayNumbersFromOfficialCommentLite(text);
  if (mw.length) return mw[0];
  return extractClassedRoadFromOfficialComment(text) || "";
}

/**
 * Lightweight publish-decision reason for audit/tests (not user-facing).
 * @param {{ roadNumber?: string, localizationTrust?: string, quarantine?: boolean, publishable?: boolean, status?: string }} item
 * @param {{ commentRoad?: string }} [meta]
 */
export function classifyPublishDecision(item, meta = {}) {
  if (!item || typeof item !== "object") {
    return { publishDecision: "invalidSource", publishDecisionReason: "missing_item" };
  }
  if (item.quarantine === true) {
    return {
      publishDecision: "unsupported",
      publishDecisionReason: item.quarantineReason || "quarantine",
    };
  }
  if (item.publishable === false) {
    const st = String(item.status || "");
    if (st === "ukonceno" || st === "zruseno") {
      return {
        publishDecision: st === "zruseno" ? "cancelled" : "ended",
        publishDecisionReason: st,
      };
    }
    return {
      publishDecision: "invalidSource",
      publishDecisionReason: "not_publishable",
    };
  }
  const road = String(item.roadNumber || "").trim();
  if (!road && meta.commentRoad) {
    return {
      publishDecision: "published",
      publishDecisionReason: "road_from_official_comment",
    };
  }
  if (!road && String(item.localizationTrust || "") === "national_fallback") {
    return {
      publishDecision: "published",
      publishDecisionReason: "active_without_structured_road",
    };
  }
  return { publishDecision: "published", publishDecisionReason: "ok" };
}
