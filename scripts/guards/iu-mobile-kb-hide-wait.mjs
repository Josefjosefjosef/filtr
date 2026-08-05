/**
 * Deterministic waits for mobile bottom-nav keyboard-hide guard (test-only).
 * Product restore deadline remains RESTORE_DEADLINE_MS (measured in-page).
 */
export const RESTORE_DEADLINE_MS = 200;
export const HIDE_DEADLINE_MS = 200;
/** Detection budget for Playwright polling (IPC overhead; not a product deadline). */
export const DETECT_DEADLINE_MS = 500;
export const POLL_INTERVAL_MS = 8;

export async function flushAnimationFrames(page) {
  await page.evaluate(
    () =>
      new Promise((resolve) => {
        try {
          requestAnimationFrame(() => {
            requestAnimationFrame(() => resolve(true));
          });
        } catch (_) {
          resolve(false);
        }
      })
  );
}

/**
 * In-page open/close + rAF wait using performance.now() (product timing).
 * Hidden/visible criteria match the guard's isHidden/isVisible.
 */
export async function inPageWaitNav(page, { expectHidden, deadlineMs, action = "none" }) {
  return page.evaluate(
    async ({ expectHidden, deadlineMs, action }) => {
      const read = () => {
        const root = document.documentElement;
        const nav = document.getElementById("iuMobileBottomNav");
        const cs = nav ? getComputedStyle(nav) : null;
        const rect = nav ? nav.getBoundingClientRect() : null;
        const rootCs = getComputedStyle(root);
        const hasClass = root.classList.contains("iu-keyboard-open");
        const height = rect ? Math.round(rect.height) : -1;
        const display = cs ? cs.display : "missing";
        const pointerEvents = cs ? cs.pointerEvents : "missing";
        const bottomNavHeight = String(rootCs.getPropertyValue("--bottom-nav-height") || "").trim();
        const hidden =
          hasClass === true &&
          display === "none" &&
          pointerEvents === "none" &&
          height === 0 &&
          (/^0px$/.test(bottomNavHeight) || bottomNavHeight === "0");
        const visible = hasClass === false && display !== "none" && height > 40;
        return { hasClass, height, display, pointerEvents, bottomNavHeight, hidden, visible };
      };
      if (action === "open" && typeof window.__iuMockKeyboard === "function") {
        window.__iuMockKeyboard(true);
      } else if (action === "close" && typeof window.__iuMockKeyboard === "function") {
        window.__iuMockKeyboard(false);
      } else if (action === "iosZeroGap" && typeof window.__iuMockKeyboard === "function") {
        window.__iuMockKeyboard("iosZeroGap");
      }
      const t0 = performance.now();
      let last = read();
      const matched = () => (expectHidden ? last.hidden === true : last.visible === true);
      if (matched()) {
        return { ok: true, elapsedMs: 0, timedOut: false, state: last };
      }
      while (performance.now() - t0 <= deadlineMs) {
        await new Promise((r) => {
          try {
            requestAnimationFrame(() => r(true));
          } catch (_) {
            setTimeout(() => r(false), 8);
          }
        });
        last = read();
        if (matched()) {
          const elapsedMs = performance.now() - t0;
          return {
            ok: elapsedMs <= deadlineMs,
            elapsedMs,
            timedOut: elapsedMs > deadlineMs,
            state: last,
          };
        }
      }
      last = read();
      return {
        ok: false,
        elapsedMs: performance.now() - t0,
        timedOut: true,
        state: last,
      };
    },
    { expectHidden, deadlineMs, action }
  );
}

/**
 * Playwright-side detection wait. deadlineMs is a detection budget (may exceed
 * product restore deadline because of CDP/IPC); ok means predicate observed.
 */
export async function waitForNavPredicate(page, predicate, deadlineMs, readState) {
  const started = Date.now();
  let last = await readState();
  if (predicate(last)) {
    return { ok: true, state: last, elapsedMs: 0, timedOut: false };
  }
  await flushAnimationFrames(page);
  last = await readState();
  if (predicate(last)) {
    return {
      ok: true,
      state: last,
      elapsedMs: Date.now() - started,
      timedOut: false,
    };
  }
  while (Date.now() - started < deadlineMs) {
    await page.waitForTimeout(POLL_INTERVAL_MS);
    last = await readState();
    if (predicate(last)) {
      return {
        ok: true,
        state: last,
        elapsedMs: Date.now() - started,
        timedOut: false,
      };
    }
  }
  return {
    ok: false,
    state: last,
    elapsedMs: Date.now() - started,
    timedOut: true,
  };
}

export async function assertKeyboardHideIdle(page, readState, isVisibleFn) {
  await flushAnimationFrames(page);
  const state = await readState();
  const visible = isVisibleFn(state);
  const pendingGrace = await page.evaluate(() => {
    return document.documentElement.classList.contains("iu-keyboard-open") ? 1 : 0;
  });
  return {
    ok: visible === true && pendingGrace === 0,
    state,
    pendingKeyboardOpenClass: pendingGrace,
  };
}
