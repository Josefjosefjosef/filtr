import {
  uniqueGuardScriptsForPrWorkflow,
  uniqueVitestForPrWorkflow,
} from "../src/regression-freeze-manifest.ts";

const vitest = uniqueVitestForPrWorkflow();
const guards = uniqueGuardScriptsForPrWorkflow();
process.stdout.write('export VITEST_FILES="' + vitest.join(" ") + '"\n');
for (const g of guards) {
  process.stdout.write("GUARD_SCRIPT=" + g + "\n");
}
