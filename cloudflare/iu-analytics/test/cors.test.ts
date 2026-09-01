import { describe, expect, it } from "vitest";
import {
  DEFAULT_PRODUCTION_ORIGINS,
  buildCorsHeaders,
  isAllowedBrowserOrigin,
  resolveAllowedOrigins,
} from "../src/cors";

function req(origin: string | null): Request {
  const headers = new Headers();
  if (origin !== null) headers.set("Origin", origin);
  return new Request("https://infouzel-analytics.example/v1/ingest", {
    method: "POST",
    headers,
  });
}

function hdr(h: HeadersInit, name: string): string | null {
  const headers = new Headers(h);
  return headers.get(name);
}

describe("resolveAllowedOrigins", () => {
  it("maps empty and * to production defaults (fail-closed, never allow-all)", () => {
    expect(resolveAllowedOrigins("")).toEqual([...DEFAULT_PRODUCTION_ORIGINS]);
    expect(resolveAllowedOrigins("*")).toEqual([...DEFAULT_PRODUCTION_ORIGINS]);
    expect(resolveAllowedOrigins(null)).toEqual([...DEFAULT_PRODUCTION_ORIGINS]);
    expect(resolveAllowedOrigins(undefined)).toEqual([...DEFAULT_PRODUCTION_ORIGINS]);
  });

  it("parses comma-separated exact origins and ignores * entries", () => {
    expect(
      resolveAllowedOrigins("https://infouzel.cz, *,https://www.infouzel.cz")
    ).toEqual(["https://infouzel.cz", "https://www.infouzel.cz"]);
  });

  it("rejects path/suffix and malformed entries", () => {
    expect(
      resolveAllowedOrigins("https://infouzel.cz/path,not-a-url,https://evilinfouzel.cz")
    ).toEqual(["https://evilinfouzel.cz"]);
  });

  it("falls back to defaults when only malformed entries remain", () => {
    expect(resolveAllowedOrigins("*,foo,https://x/y")).toEqual([...DEFAULT_PRODUCTION_ORIGINS]);
  });
});

describe("isAllowedBrowserOrigin", () => {
  const allowed = ["https://infouzel.cz", "https://www.infouzel.cz"];

  it("allows exact production origins", () => {
    expect(isAllowedBrowserOrigin("https://infouzel.cz", allowed)).toBe(true);
    expect(isAllowedBrowserOrigin("https://www.infouzel.cz", allowed)).toBe(true);
  });

  it("denies null / empty / arbitrary / similar-domain / path Origin", () => {
    expect(isAllowedBrowserOrigin("", allowed)).toBe(false);
    expect(isAllowedBrowserOrigin("null", allowed)).toBe(false);
    expect(isAllowedBrowserOrigin("https://attacker.invalid", allowed)).toBe(false);
    expect(isAllowedBrowserOrigin("https://evilinfouzel.cz", allowed)).toBe(false);
    expect(isAllowedBrowserOrigin("https://infouzel.cz.evil.example", allowed)).toBe(false);
    expect(isAllowedBrowserOrigin("https://infouzel.cz/", allowed)).toBe(false);
  });
});

describe("buildCorsHeaders", () => {
  const env = { CORS_ALLOW_ORIGIN: "https://infouzel.cz,https://www.infouzel.cz" };

  it("A legitimate Origin → CORS PASS with concrete ACAO + ACAC", () => {
    const h = buildCorsHeaders(env, req("https://infouzel.cz"));
    expect(hdr(h, "Access-Control-Allow-Origin")).toBe("https://infouzel.cz");
    expect(hdr(h, "Access-Control-Allow-Credentials")).toBe("true");
    expect(hdr(h, "Access-Control-Allow-Methods")).toBe("GET, POST, OPTIONS");
    expect(hdr(h, "Access-Control-Allow-Headers")).toBe("content-type");
    expect(hdr(h, "Vary")).toBe("Origin");
  });

  it("B arbitrary Origin → NO CORS TRUST", () => {
    const h = buildCorsHeaders(env, req("https://attacker.invalid"));
    expect(hdr(h, "Access-Control-Allow-Origin")).toBeNull();
    expect(hdr(h, "Access-Control-Allow-Credentials")).toBeNull();
    expect(hdr(h, "Vary")).toBe("Origin");
  });

  it("C null Origin → NO CORS TRUST", () => {
    const h = buildCorsHeaders(env, req("null"));
    expect(hdr(h, "Access-Control-Allow-Origin")).toBeNull();
    expect(hdr(h, "Access-Control-Allow-Credentials")).toBeNull();
  });

  it("D similar-domain bypass → NO CORS TRUST", () => {
    for (const o of [
      "https://evilinfouzel.cz",
      "https://infouzel.cz.attacker.invalid",
      "https://www.infouzel.cz.evil.test",
    ]) {
      const h = buildCorsHeaders(env, req(o));
      expect(hdr(h, "Access-Control-Allow-Origin")).toBeNull();
      expect(hdr(h, "Access-Control-Allow-Credentials")).toBeNull();
    }
  });

  it("E malformed / * config → fail-closed defaults, never allow-all", () => {
    const star = buildCorsHeaders({ CORS_ALLOW_ORIGIN: "*" }, req("https://attacker.invalid"));
    expect(hdr(star, "Access-Control-Allow-Origin")).toBeNull();

    const empty = buildCorsHeaders({ CORS_ALLOW_ORIGIN: "" }, req("https://attacker.invalid"));
    expect(hdr(empty, "Access-Control-Allow-Origin")).toBeNull();

    const starLegit = buildCorsHeaders({ CORS_ALLOW_ORIGIN: "*" }, req("https://infouzel.cz"));
    expect(hdr(starLegit, "Access-Control-Allow-Origin")).toBe("https://infouzel.cz");
  });

  it("F missing Origin (non-browser) → no ACAO/ACAC but response path unrestricted", () => {
    const h = buildCorsHeaders(env, req(null));
    expect(hdr(h, "Access-Control-Allow-Origin")).toBeNull();
    expect(hdr(h, "Access-Control-Allow-Credentials")).toBeNull();
    expect(hdr(h, "Vary")).toBe("Origin");
  });

  it("www Origin PASS", () => {
    const h = buildCorsHeaders(env, req("https://www.infouzel.cz"));
    expect(hdr(h, "Access-Control-Allow-Origin")).toBe("https://www.infouzel.cz");
    expect(hdr(h, "Access-Control-Allow-Credentials")).toBe("true");
  });
});
