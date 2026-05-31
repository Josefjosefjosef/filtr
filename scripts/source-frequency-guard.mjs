/**
 * source_frequency_guard — no medium exceeds safe hourly fetch cap (4, exception 5).
 * Run: node scripts/source-frequency-guard.mjs
 */
import {
  loadInventory,
  MAX_FETCHES_EXCEPTION,
  MAX_FETCHES_PER_HOUR,
} from "./source-rotation-guard-lib.mjs";

function log(msg) {
  console.log(`[source-frequency-guard] ${msg}`);
}

function fail(msg) {
  console.error(`[source-frequency-guard] FAIL: ${msg}`);
}

function main() {
  let failed = false;
  const inv = loadInventory();
  const capDefault = Number(inv.max_fetches_per_source_per_hour || MAX_FETCHES_PER_HOUR);
  const capExc = Number(
    inv.max_fetches_per_source_per_hour_exception || MAX_FETCHES_EXCEPTION,
  );
  const excKeys = new Set(inv.exception_keys || []);

  log(`caps default=${capDefault}/h exception=${capExc}/h`);

  const violations = [];
  for (const row of inv.frequency_plan || []) {
    const fph = Number(row.fetches_per_hour || 0);
    const cap = excKeys.has(row.source) ? capExc : capDefault;
    if (fph > cap) {
      violations.push(`${row.source}:${fph}>${cap}`);
    }
  }

  if (violations.length) {
    fail(violations.join("; "));
    failed = true;
  } else {
    log(`all ${(inv.frequency_plan || []).length} sources within hourly cap PASS`);
  }

  const p0High = (inv.frequency_plan || []).filter(
    (r) => inv.priority_groups?.P0?.includes(r.source) && r.fetches_per_hour >= 4,
  );
  const p2Low = (inv.frequency_plan || []).filter(
    (r) => inv.priority_groups?.P2?.includes(r.source) && r.fetches_per_hour <= 2,
  );
  log(`P0 at 4/h=${p0High.length} P2 at <=2/h=${p2Low.length}`);

  if (failed) {
    console.error("[source-frequency-guard] RESULT=FAIL");
    process.exit(1);
  }
  log("RESULT=PASS");
}

main();
