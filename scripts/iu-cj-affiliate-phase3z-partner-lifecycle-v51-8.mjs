/**
 * V51.8 — partner lifecycle transitions (JOINED → ACTIVE → ENDED → REJOINED).
 * Email/AI are never authority for JOINED/ENDED.
 */
import { resolveChipOwnership } from "./iu-cj-affiliate-phase3z-partner-registry-v1.mjs";

export const PARTNER_LIFECYCLE_SCHEMA = "iu-cj-affiliate-phase3z-partner-lifecycle-v51-8";

export function normalizeRelationshipStatus(raw) {
  const s = String(raw || "").trim().toLowerCase();
  if (!s) return "unknown";
  if (s === "joined" || s === "new_joined" || s === "rejoined") return "joined";
  if (s === "ended" || s === "left" || s === "declined" || s === "removed") return "ended";
  return s;
}

/**
 * Classify transition between previous and next CJ relationship status.
 */
export function classifyPartnerLifecycleTransition(prevStatus, nextStatus) {
  const prev = normalizeRelationshipStatus(prevStatus);
  const next = normalizeRelationshipStatus(nextStatus);
  if (prev === next) {
    return {
      transition: prev === "joined" ? "ACTIVE_STABLE" : prev === "ended" ? "ENDED_STABLE" : "UNCHANGED",
      publicEligible: next === "joined",
      promoteAllowed: next === "joined",
    };
  }
  if (prev !== "joined" && next === "joined") {
    const wasEnded = prev === "ended";
    return {
      transition: wasEnded ? "REJOINED" : "JOINED",
      publicEligible: true,
      promoteAllowed: true,
    };
  }
  if (prev === "joined" && next === "ended") {
    return {
      transition: "ENDED",
      publicEligible: false,
      promoteAllowed: false,
    };
  }
  return {
    transition: "OTHER",
    publicEligible: next === "joined",
    promoteAllowed: next === "joined",
  };
}

export function evaluatePartnerLifecyclePublicRules(opts = {}) {
  const rel = normalizeRelationshipStatus(opts.relationshipStatus);
  const ownership = resolveChipOwnership({
    management: opts.management || "CJ_MANAGED",
    relationshipStatus: rel,
    publishability: opts.publishability,
  });
  const ended = rel === "ended";
  return {
    relationshipStatus: rel,
    ended,
    publicPromotionAllowed: !ended && ownership.takeoverEligible !== false && rel === "joined",
    chipOwnership: ownership.ownership,
    note: ended
      ? "ENDED partner must not receive unauthorized public promotion."
      : "JOINED/REJOINED may promote when affiliate URL + policy gates pass.",
  };
}

export function runPartnerLifecycleScenarios() {
  const scenarios = [];
  function add(name, fn) {
    const r = fn();
    scenarios.push({ name, ok: r.ok === true, detail: r });
  }

  add("joined_active", () => {
    const t = classifyPartnerLifecycleTransition("joined", "joined");
    const rules = evaluatePartnerLifecyclePublicRules({ relationshipStatus: "joined" });
    return { ok: t.transition === "ACTIVE_STABLE" && rules.publicPromotionAllowed === true, t, rules };
  });
  add("new_joined", () => {
    const t = classifyPartnerLifecycleTransition("unknown", "joined");
    return { ok: t.transition === "JOINED" && t.promoteAllowed === true, t };
  });
  add("ended_blocks_promo", () => {
    const t = classifyPartnerLifecycleTransition("joined", "ended");
    const rules = evaluatePartnerLifecyclePublicRules({ relationshipStatus: "ended" });
    return {
      ok: t.transition === "ENDED" && rules.publicPromotionAllowed === false && rules.ended === true,
      t,
      rules,
    };
  });
  add("rejoined_restores", () => {
    const t = classifyPartnerLifecycleTransition("ended", "joined");
    const rules = evaluatePartnerLifecyclePublicRules({ relationshipStatus: "rejoined" });
    return {
      ok: t.transition === "REJOINED" && rules.publicPromotionAllowed === true,
      t,
      rules,
    };
  });

  const failed = scenarios.filter((s) => !s.ok);
  return {
    schema: PARTNER_LIFECYCLE_SCHEMA,
    ok: failed.length === 0,
    failed: failed.map((f) => f.name),
    scenarios,
  };
}
