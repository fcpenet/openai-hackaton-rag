import test from "node:test";
import assert from "node:assert/strict";
import { createReviewText } from "../src/product-presentation.js";
import { createIntergalacticCollection } from "../src/intergalactic-mart.js";
import { createOnDemandCollection } from "../src/on-demand-catalog.js";

test("generates on-demand catalog items from the search query", () => {
  const [product] = createOnDemandCollection("iphone", 1);
  assert.match(product.id, /^generated:/);
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
  assert.equal(product.source.provider, "on-demand-catalog");
  assert.equal(product.source.license, "synthetic");
});

test("keeps one-star reviews negative and secret mode alien", () => {
  const negativeBody = createReviewText(() => 0, "Test Item", "a sample description", 1, 0, "normal");
  assert.match(negativeBody, /(disappoint|rough|missed the mark|would not repeat|listing)/i);
  assert.match(negativeBody, /(listing|photos|purchase)/i);

  const firstAlienBody = createReviewText(() => 0, "Test Item", "a sample description", 4, 0, "alien");
  assert.match(firstAlienBody, /(first close look|first time|earth disguise|disturbingly practical)/i);

  const [secretProduct] = createIntergalacticCollection("phone", 1);
  assert.equal(secretProduct.source.provider, "intergalactic-mart");
  assert.equal(secretProduct.price.currency, "GCR");
  assert.ok(secretProduct.reviews.length > 0);
  assert.match(secretProduct.reviews[0].body, /(earth|human|mothership|translator|disguise)/i);
});
