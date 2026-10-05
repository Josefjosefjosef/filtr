import { fetchAresByIco, parseIcoQueryParam } from "./ares-lookup";
import { json } from "./admin-auth";

const LOOKUP_WINDOW_MS = 60_000;
const LOOKUP_MAX_PER_WINDOW = 30;
const lookupHits = new Map<string, number[]>();

function clientKey(request: Request): string {
  return request.headers.get("CF-Connecting-IP") || request.headers.get("X-Forwarded-For") || "unknown";
}

function rateLimitOk(key: string): boolean {
  const now = Date.now();
  const prev = lookupHits.get(key) || [];
  const fresh = prev.filter((t) => now - t < LOOKUP_WINDOW_MS);
  if (fresh.length >= LOOKUP_MAX_PER_WINDOW) {
    lookupHits.set(key, fresh);
    return false;
  }
  fresh.push(now);
  lookupHits.set(key, fresh);
  return true;
}

export async function handlePublicAresIcoLookup(request: Request): Promise<Response> {
  if (request.method !== "GET") return json({ error: "method_not_allowed" }, 405);
  const url = new URL(request.url);
  const parsed = parseIcoQueryParam(url.searchParams.get("ico"));
  if (!parsed.ok) return json({ error: parsed.reason }, 400);
  const key = clientKey(request);
  if (!rateLimitOk(key)) return json({ error: "rate_limited" }, 429);
  const result = await fetchAresByIco(parsed.ico);
  if (!result.ok) {
    const status = result.reason === "not_found" ? 404 : 503;
    return json({ error: result.reason }, status);
  }
  return json({ ok: true, ...result.data });
}
