/**
 * Fail-closed bootstrap D1 precheck evaluation (pure; no I/O).
 * Used by scripts/iu-ads-bootstrap-precheck.mjs and unit tests.
 */

export type PrecheckKind = "main_admin_count" | "users_count" | "bootstrap_lock" | "schema_probe";

export type PrecheckResult = {
  status:
    | "OK"
    | "D1_QUERY_FAILED"
    | "TABLE_MISSING"
    | "JSON_INVALID"
    | "MAIN_ADMIN_EXISTS"
    | "BOOTSTRAP_COMPLETED"
    | "AMBIGUOUS";
  count: number | null;
  detail: string;
  processExit: number;
};

export function redactSensitive(text: string): string {
  return String(text || "")
    .replace(/[A-Za-z0-9_\-]{24,}/g, "[REDACTED]")
    .replace(/Bearer\s+\S+/gi, "Bearer [REDACTED]")
    .replace(/activate=[^\s&]+/gi, "activate=[REDACTED]")
    .slice(0, 800);
}

function parseWranglerJson(raw: string): { ok: true; value: unknown } | { ok: false; reason: string } {
  const s = String(raw || "").trim();
  if (!s) return { ok: false, reason: "empty_stdout" };
  const startArr = s.indexOf("[");
  const startObj = s.indexOf("{");
  let start = -1;
  if (startArr >= 0 && (startObj < 0 || startArr < startObj)) start = startArr;
  else if (startObj >= 0) start = startObj;
  if (start < 0) return { ok: false, reason: "no_json" };
  try {
    return { ok: true, value: JSON.parse(s.slice(start)) as unknown };
  } catch {
    return { ok: false, reason: "invalid_json" };
  }
}

function extractResults(parsed: unknown): Array<Record<string, unknown>> {
  const blocks = Array.isArray(parsed) ? parsed : [parsed];
  const all: Array<Record<string, unknown>> = [];
  for (const block of blocks) {
    if (!block || typeof block !== "object") continue;
    const b = block as { results?: unknown; result?: unknown };
    if (Array.isArray(b.results)) {
      for (const row of b.results) {
        if (row && typeof row === "object") all.push(row as Record<string, unknown>);
      }
    } else if (Array.isArray(b.result)) {
      for (const row of b.result) {
        if (row && typeof row === "object") all.push(row as Record<string, unknown>);
      }
    }
  }
  return all;
}

function firstNumber(rows: Array<Record<string, unknown>>, keys: string[]): number | null {
  for (const row of rows) {
    for (const k of keys) {
      if (row[k] != null && row[k] !== "") {
        const n = Number(row[k]);
        if (Number.isFinite(n)) return n;
      }
    }
  }
  return null;
}

function stderrSuggestsMissingTable(stderr: string): boolean {
  const s = String(stderr || "").toLowerCase();
  return (
    s.includes("no such table") ||
    (s.includes("sqlite_error") && s.includes("admin_user_roles")) ||
    (s.includes("admin_user_roles") && s.includes("does not exist"))
  );
}

export function evaluatePrecheck(input: {
  kind: PrecheckKind | string;
  exitCode: number | string;
  stdout: string;
  stderr: string;
}): PrecheckResult {
  const ec = Number(input.exitCode);
  const safeStderr = redactSensitive(input.stderr);
  if (!Number.isFinite(ec)) {
    return { status: "AMBIGUOUS", count: null, detail: "bad_exit_code", processExit: 1 };
  }

  if (ec !== 0) {
    if (stderrSuggestsMissingTable(input.stderr)) {
      return { status: "TABLE_MISSING", count: null, detail: safeStderr || "no_such_table", processExit: 1 };
    }
    return {
      status: "D1_QUERY_FAILED",
      count: null,
      detail: safeStderr || "wrangler_exit_" + String(ec),
      processExit: 1,
    };
  }

  const parsed = parseWranglerJson(input.stdout);
  if (!parsed.ok) {
    return { status: "JSON_INVALID", count: null, detail: parsed.reason, processExit: 1 };
  }
  const rows = extractResults(parsed.value);
  const kind = input.kind;

  if (kind === "main_admin_count" || kind === "users_count" || kind === "schema_probe") {
    const count = firstNumber(rows, ["cnt", "count", "COUNT(*)"]);
    if (count == null || !Number.isFinite(count) || count < 0) {
      return { status: "AMBIGUOUS", count: null, detail: "count_missing", processExit: 1 };
    }
    if (kind === "schema_probe") {
      if (count < 1) {
        return { status: "TABLE_MISSING", count, detail: "admin_user_roles_absent", processExit: 1 };
      }
      return { status: "OK", count, detail: "schema_ok", processExit: 0 };
    }
    if (kind === "main_admin_count") {
      if (count === 0) return { status: "OK", count, detail: "no_main_admin", processExit: 0 };
      if (count >= 1) {
        return { status: "MAIN_ADMIN_EXISTS", count, detail: "idempotent_lock", processExit: 1 };
      }
      return { status: "AMBIGUOUS", count, detail: "unexpected_count", processExit: 1 };
    }
    return { status: "OK", count, detail: "users_counted", processExit: 0 };
  }

  if (kind === "bootstrap_lock") {
    if (!rows.length) return { status: "OK", count: 0, detail: "lock_unset", processExit: 0 };
    const val = rows[0] && rows[0].value != null ? String(rows[0].value) : "";
    if (val === "1") {
      return { status: "BOOTSTRAP_COMPLETED", count: 1, detail: "lock_set", processExit: 1 };
    }
    return { status: "AMBIGUOUS", count: null, detail: "unexpected_lock_value", processExit: 1 };
  }

  return { status: "AMBIGUOUS", count: null, detail: "unknown_kind", processExit: 1 };
}
