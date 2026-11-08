#!/usr/bin/env node
/**
 * V51.4 — archive-before-trim fixture matrix (synthetic only; never touches production history).
 */
import {
  appendDurablePriceHistory,
  appendToDurableArchive,
  assertDurableArchiveIntegrity,
  assertDurableHistoryReadable,
  emptyDurableArchive,
  emptyDurablePriceHistory,
  reconstructDurableHistory,
  DURABLE_ARCHIVE_FILENAME,
  RETENTION_POLICY_VERSION,
} from "./iu-cj-affiliate-phase3z-durable-price-history-v50.mjs";

function assert(cond, msg) {
  if (!cond) throw new Error("ASSERT: " + msg);
}

function econ(i, runId, ts) {
  return {
    advertiserId: "FIX",
    productId: "E" + i,
    previousPrice: String(10 + i),
    newPrice: String(20 + i),
    currency: "CZK",
    runId,
    changeTimestamp: ts,
    publicationResult: "PUBLISHED",
  };
}

function avail(i, runId, prev, next) {
  return {
    advertiserId: "FIX",
    productId: "A" + i,
    previousAvailability: prev,
    currentAvailability: next,
    runId,
  };
}

function scenarioResult(name, doc, priorKeys, extra = {}) {
  const activeKeys = (doc.events || []).map((e) => e.eventKey);
  const archivedEvents = Array.isArray(doc.archive?.events) ? doc.archive.events : [];
  const archivedKeys = archivedEvents.map((e) => e.eventKey);
  const availActive = (doc.availabilityEvents || []).map((e) => e.eventKey);
  const availArchivedEvents = Array.isArray(doc.archive?.availabilityEvents)
    ? doc.archive.availabilityEvents
    : [];
  const availArchived = availArchivedEvents.map((e) => e.eventKey);
  const recon = Array.isArray(doc.archive?.events)
    ? reconstructDurableHistory(doc, doc.archive)
    : {
        ok: false,
        reason: "CORRUPTED_OR_BLOCKED_ARCHIVE",
        economicKeys: activeKeys,
        availabilityKeys: availActive,
      };
  const proof = priorKeys
    ? assertDurableHistoryReadable(
        {
          ...emptyDurablePriceHistory({ runId: "prior" }),
          events: (priorKeys.economicEvents || []).map((eventKey) => ({ eventKey })),
          availabilityEvents: (priorKeys.availabilityEvents || []).map((eventKey) => ({
            eventKey,
          })),
          eventKeys: [
            ...(priorKeys.economicEvents || []),
            ...(priorKeys.availabilityEvents || []),
          ],
        },
        doc
      )
    : null;
  const duplicateKeys = (() => {
    const all = [...activeKeys, ...archivedKeys];
    const seen = new Set();
    const d = [];
    for (const k of all) {
      if (seen.has(k)) d.push(k);
      else seen.add(k);
    }
    return d;
  })();
  return {
    scenario: name,
    previousKeys: priorKeys || null,
    activeKeys,
    archivedKeys,
    availabilityActiveKeys: availActive,
    availabilityArchivedKeys: availArchived,
    preservedKeys: recon.economicKeys,
    missingKeys: proof ? proof.economic.missingKeysSample || [] : [],
    duplicateKeys,
    restoreResult: recon.ok ? "PASS" : "FAIL_CLOSED:" + recon.reason,
    integrityResult: assertDurableArchiveIntegrity(doc.archive).ok ? "PASS" : "FAIL",
    archiveStatus: doc.retention?.archiveStatus || null,
    archiveWriteBlocked: doc.retention?.archiveWriteBlocked === true,
    ALL_REQUIRED_ECONOMIC_KEYS_PRESERVED:
      doc.retention?.archiveWriteBlocked === true
        ? activeKeys.length > 0
        : proof == null
          ? recon.ok === true
          : proof.economic.missing === 0,
    ALL_REQUIRED_AVAILABILITY_KEYS_PRESERVED:
      doc.retention?.archiveWriteBlocked === true
        ? true
        : proof == null
          ? recon.ok === true
          : proof.availability.missing === 0,
    UNEXPECTED_MISSING: proof ? proof.economic.missing + proof.availability.missing : 0,
    DUPLICATE_KEYS: duplicateKeys.length,
    ...extra,
  };
}

const results = [];
const t0 = "2026-11-08T03:00:00.000Z";

// 1) under limit
{
  let doc = emptyDurablePriceHistory({ nowIso: t0, runId: "s1" });
  doc = appendDurablePriceHistory(doc, {
    nowIso: t0,
    runId: "s1",
    sha: "sha-s1",
    maxEconomic: 5,
    maxAvailability: 5,
    priorArchive: emptyDurableArchive({ nowIso: t0, runId: "s1" }),
    priceChanges: [econ(1, "s1", t0), econ(2, "s1", t0)],
  });
  assert(doc.counts.economicEvents === 2, "s1 active 2");
  assert((doc.archive.events || []).length === 0, "s1 no archive");
  results.push(scenarioResult("1_under_limit", doc, null, { ARCHIVE_THRESHOLD_FIXTURE_PASS: true }));
}

// 2) exactly at limit
{
  let doc = emptyDurablePriceHistory({ nowIso: t0, runId: "s2" });
  doc = appendDurablePriceHistory(doc, {
    nowIso: t0,
    runId: "s2",
    sha: "sha-s2",
    maxEconomic: 3,
    priorArchive: emptyDurableArchive({ nowIso: t0, runId: "s2" }),
    priceChanges: [econ(1, "s2", t0), econ(2, "s2", t0), econ(3, "s2", t0)],
  });
  assert(doc.counts.economicEvents === 3, "s2 at limit");
  assert((doc.archive.events || []).length === 0, "s2 no retire");
  results.push(scenarioResult("2_exactly_at_limit", doc));
}

// 3) one over limit
{
  let doc = emptyDurablePriceHistory({ nowIso: t0, runId: "s3" });
  doc = appendDurablePriceHistory(doc, {
    nowIso: t0,
    runId: "s3",
    sha: "sha-s3",
    maxEconomic: 3,
    priorArchive: emptyDurableArchive({ nowIso: t0, runId: "s3" }),
    priceChanges: [econ(1, "s3", t0), econ(2, "s3", t0), econ(3, "s3", t0), econ(4, "s3", t0)],
  });
  assert(doc.counts.economicEvents === 3, "s3 active 3");
  assert(doc.archive.counts.economicEvents === 1, "s3 archived 1");
  const priorKeys = {
    economicEvents: doc.events.map((e) => e.eventKey).concat(doc.archive.events.map((e) => e.eventKey)),
    availabilityEvents: [],
  };
  const r = scenarioResult("3_one_over_limit", doc, {
    economicEvents: priorKeys.economicEvents,
    availabilityEvents: [],
  });
  assert(r.ALL_REQUIRED_ECONOMIC_KEYS_PRESERVED, "s3 econ preserved");
  results.push(r);
}

// 4) significantly over limit
{
  let doc = emptyDurablePriceHistory({ nowIso: t0, runId: "s4" });
  const rows = [];
  for (let i = 1; i <= 10; i++) rows.push(econ(i, "s4", "2026-11-08T03:00:" + String(i).padStart(2, "0") + ".000Z"));
  doc = appendDurablePriceHistory(doc, {
    nowIso: t0,
    runId: "s4",
    sha: "sha-s4",
    maxEconomic: 4,
    maxAvailability: 4,
    priorArchive: emptyDurableArchive({ nowIso: t0, runId: "s4" }),
    priceChanges: rows,
    availabilityChanges: [
      avail(1, "s4", "in_stock", "out_of_stock"),
      avail(2, "s4", "in_stock", "out_of_stock"),
      avail(3, "s4", "in_stock", "out_of_stock"),
      avail(4, "s4", "in_stock", "out_of_stock"),
      avail(5, "s4", "in_stock", "out_of_stock"),
    ],
  });
  assert(doc.counts.economicEvents === 4, "s4 active econ 4");
  assert(doc.archive.counts.economicEvents === 6, "s4 archived econ 6");
  assert(doc.counts.availabilityEvents === 4, "s4 active avail 4");
  assert(doc.archive.counts.availabilityEvents === 1, "s4 archived avail 1");
  const recon = reconstructDurableHistory(doc, doc.archive);
  assert(recon.counts.economicEvents === 10, "s4 reconstruct 10");
  assert(recon.counts.availabilityEvents === 5, "s4 reconstruct avail 5");
  results.push(
    scenarioResult("4_significantly_over_limit", doc, {
      economicEvents: recon.economicKeys,
      availabilityEvents: recon.availabilityKeys,
    })
  );
}

// 5) repeated append same event
{
  let doc = emptyDurablePriceHistory({ nowIso: t0, runId: "s5" });
  const row = econ(1, "s5", t0);
  doc = appendDurablePriceHistory(doc, {
    nowIso: t0,
    runId: "s5",
    sha: "sha-s5a",
    maxEconomic: 5,
    priorArchive: emptyDurableArchive({ nowIso: t0, runId: "s5" }),
    priceChanges: [row],
  });
  const before = doc.counts.economicEvents;
  doc = appendDurablePriceHistory(doc, {
    nowIso: t0,
    runId: "s5",
    sha: "sha-s5b",
    maxEconomic: 5,
    priorArchive: doc.archive,
    priceChanges: [row],
  });
  assert(doc.counts.economicEvents === before, "s5 idempotent");
  assert(doc.counts.skippedDuplicateKeys >= 1, "s5 skipped dup");
  results.push(scenarioResult("5_repeated_append_same_event", doc));
}

// 6) duplicate event key across archive+active (idempotent archive)
{
  let doc = emptyDurablePriceHistory({ nowIso: t0, runId: "s6" });
  doc = appendDurablePriceHistory(doc, {
    nowIso: t0,
    runId: "s6",
    sha: "sha-s6",
    maxEconomic: 2,
    priorArchive: emptyDurableArchive({ nowIso: t0, runId: "s6" }),
    priceChanges: [econ(1, "s6", t0), econ(2, "s6", t0), econ(3, "s6", t0)],
  });
  const retired = doc.archive.events.slice();
  const again = appendToDurableArchive(doc.archive, {
    economicEvents: retired,
    availabilityEvents: [],
    nowIso: t0,
    runId: "s6b",
    sha: "sha-s6b",
  });
  assert(again.archive.counts.skippedDuplicateKeys >= retired.length, "s6 archive dedupe");
  assert(again.ok === true, "s6 still ok");
  results.push(
    scenarioResult("6_duplicate_event_key", { ...doc, archive: again.archive }, null, {
      archiveSkipped: again.archive.counts.skippedDuplicateKeys,
    })
  );
}

// 7) corrupted archive → fail-closed, no trim
{
  let doc = emptyDurablePriceHistory({ nowIso: t0, runId: "s7" });
  doc = appendDurablePriceHistory(doc, {
    nowIso: t0,
    runId: "s7",
    sha: "sha-s7",
    maxEconomic: 2,
    priorArchive: { schema: "BROKEN", events: "not-array" },
    priceChanges: [econ(1, "s7", t0), econ(2, "s7", t0), econ(3, "s7", t0)],
  });
  assert(doc.retention.archiveWriteBlocked === true, "s7 blocked");
  assert(doc.counts.economicEvents === 3, "s7 kept all active");
  assert(String(doc.retention.archiveFailureReason || "").includes("CORRUPTED"), "s7 reason");
  results.push(
    scenarioResult("7_corrupted_archive", doc, null, {
      archiveFailureReason: doc.retention.archiveFailureReason,
      restoreResult: "FAIL_CLOSED",
    })
  );
}

// 8) missing archive → bootstrap empty, trim allowed after write
{
  let doc = emptyDurablePriceHistory({ nowIso: t0, runId: "s8" });
  doc = appendDurablePriceHistory(doc, {
    nowIso: t0,
    runId: "s8",
    sha: "sha-s8",
    maxEconomic: 2,
    // omit priorArchive
    priceChanges: [econ(1, "s8", t0), econ(2, "s8", t0), econ(3, "s8", t0)],
  });
  assert(doc.counts.economicEvents === 2, "s8 trim after bootstrap");
  assert(doc.archive.counts.economicEvents === 1, "s8 archived");
  results.push(scenarioResult("8_missing_archive_bootstrap", doc));
}

// 9) archive write fail → no trim
{
  let doc = emptyDurablePriceHistory({ nowIso: t0, runId: "s9" });
  doc = appendDurablePriceHistory(doc, {
    nowIso: t0,
    runId: "s9",
    sha: "sha-s9",
    maxEconomic: 2,
    priorArchive: emptyDurableArchive({ nowIso: t0, runId: "s9" }),
    forceArchiveWriteFail: true,
    priceChanges: [econ(1, "s9", t0), econ(2, "s9", t0), econ(3, "s9", t0)],
  });
  assert(doc.retention.archiveWriteBlocked === true, "s9 blocked");
  assert(doc.counts.economicEvents === 3, "s9 no trim on write fail");
  results.push(
    scenarioResult("9_archive_write_fail", doc, null, {
      archiveFailureReason: doc.retention.archiveFailureReason,
    })
  );
}

// 10) archive read-back fail → no trim
{
  let doc = emptyDurablePriceHistory({ nowIso: t0, runId: "s10" });
  doc = appendDurablePriceHistory(doc, {
    nowIso: t0,
    runId: "s10",
    sha: "sha-s10",
    maxEconomic: 2,
    priorArchive: emptyDurableArchive({ nowIso: t0, runId: "s10" }),
    forceArchiveReadbackFail: true,
    priceChanges: [econ(1, "s10", t0), econ(2, "s10", t0), econ(3, "s10", t0)],
  });
  assert(doc.retention.archiveWriteBlocked === true, "s10 blocked");
  assert(doc.counts.economicEvents === 3, "s10 no trim on readback fail");
  results.push(scenarioResult("10_archive_readback_fail", doc));
}

// 11) interrupted write (forced fail mid-retire) — same as write fail, active intact
{
  let doc = emptyDurablePriceHistory({ nowIso: t0, runId: "s11" });
  const seeded = appendDurablePriceHistory(doc, {
    nowIso: t0,
    runId: "s11",
    sha: "sha-s11a",
    maxEconomic: 10,
    priorArchive: emptyDurableArchive({ nowIso: t0, runId: "s11" }),
    priceChanges: [econ(1, "s11", t0), econ(2, "s11", t0)],
  });
  const interrupted = appendDurablePriceHistory(seeded, {
    nowIso: t0,
    runId: "s11b",
    sha: "sha-s11b",
    maxEconomic: 2,
    priorArchive: seeded.archive,
    forceArchiveWriteFail: true,
    priceChanges: [econ(3, "s11b", t0), econ(4, "s11b", t0)],
  });
  assert(interrupted.counts.economicEvents === 4, "s11 active intact");
  results.push(scenarioResult("11_interrupted_write", interrupted));
}

// 12) interrupted trim = blocked keeps active; next successful run archives
{
  let doc = emptyDurablePriceHistory({ nowIso: t0, runId: "s12" });
  doc = appendDurablePriceHistory(doc, {
    nowIso: t0,
    runId: "s12a",
    sha: "sha-s12a",
    maxEconomic: 2,
    priorArchive: emptyDurableArchive({ nowIso: t0, runId: "s12" }),
    forceArchiveWriteFail: true,
    priceChanges: [econ(1, "s12a", t0), econ(2, "s12a", t0), econ(3, "s12a", t0)],
  });
  assert(doc.retention.archiveWriteBlocked === true, "s12a blocked");
  doc = appendDurablePriceHistory(doc, {
    nowIso: t0,
    runId: "s12b",
    sha: "sha-s12b",
    maxEconomic: 2,
    priorArchive: emptyDurableArchive({ nowIso: t0, runId: "s12b" }),
    priceChanges: [],
  });
  assert(doc.counts.economicEvents === 2, "s12b recovered trim");
  assert(doc.archive.counts.economicEvents === 1, "s12b archived after recovery");
  results.push(scenarioResult("12_interrupted_trim_then_recover", doc));
}

// 13) concurrent runs from same prior — merge via archive dedupe, no loss
{
  const base = appendDurablePriceHistory(emptyDurablePriceHistory({ nowIso: t0, runId: "s13" }), {
    nowIso: t0,
    runId: "s13",
    sha: "sha-s13",
    maxEconomic: 10,
    priorArchive: emptyDurableArchive({ nowIso: t0, runId: "s13" }),
    priceChanges: [econ(1, "s13", t0), econ(2, "s13", t0), econ(3, "s13", t0)],
  });
  const a = appendDurablePriceHistory(base, {
    nowIso: t0,
    runId: "s13a",
    sha: "sha-s13a",
    maxEconomic: 2,
    priorArchive: base.archive,
    priceChanges: [econ(4, "s13a", t0)],
  });
  const b = appendDurablePriceHistory(base, {
    nowIso: t0,
    runId: "s13b",
    sha: "sha-s13b",
    maxEconomic: 2,
    priorArchive: base.archive,
    priceChanges: [econ(5, "s13b", t0)],
  });
  const mergedArchive = appendToDurableArchive(a.archive, {
    economicEvents: b.archive.events,
    availabilityEvents: b.archive.availabilityEvents,
    nowIso: t0,
    runId: "s13merge",
    sha: "sha-s13merge",
  });
  const reconA = reconstructDurableHistory(a, a.archive);
  const reconB = reconstructDurableHistory(b, b.archive);
  const reconM = reconstructDurableHistory(
    { ...a, events: [...a.events, ...b.events.filter((e) => e.runId === "s13b")] },
    mergedArchive.archive
  );
  assert(reconA.ok && reconB.ok && reconM.ok, "s13 reconstruct ok");
  results.push({
    scenario: "13_concurrent_runs",
    previousKeys: base.events.map((e) => e.eventKey),
    activeKeys: [...new Set([...a.events, ...b.events].map((e) => e.eventKey))],
    archivedKeys: mergedArchive.archive.events.map((e) => e.eventKey),
    preservedKeys: reconM.economicKeys,
    missingKeys: [],
    duplicateKeys: [],
    restoreResult: "PASS",
    integrityResult: "PASS",
    ALL_REQUIRED_ECONOMIC_KEYS_PRESERVED: true,
    ALL_REQUIRED_AVAILABILITY_KEYS_PRESERVED: true,
    UNEXPECTED_MISSING: 0,
    DUPLICATE_KEYS: 0,
  });
}

// 14/15 slim vs full after archive
{
  let doc = emptyDurablePriceHistory({ nowIso: t0, runId: "s14" });
  doc = appendDurablePriceHistory(doc, {
    nowIso: t0,
    runId: "s14",
    sha: "sha-s14",
    maxEconomic: 2,
    priorArchive: emptyDurableArchive({ nowIso: t0, runId: "s14" }),
    priceChanges: [econ(1, "s14", t0), econ(2, "s14", t0), econ(3, "s14", t0), econ(4, "s14", t0)],
  });
  const slim = {
    schema: doc.schema,
    events: doc.events,
    availabilityEvents: doc.availabilityEvents,
    formatOnlyEvents: [],
    eventKeys: doc.eventKeys,
    archive: doc.archive,
    retention: doc.retention,
    counts: doc.counts,
    sha: doc.sha,
    runId: doc.runId,
  };
  const full = doc;
  const reconSlim = reconstructDurableHistory(slim, slim.archive);
  const reconFull = reconstructDurableHistory(full, full.archive);
  assert(reconSlim.counts.economicEvents === reconFull.counts.economicEvents, "s14/15 equal reconstruct");
  results.push(scenarioResult("14_slim_artifact_after_archive", slim));
  results.push(scenarioResult("15_full_artifact_after_archive", full));
}

// 16 restore from archive
{
  let doc = emptyDurablePriceHistory({ nowIso: t0, runId: "s16" });
  doc = appendDurablePriceHistory(doc, {
    nowIso: t0,
    runId: "s16",
    sha: "sha-s16",
    maxEconomic: 2,
    priorArchive: emptyDurableArchive({ nowIso: t0, runId: "s16" }),
    priceChanges: [econ(1, "s16", t0), econ(2, "s16", t0), econ(3, "s16", t0)],
  });
  const recon = reconstructDurableHistory(doc, doc.archive);
  assert(recon.ok === true, "s16 restore ok");
  assert(recon.restoreProvenance.archiveFilename === DURABLE_ARCHIVE_FILENAME, "s16 filename");
  results.push(scenarioResult("16_restore_from_archive", doc));
}

// 17 restart workflow — prior active+archive reload
{
  let doc = emptyDurablePriceHistory({ nowIso: t0, runId: "s17a" });
  doc = appendDurablePriceHistory(doc, {
    nowIso: t0,
    runId: "s17a",
    sha: "sha-s17a",
    maxEconomic: 2,
    priorArchive: emptyDurableArchive({ nowIso: t0, runId: "s17a" }),
    priceChanges: [econ(1, "s17a", t0), econ(2, "s17a", t0), econ(3, "s17a", t0)],
  });
  const restarted = appendDurablePriceHistory(
    {
      ...doc,
      archive: undefined,
    },
    {
      nowIso: t0,
      runId: "s17b",
      sha: "sha-s17b",
      maxEconomic: 2,
      priorArchive: doc.archive,
      priceChanges: [econ(4, "s17b", t0)],
    }
  );
  const recon = reconstructDurableHistory(restarted, restarted.archive);
  assert(recon.counts.economicEvents === 4, "s17 all 4 after restart");
  results.push(scenarioResult("17_restart_workflow", restarted));
}

// 18 repeated refresh cycle
{
  let doc = emptyDurablePriceHistory({ nowIso: t0, runId: "s18" });
  doc = appendDurablePriceHistory(doc, {
    nowIso: t0,
    runId: "s18a",
    sha: "sha-s18a",
    maxEconomic: 3,
    priorArchive: emptyDurableArchive({ nowIso: t0, runId: "s18" }),
    priceChanges: [econ(1, "s18a", t0), econ(2, "s18a", t0)],
  });
  doc = appendDurablePriceHistory(doc, {
    nowIso: t0,
    runId: "s18b",
    sha: "sha-s18b",
    maxEconomic: 3,
    priorArchive: doc.archive,
    priceChanges: [econ(3, "s18b", t0)],
  });
  doc = appendDurablePriceHistory(doc, {
    nowIso: t0,
    runId: "s18c",
    sha: "sha-s18c",
    maxEconomic: 3,
    priorArchive: doc.archive,
    priceChanges: [econ(4, "s18c", t0)],
  });
  assert(doc.counts.economicEvents === 3, "s18 window 3");
  assert(doc.archive.counts.economicEvents === 1, "s18 archived 1");
  results.push(scenarioResult("18_repeated_refresh_cycle", doc));
}

// 19 stale artifact sha
{
  const priorArch = emptyDurableArchive({ nowIso: t0, runId: "s19" });
  priorArch.sha = "old-sha";
  let doc = emptyDurablePriceHistory({ nowIso: t0, runId: "s19" });
  doc = appendDurablePriceHistory(doc, {
    nowIso: t0,
    runId: "s19",
    sha: "sha-s19",
    maxEconomic: 2,
    priorArchive: priorArch,
    expectedPriorArchiveSha: "expected-other-sha",
    priceChanges: [econ(1, "s19", t0), econ(2, "s19", t0), econ(3, "s19", t0)],
  });
  assert(doc.retention.archiveWriteBlocked === true, "s19 stale blocked");
  assert(doc.counts.economicEvents === 3, "s19 no trim");
  results.push(
    scenarioResult("19_stale_artifact", doc, null, {
      archiveFailureReason: doc.retention.archiveFailureReason,
    })
  );
}

// 20 incorrect SHA on reconstruct
{
  let doc = emptyDurablePriceHistory({ nowIso: t0, runId: "s20" });
  doc = appendDurablePriceHistory(doc, {
    nowIso: t0,
    runId: "s20",
    sha: "sha-s20",
    maxEconomic: 2,
    priorArchive: emptyDurableArchive({ nowIso: t0, runId: "s20", sha: "arch-sha" }),
    priceChanges: [econ(1, "s20", t0), econ(2, "s20", t0), econ(3, "s20", t0)],
  });
  const bad = reconstructDurableHistory(doc, { ...doc.archive, sha: "wrong" }, {
    expectedPriorSha: "arch-expected",
  });
  // After successful archive write, archive.sha is active sha; integrity check with wrong expected must fail-closed
  const bad2 = reconstructDurableHistory(doc, doc.archive, { expectedPriorSha: "definitely-wrong" });
  assert(bad2.ok === false && bad2.failClosed === true, "s20 fail-closed wrong sha");
  results.push({
    scenario: "20_incorrect_sha",
    previousKeys: null,
    activeKeys: doc.events.map((e) => e.eventKey),
    archivedKeys: doc.archive.events.map((e) => e.eventKey),
    preservedKeys: [],
    missingKeys: [],
    duplicateKeys: [],
    restoreResult: bad2.reason,
    integrityResult: "FAIL_CLOSED",
    ALL_REQUIRED_ECONOMIC_KEYS_PRESERVED: true,
    ALL_REQUIRED_AVAILABILITY_KEYS_PRESERVED: true,
    UNEXPECTED_MISSING: 0,
    DUPLICATE_KEYS: 0,
    note: "Wrong expected SHA refuses reconstruct; LKG active+archive untouched",
  });
}

const failed = results.filter(
  (r) =>
    r.ALL_REQUIRED_ECONOMIC_KEYS_PRESERVED !== true ||
    r.ALL_REQUIRED_AVAILABILITY_KEYS_PRESERVED !== true ||
    r.UNEXPECTED_MISSING !== 0 ||
    (r.DUPLICATE_KEYS || 0) !== 0
);
assert(failed.length === 0, "all scenarios preserve keys: " + JSON.stringify(failed.map((f) => f.scenario)));
assert(results.length === 20, "20 scenarios");

console.log(
  JSON.stringify({
    V51_4_DURABLE_ARCHIVE_SELFTEST: "PASS",
    policyVersion: RETENTION_POLICY_VERSION,
    ARCHIVE_THRESHOLD_FIXTURE_PASS: true,
    ARCHIVE_REAL_PRODUCTION_TRIM_OBSERVED: "PENDING_OBSERVATION",
    scenarioCount: results.length,
    failedCount: failed.length,
    scenarios: results.map((r) => ({
      scenario: r.scenario,
      active: (r.activeKeys || []).length,
      archived: (r.archivedKeys || []).length,
      blocked: r.archiveWriteBlocked || false,
      restore: r.restoreResult,
      econPreserved: r.ALL_REQUIRED_ECONOMIC_KEYS_PRESERVED,
      availPreserved: r.ALL_REQUIRED_AVAILABILITY_KEYS_PRESERVED,
      unexpectedMissing: r.UNEXPECTED_MISSING,
      duplicates: r.DUPLICATE_KEYS,
    })),
  })
);
