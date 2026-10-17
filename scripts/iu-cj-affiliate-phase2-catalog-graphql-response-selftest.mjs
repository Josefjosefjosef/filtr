#!/usr/bin/env node
/** Offline regression for cjGraphql shoppingProducts response parsing (no PAT / no HTTP). */
import { parseShoppingProductsGraphqlResponse } from "./iu-cj-affiliate-phase2-product-api.mjs";

const failures = [];
function expect(name, cond) {
  if (!cond) failures.push(name);
}

const productRow = { id: "SKU1", title: "T" };

expect(
  "success_with_product",
  parseShoppingProductsGraphqlResponse({
    ok: true,
    status: 200,
    gqlErrors: [],
    json: { data: { shoppingProducts: { totalCount: 1, resultList: [productRow] } } },
  }).kind === "success"
);

expect(
  "empty_catalog_ok",
  parseShoppingProductsGraphqlResponse({
    ok: true,
    status: 200,
    gqlErrors: [],
    json: { data: { shoppingProducts: { totalCount: 0, resultList: [] } } },
  }).kind === "empty_catalog"
);

expect(
  "http_401_not_ok",
  parseShoppingProductsGraphqlResponse({ ok: false, status: 401, gqlErrors: [], json: null }).ok === false &&
    parseShoppingProductsGraphqlResponse({ ok: false, status: 401, gqlErrors: [], json: null }).kind === "http_auth"
);

expect(
  "network_error_not_ok",
  parseShoppingProductsGraphqlResponse({ networkError: true, status: 0, gqlErrors: [] }).kind === "network_error"
);

expect(
  "graphql_error_not_ok",
  parseShoppingProductsGraphqlResponse({
    ok: false,
    status: 200,
    gqlErrors: [{ message: "Syntax Error" }],
    json: { data: null },
  }).kind === "graphql_error"
);

expect(
  "wrong_shape_not_ok",
  parseShoppingProductsGraphqlResponse({
    ok: true,
    status: 200,
    gqlErrors: [],
    json: { data: { otherField: {} } },
  }).kind === "graphql_shape_unexpected"
);

expect(
  "legacy_res_data_only_fails",
  parseShoppingProductsGraphqlResponse({
    ok: true,
    status: 200,
    gqlErrors: [],
    data: { shoppingProducts: { totalCount: 1, resultList: [productRow] } },
  }).ok === false
);

console.log(
  JSON.stringify({
    IU_CJ_CATALOG_GRAPHQL_RESPONSE_SELFTEST: failures.length === 0 ? "OK" : "FAIL",
    failures,
  })
);
process.exitCode = failures.length === 0 ? 0 : 1;
