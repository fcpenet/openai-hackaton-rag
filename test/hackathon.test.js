import test from "node:test";
import assert from "node:assert/strict";
import { handleRequest } from "../src/product-api.js";

function createResponse() {
  return {
    statusCode: 0,
    headers: {},
    body: "",
    chunks: [],
    writeHead(status, headers) {
      this.statusCode = status;
      this.headers = headers;
    },
    write(chunk) {
      this.chunks.push(chunk);
    },
    end(body = "") {
      this.body = body;
    }
  };
}

test("search response includes persona and explanation", async () => {
  const response = createResponse();
  await handleRequest({ method: "GET", url: "/api/products/search?q=portable%20desk&limit=2&persona=luxury", headers: { host: "localhost:3000" } }, response);
  const body = JSON.parse(response.body);
  assert.equal(response.statusCode, 200);
  assert.equal(body.persona, "luxury");
  assert.equal(body.provenance.persona, "luxury");
  assert.ok(body.products[0].explanation.length > 0);
  assert.equal(body.products[0].persona, "luxury");
});

test("shelf streams grouped rows and compare returns verdicts", async () => {
  const shelfResponse = createResponse();
  await handleRequest({ method: "GET", url: "/api/products/shelf?q=portable%20desk&limit=8&persona=minimalist", headers: { host: "localhost:3000" } }, shelfResponse);
  const shelfBody = shelfResponse.chunks.join("");
  assert.equal(shelfResponse.statusCode, 200);
  assert.match(shelfBody, /event: shelf-row/);
  assert.match(shelfBody, /best-fit|cheap-but-decent|weirdly-good|backup-option/);

  const compareResponse = createResponse();
  await handleRequest({ method: "GET", url: "/api/products/compare?q=portable%20desk&count=3&persona=bargain", headers: { host: "localhost:3000" } }, compareResponse);
  const compareBody = JSON.parse(compareResponse.body);
  assert.equal(compareResponse.statusCode, 200);
  assert.equal(compareBody.persona, "bargain");
  assert.ok(Array.isArray(compareBody.products));
  assert.ok(compareBody.verdicts.bestValue);
  assert.ok(compareBody.verdicts.bestGift);
});
