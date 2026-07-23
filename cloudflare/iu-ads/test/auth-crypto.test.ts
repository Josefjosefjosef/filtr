import { describe, expect, it } from "vitest";
import { hashPassword, validatePasswordStrength, verifyPassword } from "../src/password";

const PEPPER = "test-pepper-not-for-prod";

describe("password hashing (pbkdf2 + pepper)", () => {
  it("hashes with a unique salt each time and verifies correctly", async () => {
    const hash1 = await hashPassword("Correct-Horse-1", PEPPER, 1000);
    const hash2 = await hashPassword("Correct-Horse-1", PEPPER, 1000);
    expect(hash1).not.toEqual(hash2);
    expect(hash1.startsWith("pbkdf2$1000$")).toBe(true);
    expect(await verifyPassword("Correct-Horse-1", PEPPER, hash1)).toBe(true);
    expect(await verifyPassword("Correct-Horse-1", PEPPER, hash2)).toBe(true);
  });

  it("rejects wrong password", async () => {
    const hash = await hashPassword("Correct-Horse-1", PEPPER, 1000);
    expect(await verifyPassword("wrong-password", PEPPER, hash)).toBe(false);
  });

  it("rejects when pepper differs (defense in depth)", async () => {
    const hash = await hashPassword("Correct-Horse-1", PEPPER, 1000);
    expect(await verifyPassword("Correct-Horse-1", "other-pepper", hash)).toBe(false);
  });

  it("rejects malformed stored hashes safely", async () => {
    expect(await verifyPassword("anything", PEPPER, "not-a-hash")).toBe(false);
    expect(await verifyPassword("anything", PEPPER, "")).toBe(false);
    expect(await verifyPassword("anything", PEPPER, "pbkdf2$0$$")).toBe(false);
  });

  it("enforces server-side password strength policy", () => {
    expect(validatePasswordStrength("short1A").ok).toBe(false);
    expect(validatePasswordStrength("alllowercase12").ok).toBe(false);
    expect(validatePasswordStrength("ALLUPPERCASE12").ok).toBe(false);
    expect(validatePasswordStrength("NoDigitsHereAtAll").ok).toBe(false);
    expect(validatePasswordStrength("Valid-Password-1").ok).toBe(true);
  });
});
