/**
 * CAP identity: cap_message_id, alert_thread_id, hazard_instance_id + references parsing.
 */
import crypto from "crypto";
import { DEFAULT_LIMITS } from "./config.mjs";

/**
 * CAP references: space-separated triples "sender,identifier,sent"
 * sender/identifier may contain commas? Spec uses comma separators within each reference
 * and spaces between references. CHMI uses: sender,identifier,sent
 */
export function parseCapReferences(referencesRaw, limits = {}) {
  const lim = { ...DEFAULT_LIMITS, ...limits };
  const raw = String(referencesRaw || "").trim();
  if (!raw) return { ok: true, refs: [], warnings: [] };
  const warnings = [];
  const refs = [];
  // Split on whitespace between triples; each triple has exactly 2 commas → 3 parts
  // Prefer regex scan for WMO-style sender (often contains no spaces)
  const parts = raw.split(/\s+/).filter(Boolean);
  if (parts.length > lim.maxReferencesParts) {
    throw Object.assign(new Error("cap_too_many_references:" + parts.length), {
      code: "CAP_TRUNCATED",
      field: "references",
      count: parts.length,
      limit: lim.maxReferencesParts,
    });
  }
  for (const part of parts) {
    const commas = part.split(",");
    if (commas.length < 3) {
      warnings.push("ref_incomplete:" + part.slice(0, 80));
      continue;
    }
    // If more than 2 commas, join middle back (identifier rarely has commas; sent is ISO)
    const sent = commas[commas.length - 1];
    const identifier = commas[commas.length - 2];
    const sender = commas.slice(0, commas.length - 2).join(",");
    if (!sender || !identifier || !sent) {
      warnings.push("ref_empty_field");
      continue;
    }
    refs.push({ sender, identifier, sent });
  }
  if (!refs.length && raw) {
    return { ok: false, refs: [], warnings: warnings.length ? warnings : ["ref_parse_failed"] };
  }
  return { ok: true, refs, warnings };
}

export function makeCapMessageId(sender, identifier, sent) {
  return `capmsg:${String(sender || "").trim()}|${String(identifier || "").trim()}|${String(sent || "").trim()}`;
}

export function makeCapMessageIdFromAlert(alert) {
  return makeCapMessageId(alert.sender, alert.identifier, alert.sent);
}

function shortHash(s) {
  return crypto.createHash("sha1").update(String(s || "")).digest("hex").slice(0, 16);
}

/**
 * Stable thread id: prefer oldest referenced message; else self.
 * @param {object} alert
 * @param {{ knownThreads?: Map<string,string> }} [opts] map cap_message_id → alert_thread_id
 */
export function resolveAlertThreadId(alert, opts = {}) {
  const selfId = makeCapMessageIdFromAlert(alert);
  const parsed = parseCapReferences(alert.references);
  const known = opts.knownThreads || new Map();
  const msgType = String(alert.msgType || "");

  if (/^(Update|Cancel|Ack)$/i.test(msgType) && parsed.refs.length) {
    // CAP: first reference is typically the original Alert
    for (const r of parsed.refs) {
      const refId = makeCapMessageId(r.sender, r.identifier, r.sent);
      if (known.has(refId)) return { alert_thread_id: known.get(refId), via: "known_ref", refsOk: parsed.ok, warnings: parsed.warnings };
    }
    const root = parsed.refs[0];
    const rootId = makeCapMessageId(root.sender, root.identifier, root.sent);
    return {
      alert_thread_id: `thread:${shortHash(rootId)}`,
      via: "ref_root",
      root_cap_message_id: rootId,
      refsOk: parsed.ok,
      warnings: parsed.warnings,
    };
  }

  if (/^(Update|Cancel)$/i.test(msgType) && (!parsed.ok || !parsed.refs.length)) {
    return {
      alert_thread_id: `thread:${shortHash(selfId)}`,
      via: "orphan_update",
      refsOk: parsed.ok,
      warnings: parsed.warnings.concat(["update_without_resolved_refs"]),
    };
  }

  return {
    alert_thread_id: `thread:${shortHash(selfId)}`,
    via: "self",
    refsOk: parsed.ok,
    warnings: parsed.warnings,
  };
}

function eventCodeKey(info) {
  const codes = (info.eventCode || []).map((c) => `${c.valueName}:${c.value}`).filter((x) => x !== ":");
  return codes.sort().join(";") || fold(info.event || "unknown");
}

function fold(s) {
  return String(s || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80);
}

function areaKey(info) {
  const codes = [];
  for (const a of info.areas || []) {
    for (const g of a.geocodes || []) {
      if (/cisorp/i.test(g.valueName) || /orp/i.test(g.valueName)) codes.push(`orp:${g.value}`);
      else if (g.valueName && g.value) codes.push(`${fold(g.valueName)}:${g.value}`);
    }
  }
  if (codes.length) return [...new Set(codes)].sort().join(",");
  const descs = (info.areas || []).map((a) => fold(a.areaDesc)).filter(Boolean);
  return descs.length ? `desc:${descs.sort().join(",")}` : "area:unknown";
}

/**
 * When an <info> block omits expires but another info in the same alert has the
 * same event + onset + severity with a concrete expires, reuse that expires.
 * Only when all such siblings agree (unanimous). Never invent times.
 *
 * @param {object[]} infos
 * @returns {{ infos: object[], filled: number }}
 */
export function resolveExpiresFromSiblingInfos(infos) {
  const list = Array.isArray(infos) ? infos.map((i) => ({ ...i })) : [];
  const keyOf = (info) =>
    [
      fold(info.event || ""),
      String(info.onset || info.effective || "").trim(),
      fold(info.severity || ""),
    ].join("|");

  const byKey = new Map();
  for (const info of list) {
    const k = keyOf(info);
    if (!byKey.has(k)) byKey.set(k, []);
    byKey.get(k).push(info);
  }

  let filled = 0;
  for (const group of byKey.values()) {
    const withExp = [
      ...new Set(
        group
          .map((i) => String(i.expires || "").trim())
          .filter(Boolean)
      ),
    ];
    if (withExp.length !== 1) continue;
    const expires = withExp[0];
    for (const info of group) {
      if (String(info.expires || "").trim()) continue;
      info.expires = expires;
      info.expiresSource = "sibling_info_same_event_onset_severity";
      filled += 1;
    }
  }
  return { infos: list, filled };
}

/**
 * One hazard instance per info block (jev × území × čas).
 */
export function buildHazardInstances(alert, alertThreadId) {
  const capMessageId = makeCapMessageIdFromAlert(alert);
  const instances = [];
  const { infos } = resolveExpiresFromSiblingInfos(alert.infos || []);
  infos.forEach((info, idx) => {
    const ek = eventCodeKey(info);
    const ak = areaKey(info);
    const tk = `${info.onset || info.effective || alert.sent || ""}|${info.expires || ""}`;
    const raw = `${alertThreadId}|${ek}|${ak}|${tk}|${idx}`;
    instances.push({
      hazard_instance_id: `haz:${shortHash(raw)}`,
      alert_thread_id: alertThreadId,
      cap_message_id: capMessageId,
      infoIndex: idx,
      event: info.event || "",
      eventKey: ek,
      areaKey: ak,
      severity: info.severity || "",
      urgency: info.urgency || "",
      certainty: info.certainty || "",
      // Temporal window from CAP only — do not invent onset from alert.sent.
      valid_from: info.onset || info.effective || "",
      valid_to: info.expires || "",
      expiresSource: info.expiresSource || (info.expires ? "cap" : ""),
      headline: info.headline || "",
      description: info.description || "",
      instruction: info.instruction || "",
      language: info.language || "",
      areas: info.areas || [],
      eventCode: info.eventCode || [],
      parameter: info.parameter || [],
    });
  });
  return instances;
}

/**
 * Full identity package for one CAP alert document.
 */
export function buildCapIdentity(alert, opts = {}) {
  const cap_message_id = makeCapMessageIdFromAlert(alert);
  const thread = resolveAlertThreadId(alert, opts);
  const msgType = String(alert.msgType || "");
  const known = isKnownMsgTypeLocal(msgType);
  const hazards = buildHazardInstances(alert, thread.alert_thread_id);
  return {
    cap_message_id,
    alert_thread_id: thread.alert_thread_id,
    thread_resolution: thread,
    msgType,
    msgTypeKnown: known,
    status: alert.status || "",
    hazards,
    appliesLifecycle: known && /^(Alert|Update|Cancel)$/i.test(msgType),
  };
}

function isKnownMsgTypeLocal(msgType) {
  return /^(Alert|Update|Cancel|Ack|Error)$/i.test(String(msgType || ""));
}

export function canonicalAlertHash(alert) {
  const payload = {
    identifier: alert.identifier,
    sender: alert.sender,
    sent: alert.sent,
    status: alert.status,
    msgType: alert.msgType,
    references: alert.references,
    infos: (alert.infos || []).map((info) => ({
      language: info.language,
      event: info.event,
      severity: info.severity,
      urgency: info.urgency,
      certainty: info.certainty,
      onset: info.onset,
      expires: info.expires,
      headline: info.headline,
      description: info.description,
      areas: (info.areas || []).map((a) => ({
        areaDesc: a.areaDesc,
        geocodes: a.geocodes,
      })),
    })),
  };
  return crypto.createHash("sha256").update(JSON.stringify(payload)).digest("hex");
}
