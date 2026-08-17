/**
 * Source-backed road identity from official NDIC comment when structured/TMC road is empty.
 * Reuses presenter fail-closed extractors — never invents roads from free prose.
 */
import {
  resolvePresentationRoadNumber,
  parseOfficialCommentFacts,
  extractMotorwayNumbersFromOfficialComment,
} from "../../assets/iu-traffic-card-presenter-v1.js";

/**
 * @param {string|null|undefined} comment
 * @returns {string}
 */
export function extractRoadNumberFromNdicComment(comment) {
  const text = String(comment || "").trim();
  if (!text) return "";
  const facts = parseOfficialCommentFacts(text);
  const resolved = resolvePresentationRoadNumber({ impact: text, summaryFull: text }, facts);
  if (resolved) return String(resolved).trim();
  const mw = extractMotorwayNumbersFromOfficialComment(text);
  return mw.length ? String(mw[0]).trim() : "";
}

/**
 * Lightweight publish-decision reason for audit/tests (not user-facing).
 * @param {{ roadNumber?: string, localizationTrust?: string, quarantine?: boolean, publishable?: boolean, status?: string }} item
 * @param {{ commentRoad?: string }} [meta]
 */
export function classifyPublishDecision(item, meta = {}) {
  if (!item || typeof item !== "object") {
    return { publishDecision: "invalidRecord", publishDecisionReason: "missing_item" };
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
      publishDecision: "invalidRecord",
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
