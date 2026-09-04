import { describe, expect, it } from "vitest";
import { antiFraudGuard, suspiciousClickVsImpressions } from "../src/antifraud";
import { hasForbiddenKeys, privacyGuard } from "../src/privacy";

describe("privacyGuard", () => {
  it("rejects forbidden keys", () => {
    expect(hasForbiddenKeys({ ip: "1.2.3.4" })).toBe("ip");
    expect(hasForbiddenKeys({ fingerprint: "x" })).toBe("fingerprint");
    expect(hasForbiddenKeys({ user_agent: "Mozilla" })).toBe("user_agent");
  });

  it("rejects non-allowlisted events", () => {
    const r = privacyGuard({ type: "track_user", section_id: "home" }, "Mozilla/5.0");
    expect(r.ok).toBe(false);
  });

  it("rejects crawlers", () => {
    const r = privacyGuard({ type: "page_view", section_id: "home" }, "Googlebot/2.1");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("crawler");
  });

  it("accepts page_view and classifies device without storing UA", () => {
    const r = privacyGuard({ type: "page_view", section_id: "zpravy" }, "Mozilla/5.0 (iPhone)");
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.event.type).toBe("page_view");
      expect(r.device).toBe("mobile");
      expect(JSON.stringify(r.event)).not.toMatch(/Mozilla/);
    }
  });

  it("requires campaign_id + placement_id for ads", () => {
    const bad = privacyGuard({ type: "ad_impression" }, "Mozilla/5.0");
    expect(bad.ok).toBe(false);
    const ok = privacyGuard(
      {
        type: "ad_impression",
        campaign_id: "c1",
        placement_id: "p1",
        slot_type: "banner",
        section_id: "home",
      },
      "Mozilla/5.0 (Windows NT 10.0)"
    );
    expect(ok.ok).toBe(true);
    if (ok.ok) {
      expect(ok.event.campaign_id).toBe("c1");
      expect(ok.event.placement_id).toBe("p1");
      expect(ok.device).toBe("pc");
    }
  });

  it("rejects free-text payload fields", () => {
    const r = privacyGuard(
      { type: "page_view", section_id: "home", payload: "secret note" },
      "Mozilla/5.0"
    );
    expect(r.ok).toBe(false);
  });

  it("accepts pwa_install and rejects client count", () => {
    const ok = privacyGuard({ type: "pwa_install", device_category: "mobile" }, "Mozilla/5.0 (iPhone)");
    expect(ok.ok).toBe(true);
    if (ok.ok) expect(ok.event.type).toBe("pwa_install");
    const bad = privacyGuard({ type: "pwa_install", count: 1000 }, "Mozilla/5.0");
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.reason).toBe("client_count_forbidden");
  });
});

describe("antiFraudGuard", () => {
  it("flags click burst without storing IP", () => {
    const ev = {
      type: "ad_click" as const,
      campaign_id: "camp-x",
      placement_id: "place-y",
      day: "2026-07-20",
      device_category: "pc" as const,
    };
    let last = antiFraudGuard(ev);
    for (let i = 0; i < 12; i++) last = antiFraudGuard(ev);
    expect(last.suspicious).toBe(true);
  });

  it("detects impossible click/impression ratio", () => {
    expect(suspiciousClickVsImpressions(0, 1)).toBe(true);
    expect(suspiciousClickVsImpressions(10, 3)).toBe(false);
    expect(suspiciousClickVsImpressions(2, 20)).toBe(true);
  });
});
