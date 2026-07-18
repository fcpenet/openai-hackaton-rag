import http from "node:http";
import { fileURLToPath } from "node:url";
import { createIntergalacticCollection } from "./intergalactic-mart.js";
import { createOnDemandCollection } from "./on-demand-catalog.js";
import { createProductImage, createReviews } from "./product-presentation.js";
import { buildCompareVerdicts, buildShelfRows, normalizePersona, repairGeneratedProduct } from "./product-intelligence.js";

const port = Number(process.env.PORT || 3000);
let catalogPromise;

async function getCatalog() {
  if (!catalogPromise) {
    catalogPromise = import("./catalog.js")
      .then(({ Catalog }) => new Catalog())
      .catch(() => null);
  }
  return catalogPromise;
}

function json(response, status, body, headers = {}) {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8", ...headers });
  response.end(JSON.stringify(body));
}

function html(response, status, body, headers = {}) {
  response.writeHead(status, { "content-type": "text/html; charset=utf-8", ...headers });
  response.end(body);
}

function parseSearch(url) {
  const query = url.searchParams.get("q")?.trim();
  const requestedLimit = Number(url.searchParams.get("limit") || 12);
  const limit = Math.min(Math.max(Number.isFinite(requestedLimit) ? requestedLimit : 12, 1), 50);
  const secretMode = url.searchParams.get("not-suspicious") === "Hum^n";
  const persona = secretMode ? "intergalactic" : normalizePersona(url.searchParams.get("persona") || "normal");
  return { query, limit, secretMode, persona };
}

function getOpenApiDocument() {
  return {
    openapi: "3.0.3",
    info: {
      title: "Product Discovery Service",
      version: "0.1.0",
      description: "On-demand product search and streaming API backed by Turso."
    },
    servers: [{ url: "/" }],
    paths: {
      "/health": {
        get: {
          summary: "Health check",
          responses: {
            "200": {
              description: "Service is healthy",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: { ok: { type: "boolean", example: true } },
                    required: ["ok"]
                  }
                }
              }
            }
          }
        }
      },
      "/api/products/search": {
        get: {
          summary: "Search products",
          parameters: [
            {
              name: "q",
              in: "query",
              required: true,
              schema: { type: "string" },
              description: "Search phrase for the product collection"
            },
            {
              name: "limit",
              in: "query",
              required: false,
              schema: { type: "integer", minimum: 1, maximum: 50, default: 12 },
              description: "Maximum number of products to return"
            },
            {
              name: "not-suspicious",
              in: "query",
              required: false,
              schema: { type: "string", enum: ["Hum^n"] },
              description: "Optional hidden toggle that switches to the intergalactic mart catalog"
            },
            {
              name: "persona",
              in: "query",
              required: false,
              schema: { type: "string", enum: ["normal", "luxury", "bargain", "minimalist"] },
              description: "Optional catalog persona for the generated shelf"
            }
          ],
          responses: {
            "200": {
              description: "Normalized product collection",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      products: {
                        type: "array",
                        items: { $ref: "#/components/schemas/Product" }
                      },
                      source: { type: "string", enum: ["catalog", "on-demand-catalog", "intergalactic-mart"] },
                      generatedOnDemand: { type: "boolean" },
                      persona: { type: "string" },
                      provenance: { $ref: "#/components/schemas/Provenance" }
                    },
                    required: ["products", "source", "generatedOnDemand", "persona", "provenance"]
                  }
                }
              }
            },
            "400": { description: "Missing q parameter" },
            "502": { description: "Product generation failed" }
          }
        }
      },
      "/v1/products/search": {
        get: {
          summary: "Search products",
          deprecated: true,
          parameters: [
            {
              name: "q",
              in: "query",
              required: true,
              schema: { type: "string" }
            },
            {
              name: "limit",
              in: "query",
              required: false,
              schema: { type: "integer", minimum: 1, maximum: 50, default: 12 }
            },
            {
              name: "not-suspicious",
              in: "query",
              required: false,
              schema: { type: "string", enum: ["Hum^n"] }
            },
            {
              name: "persona",
              in: "query",
              required: false,
              schema: { type: "string", enum: ["normal", "luxury", "bargain", "minimalist"] }
            }
          ],
          responses: {
            "200": { description: "Normalized product collection" }
          }
        }
      },
      "/api/products/stream": {
        get: {
          summary: "Stream products with Server-Sent Events",
          parameters: [
            {
              name: "q",
              in: "query",
              required: true,
              schema: { type: "string" }
            },
            {
              name: "limit",
              in: "query",
              required: false,
              schema: { type: "integer", minimum: 1, maximum: 50, default: 12 }
            },
            {
              name: "not-suspicious",
              in: "query",
              required: false,
              schema: { type: "string", enum: ["Hum^n"] }
            },
            {
              name: "persona",
              in: "query",
              required: false,
              schema: { type: "string", enum: ["normal", "luxury", "bargain", "minimalist"] }
            }
          ],
          responses: {
            "200": {
              description: "SSE stream of status, product, and done events",
              content: {
                "text/event-stream": {
                  schema: { type: "string" }
                }
              }
            }
          }
        }
      },
      "/api/products/shelf": {
        get: {
          summary: "Stream a shelf grouped into shopping rows",
          parameters: [
            {
              name: "q",
              in: "query",
              required: true,
              schema: { type: "string" }
            },
            {
              name: "limit",
              in: "query",
              required: false,
              schema: { type: "integer", minimum: 4, maximum: 50, default: 12 }
            },
            {
              name: "not-suspicious",
              in: "query",
              required: false,
              schema: { type: "string", enum: ["Hum^n"] }
            },
            {
              name: "persona",
              in: "query",
              required: false,
              schema: { type: "string", enum: ["normal", "luxury", "bargain", "minimalist"] }
            }
          ],
          responses: {
            "200": {
              description: "SSE stream of shelf rows",
              content: {
                "text/event-stream": {
                  schema: { type: "string" }
                }
              }
            }
          }
        }
      },
      "/api/products/compare": {
        get: {
          summary: "Compare 2 to 4 products side by side",
          parameters: [
            {
              name: "q",
              in: "query",
              required: true,
              schema: { type: "string" }
            },
            {
              name: "count",
              in: "query",
              required: false,
              schema: { type: "integer", minimum: 2, maximum: 4, default: 4 }
            },
            {
              name: "ids",
              in: "query",
              required: false,
              schema: { type: "string" },
              description: "Comma-separated product IDs to compare"
            },
            {
              name: "not-suspicious",
              in: "query",
              required: false,
              schema: { type: "string", enum: ["Hum^n"] }
            },
            {
              name: "persona",
              in: "query",
              required: false,
              schema: { type: "string", enum: ["normal", "luxury", "bargain", "minimalist"] }
            }
          ],
          responses: {
            "200": {
              description: "Comparison verdicts and selected products",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      products: { type: "array", items: { $ref: "#/components/schemas/Product" } },
                      verdicts: { type: "object" },
                      persona: { type: "string" },
                      provenance: { $ref: "#/components/schemas/Provenance" }
                    },
                    required: ["products", "verdicts", "persona", "provenance"]
                  }
                }
              }
            }
          }
        }
      }
    },
    components: {
      schemas: {
        Product: {
          type: "object",
          properties: {
            id: { type: "string" },
            title: { type: "string" },
            description: { type: ["string", "null"] },
            category: { type: "string" },
            imageUrl: { type: "string" },
            persona: { type: "string" },
            explanation: { type: "string" },
            rating: { type: ["integer", "null"], minimum: 1, maximum: 5 },
            reviewCount: { type: "integer", minimum: 0, maximum: 250 },
            reviews: {
              type: "array",
              items: { $ref: "#/components/schemas/Review" }
            },
            price: { $ref: "#/components/schemas/Price" },
            source: { $ref: "#/components/schemas/Source" },
            provenance: { $ref: "#/components/schemas/Provenance" }
          },
          required: ["id", "title", "category", "imageUrl", "persona", "explanation", "rating", "reviewCount", "reviews", "price", "source", "provenance"]
        },
        Review: {
          type: "object",
          properties: {
            id: { type: "string" },
            author: { type: "string" },
            rating: { type: "integer", minimum: 1, maximum: 5 },
            title: { type: "string" },
            body: { type: "string" },
            createdAt: { type: "string", format: "date-time" }
          },
          required: ["id", "author", "rating", "title", "body", "createdAt"]
        },
        Price: {
          type: "object",
          properties: {
            amount: { type: "integer" },
            currency: { type: "string" },
            isSimulated: { type: "boolean" }
          },
          required: ["amount", "currency", "isSimulated"]
        },
        Source: {
          type: "object",
          properties: {
            provider: { type: "string" },
            itemId: { type: "string" },
            url: { type: "string" },
            retrievedAt: { type: "string", format: "date-time" },
            license: { type: "string" }
          },
          required: ["provider", "itemId", "url", "retrievedAt", "license"]
        },
        Provenance: {
          type: "object",
          properties: {
            query: { type: "string" },
            persona: { type: "string" },
            cached: { type: "boolean" }
          },
          required: ["query", "persona", "cached"]
        }
      }
    }
  };
}

function getDocsHtml() {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Product Discovery Service API Docs</title>
    <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/swagger-ui-dist@5/swagger-ui.css" />
    <style>
      body { margin: 0; background: #f7f8fb; }
      .topbar { display: none; }
    </style>
  </head>
  <body>
    <div id="swagger-ui"></div>
    <script src="https://cdn.jsdelivr.net/npm/swagger-ui-dist@5/swagger-ui-bundle.js"></script>
    <script src="https://cdn.jsdelivr.net/npm/swagger-ui-dist@5/swagger-ui-standalone-preset.js"></script>
    <script>
      window.ui = SwaggerUIBundle({
        url: "/openapi.json",
        dom_id: "#swagger-ui",
        deepLinking: true,
        presets: [SwaggerUIBundle.presets.apis, SwaggerUIStandalonePreset],
        layout: "BaseLayout"
      });
    </script>
  </body>
</html>`;
}

async function resolveCollection(query, limit, persona = "normal") {
  const catalog = await getCatalog();
  const collectionKey = `${persona}:${query}`;
  const cached = catalog ? await catalog.get(collectionKey) : undefined;
  const sourceCollection = cached || (
    persona === "intergalactic"
      ? createIntergalacticCollection(query, 50, { persona })
      : createOnDemandCollection(query, 50, { persona })
  );
  let changed = !cached;
  const collection = sourceCollection.map((product) => {
    const reviews = createReviews(product.id, product.title, product.description, { mode: persona === "intergalactic" ? "alien" : "normal" });
    const needsImage = !product.imageUrl;
    const needsReviews = !Array.isArray(product.reviews) || product.rating === undefined || product.reviewCount === undefined;
    const needsPersona = product.persona === undefined || product.explanation === undefined || product.provenance === undefined;
    if (!needsImage && !needsReviews && !needsPersona) return product;
    changed = true;
    return repairGeneratedProduct({
      ...product,
      imageUrl: product.imageUrl || createProductImage(product.title, product.description),
      rating: product.rating ?? reviews.rating,
      reviewCount: product.reviewCount ?? reviews.reviewCount,
      reviews: product.reviews ?? reviews.reviews
    }, { query, persona, cached: Boolean(cached) });
  });
  if (changed && catalog) await catalog.set(collectionKey, collection);
  return {
    products: collection.slice(0, limit),
    source: cached ? "catalog" : (persona === "intergalactic" ? "intergalactic-mart" : "on-demand-catalog"),
    cached,
    persona,
    provenance: { query, persona, cached: Boolean(cached) }
  };
}

async function handleSearch(url, response) {
  const { query, limit, persona } = parseSearch(url);
  if (!query) return json(response, 400, { error: "q is required" });
  try {
    const { products, source, cached, provenance } = await resolveCollection(query, limit, persona);
    return json(response, 200, { products, source, generatedOnDemand: !cached, persona, provenance }, { "cache-control": "no-store" });
  } catch (error) {
    return json(response, 502, { error: error.message || "Product search failed" });
  }
}

async function handleStream(url, response) {
  const { query, limit, persona } = parseSearch(url);
  if (!query) return json(response, 400, { error: "q is required" });

  response.writeHead(200, {
    "content-type": "text/event-stream; charset=utf-8",
    "cache-control": "no-cache, no-transform",
    connection: "keep-alive"
  });
  const send = (name, payload) => response.write(`event: ${name}\ndata: ${JSON.stringify(payload)}\n\n`);

  send("status", { phase: "searching", query, persona });
  try {
    const { products, source, cached, provenance } = await resolveCollection(query, limit, persona);
    send("status", { phase: cached ? "catalog-hit" : "sourced", query, persona });
    for (const product of products) send("product", product);
    send("done", { count: products.length, source, persona, provenance });
  } catch (error) {
    send("error", { message: error.message || "Product search failed" });
  } finally {
    response.end();
  }
}

async function handleShelf(url, response) {
  const { query, limit, persona } = parseSearch(url);
  if (!query) return json(response, 400, { error: "q is required" });

  response.writeHead(200, {
    "content-type": "text/event-stream; charset=utf-8",
    "cache-control": "no-cache, no-transform",
    connection: "keep-alive"
  });
  const send = (name, payload) => response.write(`event: ${name}\ndata: ${JSON.stringify(payload)}\n\n`);

  send("status", { phase: "building-shelf", query, persona });
  try {
    const { products, source, cached, provenance } = await resolveCollection(query, Math.max(limit, 12), persona);
    const rows = buildShelfRows(products);
    for (const row of rows) {
      send("shelf-row", { ...row, persona, provenance, source, cached });
    }
    send("done", { rows: rows.length, count: products.length, source, persona, provenance });
  } catch (error) {
    send("error", { message: error.message || "Shelf generation failed" });
  } finally {
    response.end();
  }
}

async function handleCompare(url, response) {
  const { query, limit, persona } = parseSearch(url);
  const requestedCount = Number(url.searchParams.get("count") || 4);
  const count = Math.min(Math.max(Number.isFinite(requestedCount) ? requestedCount : 4, 2), 4);
  const ids = url.searchParams.get("ids")?.split(",").map((id) => id.trim()).filter(Boolean) || [];
  if (!query) return json(response, 400, { error: "q is required" });

  try {
    const { products, source, cached, provenance } = await resolveCollection(query, Math.max(limit, count), persona);
    const selected = ids.length
      ? products.filter((product) => ids.includes(product.id)).slice(0, count)
      : products.slice(0, count);
    const comparison = buildCompareVerdicts(selected.length >= 2 ? selected : products.slice(0, count));
    return json(response, 200, {
      products: comparison.ranked,
      verdicts: comparison.verdicts,
      persona,
      provenance,
      source,
      generatedOnDemand: !cached
    }, { "cache-control": "no-store" });
  } catch (error) {
    return json(response, 502, { error: error.message || "Comparison failed" });
  }
}

export async function handleRequest(request, response) {
  try {
    const url = new URL(request.url, `http://${request.headers.host}`);
    if (request.method === "GET" && url.pathname === "/health") return json(response, 200, { ok: true });
    if (request.method === "GET" && url.pathname === "/openapi.json") return json(response, 200, getOpenApiDocument(), { "cache-control": "no-store" });
    if (request.method === "GET" && url.pathname === "/docs") return html(response, 200, getDocsHtml(), { "cache-control": "no-store" });
    if (request.method === "GET" && (url.pathname === "/api/products/search" || url.pathname === "/v1/products/search")) {
      return handleSearch(url, response);
    }
    if (request.method === "GET" && url.pathname === "/api/products/stream") {
      return handleStream(url, response);
    }
    if (request.method === "GET" && url.pathname === "/api/products/shelf") {
      return handleShelf(url, response);
    }
    if (request.method === "GET" && url.pathname === "/api/products/compare") {
      return handleCompare(url, response);
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
