import { describe, expect, it } from "vitest";
import { buildAuditEntry, redactForAudit } from "../src/audit";

describe("audit redaction (kap. 23 — no secrets in audit)", () => {
  it("redacts password/token/session-like keys but keeps other fields", () => {
    const redacted = redactForAudit({
      email: "user@example.test",
      password: "hunter2",
      password_hash: "pbkdf2$...",
      token: "abc.def.ghi",
      session_id: "sess_123",
      code_hash: "deadbeef",
      display_name: "Jane Admin",
    }) as Record<string, unknown>;
    expect(redacted.email).toBe("user@example.test");
    expect(redacted.display_name).toBe("Jane Admin");
    expect(redacted.password).toBe("[REDACTED]");
    expect(redacted.password_hash).toBe("[REDACTED]");
    expect(redacted.token).toBe("[REDACTED]");
    expect(redacted.session_id).toBe("[REDACTED]");
    expect(redacted.code_hash).toBe("[REDACTED]");
  });

  it("redacts nested objects and arrays recursively", () => {
    const redacted = redactForAudit({
      user: { email: "a@b.test", password: "secret" },
      history: [{ token: "t1" }, { note: "kept" }],
    }) as any;
    expect(redacted.user.password).toBe("[REDACTED]");
    expect(redacted.user.email).toBe("a@b.test");
    expect(redacted.history[0].token).toBe("[REDACTED]");
    expect(redacted.history[1].note).toBe("kept");
  });

  it("buildAuditEntry JSON-encodes redacted before/after and preserves result", () => {
    const entry = buildAuditEntry({
      auditId: "aud_1",
      actorUserId: "usr_1",
      operation: "password_changed",
      objectType: "admin_user",
      objectId: "usr_1",
      before: { password_hash: "old" },
      after: { password_hash: "new" },
      result: "success",
    });
    expect(entry.result).toBe("success");
    expect(entry.before_json).not.toBeNull();
    expect(entry.after_json).not.toBeNull();
    expect(JSON.parse(entry.before_json as string).password_hash).toBe("[REDACTED]");
    expect(JSON.parse(entry.after_json as string).password_hash).toBe("[REDACTED]");
    expect(entry.before_json).not.toContain("old");
    expect(entry.after_json).not.toContain("new");
  });

  it("leaves before/after null when omitted", () => {
    const entry = buildAuditEntry({
      auditId: "aud_2",
      actorUserId: null,
      operation: "login_failed",
      objectType: "admin_user",
      objectId: "unknown@example.test",
      result: "failure",
    });
    expect(entry.before_json).toBeNull();
    expect(entry.after_json).toBeNull();
  });
});
