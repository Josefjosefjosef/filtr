/**
 * Cloudflare Worker — VIN decode via api.dataovozidlech.cz (direct HTTPS).
 * Avoid proxying through orange-cloud domains (avoids SSL 525 passthrough).
 */
import { decodeVinHandler, createDecodeEnv } from "../../../server/vin-decode-core.mjs";

const JSON_HDR = { "Content-Type": "application/json; charset=utf-8" };

function jsonResponse(status, obj) {
  return new Response(JSON.stringify(obj), { status, headers: JSON_HDR });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/$/, "") || "/";

    if (path === "/health" && request.method === "GET") {
      return jsonResponse(200, { ok: true, worker: "up" });
    }

    if (path !== "/vin") {
      if (request.method === "GET") {
        return jsonResponse(404, { success: false, error: "Not found" });
      }
      return jsonResponse(405, { success: false, error: "Method not allowed" });
    }

    if (request.method !== "GET") {
      return jsonResponse(405, { success: false, error: "Method not allowed" });
    }

    const key = (env.VIN_UPSTREAM_KEY || "").trim();
    if (!key) {
      return jsonResponse(500, {
        success: false,
        error: "missing_secret",
        detail: "VIN_UPSTREAM_KEY is not configured"
      });
    }

    const vin = url.searchParams.get("vin") || "";
    const decodeEnv = createDecodeEnv({
      VIN_UPSTREAM_KEY: key,
      VIN_UPSTREAM_URL: (env.VIN_UPSTREAM_URL || "").trim(),
      VIN_UPSTREAM_AUTH_STYLE: (env.VIN_UPSTREAM_AUTH_STYLE || "bearer").trim(),
      VIN_USE_NHTSA_FALLBACK: "",
      VIN_IP_RATE_MAX: env.VIN_IP_RATE_MAX || "60",
      VIN_CACHE_TTL_MS: env.VIN_CACHE_TTL_MS || "86400000",
      VIN_UPSTREAM_MAX_PER_MIN: env.VIN_UPSTREAM_MAX_PER_MIN || "27"
    });

    const cfConnecting = request.headers.get("CF-Connecting-IP");
    const xff = request.headers.get("X-Forwarded-For");
    const clientIp =
      (cfConnecting && cfConnecting.trim()) ||
      (xff && xff.split(",")[0].trim()) ||
      "worker";

    const out = await decodeVinHandler(vin, clientIp, decodeEnv);
    return new Response(out.body, { status: out.status, headers: out.headers });
  }
};
