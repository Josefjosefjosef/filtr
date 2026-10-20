/**
 * CZ vertical deep-link prod hard proof helpers.
 * Prod may run with commercialAggregationActive=false (empty articles.json) — routing vs feed content gates differ.
 */

export const IU_TERMS_ACCEPTED_VERSION_V1 = "2026-09-08-v1";

export const CZ_VERTICAL_SECTIONS = ["hry", "kultura", "veda", "vzdelavani"];

export async function applyCzVerticalDeepLinkReadiness(page) {
  await page.evaluate((termsVer) => {
    try {
      localStorage.setItem("iu:terms:accepted:v1", "1");
      localStorage.setItem("iu:terms:accepted-version:v1", termsVer);
      localStorage.setItem("iu:terms:accepted-at:v1", new Date().toISOString());
      localStorage.setItem("iu:consent:layer:dismissed:v1", "1");
      localStorage.setItem("iu:consent:analytics:v1", "denied");
    } catch (_) {}
    try {
      document.documentElement.classList.remove("iu-terms-gate-open");
      document.body.classList.remove("iu-terms-gate-open");
    } catch (_) {}
    const terms = document.getElementById("iuTermsGate");
    if (terms) {
      try {
        terms.hidden = true;
        terms.setAttribute("aria-hidden", "true");
      } catch (_) {}
    }
    const layer = document.getElementById("iuConsentLayer");
    if (layer) {
      try {
        layer.hidden = true;
      } catch (_) {}
    }
  }, IU_TERMS_ACCEPTED_VERSION_V1);
}

export async function probePublishedMediaArticlesAvailable(page, baseUrl) {
  try {
    const origin = new URL(baseUrl).origin;
    return await page.evaluate(async (originUrl) => {
      try {
        const cutRes = await fetch(originUrl + "/projects/data/info_events/cutover_state.json", {
          cache: "no-store",
        });
        if (cutRes.ok) {
          const cut = await cutRes.json();
          if (cut && cut.commercialAggregationActive === false) {
            return { articlesRequired: false, reason: "commercialAggregationActive_false" };
          }
        }
      } catch (_) {}
      try {
        const artRes = await fetch(originUrl + "/projects/data/articles.json", { cache: "no-store" });
        if (!artRes.ok) return { articlesRequired: false, reason: "articles_fetch_failed" };
        const arts = await artRes.json();
        const list = Array.isArray(arts) ? arts : arts.articles || [];
        if (!list.length) return { articlesRequired: false, reason: "articles_empty" };
        return { articlesRequired: true, reason: "articles_present", count: list.length };
      } catch (_) {
        return { articlesRequired: false, reason: "articles_probe_error" };
      }
    }, origin);
  } catch (_) {
    return { articlesRequired: false, reason: "probe_exception" };
  }
}

export function evaluateCzVerticalRoutingGate(input) {
  const sec = String(input.expectedSection || "").toLowerCase();
  if (!CZ_VERTICAL_SECTIONS.includes(sec)) {
    return { ok: false, mode: "invalid_section", reason: "invalid_section" };
  }
  if (input.dataSection !== sec) {
    return { ok: false, mode: "routing", reason: "wrong_data_section" };
  }
  if (input.dataIuFc !== "1") {
    return { ok: false, mode: "routing", reason: "data_iu_fc_not_1" };
  }
  if (input.coldSectionAttr === "1") {
    return {
      ok: false,
      mode: "routing",
      reason: "stale_data_iu_cold_section_hides_feed",
    };
  }
  if (input.centerView !== "media") {
    return { ok: false, mode: "routing", reason: "center_view_not_media" };
  }
  if (input.articlesRequired === true && input.hasActiveNav !== true) {
    return { ok: false, mode: "routing", reason: "left_nav_not_active" };
  }
  return { ok: true, mode: "routing", reason: null };
}

export function evaluateCzVerticalFeedContentGate(input) {
  const routing = evaluateCzVerticalRoutingGate(input);
  if (routing.ok !== true) return routing;

  if (input.articlesRequired !== true) {
    if (input.feedExists !== true) {
      return { ok: false, mode: "feed_skipped", reason: "feed_element_missing" };
    }
    if (input.feedReady !== "true") {
      return { ok: false, mode: "feed_skipped", reason: "feed_not_ready" };
    }
    return { ok: true, mode: "feed_skipped_no_published_articles", reason: null };
  }

  if (input.feedVisible !== true) {
    return { ok: false, mode: "feed_content", reason: "feed_not_visible" };
  }
  if (!(Number(input.titleLinkCount) > 0)) {
    return { ok: false, mode: "feed_content", reason: "no_title_links" };
  }
  if (!(Number(input.titleLinksBlank) > 0)) {
    return { ok: false, mode: "feed_content", reason: "title_links_not_blank_target" };
  }
  if (!/^https?:\/\//i.test(String(input.sampleHref || ""))) {
    return { ok: false, mode: "feed_content", reason: "sample_href_invalid" };
  }
  return { ok: true, mode: "feed_content", reason: null };
}
