import { describe, expect, it } from "vitest";
import { isSafeTargetUrl, validateTargetUrl } from "../src/url-safety";

describe("target URL allowlist (kap. 43 / SSRF & dangerous-scheme rejection)", () => {
  it("accepts absolute http/https URLs", () => {
    expect(validateTargetUrl("https://example.cz/kampan")).toEqual({ ok: true, normalized: "https://example.cz/kampan" });
    expect(isSafeTargetUrl("http://example.cz")).toBe(true);
  });

  it("accepts root-relative internal paths", () => {
    expect(validateTargetUrl("/infocentrum/nabidka")).toEqual({ ok: true, normalized: "/infocentrum/nabidka" });
  });

  it("rejects javascript: URLs", () => {
    const r = validateTargetUrl("javascript:alert(1)");
    expect(r).toEqual({ ok: false, reason: "unsafe_scheme" });
  });

  it("rejects data: URLs", () => {
    expect(validateTargetUrl("data:text/html,<script>alert(1)</script>").ok).toBe(false);
  });

  it("rejects vbscript: and file: schemes", () => {
    expect(validateTargetUrl("vbscript:msgbox(1)").ok).toBe(false);
    expect(validateTargetUrl("file:///etc/passwd").ok).toBe(false);
  });

  it("rejects protocol-relative URLs (never trust an implicit host)", () => {
    expect(validateTargetUrl("//evil.example.com/phish").ok).toBe(false);
  });

  it("rejects other non-http schemes (mailto/ftp)", () => {
    expect(validateTargetUrl("mailto:foo@example.com").ok).toBe(false);
    expect(validateTargetUrl("ftp://example.com/file").ok).toBe(false);
  });

  it("rejects empty, non-string, and malformed input (fail closed)", () => {
    expect(validateTargetUrl("").ok).toBe(false);
    expect(validateTargetUrl("   ").ok).toBe(false);
    expect(validateTargetUrl(undefined).ok).toBe(false);
    expect(validateTargetUrl(42).ok).toBe(false);
    expect(validateTargetUrl("https://").ok).toBe(false);
  });

  it("rejects URLs containing control characters (header/CRLF-injection style payloads)", () => {
    expect(validateTargetUrl("/path\r\nSet-Cookie: evil=1").ok).toBe(false);
  });

  it("normalizes scheme casing", () => {
    const r = validateTargetUrl("HTTPS://Example.cz/x");
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.normalized.startsWith("https://")).toBe(true);
  });
});
