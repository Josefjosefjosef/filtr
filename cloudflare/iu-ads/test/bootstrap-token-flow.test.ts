import { describe, expect, it } from "vitest";
// @ts-expect-error plain ESM lib used by GitHub Actions CLI (no types)
import * as tokenFlow from "../scripts/iu-ads-bootstrap-token-flow.mjs";
import { handleBootstrapMainAdmin } from "../src/admin-bootstrap";
import type { Env } from "../src/types";

const {
  SAFE_BOOTSTRAP_TOKEN_STEPS,
  assertDeployTarget,
  assertSafeBootstrapTokenOrder,
  artifactContainsToken,
  bootstrapTokenConfiguredByName,
  classifyBootstrapCallResult,
  classifyBootstrapReadiness,
  classifyCleanupAfterFailure,
  classifyPostDeleteProbe,
  classifySecretPutExit,
  EXPECTED_ADS_TARGET,
  logContainsRawToken,
  secretListHasName,
} = tokenFlow;

describe("bootstrap token workflow order", () => {
  it("accepts safe deploy-then-secret-put order", () => {
    expect(assertSafeBootstrapTokenOrder([...SAFE_BOOTSTRAP_TOKEN_STEPS]).ok).toBe(true);
  });

  it("rejects secret put before deploy (root cause of bootstrap_token_not_configured)", () => {
    const broken = [
      "d1_precheck",
      "secret_put_ADS_BOOTSTRAP_TOKEN",
      "deploy_worker_apis_on",
      "call_bootstrap_endpoint",
    ];
    const r = assertSafeBootstrapTokenOrder(broken);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toBe("forbidden_order");
    expect(r.pair).toEqual(["secret_put_ADS_BOOTSTRAP_TOKEN", "deploy_worker_apis_on"]);
  });

  it("rejects call before readiness", () => {
    const r = assertSafeBootstrapTokenOrder([
      "deploy_worker_apis_on",
      "secret_put_ADS_BOOTSTRAP_TOKEN",
      "call_bootstrap_endpoint",
      "readiness_until_configured",
    ]);
    expect(r.ok).toBe(false);
  });

  it("rejects deploy into wrong worker / account / URL", () => {
    expect(
      assertDeployTarget(
        {
          workerName: "infouzel-analytics",
          accountId: EXPECTED_ADS_TARGET.accountId,
          urlHost: EXPECTED_ADS_TARGET.urlHost,
        },
        EXPECTED_ADS_TARGET
      ).ok
    ).toBe(false);
    expect(
      assertDeployTarget(
        {
          workerName: "infouzel-ads",
          accountId: "00000000000000000000000000000000",
          urlHost: EXPECTED_ADS_TARGET.urlHost,
        },
        EXPECTED_ADS_TARGET
      ).ok
    ).toBe(false);
    expect(
      assertDeployTarget(
        {
          workerName: "infouzel-ads",
          accountId: EXPECTED_ADS_TARGET.accountId,
          urlHost: EXPECTED_ADS_TARGET.urlHost,
        },
        EXPECTED_ADS_TARGET
      ).ok
    ).toBe(true);
  });
});

describe("bootstrap readiness classification", () => {
  it("NOT_READY when secret missing (bootstrap_token_not_configured)", () => {
    const r = classifyBootstrapReadiness(503, { error: "bootstrap_token_not_configured" });
    expect(r.state).toBe("NOT_READY");
  });

  it("READY when wrong probe token gets unauthorized (secret present)", () => {
    const r = classifyBootstrapReadiness(401, { error: "unauthorized" });
    expect(r.state).toBe("READY");
  });

  it("treats delayed propagation as NOT_READY until configured", () => {
    const before = classifyBootstrapReadiness(503, { error: "bootstrap_token_not_configured" });
    const after = classifyBootstrapReadiness(401, { error: "unauthorized" });
    expect(before.state).toBe("NOT_READY");
    expect(after.state).toBe("READY");
  });
});

describe("bootstrap call classification", () => {
  it("fails closed on 503 token not configured", () => {
    const r = classifyBootstrapCallResult(503, { error: "bootstrap_token_not_configured" });
    expect(r.ok).toBe(false);
    expect(r.code).toBe("TOKEN_NOT_CONFIGURED");
  });

  it("fails closed on wrong token / missing token (401)", () => {
    expect(classifyBootstrapCallResult(401, { error: "unauthorized" }).ok).toBe(false);
  });

  it("fails closed on invalid response body", () => {
    expect(classifyBootstrapCallResult(200, { ok: true }).ok).toBe(false);
    expect(classifyBootstrapCallResult(200, { ok: false }).ok).toBe(false);
  });

  it("accepts 200 with activationUrl", () => {
    const r = classifyBootstrapCallResult(200, {
      ok: true,
      activationUrl: "https://x/admin?activate=abc",
    });
    expect(r.ok).toBe(true);
  });
});

describe("secret put / list / cleanup", () => {
  it("secret put non-zero exit is fail-closed", () => {
    expect(classifySecretPutExit(0).ok).toBe(true);
    expect(classifySecretPutExit(1).ok).toBe(false);
    expect(classifySecretPutExit(1).failClosed).toBe(true);
  });

  it("detects ADS_BOOTSTRAP_TOKEN name and rejects wrong name", () => {
    const list = [{ name: "ADS_SESSION_SECRET", type: "secret_text" }];
    expect(bootstrapTokenConfiguredByName(list)).toBe(false);
    expect(secretListHasName(list, "ADS_BOOTSTRAP_TOKNN")).toBe(false);
    expect(
      bootstrapTokenConfiguredByName([{ name: "ADS_BOOTSTRAP_TOKEN", type: "secret_text" }, ...list])
    ).toBe(true);
  });

  it("cleanup after failure preserves original error and still reports delete", () => {
    const r = classifyCleanupAfterFailure({
      bootstrapOutcome: "failure",
      cleanupOutcome: "success",
      originalError: "bootstrap_token_not_configured",
    });
    expect(r.jobFailed).toBe(true);
    expect(r.preserveOriginalError).toBe(true);
    expect(r.primary).toBe("bootstrap_token_not_configured");
    expect(r.cleanup).toBe("BOOTSTRAP_SECRET_DELETE=SUCCESS");
  });

  it("cleanup failure after success fails the job", () => {
    const r = classifyCleanupAfterFailure({
      bootstrapOutcome: "success",
      cleanupOutcome: "failure",
    });
    expect(r.jobFailed).toBe(true);
  });

  it("post-delete probe requires not_configured, not unauthorized", () => {
    expect(classifyPostDeleteProbe(503, { error: "bootstrap_token_not_configured" }).ok).toBe(true);
    expect(classifyPostDeleteProbe(401, { error: "unauthorized" }).ok).toBe(false);
  });
});

describe("token must not appear in log or artifact", () => {
  const token = "aabbccddeeff00112233445566778899aabbccddeeff00112233445566778899";

  it("detects token leak in log", () => {
    expect(logContainsRawToken("BOOTSTRAP_HTTP=200", token)).toBe(false);
    expect(logContainsRawToken("Authorization: Bearer " + token, token)).toBe(true);
  });

  it("detects token leak in artifact", () => {
    expect(artifactContainsToken("https://x/admin?activate=deadbeef", token)).toBe(false);
    expect(artifactContainsToken("token=" + token, token)).toBe(true);
  });
});

describe("handleBootstrapMainAdmin token binding", () => {
  const pepper = "pepper-test-0123456789abcdef";

  it("returns bootstrap_token_not_configured when Worker secret missing", async () => {
    const env = {
      DB: {} as D1Database,
      ADS_PASSWORD_PEPPER: pepper,
      ADS_SAFE_MODE: "true",
      ADS_PUBLIC_DELIVERY_ENABLED: "false",
    } as Env;
    const res = await handleBootstrapMainAdmin(
      new Request("https://ads.test/v1/internal/bootstrap/main-admin", {
        method: "POST",
        headers: { Authorization: "Bearer anything", "Content-Type": "application/json" },
        body: "{}",
      }),
      env
    );
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: "bootstrap_token_not_configured" });
  });

  it("returns unauthorized when secret set under wrong conceptual value (wrong token)", async () => {
    const env = {
      DB: {} as D1Database,
      ADS_PASSWORD_PEPPER: pepper,
      ADS_BOOTSTRAP_TOKEN: "correct-token-value-aaaaaaaaaaaa",
      ADS_SAFE_MODE: "true",
      ADS_PUBLIC_DELIVERY_ENABLED: "false",
    } as Env;
    const res = await handleBootstrapMainAdmin(
      new Request("https://ads.test/v1/internal/bootstrap/main-admin", {
        method: "POST",
        headers: { Authorization: "Bearer wrong-token", "Content-Type": "application/json" },
        body: "{}",
      }),
      env
    );
    expect(res.status).toBe(401);
  });

  it("returns unauthorized when Authorization header missing", async () => {
    const env = {
      DB: {} as D1Database,
      ADS_PASSWORD_PEPPER: pepper,
      ADS_BOOTSTRAP_TOKEN: "correct-token-value-bbbbbbbbbbbb",
      ADS_SAFE_MODE: "true",
      ADS_PUBLIC_DELIVERY_ENABLED: "false",
    } as Env;
    const res = await handleBootstrapMainAdmin(
      new Request("https://ads.test/v1/internal/bootstrap/main-admin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      }),
      env
    );
    expect(res.status).toBe(401);
  });
});
