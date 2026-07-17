const API_URL = "https://www.wikidata.org/w/api.php";
import { createProductImage, createReviewSummary } from "./product-presentation.js";

function simulatedPrice(id) {
  let value = 0;
  for (const char of id) value = (value * 31 + char.charCodeAt(0)) >>> 0;
  return 499 + (value % 50_000);
}

export class WikidataProvider {
  constructor({ fetchImpl = fetch } = {}) {
    this.fetch = fetchImpl;
  }

  async search(query, limit) {
    const url = new URL(API_URL);
    url.search = new URLSearchParams({
      action: "wbsearchentities",
      search: query,
      language: "en",
      uselang: "en",
      type: "item",
      limit: String(limit),
      format: "json",
      origin: "*"
    }).toString();
    const response = await this.fetch(url, { headers: { "user-agent": "ProductDiscoveryService/0.1 (contact: admin@example.invalid)" } });
    if (!response.ok) throw new Error(`Wikidata search failed (${response.status})`);
    const { search = [] } = await response.json();
    const retrievedAt = new Date().toISOString();
    return search.map((item) => {
      const id = `wikidata:${item.id}`;
      const description = item.description || null;
      return {
        id,
        title: item.label,
        description,
        category: "General merchandise",
        imageUrl: createProductImage(item.label, description),
        ...createReviewSummary(id),
        price: { amount: simulatedPrice(item.id), currency: "PHP", isSimulated: true },
        source: {
          provider: "wikidata",
          itemId: item.id,
          url: item.concepturi,
          retrievedAt,
          license: "CC0"
        }
      };
    }).filter((item) => item.title);
  }
}
