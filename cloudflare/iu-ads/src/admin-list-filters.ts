/**
 * Thin shared list-filter helpers (Etapa 8, kap. 17). Existing list endpoints already accept
 * status/client_id/limit/offset; this module centralizes clamp + LIKE escaping so new filters
 * (q / from / to) stay consistent without rewriting every CRUD module.
 */

export function clampLimit(raw: string | null, fallback = 50, max = 200): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.min(max, Math.floor(n));
}

export function clampOffset(raw: string | null): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.floor(n);
}

/** Escape LIKE metacharacters so user `q` cannot widen matches unexpectedly. */
export function likeContains(q: string): string {
  const escaped = q.replace(/[\\%_]/g, (ch) => "\\" + ch);
  return "%" + escaped + "%";
}

export type ListFilterBag = {
  status: string | null;
  client_id: string | null;
  campaign_id: string | null;
  q: string | null;
  from: string | null;
  to: string | null;
  limit: number;
  offset: number;
};

/** Documented common admin list query params (kap. 17). Callers still build SQL themselves. */
export function parseCommonListFilters(url: URL): ListFilterBag {
  const q = (url.searchParams.get("q") || "").trim();
  return {
    status: url.searchParams.get("status"),
    client_id: url.searchParams.get("client_id"),
    campaign_id: url.searchParams.get("campaign_id"),
    q: q || null,
    from: url.searchParams.get("from"),
    to: url.searchParams.get("to"),
    limit: clampLimit(url.searchParams.get("limit")),
    offset: clampOffset(url.searchParams.get("offset")),
  };
}
