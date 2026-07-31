/**
 * Shared console event classification for offline / multibrowser proofs.
 * Keep ResizeObserver allowance narrowly exact; never swallow InvalidStateError.
 */
export function classify(ev) {
  const text = String(ev.text || "");
  if (ev.phase === "offline") {
    if (
      ev.kind === "requestfailed" ||
      /failed to load resource|err_internet_disconnected|err_failed|failed to fetch|net::err_|networkerror|load failed/i.test(
        text
      )
    ) {
      return "expectedOfflineNetworkFailure";
    }
  }
  if (ev.kind === "warning" || ev.type === "warning") return "warning";
  if (/net::err_aborted/i.test(text) && ev.kind === "requestfailed") return "noise";
  if (/favicon\.ico|chrome-extension:/i.test(text)) return "noise";
  if (/^ResizeObserver loop (limit exceeded|completed with undelivered notifications)\.?$/i.test(text.trim())) {
    return "browserOnlyResizeObserverLoop";
  }
  if (ev.kind === "pageerror") return "unexpectedConsoleError";
  if (ev.kind === "console.error" || ev.type === "error") return "unexpectedConsoleError";
  if (ev.kind === "requestfailed") return "noise";
  return "unexpectedConsoleError";
}
