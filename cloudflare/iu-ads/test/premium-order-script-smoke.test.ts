import { describe, expect, it } from "vitest";
import { buildPremiumOrderClientScript } from "../src/premium-order-ui-script";
import { buildPremiumOrderShellHtml } from "../src/premium-order-ui";

describe("premium order client script bundle", () => {
  it("does not contain broken inline serialization", () => {
    const script = buildPremiumOrderClientScript("v1", "2026-01-01");
    expect(script).not.toContain("[object Object]");
    expect(script).toContain("iuPremiumCreativeRender");
    expect(script).toContain("bindPremiumCreativeImage");
  });

  it("shell embeds executable script prefix", () => {
    const html = buildPremiumOrderShellHtml("nonce-x", "<p>x</p>", 1);
    const m = html.match(/<script nonce="nonce-x">([\s\S]*?)<\/script>/);
    expect(m).toBeTruthy();
    const script = m![1];
    expect(script.startsWith("/**")).toBe(true);
    expect(script).not.toContain("[object Object]");
  });
});
