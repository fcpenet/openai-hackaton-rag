import test from "node:test";
import assert from "node:assert/strict";
import { Catalog } from "../src/catalog.js";
import { createProductImage, createReviewText, createReviewTitle } from "../src/product-presentation.js";
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

test("varies review titles across a collection", () => {
  const titles = new Set(
    Array.from({ length: 10 }, (_, index) => createReviewTitle(() => index / 10, "Test Item", "sample description", 3 + (index % 3), index, index % 2 === 0 ? "normal" : "alien"))
  );
  assert.ok(titles.size >= 8);
});

test("gives every generated item distinct copy and artwork", () => {
  for (const collection of [
    createOnDemandCollection("iphone", 50),
    createIntergalacticCollection("phone", 50)
  ]) {
    assert.equal(new Set(collection.map((product) => product.description)).size, collection.length);
    assert.equal(new Set(collection.map((product) => product.imageUrl)).size, collection.length);
  }
});

test("prices have a wider spread across a collection", () => {
  for (const collection of [
    createOnDemandCollection("iphone", 12),
    createIntergalacticCollection("phone", 12)
  ]) {
    const prices = collection.map((product) => product.price.amount).sort((left, right) => left - right);
    assert.ok(prices[prices.length - 1] - prices[0] >= 20_000);
  }
});

test("headphones do not render as phone silhouettes", () => {
  const phoneSvg = decodeURIComponent(createProductImage("iPhone Pro", "compact smart phone", "phone-variant").replace("data:image/svg+xml,", ""));
  const headphoneSvg = decodeURIComponent(createProductImage("Wireless Headphones", "portable audio gear", "audio-variant").replace("data:image/svg+xml,", ""));
  assert.match(phoneSvg, /<rect x="116" y="30" width="168" height="260" rx="24"/);
  assert.doesNotMatch(headphoneSvg, /<rect x="116" y="30" width="168" height="260" rx="24"/);
  assert.match(headphoneSvg, /M100 205V155/);
});

test("purges legacy v2 catalog rows before using the cache", async () => {
  const statements = [];
  const client = {
    async execute(statement) {
      statements.push(statement);
      if (typeof statement === "string") return { rows: [] };
      if (statement.sql.startsWith("SELECT products_json")) return { rows: [] };
      return { rows: [] };
    }
  };

  const catalog = new Catalog({ client });
  await catalog.get("portable desk");

  assert.ok(statements.some((statement) => typeof statement === "object" && statement.sql === "DELETE FROM product_collections WHERE query LIKE ?"));
  assert.deepEqual(statements.find((statement) => typeof statement === "object" && statement.sql === "DELETE FROM product_collections WHERE query LIKE ?").args, ["products:v2:%"]);
});
