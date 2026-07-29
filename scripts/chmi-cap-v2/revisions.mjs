/**
 * Immutable CAP revision records + change classification.
 */
import { canonicalAlertHash, makeCapMessageIdFromAlert } from "./identity.mjs";

function setOfOrp(hazards) {
  const s = new Set();
  for (const h of hazards || []) {
    for (const a of h.areas || []) {
      for (const g of a.geocodes || []) {
        if (/cisorp/i.test(g.valueName) || /orp/i.test(g.valueName)) s.add(String(g.value));
      }
    }
  }
  return s;
}

function maxSeverityRank(hazards) {
  const rank = { Unknown: 0, Minor: 1, Moderate: 2, Severe: 3, Extreme: 4 };
  let m = 0;
  for (const h of hazards || []) {
    m = Math.max(m, rank[h.severity] || 0);
  }
  return m;
}

/**
 * Compare previous revision identity package to current.
 */
export function classifyRevisionChange(prev, curr) {
  if (!prev) return { changeType: "new", significantUnreadReset: true, areaExpanded: false, areaReduced: false, severityUp: false };
  const prevOrp = setOfOrp(prev.hazards);
  const currOrp = setOfOrp(curr.hazards);
  let added = 0;
  let removed = 0;
  for (const c of currOrp) if (!prevOrp.has(c)) added++;
  for (const p of prevOrp) if (!currOrp.has(p)) removed++;
  const severityUp = maxSeverityRank(curr.hazards) > maxSeverityRank(prev.hazards);
  const severityDown = maxSeverityRank(curr.hazards) < maxSeverityRank(prev.hazards);
  const msg = String(curr.msgType || curr.identity?.msgType || "");
  let changeType = "update";
  if (/^Cancel$/i.test(msg)) changeType = "cancel";
  else if (/^Alert$/i.test(msg) && !prev) changeType = "new";
  else if (added && removed) changeType = "area_reshape";
  else if (added) changeType = "area_expand";
  else if (removed) changeType = "area_reduce";
  else if (severityUp) changeType = "severity_up";
  else if (severityDown) changeType = "severity_down";

  const significantUnreadReset = changeType === "cancel" || changeType === "area_expand" || changeType === "severity_up" || changeType === "new";
  return {
    changeType,
    significantUnreadReset,
    areaExpanded: added > 0,
    areaReduced: removed > 0,
    severityUp,
    severityDown,
    orpAdded: added,
    orpRemoved: removed,
  };
}

/**
 * Build immutable revision record (no raw XML in public fields).
 */
export function buildRevisionRecord(alert, identity, opts = {}) {
  const nowIso = opts.receivedAt || new Date().toISOString();
  const prev = opts.previousRevision || null;
  const change = classifyRevisionChange(prev, { ...identity, msgType: alert.msgType, hazards: identity.hazards });
  return {
    revision_id: identity.cap_message_id,
    cap_message_id: identity.cap_message_id,
    alert_thread_id: identity.alert_thread_id,
    previous_cap_message_id: prev ? prev.cap_message_id : null,
    sender: alert.sender,
    identifier: alert.identifier,
    sent: alert.sent,
    msgType: alert.msgType,
    status: alert.status,
    references: alert.references || "",
    canonical_hash: canonicalAlertHash(alert),
    validation_status: opts.validationStatus || "valid",
    received_at: nowIso,
    published_at: alert.sent,
    change_type: change.changeType,
    change,
    language_fallback: !!alert.languageFallback,
    selected_languages: alert.selectedLanguages || [],
    hazards: identity.hazards,
    applies_lifecycle: identity.appliesLifecycle,
    msg_type_known: identity.msgTypeKnown,
    // raw XML never stored here by default
    raw_xml_retained: false,
  };
}

export function emptyRevisionStore() {
  return {
    byMessageId: new Map(),
    byThreadId: new Map(),
    order: [],
  };
}

export function putRevision(store, revision) {
  if (store.byMessageId.has(revision.cap_message_id)) {
    return { store, duplicate: true, revision: store.byMessageId.get(revision.cap_message_id) };
  }
  store.byMessageId.set(revision.cap_message_id, revision);
  store.order.push(revision.cap_message_id);
  const list = store.byThreadId.get(revision.alert_thread_id) || [];
  list.push(revision.cap_message_id);
  store.byThreadId.set(revision.alert_thread_id, list);
  return { store, duplicate: false, revision };
}

export function latestRevisionForThread(store, alertThreadId) {
  const ids = store.byThreadId.get(alertThreadId) || [];
  if (!ids.length) return null;
  let best = null;
  for (const id of ids) {
    const r = store.byMessageId.get(id);
    if (!r) continue;
    if (!best || String(r.sent) >= String(best.sent) || String(r.received_at) >= String(best.received_at)) best = r;
  }
  return best;
}

export { makeCapMessageIdFromAlert };
