/**
 * Fail-closed bootstrap D1 precheck evaluation (plain ESM for Actions + tests).
 * Keep in sync with src/bootstrap-precheck.ts (tests assert both).
 */

export function redactSensitive(text) {
  return String(text || "")
    .replace(/[A-Za-z0-9_\-]{24,}/g, "[REDACTED]")
    .replace(/Bearer\s+\S+/gi, "Bearer [REDACTED]")
    .replace(/activate=[^\s&]+/gi, "activate=[REDACTED]")
    .slice(0, 800);
}

function parseWranglerJson(raw) {
  const s = String(raw || "").trim();
  if (!s) return { ok: false, reason: "empty_stdout" };
  const startArr = s.indexOf("[");
  const startObj = s.indexOf("{");
  let start = -1;
  if (startArr >= 0 && (startObj < 0 || startArr < startObj)) start = startArr;
  else if (startObj >= 0) start = startObj;
  if (start < 0) return { ok: false, reason: "no_json" };
  try {
    return { ok: true, value: JSON.parse(s.slice(start)) };
  } catch {
    return { ok: false, reason: "invalid_json" };
  }
}

function extractResults(parsed) {
  const blocks = Array.isArray(parsed) ? parsed : [parsed];
  const all = [];
  for (const block of blocks) {
    if (!block || typeof block !== "object") continue;
    if (Array.isArray(block.results)) {
      for (const row of block.results) {
        if (row && typeof row === "object") all.push(row);
      }
    } else if (Array.isArray(block.result)) {
      for (const row of block.result) {
        if (row && typeof row === "object") all.push(row);
      }
    }
  }
  return all;
}

function firstNumber(rows, keys) {
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

function stderrSuggestsMissingTable(stderr) {
  const s = String(stderr || "").toLowerCase();
  return (
    s.includes("no such table") ||
    (s.includes("sqlite_error") && s.includes("admin_user_roles")) ||
    (s.includes("admin_user_roles") && s.includes("does not exist"))
  );
}

export function evaluatePrecheck(input) {
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
        return { status: "TABLE_MISSING", count: count, detail: "admin_user_roles_absent", processExit: 1 };
      }
      return { status: "OK", count: count, detail: "schema_ok", processExit: 0 };
    }
    if (kind === "main_admin_count") {
      if (count === 0) return { status: "OK", count: count, detail: "no_main_admin", processExit: 0 };
      if (count >= 1) {
        return { status: "MAIN_ADMIN_EXISTS", count: count, detail: "idempotent_lock", processExit: 1 };
      }
      return { status: "AMBIGUOUS", count: count, detail: "unexpected_count", processExit: 1 };
    }
    return { status: "OK", count: count, detail: "users_counted", processExit: 0 };
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
