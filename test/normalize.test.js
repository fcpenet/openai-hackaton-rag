import test from "node:test";
import assert from "node:assert/strict";
import { WikidataProvider } from "../src/wikidata.js";

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
  assert.equal(product.source.license, "CC0");
});
