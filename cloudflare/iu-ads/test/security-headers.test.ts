import { describe, expect, it } from "vitest";
import worker from "../src/index";
import {
  HSTS_VALUE,
  PERMISSIONS_POLICY_VALUE,
  buildHtmlContentSecurityPolicy,
  generateNonce,
} from "../src/security-headers";
import type { Env } from "../src/types";

const env = {
  ADS_SAFE_MODE: "true",
  ADS_PUBLIC_DELIVERY_ENABLED: "false",
  ADS_ADMIN_API_ENABLED: "false",
  ADS_CLIENT_API_ENABLED: "false",
} as Env;

function expectShellSecurity(res: Response, html: string) {
  expect(res.status).toBe(200);
  expect(res.headers.get("Content-Type") || "").toContain("text/html");
  expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
  expect(res.headers.get("Referrer-Policy")).toBe("same-origin");
  expect(res.headers.get("X-Frame-Options")).toBe("SAMEORIGIN");
  expect(res.headers.get("Permissions-Policy")).toBe(PERMISSIONS_POLICY_VALUE);
  expect(res.headers.get("Cross-Origin-Opener-Policy")).toBe("same-origin");
  expect(res.headers.get("Cross-Origin-Embedder-Policy")).toBeNull();

  const csp = res.headers.get("Content-Security-Policy") || "";
  expect(csp).toContain("default-src 'self'");
  expect(csp).toContain("object-src 'none'");
  expect(csp).toContain("base-uri 'self'");
  expect(csp).toContain("frame-ancestors 'self'");
  expect(csp).toContain("form-action 'self'");
  expect(csp).toContain("script-src 'nonce-");
  expect(csp).toContain("style-src 'nonce-");
  expect(csp).not.toMatch(/script-src[^;]*\*/);
  expect(csp).not.toContain("unsafe-eval");
  expect(csp).not.toContain("unsafe-inline");

  const nonceMatch = csp.match(/script-src 'nonce-([^']+)'/);
  expect(nonceMatch).toBeTruthy();
  const nonce = nonceMatch![1];
  expect(csp).toContain("style-src 'nonce-" + nonce + "'");
  expect(html).toContain('nonce="' + nonce + '"');
  expect(html.match(/<style nonce="/g)?.length).toBe(1);
  expect(html.match(/<script nonce="/g)?.length).toBe(1);
}

describe("security headers — HTML shells", () => {
  it("GET /admin enforces CSP + HSTS + Permissions-Policy on HTTPS", async () => {
    const res = await worker.fetch(new Request("https://ads.test/admin"), env);
    const html = await res.text();
    expectShellSecurity(res, html);
    expect(res.headers.get("Strict-Transport-Security")).toBe(HSTS_VALUE);
    expect(html).toContain('id="login-form"');
  });

  it("GET /client enforces CSP + HSTS + Permissions-Policy on HTTPS", async () => {
    const res = await worker.fetch(new Request("https://ads.test/client"), env);
    const html = await res.text();
    expectShellSecurity(res, html);
    expect(res.headers.get("Strict-Transport-Security")).toBe(HSTS_VALUE);
    expect(html).toContain('id="access_code"');
  });

  it("does not emit HSTS on local HTTP shell responses", async () => {
    const res = await worker.fetch(new Request("http://127.0.0.1:8787/admin"), env);
    expect(res.status).toBe(200);
    expect(res.headers.get("Strict-Transport-Security")).toBeNull();
    expect(res.headers.get("Content-Security-Policy") || "").toContain("default-src 'self'");
    expect(res.headers.get("Permissions-Policy")).toBe(PERMISSIONS_POLICY_VALUE);
  });

  it("rotates CSP nonce between HTML responses", async () => {
    const a = await worker.fetch(new Request("https://ads.test/admin"), env);
    const b = await worker.fetch(new Request("https://ads.test/admin"), env);
    const cspA = a.headers.get("Content-Security-Policy") || "";
    const cspB = b.headers.get("Content-Security-Policy") || "";
    await a.text();
    await b.text();
    expect(cspA).not.toBe(cspB);
  });
});

describe("security headers — API / objects", () => {
  it("JSON health gets base headers without HTML CSP", async () => {
    const res = await worker.fetch(new Request("https://ads.test/health"), env);
    expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(res.headers.get("Referrer-Policy")).toBe("same-origin");
    expect(res.headers.get("X-Frame-Options")).toBe("SAMEORIGIN");
    expect(res.headers.get("Permissions-Policy")).toBe(PERMISSIONS_POLICY_VALUE);
    expect(res.headers.get("Strict-Transport-Security")).toBe(HSTS_VALUE);
    expect(res.headers.get("Content-Security-Policy")).toBeNull();
  });

  it("object stream path keeps XCTO and does not attach HTML CSP", async () => {
    const res = await worker.fetch(
      new Request("https://ads.test/v1/objects/get?key=x&bucket=DOCUMENTS&exp=1&sig=bad"),
      env
    );
    // signing may 503 without secret — still must not ship HTML CSP
    expect(res.headers.get("Content-Security-Policy")).toBeNull();
    expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(res.headers.get("Strict-Transport-Security")).toBe(HSTS_VALUE);
  });
});

describe("CSP builder invariants", () => {
  it("buildHtmlContentSecurityPolicy embeds nonce and required directives", () => {
    const nonce = generateNonce();
    const csp = buildHtmlContentSecurityPolicy(nonce);
    expect(csp).toBe(
      [
        "default-src 'self'",
        "script-src 'nonce-" + nonce + "'",
        "style-src 'nonce-" + nonce + "'",
        "img-src 'self'",
        "font-src 'self'",
        "connect-src 'self'",
        "worker-src 'none'",
        "object-src 'none'",
        "base-uri 'self'",
        "form-action 'self'",
        "frame-ancestors 'self'",
        "frame-src 'none'",
        "media-src 'self'",
        "manifest-src 'none'",
      ].join("; ")
    );
  });

  it("frame-ancestors 'self' matches X-Frame-Options SAMEORIGIN", () => {
    const csp = buildHtmlContentSecurityPolicy("n");
    expect(csp).toContain("frame-ancestors 'self'");
  });
});
