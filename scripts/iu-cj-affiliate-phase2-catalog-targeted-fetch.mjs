#!/usr/bin/env node
/** Limited catalog supplementation — shared launcher (resume, HTTP budget, no adIds as coupon proof). */
import fs from "node:fs";
import path from "node:path";
import {
  defaultStateDir,
  finishNodeProcess,
  readJson,
  settleEventLoopBeforeExit,
  writeJson,
} from "./iu-cj-affiliate-phase1-lib.mjs";
import {
  CATALOG_FETCH_LIMITS,
  CJ_SHOPPING_PRODUCTS_DOC,
  buildSharedCatalogQueryKey,
  keywordProposalForCatalogGroup,
  selectCatalogFetchGroups,
} from "./iu-cj-affiliate-phase2-offer-audit-lib.mjs";
import {
  buildPublisherProductsQuery,
  cjGraphql as cjGraphqlLive,
  parseShoppingProductsGraphqlResponse,
} from "./iu-cj-affiliate-phase2-product-api.mjs";

function logProgress(msg) {
  const line = JSON.stringify({ ts: new Date().toISOString(), ...msg });
  console.log(line);
}

async function cjGraphqlMock() {
  return {
    ok: true,
    status: 200,
    networkError: false,
    gqlErrors: [],
    json: {
      data: {
        shoppingProducts: {
          totalCount: 1,
          resultList: [
            {
              id: "SYNTHETIC_SKU_DO_NOT_PUBLISH",
              title: "Synthetic catalog candidate",
              price: { amount: "1", currency: "CZK" },
            },
          ],
        },
      },
    },
  };
}

const cjGraphql = process.env.IU_CJ_CATALOG_FETCH_MOCK_HTTP === "1" ? cjGraphqlMock : cjGraphqlLive;

const stateDir = process.env.IU_CJ_STATE_DIR
  ? path.resolve(process.env.IU_CJ_STATE_DIR)
  : defaultStateDir();
const statePath = path.join(stateDir, CATALOG_FETCH_LIMITS.stateFile);
const outPath = path.join(stateDir, CATALOG_FETCH_LIMITS.outputFile);
const auditPath = path.join(stateDir, "cj-phase2-coupon-universe-audit.json");
const preflightPath = path.join(stateDir, "cj-phase2-catalog-targeted-preflight.json");

const execute = process.env.IU_CJ_CATALOG_FETCH_EXECUTE === "1";
const pat = process.env.IU_CJ_PAT || "";
const publisherCid = process.env.IU_CJ_PUBLISHER_CID || "7991692";
const websitePid = process.env.IU_CJ_WEBSITE_PID || "101883843";

function loadState() {
  return readJson(statePath, {
    version: 1,
    httpRequestsUsed: 0,
    completedGroupKeys: [],
    pendingGroupKeys: [],
    productsStored: 0,
    lastUpdated: null,
  });
}

function saveState(st) {
  st.lastUpdated = new Date().toISOString();
  writeJson(statePath, st);
}

function keywordProposal(group) {
  return group.catalogKeywords?.length ? group.catalogKeywords : keywordProposalForCatalogGroup(group);
}

async function main() {
  if (!fs.existsSync(auditPath)) {
    console.log(JSON.stringify({ IU_CJ_CATALOG_TARGETED_FETCH: "FAIL", reason: "missing_universe_audit" }));
    finishNodeProcess(1);
    return;
  }

  const preflight = fs.existsSync(preflightPath)
    ? readJson(preflightPath, null)
    : null;
  if (preflight && preflight.status === "BLOCKED") {
    console.log(
      JSON.stringify({
        IU_CJ_CATALOG_TARGETED_FETCH: "FAIL",
        reason: "preflight_blocked",
        rejected: preflight.rejected,
      })
    );
    finishNodeProcess(1);
    return;
  }

  const audit = readJson(auditPath, { offers: [], counts: {} });
  const offers = audit.offers || [];
  const runContract =
    preflight?.runContract ||
    audit.counts?.catalogRunPreflight?.runContract || {
      maxGroups: CATALOG_FETCH_LIMITS.maxGroups,
      maxHttpRequestsIncludingRetryAndPagination: CATALOG_FETCH_LIMITS.maxHttpRequests,
      maxProductsStoredPerGroup: CATALOG_FETCH_LIMITS.maxProductsStoredPerGroup,
    };
  const groups =
    preflight?.groups ||
    audit.counts?.catalogRunPreflight?.groups ||
    audit.counts?.catalogFetchPlan?.catalogSupplementTop ||
    (selectCatalogFetchGroups(offers, CATALOG_FETCH_LIMITS.maxGroups).catalogSupplementTop || []);
  logProgress({
    phase: "plan",
    groups: groups.length,
    deliverable: "catalog_candidates_only",
    runContract,
  });

  const state = loadState();
  const sharedQueries = new Map();
  const results = readJson(outPath, { groups: [], candidates: [] });
  let httpUsed = state.httpRequestsUsed || 0;
  let exitCode = 0;
  let status = "OK";

  const plan = groups.map((g) => {
    const gk = g.advertiserId + ":" + (g.scopeType || "unknown");
    const kw = keywordProposal(g);
    const qk =
      g.sharedCatalogQueryKey ||
      buildSharedCatalogQueryKey(g.advertiserId, kw, "CZ", { websitePid: websitePid });
    return {
      groupKey: gk,
      advertiserId: g.advertiserId,
      advertiserName: g.advertiserName,
      scopeType: g.scopeType,
      resolvableOfferCount: g.resolvableOfferCount || g.linkIds?.length || 0,
      linkIds: g.linkIds,
      linkDossiers: g.linkDossiers || null,
      keywords: kw,
      sharedCatalogQueryKey: qk,
      sharedQueryPolicy: g.sharedQueryPolicy || null,
      perActionEligibility: "evaluated_separately_per_linkId",
      graphqlDoc: CJ_SHOPPING_PRODUCTS_DOC,
      adIdsUsedAsCouponProof: false,
    };
  });

  for (const pg of plan) {
    if (state.completedGroupKeys.includes(pg.groupKey)) continue;
    if (httpUsed >= CATALOG_FETCH_LIMITS.maxHttpRequests) {
      status = "PARTIAL";
      exitCode = 2;
      break;
    }
    if (!execute || !pat) {
      pg.status = "planned_dry_run";
      logProgress({ phase: "group_skip_dry", groupKey: pg.groupKey });
      continue;
    }

    let queryBody;
    if (sharedQueries.has(pg.sharedCatalogQueryKey)) {
      pg.status = "reused_shared_partner_query";
      pg.sharedFrom = sharedQueries.get(pg.sharedCatalogQueryKey);
      pg.catalogCandidateNote = "same_http_as_partner_other_actions; eligibility_per_linkId_in_pipeline";
      continue;
    }

    const gql = buildPublisherProductsQuery(publisherCid, pg.advertiserId, websitePid, 5, {
      keywords: pg.keywords,
    });
    queryBody = gql;
    httpUsed += 1;
    logProgress({ phase: "http", groupKey: pg.groupKey, httpUsed, budget: CATALOG_FETCH_LIMITS.maxHttpRequests });
    let attempt = 0;
    let lastErr = null;
    while (attempt < 2 && httpUsed <= CATALOG_FETCH_LIMITS.maxHttpRequests) {
      attempt += 1;
      if (attempt > 1) {
        httpUsed += 1;
        logProgress({ phase: "http_retry", groupKey: pg.groupKey, httpUsed, attempt });
      }
      try {
        const res = await cjGraphql(gql, pat);
        const parsed = parseShoppingProductsGraphqlResponse(res);
        if (!parsed.ok) {
          lastErr = parsed.kind + (parsed.errorDetail ? ":" + parsed.errorDetail : "");
          pg.graphqlOutcome = parsed.kind;
          if (attempt >= 2) {
            pg.status = "fetch_failed";
            pg.error = lastErr;
            status = "PARTIAL";
            exitCode = 2;
          }
          continue;
        }
        const list = parsed.resultList || [];
        const slice = list.slice(0, CATALOG_FETCH_LIMITS.maxProductsStoredPerGroup);
        for (const row of slice) {
          results.candidates.push({
            groupKey: pg.groupKey,
            catalogRole: "catalog_search_candidate_not_publication_ready",
            advertiserId: pg.advertiserId,
            productId: row.id,
            title: row.title,
            price: row.price,
            eligibilityAssessment: "not_evaluated_yet",
            ineligible: false,
            note: "not_auto_ineligible; pipeline_must_evaluate_per_linkId_before_publish",
            appliesToLinkIds: pg.linkIds,
            catalogFetchOutcome: parsed.kind,
          });
        }
        state.productsStored = (state.productsStored || 0) + slice.length;
        sharedQueries.set(pg.sharedCatalogQueryKey, pg.groupKey);
        pg.status = parsed.kind === "empty_catalog" ? "fetched_empty_catalog" : "fetched";
        pg.httpRequests = attempt;
        pg.graphqlOutcome = parsed.kind;
        state.completedGroupKeys.push(pg.groupKey);
        break;
      } catch (err) {
        lastErr = String(err?.message || err);
        if (attempt >= 2) {
          pg.status = "fetch_failed";
          pg.error = lastErr;
          status = "PARTIAL";
          exitCode = 2;
        }
      }
    }
    if (httpUsed >= CATALOG_FETCH_LIMITS.maxHttpRequests && pg.status === "planned_dry_run") {
      status = "PARTIAL";
      exitCode = 2;
    }
  }

  if (!execute || !pat) {
    status = "PARTIAL";
    exitCode = 2;
  }

  state.httpRequestsUsed = httpUsed;
  state.pendingGroupKeys = plan.filter((p) => !state.completedGroupKeys.includes(p.groupKey)).map((p) => p.groupKey);
  saveState(state);
  results.generatedAt = new Date().toISOString();
  results.plan = plan;
  results.scopeVerificationQueue = preflight?.scopeVerificationQueue || audit.counts?.catalogFetchPlan?.scopeVerificationQueue || [];
  results.runContract = runContract;
  results.note =
    "Catalog run stores search candidates only; pairing and publicationReady require shared pipeline gates.";
  results.httpBudget = {
    used: httpUsed,
    max: CATALOG_FETCH_LIMITS.maxHttpRequests,
    includesRetriesAndPagination: true,
  };
  writeJson(outPath, results);

  console.log(
    JSON.stringify({
      IU_CJ_CATALOG_TARGETED_FETCH: status,
      executeRequested: execute,
      patPresent: Boolean(pat),
      groupsPlanned: plan.length,
      httpRequestsUsed: httpUsed,
      completedGroups: state.completedGroupKeys.length,
      candidatesStored: results.candidates.length,
      stateFile: statePath,
      outputFile: outPath,
      productionAutomationOffLocalPc: "NOT_DONE",
    })
  );

  await settleEventLoopBeforeExit();
  finishNodeProcess(exitCode);
}

main().catch((e) => {
  console.log(JSON.stringify({ IU_CJ_CATALOG_TARGETED_FETCH: "FAIL", error: String(e?.message || e) }));
  finishNodeProcess(1);
});
