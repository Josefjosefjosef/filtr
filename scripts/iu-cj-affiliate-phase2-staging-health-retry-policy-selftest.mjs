#!/usr/bin/env node
/** Mirrors bootstrap health wait policy (transient vs fail-closed). */
export function shouldRetryStagingHealthHttp(code) {
  const c = Number(code);
  if (c === 401 || c === 403) return false;
  if (c === 404 || c === 502 || c === 503 || c === 0) return true;
  return false;
}

export function isTerminalHealthHttpFailure(code) {
  const c = Number(code);
  if (c === 401 || c === 403) return true;
  if (shouldRetryStagingHealthHttp(c)) return false;
  if (c === 200) return false;
  return true;
}

const failures = [];
function expect(name, cond) {
  if (!cond) failures.push(name);
}

expect("retry_404", shouldRetryStagingHealthHttp(404));
expect("retry_503", shouldRetryStagingHealthHttp(503));
expect("retry_000", shouldRetryStagingHealthHttp(0));
expect("no_retry_401", !shouldRetryStagingHealthHttp(401));
expect("no_retry_403", !shouldRetryStagingHealthHttp(403));
expect("no_retry_200", !shouldRetryStagingHealthHttp(200));
expect("terminal_500", isTerminalHealthHttpFailure(500));
expect("not_terminal_404", !isTerminalHealthHttpFailure(404));

console.log(
  JSON.stringify({
    IU_CJ_STAGING_HEALTH_RETRY_POLICY_SELFTEST: failures.length ? "FAIL" : "OK",
    failures,
  })
);
process.exit(failures.length ? 1 : 0);
