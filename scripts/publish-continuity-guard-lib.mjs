/**
 * Local artifact freshness policy for publish-continuity-guard.
 * Distinguishes current-workflow artifacts from truly stale bundles.
 */

export function parseGeneratedAtTs(v) {
  if (!v) return null;
  const t = Date.parse(v);
  return Number.isFinite(t) ? t : null;
}

/**
 * @param {{
 *   generatedAt: string|null|undefined,
 *   nowMs?: number,
 *   maxAgeMin?: number,
 *   runtimeToleranceMin?: number,
 *   workflowRunStartedAt?: string|null,
 *   githubRunId?: string|null,
 *   artifactPipelineRunId?: string|null,
 *   runStartSkewMs?: number,
 * }} opts
 */
export function evaluateLocalArtifactFreshness(opts) {
  const nowMs = opts.nowMs ?? Date.now();
  const maxAgeMin = Number(opts.maxAgeMin ?? 30);
  const runtimeToleranceMin = Number(opts.runtimeToleranceMin ?? 60);
  const runStartSkewMs = Number(opts.runStartSkewMs ?? 120_000);

  const genTs = parseGeneratedAtTs(opts.generatedAt);
  if (!genTs) {
    return {
      localArtifactCurrentRun: "NO",
      localArtifactAgeMin: null,
      localArtifactLimitMin: maxAgeMin,
      localArtifactRuntimeToleranceMin: runtimeToleranceMin,
      localArtifactEffectiveLimitMin: maxAgeMin,
      releaseAllowed: "NO",
      failReason: "local articles.json missing generatedAt",
    };
  }

  const ageMin = (nowMs - genTs) / 60_000;
  const runStartTs = parseGeneratedAtTs(opts.workflowRunStartedAt);
  const githubRunId = String(opts.githubRunId || "").trim();
  const artifactPipelineRunId = String(opts.artifactPipelineRunId || "").trim();

  const byRunId =
    githubRunId.length > 0 &&
    artifactPipelineRunId.length > 0 &&
    githubRunId === artifactPipelineRunId;
  const byRunStart = runStartTs != null && genTs >= runStartTs - runStartSkewMs;
  const isCurrentRun = byRunId || byRunStart;

  const effectiveLimitMin = isCurrentRun ? maxAgeMin + runtimeToleranceMin : maxAgeMin;
  const releaseAllowed = ageMin <= effectiveLimitMin;

  return {
    localArtifactCurrentRun: isCurrentRun ? "YES" : "NO",
    localArtifactAgeMin: ageMin,
    localArtifactLimitMin: maxAgeMin,
    localArtifactRuntimeToleranceMin: runtimeToleranceMin,
    localArtifactEffectiveLimitMin: effectiveLimitMin,
    releaseAllowed: releaseAllowed ? "YES" : "NO",
    failReason: releaseAllowed
      ? null
      : `local generatedAt age ${ageMin.toFixed(1)}m > ${effectiveLimitMin}m` +
        (isCurrentRun ? " (current-run effective limit)" : " (stale artifact)"),
  };
}
