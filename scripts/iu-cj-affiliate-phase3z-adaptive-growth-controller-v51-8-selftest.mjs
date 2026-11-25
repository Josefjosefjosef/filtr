import assert from 'node:assert/strict';
import {
  estimateSafeBatchSize,
  evaluateGrowthHealth,
  planAdaptiveBatch,
  circuitBreakerDecide,
} from './iu-cj-affiliate-phase3z-adaptive-growth-controller-v51-8.mjs';

const results = [];
function check(name, fn) {
  fn();
  results.push(name);
  console.log('PASS ' + name);
}

const candidates = Array.from({ length: 100 }, (_, i) => ({ id: 'p' + i }));
const healthy = evaluateGrowthHealth({ uniqueProducts: 1000, holdCount: 10, invalidRate: 0.01, syncDurationMs: 1000, pagesFail: 0 });

check('batch size estimate respects caps', () => {
  assert.equal(estimateSafeBatchSize({ deferredCount: 10000, caps: { maxBatch: 200 } }), 200);
  assert.equal(estimateSafeBatchSize({ deferredCount: 50 }), 50);
  assert.equal(estimateSafeBatchSize({ deferredCount: 200, holdRate: 0.5, caps: { maxBatch: 200 } }), 100);
  assert.equal(estimateSafeBatchSize({ deferredCount: 200, publicBytes: 1e12 }), 0);
});

check('healthy growth ok', () => {
  assert.equal(healthy.ok, true);
  assert.equal(healthy.stop, false);
});

check('normal growth planning when disarmed -> allowed 0', () => {
  const r = planAdaptiveBatch({ candidates, health: healthy, remainingCumulative: 1000, uncappedGate: false, executeArmed: false });
  assert.equal(r.allowed, 0);
  assert.equal(r.reason, 'OWNER_GATES_DISARMED');
  assert.equal(planAdaptiveBatch({ candidates, health: healthy, remainingCumulative: 1000 }).allowed, 0);
});

check('health stop on high hold', () => {
  const h = evaluateGrowthHealth({ uniqueProducts: 100, holdCount: 50, invalidRate: 0, syncDurationMs: 0, pagesFail: 0 });
  assert.equal(h.stop, true);
  assert.ok(h.reasons.includes('HOLD_RATE_STOP'));
});

check('health stop on high invalid', () => {
  const h = evaluateGrowthHealth({ uniqueProducts: 100, holdCount: 0, invalidRate: 0.5, syncDurationMs: 0, pagesFail: 0 });
  assert.equal(h.stop, true);
  assert.ok(h.reasons.includes('INVALID_RATE_STOP'));
});

check('health stop on pagesFail', () => {
  assert.equal(evaluateGrowthHealth({ uniqueProducts: 100, pagesFail: 1 }).stop, true);
});

check('circuit breaker STOP', () => {
  assert.equal(circuitBreakerDecide({ consecutiveFailures: 3, manualStop: false }), 'STOP');
  assert.equal(circuitBreakerDecide({ consecutiveFailures: 0, manualStop: true }), 'STOP');
  assert.equal(circuitBreakerDecide({ consecutiveFailures: 1, manualStop: false }), 'CONTINUE');
});

check('cannot bypass disarmed gates (partial arm / truthy non-true)', () => {
  const base = { candidates, health: healthy, remainingCumulative: 1000 };
  for (const [u, e] of [[true, false], [false, true], ['1', true], [true, 1], [true, 'true'], [undefined, true]]) {
    const r = planAdaptiveBatch({ ...base, uncappedGate: u, executeArmed: e });
    assert.equal(r.allowed, 0);
    assert.equal(r.reason, 'OWNER_GATES_DISARMED');
  }
});

check('armed still respects health.stop and remainingCumulative', () => {
  const stopHealth = evaluateGrowthHealth({ uniqueProducts: 100, holdCount: 90 });
  assert.equal(planAdaptiveBatch({ candidates, health: stopHealth, remainingCumulative: 1000, uncappedGate: true, executeArmed: true }).allowed, 0);
  assert.equal(planAdaptiveBatch({ candidates, health: null, remainingCumulative: 1000, uncappedGate: true, executeArmed: true }).allowed, 0);
  assert.equal(planAdaptiveBatch({ candidates, health: healthy, remainingCumulative: 0, uncappedGate: true, executeArmed: true }).allowed, 0);
  assert.equal(planAdaptiveBatch({ candidates, health: healthy, remainingCumulative: 30, uncappedGate: true, executeArmed: true }).allowed, 30);
  assert.equal(planAdaptiveBatch({ candidates, health: healthy, remainingCumulative: 1000, uncappedGate: true, executeArmed: true }).allowed, 100);
});

check('env IU_CJ_PUBLIC_GROWTH_UNCAPPED does not affect planner', () => {
  const prev = process.env.IU_CJ_PUBLIC_GROWTH_UNCAPPED;
  process.env.IU_CJ_PUBLIC_GROWTH_UNCAPPED = '1';
  try {
    assert.equal(planAdaptiveBatch({ candidates, health: healthy, remainingCumulative: 1000 }).allowed, 0);
  } finally {
    if (prev === undefined) delete process.env.IU_CJ_PUBLIC_GROWTH_UNCAPPED;
    else process.env.IU_CJ_PUBLIC_GROWTH_UNCAPPED = prev;
  }
});

console.log('SELFTEST_PASS count=' + results.length);
