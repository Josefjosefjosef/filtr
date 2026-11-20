import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  PROVENANCE_SCHEMA,
  buildProvenance,
  createDecisionId,
  dispatchStatusForCycle,
  extractDecisionIdFromRunTitle,
  resolveGithubRunIdFromRuns,
} from "./provenance.ts";

describe("createDecisionId", () => {
  it("returns cjwd_ prefix and is unique across calls", () => {
    const a = createDecisionId(Date.parse("2026-11-20T12:00:00.000Z"));
    const b = createDecisionId(Date.parse("2026-11-20T12:00:00.000Z"));
    assert.match(a, /^cjwd_\d{8}T\d{6}Z_[0-9a-f]{8}$/);
    assert.match(b, /^cjwd_/);
    assert.notEqual(a, b);
  });
});

describe("buildProvenance", () => {
  it("fills required fields and keeps unknown null", () => {
    const p = buildProvenance({
      decisionId: "cjwd_20261120T120000Z_deadbeef",
      timeIso: "2026-11-20T12:00:00.000Z",
      decision: { action: "dispatch", reason: "stale", ageMinutes: 300, staleAfterMinutes: 240 },
      dispatchStatus: "dispatched_ok",
      githubRunId: null,
      sha: null,
      result: "dispatched_ok:run_id_pending",
      promotionDecision: null,
      productionReadback: {
        generatedAt: "2026-11-20T07:00:00.000Z",
        ageMinutes: 300,
        observedAt: "2026-11-20T12:00:00.000Z",
      },
      slaBudgetMinutes: 180,
    });
    assert.equal(p.schema, PROVENANCE_SCHEMA);
    assert.equal(p.decisionId, "cjwd_20261120T120000Z_deadbeef");
    assert.equal(p.reason, "stale");
    assert.equal(p.detectedState, "dispatch:stale");
    assert.equal(p.slaDeadline, "2026-11-20T15:00:00.000Z");
    assert.equal(p.dispatchStatus, "dispatched_ok");
    assert.equal(p.githubRunId, null);
    assert.equal(p.sha, null);
    assert.equal(p.promotionDecision, null);
    assert.ok(p.productionReadback);
    assert.equal(p.productionReadback.generatedAt, "2026-11-20T07:00:00.000Z");
  });
});

describe("extractDecisionIdFromRunTitle / resolveGithubRunIdFromRuns", () => {
  it("extracts wd= marker", () => {
    assert.equal(
      extractDecisionIdFromRunTitle("CATCHUP_DISPATCH_NOT_SCHEDULE 99 wd=cjwd_20261120T120000Z_aabbccdd"),
      "cjwd_20261120T120000Z_aabbccdd",
    );
    assert.equal(extractDecisionIdFromRunTitle("CATCHUP_DISPATCH_NOT_SCHEDULE 99"), null);
  });

  it("resolves run id only when decisionId is proven in title", () => {
    const decisionId = "cjwd_20261120T120000Z_aabbccdd";
    const dispatchStartedMs = Date.parse("2026-11-20T12:00:00.000Z");
    const hit = resolveGithubRunIdFromRuns({
      decisionId,
      dispatchStartedMs,
      runs: [
        {
          id: 111,
          event: "workflow_dispatch",
          created_at: "2026-11-20T12:00:05.000Z",
          display_title: `CATCHUP_DISPATCH_NOT_SCHEDULE 111 wd=${decisionId}`,
        },
        {
          id: 110,
          event: "workflow_dispatch",
          created_at: "2026-11-20T11:59:00.000Z",
          display_title: "CATCHUP_DISPATCH_NOT_SCHEDULE 110",
        },
      ],
    });
    assert.equal(hit, 111);

    const miss = resolveGithubRunIdFromRuns({
      decisionId,
      dispatchStartedMs,
      runs: [
        {
          id: 222,
          event: "workflow_dispatch",
          created_at: "2026-11-20T12:00:05.000Z",
          display_title: "CATCHUP_DISPATCH_NOT_SCHEDULE 222",
        },
      ],
    });
    assert.equal(miss, null);
  });
});

describe("dispatchStatusForCycle", () => {
  it("maps observe / skip / ok / fail", () => {
    assert.equal(
      dispatchStatusForCycle({ action: "skip", allowMutations: true, dispatch: null }),
      "skipped",
    );
    assert.equal(
      dispatchStatusForCycle({ action: "dispatch", allowMutations: false, dispatch: null }),
      "observe_only",
    );
    assert.equal(
      dispatchStatusForCycle({
        action: "dispatch",
        allowMutations: true,
        dispatch: { ok: true },
      }),
      "dispatched_ok",
    );
    assert.equal(
      dispatchStatusForCycle({
        action: "dispatch",
        allowMutations: true,
        dispatch: { ok: false },
      }),
      "dispatch_failed",
    );
  });
});
