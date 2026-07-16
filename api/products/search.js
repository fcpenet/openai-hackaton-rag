import { Catalog } from "../../src/catalog.js";
import { WikidataProvider } from "../../src/wikidata.js";

const catalog = new Catalog();
const wikidata = new WikidataProvider();

export const config = { runtime: "edge" };

export default async function handler(request) {
  const url = new URL(request.url);
  const query = url.searchParams.get("q")?.trim();
  const requestedLimit = Number(url.searchParams.get("limit") || 12);
  const limit = Math.min(Math.max(Number.isFinite(requestedLimit) ? requestedLimit : 12, 1), 50);
  if (!query) return Response.json({ error: "q is required" }, { status: 400 });

  try {
    const cached = await catalog.get(query);
    const collection = cached || await wikidata.search(query, 50);
    if (!cached) await catalog.set(query, collection);
    const products = collection.slice(0, limit);
    return Response.json(
      { products, source: cached ? "catalog" : "wikidata", generatedOnDemand: !cached },
      { headers: { "cache-control": "no-store" } }
    );
  } catch (error) {
    return Response.json({ error: error.message || "Product search failed" }, { status: 502 });
  }
}
