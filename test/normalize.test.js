import test from "node:test";
import assert from "node:assert/strict";
import { WikidataProvider } from "../src/wikidata.js";
import { createReviewText } from "../src/product-presentation.js";
import { createIntergalacticCollection } from "../src/intergalactic-mart.js";

test("normalizes Wikidata search results into simulated catalog items", async () => {
  const provider = new WikidataProvider({
    fetchImpl: async () => new Response(JSON.stringify({
      search: [{ id: "Q48493", label: "iPhone", description: "smartphone line", concepturi: "https://www.wikidata.org/entity/Q48493" }]
    }))
  });
  const [product] = await provider.search("iphone", 1);
  assert.equal(product.id, "wikidata:Q48493");
  assert.equal(product.price.currency, "PHP");
  assert.equal(product.price.isSimulated, true);
  assert.match(product.imageUrl, /^data:image\/svg\+xml,/);
  assert.ok(Array.isArray(product.reviews));
  assert.ok(product.reviewCount >= 0 && product.reviewCount <= 250);
  assert.equal(product.reviewCount, product.reviews.length);
  assert.ok(product.rating === null || (product.rating >= 1 && product.rating <= 5));
  for (const review of product.reviews) {
    assert.equal(typeof review.id, "string");
    assert.equal(typeof review.author, "string");
    assert.ok(review.rating >= 1 && review.rating <= 5);
    assert.equal(typeof review.title, "string");
    assert.equal(typeof review.body, "string");
    assert.match(review.createdAt, /^\d{4}-\d{2}-\d{2}T/);
  }
  assert.equal(product.source.license, "CC0");
});

test("keeps one-star reviews negative and secret mode alien", () => {
  const negativeBody = createReviewText(() => 0, "Test Item", "a sample description", 1, 0, "normal");
  assert.match(negativeBody, /(disappoint|rough|missed the mark|would not repeat|listing)/i);
  assert.match(negativeBody, /(listing|photos|purchase)/i);

  const [secretProduct] = createIntergalacticCollection("phone", 1);
  assert.equal(secretProduct.source.provider, "intergalactic-mart");
  assert.equal(secretProduct.price.currency, "GCR");
  assert.ok(secretProduct.reviews.length > 0);
  assert.match(secretProduct.reviews[0].body, /(earth|human|mothership|translator|disguise)/i);
});
