/**
 * Hard ceiling for intentional production HTTP requests in guard/smoke scripts.
 */

export function createProdRequestBudget(maxRequests, label) {
  const cap = Math.max(1, Number(maxRequests) || 1);
  let count = 0;
  const labelText = label || "prod";

  function record(url) {
    count += 1;
    if (count > cap) {
      const err = new Error(
        "PRODUCTION_REQUEST_BUDGET_EXCEEDED label=" +
          labelText +
          " budget=" +
          cap +
          " actual=" +
          count +
          " url=" +
          String(url || "")
      );
      err.code = "PRODUCTION_REQUEST_BUDGET_EXCEEDED";
      throw err;
    }
  }

  return {
    get count() {
      return count;
    },
    get budget() {
      return cap;
    },
    record,
    wrapFetch(fetchImpl) {
      return async function budgetedFetch(url, init) {
        record(url);
        return fetchImpl(url, init);
      };
    },
    summary() {
      return { label: labelText, budget: cap, actual: count };
    },
  };
}

export function isCloudflareQuotaResponse(status, bodyText) {
  const st = Number(status);
  if (st === 429) return true;
  const t = String(bodyText || "");
  return /Error\s+1027/i.test(t) || /reached their plan limits/i.test(t);
}

export function quotaBlockerFailMessage(detail) {
  return "CLOUDFLARE_QUOTA_BLOCKER=true detail=" + String(detail || "429_or_1027");
}
