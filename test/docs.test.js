import test from "node:test";
import assert from "node:assert/strict";
import { handleRequest } from "../src/product-api.js";

function createResponse() {
  return {
    statusCode: 0,
    headers: {},
    body: "",
    writeHead(status, headers) {
      this.statusCode = status;
      this.headers = headers;
    },
    end(body = "") {
      this.body = body;
    }
  };
}

test("serves OpenAPI document and docs page", async () => {
  const openApiResponse = createResponse();
  await handleRequest({ method: "GET", url: "/openapi.json", headers: { host: "localhost:3000" } }, openApiResponse);
  assert.equal(openApiResponse.statusCode, 200);
  const openApi = JSON.parse(openApiResponse.body);
  assert.equal(openApi.openapi, "3.0.3");
  assert.ok(openApi.paths["/api/products/search"]);
  assert.ok(openApi.paths["/api/products/selling-fast"]);
  assert.ok(openApi.paths["/api/products/featured"]);
  assert.ok(openApi.paths["/api/cart"]);
  assert.ok(openApi.paths["/api/cart/items"]);
  assert.ok(openApi.paths["/api/wallet"]);
  assert.ok(openApi.paths["/api/checkout"]);
  assert.ok(openApi.paths["/api/orders"]);
  assert.ok(openApi.paths["/api/users/register"]);
  assert.ok(openApi.paths["/api/users/login"]);
  assert.ok(openApi.paths["/api/users/me"]);
  assert.ok(openApi.paths["/api/users/logout"]);
  assert.ok(openApi.components.schemas.Product);
  assert.ok(openApi.components.schemas.User);
  assert.ok(openApi.components.securitySchemes.bearerAuth);

  const docsResponse = createResponse();
  await handleRequest({ method: "GET", url: "/docs", headers: { host: "localhost:3000" } }, docsResponse);
  assert.equal(docsResponse.statusCode, 200);
  assert.match(docsResponse.body, /SwaggerUIBundle/);
  assert.match(docsResponse.body, /\/openapi\.json/);

  const economyResponse = createResponse();
  await handleRequest({ method: "GET", url: "/economy", headers: { host: "localhost:3000" } }, economyResponse);
  assert.equal(economyResponse.statusCode, 200);
  assert.match(economyResponse.body, /Real World Economy/);
  assert.match(economyResponse.body, /Live market simulator/);

  const mechanicsResponse = createResponse();
  await handleRequest({ method: "GET", url: "/mechanics", headers: { host: "localhost:3000" } }, mechanicsResponse);
  assert.equal(mechanicsResponse.statusCode, 200);
  assert.match(mechanicsResponse.body, /How the catalog works/);
  assert.match(mechanicsResponse.body, /Pricing/);
  assert.match(mechanicsResponse.body, /Image generation/);
  assert.match(mechanicsResponse.body, /Product generation/);
});
