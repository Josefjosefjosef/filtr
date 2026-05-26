/**
 * Silver runtime debug leaf — hash + snapshot metadata helpers (no user text).
 * Imported by assets/app.js; VM harness concatenates before P0 engine slice.
 */
"use strict";

/** FNV-1a 32-bit — deterministic, no user raw text in output. */
export function iuSilverHashSafeLabelV1(s) {
  let h = 2166136261;
  const x = String(s || "");
  for (let i = 0; i < x.length; i++) {
    h ^= x.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

export function iuSilverReplayChecksumV1(parts) {
  let acc = 2166136261;
  const arr = Array.isArray(parts) ? parts : [];
  for (let i = 0; i < arr.length; i++) {
    const p = String(arr[i] == null ? "" : arr[i]);
    for (let j = 0; j < p.length; j++) {
      acc ^= p.charCodeAt(j);
      acc = Math.imul(acc, 16777619);
    }
    acc ^= 0x7c;
    acc = Math.imul(acc, 16777619);
  }
  return (acc >>> 0).toString(16).padStart(8, "0");
}

export function iuSilverExpandRuntimeDebugMetaV1(baseSnap, extras) {
  const b = baseSnap && typeof baseSnap === "object" ? baseSnap : {};
  const e = extras && typeof extras === "object" ? extras : {};
  return Object.assign({}, b, {
    schema: "iu_silver_runtime_debug_snapshot_v2",
    runtime_memory_footprint: e.runtime_memory_footprint != null ? e.runtime_memory_footprint : 0,
    continuation_graph_size: e.continuation_graph_size != null ? e.continuation_graph_size : 0,
    stale_chain_count: e.stale_chain_count != null ? e.stale_chain_count : 0,
    governance_cleanup_count: e.governance_cleanup_count != null ? e.governance_cleanup_count : 0,
    payload_cleanup_count: e.payload_cleanup_count != null ? e.payload_cleanup_count : 0,
    draft_lifecycle_count: e.draft_lifecycle_count != null ? e.draft_lifecycle_count : 0,
    capability_isolation_count: e.capability_isolation_count != null ? e.capability_isolation_count : 0,
    deterministic_replay_checksum: e.deterministic_replay_checksum || "00000000",
    replay_replayability_hash: e.replay_replayability_hash || "00000000"
  });
}
