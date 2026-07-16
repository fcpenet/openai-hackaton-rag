import http from "node:http";
import { Catalog } from "./catalog.js";
import { WikidataProvider } from "./wikidata.js";

const port = Number(process.env.PORT || 3000);
const catalog = new Catalog();
const wikidata = new WikidataProvider();

function json(response, status, body) {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(body));
}

async function readJson(request) {
  let body = "";
  for await (const chunk of request) body += chunk;
  return JSON.parse(body || "{}");
}

const server = http.createServer(async (request, response) => {
  try {
    const url = new URL(request.url, `http://${request.headers.host}`);
    if (request.method === "GET" && url.pathname === "/health") return json(response, 200, { ok: true });

    if (request.method === "GET" && url.pathname === "/v1/products/search") {
      const query = url.searchParams.get("q")?.trim();
      const limit = Math.min(Math.max(Number(url.searchParams.get("limit") || 12), 1), 50);
      if (!query) return json(response, 400, { error: "q is required" });
      const cached = await catalog.get(query);
      const collection = cached || await wikidata.search(query, 50);
      if (!cached) await catalog.set(query, collection);
      const products = collection.slice(0, limit);
      return json(response, 200, { products, source: cached ? "catalog" : "wikidata", generatedOnDemand: !cached });
    }
    return json(response, 404, { error: "Not found" });
  } catch (error) {
    return json(response, 500, { error: error.message || "Internal server error" });
  }
});

server.listen(port, () => console.log(`Product Discovery Service listening on http://localhost:${port}`));
