import { describe, expect, it } from "vitest";
import { normalizeCzechIco, validateCzechIco } from "../src/czech-ico";

describe("czech ico validation", () => {
  it("normalizes digits and padding", () => {
    expect(normalizeCzechIco("27074358")).toBe("27074358");
    expect(normalizeCzechIco(" 27074358 ")).toBe("27074358");
  });

  it("accepts valid checksum", () => {
    const r = validateCzechIco("27074358");
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.ico).toBe("27074358");
  });

  it("rejects empty and invalid checksum", () => {
    expect(validateCzechIco("").ok).toBe(false);
    expect(validateCzechIco("12345678").ok).toBe(false);
  });
});
