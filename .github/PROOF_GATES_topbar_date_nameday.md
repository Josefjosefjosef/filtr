# Proof gates: topbar date/nameday removal (P0)

Proof script (run from %TEMP%, never committed) must set **PASS=true** only when **all** of the following hold:

| Gate | Required value | Meaning |
|------|----------------|---------|
| boxRemoved | true | #iuTopbarToday not in DOM or not visible |
| noResidualStrip | true | No strip under CTA |
| noHelperTextUnderCta | true | No "Svátek" in topbar CTA area |
| dateRendered | false | No date text in topbar/CTA scope |
| namedayRendered | false | No "Svátek má …" in topbar/CTA scope |
| CLS | 0 | Cumulative Layout Shift = 0 |
| overflowX | false | No horizontal overflow (scrollWidth ≤ clientWidth) |
| railShift | 0 | No rail shift |
| consoleErrorsCount | 0 | No console or page errors |

**PASS** = AND of all gates. On fail, proof must exit with code ≠ 0.

**Semantics:** `overflowX` in output = "page has horizontal overflow" (true = fail). Do not invert.

**Scope for date/nameday:** Only elements inside #topbarWrap, #iuTopbarRight, .iuRightTopCtas.
