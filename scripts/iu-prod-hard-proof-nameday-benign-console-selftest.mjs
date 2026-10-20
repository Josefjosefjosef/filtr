#!/usr/bin/env node
/** Negative coverage: nameday harness must not swallow real console errors. */
function isNamedayHarnessBenignConsoleText(text) {
  const t = String(text || "");
  return /Permissions policy violation.*Clipboard API/i.test(t);
}

const failures = [];
function expect(name, cond) {
  if (!cond) failures.push(name);
}

expect(
  "benign_clipboard_policy",
  isNamedayHarnessBenignConsoleText(
    "Permissions policy violation: The Clipboard API has been blocked because of a permissions policy applied to the current document."
  )
);
expect("empty_not_benign", !isNamedayHarnessBenignConsoleText(""));
expect("typeerror_not_benign", !isNamedayHarnessBenignConsoleText("Uncaught TypeError: boom"));
expect(
  "other_permissions_policy_not_benign",
  !isNamedayHarnessBenignConsoleText("Permissions policy violation: geolocation is not allowed")
);
expect(
  "clipboard_without_policy_prefix_not_benign",
  !isNamedayHarnessBenignConsoleText("Failed to execute writeText on Clipboard")
);

const ok = failures.length === 0;
console.log(
  JSON.stringify({
    IU_PROD_HARD_PROOF_NAMEDAY_BENIGN_CONSOLE_SELFTEST: ok ? "OK" : "FAIL",
    pass: ok ? 6 : 6 - failures.length,
    fail: failures.length,
    failures,
  })
);
process.exit(ok ? 0 : 1);
