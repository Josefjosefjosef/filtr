/**
 * Collect CAP revision documents for territory-onset ledger.
 *
 * Combines:
 * 1) Bounded recent mtime window per product stream (not sole source of truth)
 * 2) CAP <references> traversal resolved against the open-data index
 *
 * No incident-specific ORP lists or hardcoded onset times.
 */
import { parseCapReferences } from "./identity.mjs";
import { capProductKeyFromUrl } from "./discovery-adapter.mjs";

/** Default recent window — must cover drought/fire chains longer than 6. */
export const ONSET_LEDGER_RECENT_PER_STREAM = 16;

/** Hard cap on reference-walk depth (Alert→Update chain). */
export const ONSET_LEDGER_REF_MAX_DEPTH = 24;

/**
 * Extract YYMMDDHHMMSS from CHMI CAP identifier, then DDHHMM filename hint.
 * Example: ...CZ.260731123048.XOCZ50... → "311230"
 */
export function filenameHintFromCapIdentifier(identifier) {
  const m = String(identifier || "").match(/\.CZ\.(\d{10,14})(?:\.|$)/i);
  if (!m) return null;
  const ts = m[1];
  if (ts.length < 10) return null;
  const dd = ts.slice(4, 6);
  const hh = ts.slice(6, 8);
  const mm = ts.slice(8, 10);
  if (!/^\d{6}$/.test(`${dd}${hh}${mm}`)) return null;
  return `${dd}${hh}${mm}`;
}

/**
 * Prefer product-stream match for filename hint among listed open-data entries.
 */
export function matchListedForIdentifier(listed, identifier, preferredProductKey) {
  const hint = filenameHintFromCapIdentifier(identifier);
  if (!hint) return null;
  const wantKey = preferredProductKey != null ? String(preferredProductKey) : null;
  const scored = [];
  for (const item of listed || []) {
    const url = item && item.url ? String(item.url) : "";
    if (!url) continue;
    const name = url.split("/").pop() || url;
    if (!name.toLowerCase().includes(`_${hint}.xml`)) continue;
    const pk = capProductKeyFromUrl(name);
    let score = Number(item.mtime) || 0;
    if (wantKey && pk === wantKey) score += 1e15;
    scored.push({ url, name, mtime: Number(item.mtime) || 0, productKey: pk, score });
  }
  if (!scored.length) return null;
  scored.sort((a, b) => b.score - a.score || b.mtime - a.mtime || String(b.name).localeCompare(String(a.name)));
  return scored[0];
}

/**
 * Walk CAP references from head XML documents; resolve identifiers to listed URLs.
 * @returns {{ url: string, name: string, mtime: number, productKey: string, via: string }[]}
 */
export function resolveReferenceChainEntries(headDocs, listed, opts = {}) {
  const maxDepth = Math.max(1, Math.min(40, Number(opts.maxDepth) || ONSET_LEDGER_REF_MAX_DEPTH));
  const out = new Map();
  const queue = [];

  for (const doc of headDocs || []) {
    if (!doc || !doc.xml) continue;
    const pk = capProductKeyFromUrl(doc.sourceUrl || doc.name || "");
    const id = (String(doc.xml).match(/<identifier>([^<]*)<\/identifier>/i) || [])[1] || "";
    if (id) queue.push({ identifier: id, productKey: pk, depth: 0 });
    const refsRaw = (String(doc.xml).match(/<references>([\s\S]*?)<\/references>/i) || [])[1] || "";
    const parsed = parseCapReferences(refsRaw);
    for (const r of parsed.refs || []) {
      queue.push({ identifier: r.identifier, productKey: pk, depth: 1 });
    }
  }

  const seenIdent = new Set();
  while (queue.length) {
    const cur = queue.shift();
    if (!cur || !cur.identifier) continue;
    if (seenIdent.has(cur.identifier)) continue;
    seenIdent.add(cur.identifier);
    if (cur.depth > maxDepth) continue;
    const hit = matchListedForIdentifier(listed, cur.identifier, cur.productKey);
    if (!hit) continue;
    if (!out.has(hit.url)) {
      out.set(hit.url, { ...hit, via: "references" });
    }
  }

  return [...out.values()];
}

/**
 * Merge recent-window entries with reference-resolved entries (dedupe by URL).
 * Sorted oldest → newest for ledger walk.
 */
export function mergeOnsetHistoryEntries(recentEntries, refEntries) {
  const map = new Map();
  for (const e of [...(recentEntries || []), ...(refEntries || [])]) {
    if (!e || !e.url) continue;
    const prev = map.get(e.url);
    if (!prev) {
      map.set(e.url, { ...e });
      continue;
    }
    map.set(e.url, {
      ...prev,
      ...e,
      via: [prev.via, e.via].filter(Boolean).join("+"),
      mtime: Math.max(Number(prev.mtime) || 0, Number(e.mtime) || 0),
    });
  }
  return [...map.values()].sort(
    (a, b) => (a.mtime || 0) - (b.mtime || 0) || String(a.name || "").localeCompare(String(b.name || ""))
  );
}

/**
 * Merge two onset ledgers — earliest validFrom wins per ORP under each semantic key.
 * Prefer mergeOnsetLedgersPreferPrimary when combining authoritative history with
 * a persistent cache (earliest-wins can resurrect pre-handoff onsets).
 */
export function mergeOnsetLedgersEarliest(a, b) {
  const out = a && typeof a === "object" ? { ...a } : {};
  for (const [sem, bucket] of Object.entries(b || {})) {
    if (!out[sem]) {
      out[sem] = { ...bucket };
      continue;
    }
    const next = { ...out[sem] };
    for (const [orp, meta] of Object.entries(bucket || {})) {
      const prev = next[orp];
      if (!prev) {
        next[orp] = { ...meta };
        continue;
      }
      const prevMs = Date.parse(prev.validFrom);
      const nextMs = Date.parse(meta.validFrom);
      if (Number.isFinite(prevMs) && Number.isFinite(nextMs) && nextMs < prevMs) {
        next[orp] = { ...meta };
      }
    }
    out[sem] = next;
  }
  return out;
}

/**
 * Merge ledgers with primary winning on conflict.
 * Fallback only fills ORPs missing from primary (e.g. temporary history gap).
 * Never reintroduces an older onset that primary already reconciled away.
 */
export function mergeOnsetLedgersPreferPrimary(primary, fallback) {
  const out = primary && typeof primary === "object" ? { ...primary } : {};
  for (const [sem, bucket] of Object.entries(fallback || {})) {
    if (!out[sem]) {
      out[sem] = { ...bucket };
      continue;
    }
    const next = { ...out[sem] };
    for (const [orp, meta] of Object.entries(bucket || {})) {
      if (!next[orp] && meta) next[orp] = { ...meta };
    }
    out[sem] = next;
  }
  return out;
}
