import http from "node:http";
import { fileURLToPath } from "node:url";
import { CommerceStore } from "./commerce.js";
import { createIntergalacticCollection } from "./intergalactic-mart.js";
import { compareFeatured, compareSalesVelocity, enrichWithMarket } from "./market-economy.js";
import { MarketStore } from "./market-store.js";
import { createOnDemandCollection } from "./on-demand-catalog.js";
import { createProductImage, createReviews } from "./product-presentation.js";
import { buildCompareVerdicts, buildShelfRows, normalizePersona, repairGeneratedProduct } from "./product-intelligence.js";
import { normalizeEmail, validateRegistration } from "./users.js";

const port = Number(process.env.PORT || 3000);
let catalogPromise;
let userStorePromise;
let commerceStorePromise;
let marketStorePromise;

async function getCatalog() {
  if (!catalogPromise) {
    catalogPromise = import("./catalog.js")
      .then(({ Catalog }) => new Catalog())
      .catch(() => null);
  }
  return catalogPromise;
}

async function getUserStore() {
  if (!userStorePromise) {
    userStorePromise = import("./users.js")
      .then(({ UserStore }) => new UserStore())
      .catch(() => null);
  }
  return userStorePromise;
}

// Keeps the HTTP layer independently testable without requiring a live Turso database.
export function setUserStoreForTesting(store) {
  userStorePromise = store ? Promise.resolve(store) : undefined;
}

async function getCommerceStore() {
  if (!commerceStorePromise) {
    commerceStorePromise = Promise.resolve().then(() => new CommerceStore()).catch(() => null);
  }
  return commerceStorePromise;
}

export function setCommerceStoreForTesting(store) {
  commerceStorePromise = store ? Promise.resolve(store) : undefined;
}

async function getMarketStore() {
  if (!marketStorePromise) marketStorePromise = Promise.resolve().then(() => new MarketStore()).catch(() => null);
  return marketStorePromise;
}

export function setMarketStoreForTesting(store) {
  marketStorePromise = store ? Promise.resolve(store) : undefined;
}

function json(response, status, body, headers = {}) {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8", ...headers });
  response.end(JSON.stringify(body));
}

function html(response, status, body, headers = {}) {
  response.writeHead(status, { "content-type": "text/html; charset=utf-8", ...headers });
  response.end(body);
}

async function readJson(request) {
  if (request.body && typeof request.body === "object" && !request[Symbol.asyncIterator]) return request.body;
  if (!request || typeof request[Symbol.asyncIterator] !== "function") return request.body && typeof request.body === "object" ? request.body : {};
  const chunks = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    if (Buffer.concat(chunks).length > 64 * 1024) throw new Error("Request body is too large");
  }
  if (!chunks.length) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    const error = new Error("Request body must be valid JSON");
    error.status = 400;
    throw error;
  }
}

function bearerToken(request) {
  const value = request.headers.authorization || request.headers.Authorization || "";
  return /^Bearer\s+(.+)$/i.exec(value)?.[1]?.trim();
}

async function requireAuthedUser(request, response) {
  const token = bearerToken(request);
  if (!token) {
    json(response, 401, { error: "Authentication required" });
    return null;
  }
  const store = await getUserStore();
  if (!store) {
    json(response, 503, { error: "User storage is unavailable. Configure Turso to enable accounts." });
    return null;
  }
  try {
    const user = await store.getUserForToken(token);
    if (!user) {
      json(response, 401, { error: "Authentication required" });
      return null;
    }
    return { store, user };
  } catch (error) {
    json(response, 502, { error: error.message || "Could not load user" });
    return null;
  }
}

async function handleRegistration(request, response) {
  const input = await readJson(request);
  const validationError = validateRegistration(input);
  if (validationError) return json(response, 400, { error: validationError });
  const store = await getUserStore();
  if (!store) return json(response, 503, { error: "User storage is unavailable. Configure Turso to enable accounts." });
  try {
    const user = await store.register(input);
    const login = await store.login({ email: input.email, password: input.password });
    return json(response, 201, { user, token: login.token });
  } catch (error) {
    return json(response, error.code === "EMAIL_TAKEN" ? 409 : 502, { error: error.message || "Could not create user" });
  }
}

async function handleLogin(request, response) {
  const input = await readJson(request);
  if (!normalizeEmail(input.email) || typeof input.password !== "string") return json(response, 400, { error: "Email and password are required" });
  const store = await getUserStore();
  if (!store) return json(response, 503, { error: "User storage is unavailable. Configure Turso to enable accounts." });
  try {
    const login = await store.login(input);
    if (!login) return json(response, 401, { error: "Invalid email or password" });
    return json(response, 200, login);
  } catch (error) {
    return json(response, 502, { error: error.message || "Could not sign in" });
  }
}

async function handleCurrentUser(request, response) {
  const token = bearerToken(request);
  if (!token) return json(response, 401, { error: "Authentication required" });
  const store = await getUserStore();
  if (!store) return json(response, 503, { error: "User storage is unavailable. Configure Turso to enable accounts." });
  try {
    const user = await store.getUserForToken(token);
    if (!user) return json(response, 401, { error: "Authentication required" });
    return json(response, 200, { user, profile: await store.getProfile(user.id) });
  } catch (error) {
    return json(response, 502, { error: error.message || "Could not load user" });
  }
}

async function handleProfileUpdate(request, response) {
  const token = bearerToken(request);
  if (!token) return json(response, 401, { error: "Authentication required" });
  const store = await getUserStore();
  if (!store) return json(response, 503, { error: "User storage is unavailable. Configure Turso to enable accounts." });
  try {
    const user = await store.getUserForToken(token);
    if (!user) return json(response, 401, { error: "Authentication required" });
    return json(response, 200, { user, profile: await store.updateProfile(user.id, await readJson(request)) });
  } catch (error) {
    return json(response, error.status || 502, { error: error.message || "Could not update profile" });
  }
}

async function handleLogout(request, response) {
  const token = bearerToken(request);
  if (!token) return json(response, 204, undefined);
  const store = await getUserStore();
  if (!store) return json(response, 503, { error: "User storage is unavailable. Configure Turso to enable accounts." });
  try {
    await store.logout(token);
    return json(response, 204, undefined);
  } catch (error) {
    return json(response, 502, { error: error.message || "Could not sign out" });
  }
}

function parseSearch(url) {
  const query = url.searchParams.get("q")?.trim();
  const requestedLimit = Number(url.searchParams.get("limit") || 12);
  const limit = Math.min(Math.max(Number.isFinite(requestedLimit) ? requestedLimit : 12, 1), 50);
  const secretMode = url.searchParams.get("not-suspicious") === "Hum^n";
  const requestedPersona = url.searchParams.get("persona");
  const persona = secretMode ? "intergalactic" : normalizePersona(requestedPersona || "normal");
  return { query, limit, secretMode, persona, hasExplicitPersona: Boolean(requestedPersona) };
}

function defaultCuratedQuery(label, query) {
  return query || label;
}

function getOpenApiDocument() {
  return {
    openapi: "3.0.3",
    info: {
      title: "Product Discovery Service",
      version: "0.1.0",
      description: "On-demand product search and streaming API backed by Turso. Includes a deterministic UTC-day market simulator that tracks inventory, sales velocity, demand, and featured ranking."
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
      "/api/users/register": {
        post: {
          summary: "Create a user account",
          requestBody: {
            required: true,
            content: { "application/json": { schema: { $ref: "#/components/schemas/RegisterInput" } } }
          },
          responses: {
            "201": { description: "Account created", content: { "application/json": { schema: { $ref: "#/components/schemas/AuthResponse" } } } },
            "409": { description: "Email already registered" }
          }
        }
      },
      "/api/users/login": {
        post: {
          summary: "Sign in and create a session",
          requestBody: {
            required: true,
            content: { "application/json": { schema: { $ref: "#/components/schemas/LoginInput" } } }
          },
          responses: {
            "200": { description: "Signed in", content: { "application/json": { schema: { $ref: "#/components/schemas/AuthResponse" } } } },
            "401": { description: "Invalid credentials" }
          }
        }
      },
      "/api/users/me": {
        get: {
          summary: "Get the current user and profile",
          security: [{ bearerAuth: [] }],
          responses: {
            "200": { description: "Current user", content: { "application/json": { schema: { $ref: "#/components/schemas/UserProfileResponse" } } } },
            "401": { description: "Authentication required" }
          }
        },
        put: {
          summary: "Update the current user's discovery profile",
          security: [{ bearerAuth: [] }],
          requestBody: { required: true, content: { "application/json": { schema: { $ref: "#/components/schemas/ProfileInput" } } } },
          responses: {
            "200": { description: "Profile updated", content: { "application/json": { schema: { $ref: "#/components/schemas/UserProfileResponse" } } } },
            "400": { description: "Invalid profile" },
            "401": { description: "Authentication required" }
          }
        }
      },
      "/api/users/logout": {
        post: {
          summary: "End the current session",
          security: [{ bearerAuth: [] }],
          responses: { "204": { description: "Signed out" } }
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
      "/api/products/selling-fast": {
        get: {
          summary: "Get the six fastest-selling products for a search",
          parameters: [
            { name: "q", in: "query", required: false, schema: { type: "string" }, description: "Search phrase for the product collection" },
            { name: "not-suspicious", in: "query", required: false, schema: { type: "string", enum: ["Hum^n"] } },
            { name: "persona", in: "query", required: false, schema: { type: "string", enum: ["normal", "luxury", "bargain", "minimalist"] } }
          ],
          responses: {
            "200": { description: "Six products ordered by simulated sales velocity", content: { "application/json": { schema: { $ref: "#/components/schemas/ProductCollection" } } } },
            "502": { description: "Product generation failed" }
          }
        }
      },
      "/api/products/featured": {
        get: {
          summary: "Get the featured product for a search",
          parameters: [
            { name: "q", in: "query", required: false, schema: { type: "string" }, description: "Search phrase for the product collection" },
            { name: "not-suspicious", in: "query", required: false, schema: { type: "string", enum: ["Hum^n"] } },
            { name: "persona", in: "query", required: false, schema: { type: "string", enum: ["normal", "luxury", "bargain", "minimalist"] } }
          ],
          responses: {
            "200": { description: "One featured product", content: { "application/json": { schema: { $ref: "#/components/schemas/ProductCollection" } } } },
            "502": { description: "Product generation failed" }
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
      },
      "/api/cart": {
        get: {
          summary: "Get the authenticated user's cart",
          security: [{ bearerAuth: [] }],
          responses: {
            "200": { description: "Cart contents", content: { "application/json": { schema: { $ref: "#/components/schemas/Cart" } } } },
            "401": { description: "Authentication required" }
          }
        }
      },
      "/api/cart/items": {
        post: {
          summary: "Add an item to the authenticated user's cart",
          security: [{ bearerAuth: [] }],
          requestBody: {
            required: true,
            content: { "application/json": { schema: { $ref: "#/components/schemas/CartItemInput" } } }
          },
          responses: {
            "200": { description: "Updated cart", content: { "application/json": { schema: { $ref: "#/components/schemas/Cart" } } } },
            "400": { description: "Invalid cart item" },
            "401": { description: "Authentication required" }
          }
        }
      },
      "/api/cart/items/{itemId}": {
        delete: {
          summary: "Remove an item from the authenticated user's cart",
          security: [{ bearerAuth: [] }],
          parameters: [{ name: "itemId", in: "path", required: true, schema: { type: "string" } }],
          responses: {
            "200": { description: "Updated cart", content: { "application/json": { schema: { $ref: "#/components/schemas/Cart" } } } },
            "401": { description: "Authentication required" }
          }
        }
      },
      "/api/wallet": {
        get: {
          summary: "Get the authenticated user's wallet",
          security: [{ bearerAuth: [] }],
          responses: {
            "200": { description: "Wallet state", content: { "application/json": { schema: { $ref: "#/components/schemas/Wallet" } } } },
            "401": { description: "Authentication required" }
          }
        }
      },
      "/api/wallet/topup": {
        post: {
          summary: "Add funds to the authenticated user's wallet",
          security: [{ bearerAuth: [] }],
          requestBody: {
            required: true,
            content: { "application/json": { schema: { $ref: "#/components/schemas/TopUpRequest" } } }
          },
          responses: {
            "200": { description: "Updated wallet", content: { "application/json": { schema: { $ref: "#/components/schemas/Wallet" } } } },
            "400": { description: "Invalid amount" },
            "401": { description: "Authentication required" }
          }
        }
      },
      "/api/wallet/transactions": {
        get: {
          summary: "List wallet transactions",
          security: [{ bearerAuth: [] }],
          responses: {
            "200": {
              description: "Wallet transaction ledger",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: { transactions: { type: "array", items: { $ref: "#/components/schemas/WalletTransaction" } } },
                    required: ["transactions"]
                  }
                }
              }
            },
            "401": { description: "Authentication required" }
          }
        }
      },
      "/api/checkout": {
        post: {
          summary: "Checkout items for the authenticated user",
          security: [{ bearerAuth: [] }],
          requestBody: {
            required: false,
            content: { "application/json": { schema: { $ref: "#/components/schemas/CheckoutRequest" } } }
          },
          responses: {
            "200": { description: "Created order", content: { "application/json": { schema: { $ref: "#/components/schemas/Order" } } } },
            "400": { description: "Invalid checkout" },
            "401": { description: "Authentication required" },
            "402": { description: "Insufficient wallet balance" }
          }
        }
      },
      "/api/orders": {
        get: {
          summary: "List the authenticated user's orders",
          security: [{ bearerAuth: [] }],
          responses: {
            "200": {
              description: "Order history",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: { orders: { type: "array", items: { $ref: "#/components/schemas/Order" } } },
                    required: ["orders"]
                  }
                }
              }
            },
            "401": { description: "Authentication required" }
          }
        }
      },
      "/api/orders/{orderId}": {
        get: {
          summary: "Get one authenticated order",
          security: [{ bearerAuth: [] }],
          parameters: [{ name: "orderId", in: "path", required: true, schema: { type: "string" } }],
          responses: {
            "200": { description: "Order details", content: { "application/json": { schema: { $ref: "#/components/schemas/Order" } } } },
            "401": { description: "Authentication required" },
            "404": { description: "Order not found" }
          }
        }
      },
      "/api/orders/{orderId}/status": {
        get: {
          summary: "Get the delivery status for an authenticated order",
          security: [{ bearerAuth: [] }],
          parameters: [{ name: "orderId", in: "path", required: true, schema: { type: "string" } }],
          responses: {
            "200": { description: "Order delivery status", content: { "application/json": { schema: { $ref: "#/components/schemas/OrderStatus" } } } },
            "401": { description: "Authentication required" },
            "404": { description: "Order not found" }
          }
        }
      }
    },
    components: {
      securitySchemes: {
        bearerAuth: { type: "http", scheme: "bearer", bearerFormat: "session token" }
      },
      schemas: {
        ProductCollection: {
          type: "object",
          properties: {
            products: { type: "array", items: { $ref: "#/components/schemas/Product" } },
            source: { type: "string" },
            generatedOnDemand: { type: "boolean" },
            persona: { type: "string" },
            provenance: { $ref: "#/components/schemas/Provenance" }
          },
          required: ["products", "source", "generatedOnDemand", "persona", "provenance"]
        },
        CartItemInput: {
          type: "object",
          properties: {
            product: { $ref: "#/components/schemas/Product" },
            quantity: { type: "integer", minimum: 1, default: 1 }
          },
          required: ["product"]
        },
        CartItem: {
          type: "object",
          properties: {
            itemId: { type: "string" },
            quantity: { type: "integer" },
            product: { $ref: "#/components/schemas/Product" },
            addedAt: { type: "string", format: "date-time" },
            updatedAt: { type: "string", format: "date-time" }
          },
          required: ["itemId", "quantity", "product", "addedAt", "updatedAt"]
        },
        Cart: {
          type: "object",
          properties: {
            items: { type: "array", items: { $ref: "#/components/schemas/CartItem" } },
            itemCount: { type: "integer" },
            totalAmount: { type: "integer" },
            currency: { type: "string" }
          },
          required: ["items", "itemCount", "totalAmount", "currency"]
        },
        TopUpRequest: {
          type: "object",
          properties: {
            amount: { type: "integer", minimum: 1 },
            metadata: { type: "object", additionalProperties: true }
          },
          required: ["amount"]
        },
        Wallet: {
          type: "object",
          properties: {
            userId: { type: "string" },
            balance: { type: "integer" },
            createdAt: { type: ["string", "null"], format: "date-time" },
            updatedAt: { type: ["string", "null"], format: "date-time" }
          },
          required: ["userId", "balance", "createdAt", "updatedAt"]
        },
        WalletTransaction: {
          type: "object",
          properties: {
            id: { type: "string" },
            kind: { type: "string" },
            amount: { type: "integer" },
            balanceAfter: { type: "integer" },
            metadata: { type: "object", additionalProperties: true },
            createdAt: { type: "string", format: "date-time" }
          },
          required: ["id", "kind", "amount", "balanceAfter", "metadata", "createdAt"]
        },
        CheckoutRequest: {
          type: "object",
          properties: {
            source: { type: "string", enum: ["cart", "direct"] },
            items: { type: "array", items: { $ref: "#/components/schemas/CartItemInput" } }
          }
        },
        OrderItem: {
          type: "object",
          properties: {
            itemId: { type: "string" },
            quantity: { type: "integer" },
            unitPrice: { type: "integer" },
            product: { $ref: "#/components/schemas/Product" },
            createdAt: { type: "string", format: "date-time" }
          },
          required: ["itemId", "quantity", "unitPrice", "product", "createdAt"]
        },
        OrderStatus: {
          type: "object",
          properties: {
            orderId: { type: "string" },
            status: { type: "string" },
            nextStatus: { type: ["string", "null"] },
            estimatedDeliveryAt: { type: ["string", "null"], format: "date-time" },
            timeline: { type: "array", items: { type: "object" } },
            paymentStatus: { type: "string" },
            totalAmount: { type: "integer" },
            currency: { type: "string" }
          },
          required: ["orderId", "status", "nextStatus", "estimatedDeliveryAt", "timeline", "paymentStatus", "totalAmount", "currency"]
        },
        Order: {
          type: "object",
          properties: {
            id: { type: "string" },
            status: { type: "string" },
            nextStatus: { type: ["string", "null"] },
            estimatedDeliveryAt: { type: ["string", "null"], format: "date-time" },
            deliverySchedule: { type: "object" },
            deliveryTimeline: { type: "array", items: { type: "object" } },
            paymentStatus: { type: "string" },
            totalAmount: { type: "integer" },
            currency: { type: "string" },
            itemCount: { type: "integer" },
            checkoutSource: { type: "string" },
            createdAt: { type: "string", format: "date-time" },
            updatedAt: { type: "string", format: "date-time" },
            items: { type: "array", items: { $ref: "#/components/schemas/OrderItem" } }
          },
          required: ["id", "status", "nextStatus", "estimatedDeliveryAt", "deliverySchedule", "deliveryTimeline", "paymentStatus", "totalAmount", "currency", "itemCount", "checkoutSource", "createdAt", "updatedAt"]
        },
        RegisterInput: {
          type: "object",
          properties: {
            email: { type: "string", format: "email" },
            password: { type: "string", minLength: 8, format: "password" },
            displayName: { type: "string", maxLength: 80 }
          },
          required: ["email", "password"]
        },
        LoginInput: {
          type: "object",
          properties: { email: { type: "string", format: "email" }, password: { type: "string", format: "password" } },
          required: ["email", "password"]
        },
        User: {
          type: "object",
          properties: {
            id: { type: "string", format: "uuid" },
            email: { type: "string", format: "email" },
            displayName: { type: "string" },
            createdAt: { type: "string", format: "date-time" }
          },
          required: ["id", "email", "displayName", "createdAt"]
        },
        AuthResponse: {
          type: "object",
          properties: { user: { $ref: "#/components/schemas/User" }, token: { type: "string" } },
          required: ["user", "token"]
        },
        ProfileInput: {
          type: "object",
          properties: {
            persona: { type: "string", enum: ["normal", "luxury", "bargain", "minimalist"] },
            budgetMin: { type: "integer", minimum: 0, description: "Minimum simulated price in PHP" },
            budgetMax: { type: "integer", minimum: 0, description: "Maximum simulated price in PHP" },
            preferredCategories: { type: "array", items: { type: "string" }, maxItems: 20 },
            excludedCategories: { type: "array", items: { type: "string" }, maxItems: 20 }
          }
        },
        Profile: {
          allOf: [{ $ref: "#/components/schemas/ProfileInput" }],
          type: "object",
          properties: { updatedAt: { type: ["string", "null"], format: "date-time" } },
          required: ["persona", "budgetMin", "budgetMax", "preferredCategories", "excludedCategories", "updatedAt"]
        },
        UserProfileResponse: {
          type: "object",
          properties: { user: { $ref: "#/components/schemas/User" }, profile: { $ref: "#/components/schemas/Profile" } },
          required: ["user", "profile"]
        },
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
            provenance: { $ref: "#/components/schemas/Provenance" },
            market: { $ref: "#/components/schemas/MarketState" }
          },
          required: ["id", "title", "category", "imageUrl", "persona", "explanation", "rating", "reviewCount", "reviews", "price", "source", "provenance", "market"]
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
        MarketState: {
          type: "object",
          description: "Deterministic simulated market state for the current UTC day.",
          properties: {
            day: { type: "string", format: "date" },
            source: { type: "string", enum: ["seeded", "observed"], description: "Whether real checkouts have influenced this product today" },
            inventory: { type: "integer", minimum: 0 },
            unitsSold: { type: "integer", minimum: 0 },
            salesVelocity: { type: "integer", minimum: 0, description: "Simulated units sold today" },
            demandScore: { type: "integer", minimum: 0 },
            featuredScore: { type: "integer", minimum: 0 },
            trend: { type: "string", enum: ["rising", "steady", "cooling"] }
          },
          required: ["day", "source", "inventory", "unitsSold", "salesVelocity", "demandScore", "featuredScore", "trend"]
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
    // Always derive artwork from the individual product identity. This also repairs
    // legacy cached collections whose images were generated from the search alone.
    const imageUrl = createProductImage(product.title, product.description, product.id);
    const needsImage = product.imageUrl !== imageUrl;
    const needsReviews = !Array.isArray(product.reviews) || product.rating === undefined || product.reviewCount === undefined;
    const needsPersona = product.persona === undefined || product.explanation === undefined || product.provenance === undefined;
    if (!needsImage && !needsReviews && !needsPersona) return product;
    changed = true;
    return repairGeneratedProduct({
      ...product,
      imageUrl,
      rating: product.rating ?? reviews.rating,
      reviewCount: product.reviewCount ?? reviews.reviewCount,
      reviews: product.reviews ?? reviews.reviews
    }, { query, persona, cached: Boolean(cached) });
  });
  if (changed && catalog) await catalog.set(collectionKey, collection);
  const marketStore = await getMarketStore();
  const products = await Promise.all(collection.slice(0, limit).map(async (product) => ({
    ...product,
    market: marketStore ? await marketStore.getMarket(product) : enrichWithMarket(product).market
  })));
  const duplicateImages = products.length - new Set(products.map((product) => product.imageUrl)).size;
  if (duplicateImages > 0) {
    console.warn(`[product-api] duplicate imageUrl values detected for query "${query}" (${duplicateImages} duplicates)`);
  }
  return {
    products,
    source: cached ? "catalog" : (persona === "intergalactic" ? "intergalactic-mart" : "on-demand-catalog"),
    cached,
    persona,
    provenance: { query, persona, cached: Boolean(cached) }
  };
}

async function resolvePersonalizedCollection(request, url, minimumLimit = 0) {
  const search = parseSearch(url);
  let profile;
  if (!search.hasExplicitPersona && !search.secretMode) {
    const token = bearerToken(request);
    const store = token && await getUserStore();
    const user = store && await store.getUserForToken(token);
    if (user) profile = await store.getProfile(user.id);
  }
  const persona = profile?.persona || search.persona;
  const result = await resolveCollection(search.query, 50, persona);
  const products = profile ? tailorProducts(result.products, profile) : result.products;
  return {
    ...result,
    products: products.slice(0, Math.max(search.limit, minimumLimit)),
    persona,
    query: search.query,
    limit: search.limit,
    provenance: { ...result.provenance, persona, profileApplied: Boolean(profile) }
  };
}

function tailorProducts(products, profile) {
  const preferred = new Set(profile.preferredCategories.map((category) => category.toLowerCase()));
  const excluded = new Set(profile.excludedCategories.map((category) => category.toLowerCase()));
  const allowed = products.filter((product) => !excluded.has(product.category.toLowerCase()));
  const candidates = allowed.length ? allowed : products;
  const budgetDistance = (amount) => {
    if (profile.budgetMin !== null && amount < profile.budgetMin) return profile.budgetMin - amount;
    if (profile.budgetMax !== null && amount > profile.budgetMax) return amount - profile.budgetMax;
    return 0;
  };
  return [...candidates].sort((left, right) => {
    const preference = Number(preferred.has(right.category.toLowerCase())) - Number(preferred.has(left.category.toLowerCase()));
    return preference || budgetDistance(left.price.amount) - budgetDistance(right.price.amount);
  });
}

async function handleSearch(request, url, response) {
  const { query, limit } = parseSearch(url);
  if (!query) return json(response, 400, { error: "q is required" });
  try {
    const { products, source, cached, provenance, persona } = await resolvePersonalizedCollection(request, url);
    return json(response, 200, { products, source, generatedOnDemand: !cached, persona, provenance }, { "cache-control": "no-store" });
  } catch (error) {
    return json(response, 502, { error: error.message || "Product search failed" });
  }
}

async function handleCuratedCollection(request, url, response, { count, sort }) {
  const { query } = parseSearch(url);
  try {
    const curatedUrl = new URL(url.toString());
    curatedUrl.searchParams.set("q", defaultCuratedQuery("curated picks", query));
    const result = await resolvePersonalizedCollection(request, curatedUrl, count);
    const products = [...result.products]
      .filter((product) => product.market.inventory > 0)
      .sort(sort)
      .slice(0, count);
    return json(response, 200, {
      products,
      source: result.source,
      generatedOnDemand: !result.cached,
      persona: result.persona,
      provenance: result.provenance
    }, { "cache-control": "no-store" });
  } catch (error) {
    return json(response, 502, { error: error.message || "Product collection failed" });
  }
}

async function requireCommerceUser(request, response) {
  const auth = await requireAuthedUser(request, response);
  if (!auth) return null;
  const commerce = await getCommerceStore();
  if (!commerce) {
    json(response, 503, { error: "Commerce storage is unavailable. Configure Turso to enable carts and checkout." });
    return null;
  }
  return { ...auth, commerce };
}

async function handleCartGet(request, response) {
  const auth = await requireCommerceUser(request, response);
  if (!auth) return;
  try {
    return json(response, 200, await auth.commerce.getCart(auth.user.id), { "cache-control": "no-store" });
  } catch (error) {
    return json(response, 502, { error: error.message || "Could not load cart" });
  }
}

async function handleCartAdd(request, response) {
  const auth = await requireCommerceUser(request, response);
  if (!auth) return;
  try {
    return json(response, 200, await auth.commerce.addCartItem(auth.user.id, await readJson(request)), { "cache-control": "no-store" });
  } catch (error) {
    return json(response, error.status || 502, { error: error.message || "Could not update cart" });
  }
}

async function handleCartRemove(request, response, itemId) {
  const auth = await requireCommerceUser(request, response);
  if (!auth) return;
  try {
    return json(response, 200, await auth.commerce.removeCartItem(auth.user.id, itemId), { "cache-control": "no-store" });
  } catch (error) {
    return json(response, error.status || 502, { error: error.message || "Could not update cart" });
  }
}

async function handleWalletGet(request, response) {
  const auth = await requireCommerceUser(request, response);
  if (!auth) return;
  try {
    return json(response, 200, await auth.commerce.getWallet(auth.user.id), { "cache-control": "no-store" });
  } catch (error) {
    return json(response, 502, { error: error.message || "Could not load wallet" });
  }
}

async function handleWalletTopUp(request, response) {
  const auth = await requireCommerceUser(request, response);
  if (!auth) return;
  try {
    const input = await readJson(request);
    return json(response, 200, await auth.commerce.topUpWallet(auth.user.id, input.amount, input.metadata || {}), { "cache-control": "no-store" });
  } catch (error) {
    return json(response, error.status || 502, { error: error.message || "Could not add funds" });
  }
}

async function handleWalletTransactions(request, response) {
  const auth = await requireCommerceUser(request, response);
  if (!auth) return;
  try {
    const url = new URL(request.url, `http://${request.headers.host}`);
    const limit = Number(url.searchParams.get("limit") || 50);
    return json(response, 200, { transactions: await auth.commerce.listWalletTransactions(auth.user.id, limit) }, { "cache-control": "no-store" });
  } catch (error) {
    return json(response, 502, { error: error.message || "Could not load transactions" });
  }
}

async function handleCheckout(request, response) {
  const auth = await requireCommerceUser(request, response);
  if (!auth) return;
  try {
    return json(response, 200, await auth.commerce.checkout(auth.user.id, await readJson(request)), { "cache-control": "no-store" });
  } catch (error) {
    return json(response, error.status || 502, { error: error.message || "Could not checkout" });
  }
}

async function handleOrdersList(request, response) {
  const auth = await requireCommerceUser(request, response);
  if (!auth) return;
  try {
    const url = new URL(request.url, `http://${request.headers.host}`);
    const limit = Number(url.searchParams.get("limit") || 20);
    return json(response, 200, { orders: await auth.commerce.listOrders(auth.user.id, limit) }, { "cache-control": "no-store" });
  } catch (error) {
    return json(response, 502, { error: error.message || "Could not load orders" });
  }
}

async function handleOrderGet(request, response, orderId) {
  const auth = await requireCommerceUser(request, response);
  if (!auth) return;
  try {
    const order = await auth.commerce.getOrder(auth.user.id, orderId);
    if (!order) return json(response, 404, { error: "Order not found" });
    return json(response, 200, order, { "cache-control": "no-store" });
  } catch (error) {
    return json(response, 502, { error: error.message || "Could not load order" });
  }
}

async function handleOrderStatus(request, response, orderId) {
  const auth = await requireCommerceUser(request, response);
  if (!auth) return;
  try {
    const status = await auth.commerce.getOrderStatus(auth.user.id, orderId);
    if (!status) return json(response, 404, { error: "Order not found" });
    return json(response, 200, status, { "cache-control": "no-store" });
  } catch (error) {
    return json(response, 502, { error: error.message || "Could not load order status" });
  }
}

async function handleSellingFast(request, url, response) {
  return handleCuratedCollection(request, url, response, {
    count: 6,
    sort: compareSalesVelocity
  });
}

async function handleFeatured(request, url, response) {
  return handleCuratedCollection(request, url, response, {
    count: 1,
    sort: compareFeatured
  });
}

async function handleStream(request, url, response) {
  const { query, limit, persona: initialPersona } = parseSearch(url);
  let persona = initialPersona;
  if (!query) return json(response, 400, { error: "q is required" });

  response.writeHead(200, {
    "content-type": "text/event-stream; charset=utf-8",
    "cache-control": "no-cache, no-transform",
    connection: "keep-alive"
  });
  const send = (name, payload) => response.write(`event: ${name}\ndata: ${JSON.stringify(payload)}\n\n`);

  send("status", { phase: "searching", query, persona });
  try {
    const { products, source, cached, provenance, persona: resolvedPersona } = await resolvePersonalizedCollection(request, url);
    persona = resolvedPersona;
    send("status", { phase: cached ? "catalog-hit" : "sourced", query, persona });
    for (const product of products) send("product", product);
    send("done", { count: products.length, source, persona, provenance });
  } catch (error) {
    send("error", { message: error.message || "Product search failed" });
  } finally {
    response.end();
  }
}

async function handleShelf(request, url, response) {
  const { query, limit, persona: initialPersona } = parseSearch(url);
  let persona = initialPersona;
  if (!query) return json(response, 400, { error: "q is required" });

  response.writeHead(200, {
    "content-type": "text/event-stream; charset=utf-8",
    "cache-control": "no-cache, no-transform",
    connection: "keep-alive"
  });
  const send = (name, payload) => response.write(`event: ${name}\ndata: ${JSON.stringify(payload)}\n\n`);

  send("status", { phase: "building-shelf", query, persona });
  try {
    const { products, source, cached, provenance, persona: resolvedPersona } = await resolvePersonalizedCollection(request, url, 12);
    persona = resolvedPersona;
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

async function handleCompare(request, url, response) {
  const { query, limit, persona: initialPersona } = parseSearch(url);
  let persona = initialPersona;
  const requestedCount = Number(url.searchParams.get("count") || 4);
  const count = Math.min(Math.max(Number.isFinite(requestedCount) ? requestedCount : 4, 2), 4);
  const ids = url.searchParams.get("ids")?.split(",").map((id) => id.trim()).filter(Boolean) || [];
  if (!query) return json(response, 400, { error: "q is required" });

  try {
    const { products, source, cached, provenance, persona: resolvedPersona } = await resolvePersonalizedCollection(request, url, count);
    persona = resolvedPersona;
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
    if (request.method === "POST" && url.pathname === "/api/users/register") return handleRegistration(request, response);
    if (request.method === "POST" && url.pathname === "/api/users/login") return handleLogin(request, response);
    if (request.method === "POST" && url.pathname === "/api/users/logout") return handleLogout(request, response);
    if (request.method === "GET" && url.pathname === "/api/users/me") return handleCurrentUser(request, response);
    if (request.method === "PUT" && url.pathname === "/api/users/me") return handleProfileUpdate(request, response);
    if (request.method === "GET" && (url.pathname === "/api/products/search" || url.pathname === "/v1/products/search")) {
      return handleSearch(request, url, response);
    }
    if (request.method === "GET" && url.pathname === "/api/products/selling-fast") return handleSellingFast(request, url, response);
    if (request.method === "GET" && url.pathname === "/api/products/featured") return handleFeatured(request, url, response);
    if (request.method === "GET" && url.pathname === "/api/cart") return handleCartGet(request, response);
    if (request.method === "POST" && url.pathname === "/api/cart/items") return handleCartAdd(request, response);
    if (request.method === "DELETE" && url.pathname.startsWith("/api/cart/items/")) {
      return handleCartRemove(request, response, decodeURIComponent(url.pathname.slice("/api/cart/items/".length)));
    }
    if (request.method === "GET" && url.pathname === "/api/wallet") return handleWalletGet(request, response);
    if (request.method === "POST" && url.pathname === "/api/wallet/topup") return handleWalletTopUp(request, response);
    if (request.method === "GET" && url.pathname === "/api/wallet/transactions") return handleWalletTransactions(request, response);
    if (request.method === "POST" && url.pathname === "/api/checkout") return handleCheckout(request, response);
    if (request.method === "GET" && url.pathname === "/api/orders") return handleOrdersList(request, response);
    if (request.method === "GET" && /^\/api\/orders\/[^/]+\/status$/.test(url.pathname)) {
      return handleOrderStatus(request, response, decodeURIComponent(url.pathname.slice("/api/orders/".length, -"/status".length)));
    }
    if (request.method === "GET" && /^\/api\/orders\/[^/]+$/.test(url.pathname)) {
      return handleOrderGet(request, response, decodeURIComponent(url.pathname.slice("/api/orders/".length)));
    }
    if (request.method === "GET" && url.pathname === "/api/products/stream") {
      return handleStream(request, url, response);
    }
    if (request.method === "GET" && url.pathname === "/api/products/shelf") {
      return handleShelf(request, url, response);
    }
    if (request.method === "GET" && url.pathname === "/api/products/compare") {
      return handleCompare(request, url, response);
    }
    return json(response, 404, { error: "Not found" });
  } catch (error) {
    return json(response, error.status || 500, { error: error.message || "Internal server error" });
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const server = http.createServer(handleRequest);
  server.listen(port, () => console.log(`Product Discovery Service listening on http://localhost:${port}`));
}
