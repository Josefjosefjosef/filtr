/**
 * Fail-closed NDIC Czech egress runner identity (runtime, no secret values logged).
 * Blocks GitHub-hosted /home/runner bypass when feature code is checked out from main.
 */
export const NDIC_EXPECTED_RUNNER_NAME = "infouzel-ndic-cz-vps4204";
export const NDIC_REQUIRED_LABELS = Object.freeze([
  "self-hosted",
  "Linux",
  "X64",
  "ndic-cz-egress",
]);

/**
 * @param {NodeJS.ProcessEnv|Record<string,string|undefined>} [env]
 * @param {{ cwd?: string }} [opts]
 * @returns {{ ok: true, skipped?: boolean } | never}
 */
export function assertNdicCzechEgressRunnerOrThrow(env = process.env, opts = {}) {
  const e = env || {};
  const mode = String(e.IU_NDIC_DATEX_V1_MODE || "").trim().toLowerCase();
  const hasPullSecretNamePresent = Boolean(
    String(e.IU_NDIC_PULL_URL || "").trim() ||
      String(e.IU_NDIC_PULL_USER || "").trim() ||
      String(e.IU_NDIC_PULL_PASS || "").trim() ||
      String(e.IU_NDIC_TMC_PULL_URL || "").trim() ||
      String(e.IU_NDIC_TMC_PULL_USER || "").trim() ||
      String(e.IU_NDIC_TMC_PULL_PASS || "").trim() ||
      String(e.IU_NDIC_MOBILITYDATA_SUBSCRIBER_ID || "").trim()
  );
  const networkIntended =
    mode === "shadow" ||
    mode === "active" ||
    mode === "format_inspection" ||
    hasPullSecretNamePresent;
  if (!networkIntended) {
    return { ok: true, skipped: true };
  }

  if (String(e.RUNNER_ENVIRONMENT || "") !== "self-hosted") {
    throw Object.assign(new Error("REFUSING_GITHUB_HOSTED"), {
      code: "REFUSING_GITHUB_HOSTED",
    });
  }
  if (String(e.RUNNER_NAME || "") !== NDIC_EXPECTED_RUNNER_NAME) {
    throw Object.assign(new Error("REFUSING_UNEXPECTED_RUNNER_NAME"), {
      code: "REFUSING_UNEXPECTED_RUNNER_NAME",
    });
  }
  if (String(e.RUNNER_OS || "") !== "Linux") {
    throw Object.assign(new Error("REFUSING_UNEXPECTED_OS"), {
      code: "REFUSING_UNEXPECTED_OS",
    });
  }
  if (String(e.RUNNER_ARCH || "") !== "X64") {
    throw Object.assign(new Error("REFUSING_UNEXPECTED_ARCH"), {
      code: "REFUSING_UNEXPECTED_ARCH",
    });
  }

  const paths = [String(e.GITHUB_WORKSPACE || ""), String(opts.cwd || process.cwd() || "")];
  for (const p of paths) {
    if (!p) continue;
    if (p === "/home/runner" || p.startsWith("/home/runner/")) {
      throw Object.assign(new Error("REFUSING_GITHUB_HOSTED_PATH"), {
        code: "REFUSING_GITHUB_HOSTED_PATH",
      });
    }
  }
  return { ok: true };
}
