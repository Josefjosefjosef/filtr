#!/usr/bin/env node
/**
 * V51.8 — acceptance table builder that never emits JS "undefined" strings.
 */
export function unknownOr(value, fallback = "UNKNOWN") {
  if (value === undefined || value === null || value === "") return fallback;
  if (typeof value === "number" && !Number.isFinite(value)) return fallback;
  return value;
}

export function buildAcceptanceTable(rows) {
  const out = [];
  for (const row of rows || []) {
    out.push({
      area: unknownOr(row.area),
      required: unknownOr(row.required, "PASS"),
      actual: unknownOr(row.actual),
      status: unknownOr(row.status, "NOT_READY"),
      evidence: unknownOr(row.evidence, "UNKNOWN"),
      note: unknownOr(row.note, ""),
    });
  }
  return out;
}

export function formatDeferredGapLine(recon) {
  const reconstructed = unknownOr(recon?.reconstructedNotInPublic, "UNKNOWN");
  const reported = unknownOr(recon?.reportedDeferredNew, "UNKNOWN");
  const gap = unknownOr(recon?.gap, "HISTORICAL_EVIDENCE_UNAVAILABLE");
  return `reconstructed ${reconstructed} / run ${reported} (gap ${gap})`;
}

export function assertNoUndefinedStrings(obj, path = "$") {
  const bad = [];
  const walk = (v, p) => {
    if (v === undefined) {
      bad.push(p);
      return;
    }
    if (typeof v === "string" && /\bundefined\b/i.test(v)) bad.push(p + "=" + v);
    if (v && typeof v === "object") {
      if (Array.isArray(v)) {
        v.forEach((x, i) => walk(x, p + "[" + i + "]"));
      } else {
        for (const [k, val] of Object.entries(v)) walk(val, p + "." + k);
      }
    }
  };
  walk(obj, path);
  return { ok: bad.length === 0, bad };
}

const isMain =
  process.argv[1] &&
  String(process.argv[1]).replace(/\\/g, "/").endsWith(
    "iu-cj-affiliate-phase3z-acceptance-table-v51-8.mjs"
  );
if (isMain) {
  const line = formatDeferredGapLine({
    reconstructedNotInPublic: undefined,
    reportedDeferredNew: undefined,
    gap: undefined,
  });
  const table = buildAcceptanceTable([
    { area: "DEFERRED_NEW", actual: line, status: "PASS" },
  ]);
  const check = assertNoUndefinedStrings({ line, table });
  if (!check.ok || /undefined/i.test(line)) {
    console.error(JSON.stringify({ IU_CJ_ACCEPTANCE_TABLE: "FAIL", line, bad: check.bad }));
    process.exitCode = 1;
  } else {
    console.log(JSON.stringify({ IU_CJ_ACCEPTANCE_TABLE: "PASS", line, rows: table.length }));
  }
}
