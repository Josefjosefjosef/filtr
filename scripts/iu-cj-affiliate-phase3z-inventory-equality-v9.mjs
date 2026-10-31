#!/usr/bin/env node
/**
 * JOINED CID ↔ merchant-website audit set equality (not mere count sums).
 */
export function assertJoinedWebsiteAuditEquality(joinedCids, websiteAuditRows) {
  const joined = [...new Set((joinedCids || []).map(String))];
  const audited = [...new Set((websiteAuditRows || []).map((r) => String(r.advertiserId || r.advertiserCid || "")))].filter(
    Boolean
  );
  const joinedSet = new Set(joined);
  const auditSet = new Set(audited);
  const missingInAudit = joined.filter((id) => !auditSet.has(id));
  const extraInAudit = audited.filter((id) => !joinedSet.has(id));
  const duplicateJoined = joined.filter((id, i) => joined.indexOf(id) !== i);
  const duplicateAudit = audited.filter((id, i) => audited.indexOf(id) !== i);
  const ok =
    missingInAudit.length === 0 &&
    extraInAudit.length === 0 &&
    duplicateJoined.length === 0 &&
    duplicateAudit.length === 0 &&
    joined.length === audited.length;
  return {
    ok,
    joinedCount: joined.length,
    auditCount: audited.length,
    missingInAudit,
    extraInAudit,
    duplicateJoined: [...new Set(duplicateJoined)],
    duplicateAudit: [...new Set(duplicateAudit)],
    note: ok
      ? "JOINED set equals website-audit set"
      : "SET_INEQUALITY — fix before claiming 100% merchant coverage",
  };
}

export function classifyPublicationBuckets(partners) {
  const rows = partners || [];
  const buckets = {
    READY: [],
    PENDING: [],
    BLOCKED: [],
    QUARANTINED: [],
  };
  for (const p of rows) {
    const pub = String(p.publishability || "");
    const hold = String(p.holdReason || "");
    if (pub === "READY_FOR_REVIEW" || pub === "CZ_SUITABILITY_VERIFIED" || pub === "AFFILIATE_LINK_VERIFIED") {
      if (hold && hold !== "null") buckets.PENDING.push(p);
      else buckets.READY.push(p);
    } else if (pub === "QUARANTINED" || hold === "UNSUITABLE_MAIN_DESTINATION" || hold === "CATEGORY_REVIEW_REQUIRED") {
      buckets.BLOCKED.push(p);
      buckets.QUARANTINED.push(p);
    } else {
      buckets.PENDING.push(p);
    }
  }
  return {
    READY: buckets.READY.length,
    PENDING: buckets.PENDING.length,
    BLOCKED: buckets.BLOCKED.length,
    QUARANTINED: buckets.QUARANTINED.length,
    // QUARANTINED ⊆ BLOCKED for reporting; READY+PENDING+BLOCKED should cover JOINED
    sumReadyPendingBlocked: buckets.READY.length + buckets.PENDING.length + buckets.BLOCKED.length,
    overlapReadyPending: buckets.READY.filter((p) =>
      buckets.PENDING.some((x) => String(x.advertiserId) === String(p.advertiserId))
    ).length,
  };
}

if (import.meta.url === `file://${process.argv[1]?.replace(/\\/g, "/")}` || process.argv[1]?.endsWith("iu-cj-affiliate-phase3z-inventory-equality-v9.mjs")) {
  const a = assertJoinedWebsiteAuditEquality(["1", "2"], [{ advertiserId: "1" }, { advertiserId: "2" }]);
  const b = assertJoinedWebsiteAuditEquality(["1", "2"], [{ advertiserId: "1" }]);
  console.log(JSON.stringify({ okSelf: a.ok === true && b.ok === false, a, b }));
}
