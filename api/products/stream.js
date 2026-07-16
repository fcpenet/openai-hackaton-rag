import { Catalog } from "../../src/catalog.js";
import { WikidataProvider } from "../../src/wikidata.js";

const catalog = new Catalog();
const wikidata = new WikidataProvider();
const encoder = new TextEncoder();

function event(name, payload) {
  return encoder.encode(`event: ${name}\ndata: ${JSON.stringify(payload)}\n\n`);
}

export default {
  async fetch(request) {
    const url = new URL(request.url);
    const query = url.searchParams.get("q")?.trim();
    const requestedLimit = Number(url.searchParams.get("limit") || 12);
    const limit = Math.min(Math.max(Number.isFinite(requestedLimit) ? requestedLimit : 12, 1), 50);
    if (!query) return Response.json({ error: "q is required" }, { status: 400 });

    const stream = new ReadableStream({
      async start(controller) {
        controller.enqueue(event("status", { phase: "searching", query }));
        try {
          const cached = await catalog.get(query);
          const collection = cached || await wikidata.search(query, 50);
          if (!cached) await catalog.set(query, collection);
          const products = collection.slice(0, limit);
          controller.enqueue(event("status", { phase: cached ? "catalog-hit" : "sourced", query }));
          for (const product of products) controller.enqueue(event("product", product));
          controller.enqueue(event("done", { count: products.length, source: cached ? "catalog" : "wikidata" }));
        } catch (error) {
          controller.enqueue(event("error", { message: error.message || "Product search failed" }));
        } finally {
          controller.close();
        }
      }
    });

    return new Response(stream, {
      headers: {
        "content-type": "text/event-stream; charset=utf-8",
        "cache-control": "no-cache, no-transform",
        connection: "keep-alive"
      }
    });
  }
};
