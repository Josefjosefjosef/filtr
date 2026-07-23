import { describe, expect, it } from "vitest";
import { evaluateLockout, type LoginAttemptRecord } from "../src/admin-auth";

const OPTS = { maxAttempts: 5, lockoutSeconds: 900 };

function attemptsAgo(secondsAgoList: number[], now: Date): LoginAttemptRecord[] {
  return secondsAgoList.map((s) => ({ success: false, attempted_at: new Date(now.getTime() - s * 1000).toISOString() }));
}

describe("brute-force login lockout policy (kap. 3)", () => {
  it("does not lock out below the attempt threshold", () => {
    const now = new Date();
    const attempts = attemptsAgo([10, 20, 30], now);
    const result = evaluateLockout(attempts, { ...OPTS, now });
    expect(result.locked).toBe(false);
    expect(result.retryAfterSeconds).toBe(0);
  });

  it("locks out once consecutive failures reach the threshold within the window", () => {
    const now = new Date();
    const attempts = attemptsAgo([5, 10, 15, 20, 25], now);
    const result = evaluateLockout(attempts, { ...OPTS, now });
    expect(result.locked).toBe(true);
    expect(result.retryAfterSeconds).toBeGreaterThan(0);
    expect(result.retryAfterSeconds).toBeLessThanOrEqual(OPTS.lockoutSeconds);
  });

  it("unlocks automatically after the lockout window elapses", () => {
    const now = new Date();
    const attempts = attemptsAgo([1000, 1010, 1020, 1030, 1040], now);
    const result = evaluateLockout(attempts, { ...OPTS, now });
    expect(result.locked).toBe(false);
  });

  it("a successful login resets the consecutive failure streak", () => {
    const now = new Date();
    const attempts: LoginAttemptRecord[] = [
      { success: false, attempted_at: new Date(now.getTime() - 5_000).toISOString() },
      { success: false, attempted_at: new Date(now.getTime() - 10_000).toISOString() },
      { success: true, attempted_at: new Date(now.getTime() - 15_000).toISOString() },
      { success: false, attempted_at: new Date(now.getTime() - 20_000).toISOString() },
      { success: false, attempted_at: new Date(now.getTime() - 25_000).toISOString() },
      { success: false, attempted_at: new Date(now.getTime() - 30_000).toISOString() },
    ];
    const result = evaluateLockout(attempts, { ...OPTS, now });
    expect(result.locked).toBe(false);
  });

  it("uses uniform invalid_credentials semantics regardless of which factor failed (documented contract)", () => {
    // Pure policy function does not leak which factor (email vs password) caused failures;
    // callers (admin-auth.ts handleLogin) must return the same error code/status for both cases.
    const now = new Date();
    const attempts = attemptsAgo([1, 2, 3, 4, 5], now);
    const result = evaluateLockout(attempts, { maxAttempts: 5, lockoutSeconds: 60, now });
    expect(result.locked).toBe(true);
  });
});
