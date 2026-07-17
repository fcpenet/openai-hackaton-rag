import http from "node:http";
import { fileURLToPath } from "node:url";
import { Catalog } from "./catalog.js";
import { createProductImage, createReviewSummary } from "./product-presentation.js";
import { WikidataProvider } from "./wikidata.js";

const port = Number(process.env.PORT || 3000);
const catalog = new Catalog();
const wikidata = new WikidataProvider();

function json(response, status, body, headers = {}) {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8", ...headers });
  response.end(JSON.stringify(body));
}

function parseSearch(url) {
  const query = url.searchParams.get("q")?.trim();
  const requestedLimit = Number(url.searchParams.get("limit") || 12);
  const limit = Math.min(Math.max(Number.isFinite(requestedLimit) ? requestedLimit : 12, 1), 50);
  return { query, limit };
}

async function resolveCollection(query, limit) {
  const cached = await catalog.get(query);
  const sourceCollection = cached || (await wikidata.search(query, 50));
  let changed = !cached;
  const collection = sourceCollection.map((product) => {
    const reviews = createReviewSummary(product.id);
    const needsImage = !product.imageUrl;
    const needsReviews = product.rating === undefined || product.reviewCount === undefined;
    if (!needsImage && !needsReviews) return product;
    changed = true;
    return {
      ...product,
      imageUrl: product.imageUrl || createProductImage(product.title, product.description),
      rating: product.rating ?? reviews.rating,
      reviewCount: product.reviewCount ?? reviews.reviewCount
    };
  });
  if (changed) await catalog.set(query, collection);
  return { products: collection.slice(0, limit), source: cached ? "catalog" : "wikidata", cached };
}

async function handleSearch(url, response) {
  const { query, limit } = parseSearch(url);
  if (!query) return json(response, 400, { error: "q is required" });
  try {
    const { products, source, cached } = await resolveCollection(query, limit);
    return json(response, 200, { products, source, generatedOnDemand: !cached }, { "cache-control": "no-store" });
  } catch (error) {
    return json(response, 502, { error: error.message || "Product search failed" });
  }
}

async function handleStream(url, response) {
  const { query, limit } = parseSearch(url);
  if (!query) return json(response, 400, { error: "q is required" });

  response.writeHead(200, {
    "content-type": "text/event-stream; charset=utf-8",
    "cache-control": "no-cache, no-transform",
    connection: "keep-alive"
  });
  const send = (name, payload) => response.write(`event: ${name}\ndata: ${JSON.stringify(payload)}\n\n`);

  send("status", { phase: "searching", query });
  try {
    const { products, source, cached } = await resolveCollection(query, limit);
    send("status", { phase: cached ? "catalog-hit" : "sourced", query });
    for (const product of products) send("product", product);
    send("done", { count: products.length, source });
  } catch (error) {
    send("error", { message: error.message || "Product search failed" });
  } finally {
    response.end();
  }
}

export async function handleRequest(request, response) {
  try {
    const url = new URL(request.url, `http://${request.headers.host}`);
    if (request.method === "GET" && url.pathname === "/health") return json(response, 200, { ok: true });
    if (request.method === "GET" && (url.pathname === "/api/products/search" || url.pathname === "/v1/products/search")) {
      return handleSearch(url, response);
    }
    if (request.method === "GET" && url.pathname === "/api/products/stream") {
      return handleStream(url, response);
    }
    return json(response, 404, { error: "Not found" });
  } catch (error) {
    return json(response, 500, { error: error.message || "Internal server error" });
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const server = http.createServer(handleRequest);
  server.listen(port, () => console.log(`Product Discovery Service listening on http://localhost:${port}`));
}
