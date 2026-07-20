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

test("search corrects typos in normal mode but not in intergalactic mode", async () => {
  const normalResponse = createResponse();
  await handleRequest({ method: "GET", url: "/api/products/search?q=Milkt%20Tea%20Cups&limit=1", headers: { host: "localhost:3000" } }, normalResponse);
  const normalBody = JSON.parse(normalResponse.body);
  assert.equal(normalResponse.statusCode, 200);
  assert.match(normalBody.products[0].title.toLowerCase(), /milk tea cups/);
  assert.equal(normalBody.provenance.originalQuery, "Milkt Tea Cups");

  const alienResponse = createResponse();
  await handleRequest({ method: "GET", url: "/api/products/search?q=Milkt%20Tea%20Cups&limit=1&not-suspicious=Hum^n", headers: { host: "localhost:3000" } }, alienResponse);
  const alienBody = JSON.parse(alienResponse.body);
  assert.equal(alienResponse.statusCode, 200);
  assert.equal(alienBody.provenance.query, "Milkt Tea Cups");
  assert.equal(alienBody.provenance.originalQuery, undefined);
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

test("selling-fast and featured endpoints return fixed-size, unique-image collections", async () => {
  const sellingFastResponse = createResponse();
  await handleRequest({ method: "GET", url: "/api/products/selling-fast", headers: { host: "localhost:3000" } }, sellingFastResponse);
  const sellingFast = JSON.parse(sellingFastResponse.body);
  assert.equal(sellingFastResponse.statusCode, 200);
  assert.equal(sellingFast.products.length, 6);
  assert.equal(new Set(sellingFast.products.map((product) => product.imageUrl)).size, 6);
  assert.ok(sellingFast.products.every((product) => product.market.salesVelocity > 0));
  assert.deepEqual(
    sellingFast.products.map((product) => product.market.salesVelocity),
    [...sellingFast.products.map((product) => product.market.salesVelocity)].sort((left, right) => right - left)
  );

  const featuredResponse = createResponse();
  await handleRequest({ method: "GET", url: "/api/products/featured", headers: { host: "localhost:3000" } }, featuredResponse);
  const featured = JSON.parse(featuredResponse.body);
  assert.equal(featuredResponse.statusCode, 200);
  assert.equal(featured.products.length, 1);
  assert.ok(featured.products[0].market.featuredScore > 0);
});
